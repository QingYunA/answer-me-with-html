// Browser seam for the reader's text-size buttons (#302, phase 3): render pages, open them in headless Chrome and check that
// A− / A+ change --am-scale, the page text, and the drawing boxes; that the choice survives a reload; and that a blocked
// localStorage (as under `am serve`) leaves the buttons working for the tab. Slow and needs Chrome, so it runs only with AM_E2E=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser scale tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DESKTOP = 1440;
const PHONE = 390;
const LAYOUT_WAIT_MS = 1000; // generous: the page waits 150 ms after a scale change, then plans and applies the layout (budget 1 s)

const DRAFT = `---
title: Text size
subtitle: A− and A+ on the page
cols: 3
lang: en
author: Test
---
This page has enough text to show the reader's text size, and a diagram whose box grows with it.

## A Text
This panel is plain text. It sits in a row with other panels and wraps to a few lines. It is here to show the page text size
changing without a layout pass hiding a panel or making the page scroll sideways.

## B More text
The toolbar keeps its own size while the page grows: the A− and A+ buttons stay the same height and font, so the controls never
move away from the reader. The choice is stored in this browser.

## C Pipeline
\`\`\`flow LR
(Idea) -> spec: write it
spec -> tickets: split it
tickets -> code: build it
\`\`\`
`;

// The same toolbar on a right-to-left page: its inline start is the right edge, and it must stay reachable there.
const RTL_DRAFT = `---
title: גודל טקסט
lang: he
cols: 3
---
טקסט.

## A טקסט
זה פאנל עם טקסט רגיל, כדי שהעמוד ייראה כמו עמוד אמיתי.

## B עוד טקסט
הסרגל נשאר בגודל קבוע כאשר הטקסט גדל.

## C תרשים
\`\`\`flow LR
(Idea) -> spec: write it
spec -> tickets: split it
\`\`\`
`;

// The state one test needs, read in the page in one call.
const STATE = `(() => {
  const root = document.documentElement;
  const down = document.querySelector('[data-am="scale-down"]');
  const up = document.querySelector('[data-am="scale-up"]');
  const svg = document.querySelector('.am-diagram > svg[role="img"]');
  const vb = svg?.viewBox?.baseVal;
  return {
    scale: parseFloat(getComputedStyle(root).getPropertyValue('--am-scale')) || 1,
    inline: root.style.getPropertyValue('--am-scale'),
    body: parseFloat(getComputedStyle(document.body).fontSize),
    downHidden: down.hidden, upHidden: up.hidden,
    downDisabled: down.getAttribute('aria-disabled') === 'true',
    upDisabled: up.getAttribute('aria-disabled') === 'true',
    downWidth: down.getBoundingClientRect().width, upWidth: up.getBoundingClientRect().width,
    svgWidth: svg ? Number(svg.getAttribute('width')) : null,
    svgHeight: svg ? Number(svg.getAttribute('height')) : null,
    vbWidth: vb ? vb.width : null,
    vbHeight: vb ? vb.height : null,
  };
})()`;

// Every panel fits its box, and the page does not scroll sideways.
const OVERFLOW = `(() => {
  const panels = [...document.querySelectorAll('.am-grid .am-panel')];
  return {
    panels: panels.filter((p) => p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1).map((p) => p.id),
    page: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

// The toolbar at a phone width: it opens at its end (Reply, Remark, Copy source), and scrolling to the start reaches Theme.
const TOOLBAR = `(() => {
  const bar = document.querySelector('.am-toolbar');
  const rtl = getComputedStyle(bar).direction === 'rtl';
  const controls = [...bar.querySelectorAll('.am-btn, .am-pick')].filter((c) => c.getClientRects().length);
  const theme = bar.querySelector('select[data-am="theme"]').closest('.am-pick');
  const reply = bar.querySelector('[data-am="reply"]');
  const remark = bar.querySelector('[data-am="remark"]');
  const copy = bar.querySelector('[data-am="copy"]');
  const inside = (el) => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= innerWidth + 1;
  };
  const rect = bar.getBoundingClientRect();
  const tops = controls.map((c) => c.getBoundingClientRect().top);
  const heights = controls.map((c) => c.getBoundingClientRect().height);
  const end = { reply: inside(reply), remark: inside(remark), copy: inside(copy) };
  // Start for the direction: 0 on the left, or the clamped right edge in a right-to-left box.
  bar.scrollTo({ left: rtl ? bar.scrollWidth : 0 });
  const start = { theme: inside(theme), lefts: controls.map((c) => c.getBoundingClientRect().left) };
  return {
    rtl,
    end,
    start,
    barLeft: rect.left,
    barRight: rect.right,
    innerWidth,
    oneRow: tops.every((top) => Math.abs(top - tops[0]) <= 1),
    height: rect.height,
    controlHeight: Math.max(...heights),
    page: document.documentElement.scrollWidth - window.innerWidth,
    scrolls: bar.scrollWidth > bar.clientWidth + 1,
  };
})()`;

let tmp;
let chrome;
let cdp;
let session;
let file;
let rtlFile;

const page = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const setWidth = (width) => page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (condition, what, timeout = 4000) => {
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(condition)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(25);
  }
};
const state = () => evaluate(STATE);
const overflow = () => evaluate(OVERFLOW);
const click = (name) => evaluate(`document.querySelector('[data-am="${name}"]').click()`);
const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
};
const pressKey = async (name, modifiers = 0) => {
  const key = KEYS[name];
  await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key, modifiers });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key, modifiers });
};
const openFile = async (path, width) => {
  await setWidth(width);
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(path).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => true)');
};
const open = (width) => openFile(file, width);
// A page with no stored choice, whatever an earlier test left in this profile.
const fresh = async (width) => {
  await open(width);
  await evaluate("localStorage.removeItem('am-scale')");
  await open(width);
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-scale-'));
  file = join(tmp, 'scale.html');
  writeFileSync(file, renderDoc(DRAFT).html);
  rtlFile = join(tmp, 'scale-he.html');
  writeFileSync(rtlFile, renderDoc(RTL_DRAFT).html);
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', `--window-size=${DESKTOP},900`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable');
});

after(async () => {
  cdp?.close();
  if (chrome) {
    await new Promise((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    // Chrome helper processes can still write to the profile after the main process exits (#74).
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

test('e2e scale: the buttons are visible, step the text and drawing, and stop at the ends', { skip: SKIP, timeout: 180000 }, async () => {
  await fresh(DESKTOP);
  const start = await state();
  assert.equal(start.downHidden, false, 'A− is revealed after load');
  assert.equal(start.upHidden, false, 'A+ is revealed after load');
  assert.ok(start.downWidth > 0 && start.upWidth > 0, 'both buttons take room in the toolbar');
  assert.equal(start.scale, 1);
  assert.equal(start.inline, '', 'a page with no stored choice gets no inline --am-scale');
  assert.ok(Math.abs(start.body - 14) < 0.01, `body text starts at 14px, got ${start.body}`);
  assert.equal(start.svgWidth, Math.ceil(start.vbWidth), 'the drawing box starts at its viewBox size');

  await click('scale-up');
  const one = await state();
  assert.ok(Math.abs(one.scale - 1.05) < 1e-9, `one click is one step, got ${one.scale}`);
  assert.ok(Math.abs(one.body - 14.7) < 0.01, `body text follows to 14.7px, got ${one.body}`);
  assert.equal(one.svgWidth, Math.ceil(one.vbWidth * 1.05), 'the drawing width is ceil(viewBox × scale)');
  assert.equal(one.svgHeight, Math.ceil(one.vbHeight * 1.05), 'the drawing height is ceil(viewBox × scale)');

  await wait(LAYOUT_WAIT_MS);
  const desktop = await overflow();
  assert.deepEqual(desktop.panels, [], `no panel overflows at ${DESKTOP}px`);
  assert.ok(desktop.page <= 0, `the page does not scroll sideways at ${DESKTOP}px`);

  for (let i = 0; i < 9; i++) await click('scale-up');
  const max = await state();
  assert.equal(max.scale, 1.5, 'the last step is 1.5');
  assert.equal(max.upDisabled, true, 'A+ announces it is unavailable at the top of the range');
  assert.equal(max.downDisabled, false, 'A− still works at the top of the range');

  // The viewer fits the drawing by its viewBox, so a scale change must not break opening it.
  await evaluate("document.querySelector('.am-diagram-expand').click()");
  const viewer = await evaluate(`(() => {
    const lb = document.querySelector('.am-lightbox');
    const svg = lb.querySelector('.am-lightbox-canvas svg');
    const box = svg.getBoundingClientRect();
    const stage = lb.querySelector('.am-lightbox-stage').getBoundingClientRect();
    return { open: !lb.hasAttribute('hidden'), width: box.width, height: box.height, fits: box.width <= stage.width + 1 && box.height <= stage.height + 1 };
  })()`);
  assert.equal(viewer.open, true, 'the lightbox opens after a scale change');
  assert.ok(viewer.width > 0 && viewer.height > 0 && viewer.fits, 'the drawing fits the lightbox stage');
  await evaluate("document.querySelector('.am-lightbox-close').click()");

  // Load at the phone width: the toolbar's end is set during the page script, before the first paint.
  await open(PHONE);
  await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid' && document.querySelectorAll('.am-panel[style*=width], .am-panel[style*=flex]').length === 0", 'the phone grid');
  const phone = await overflow();
  assert.deepEqual(phone.panels, [], `no panel overflows at ${PHONE}px`);
  assert.ok(phone.page <= 0, `the page does not scroll sideways at ${PHONE}px`);
  assert.equal((await state()).upDisabled, true, 'A+ stays unavailable after the width change');

  const toolbar = await evaluate(TOOLBAR);
  assert.equal(toolbar.end.reply && toolbar.end.remark && toolbar.end.copy, true, 'the toolbar opens at its end: Reply, Remark and Copy source are fully visible');
  assert.equal(toolbar.start.theme, true, 'scrolling to the start reaches Theme fully');
  assert.ok(toolbar.start.lefts.every((left) => left >= 0), `every toolbar control starts inside the viewport at the start: ${toolbar.start.lefts.map(Math.round).join(', ')}`);
  assert.ok(toolbar.oneRow, 'the toolbar stays on one row');
  assert.ok(Math.abs(toolbar.height - toolbar.controlHeight) <= 2, `the toolbar is one control high: ${toolbar.height} vs ${toolbar.controlHeight}`);
  assert.ok(toolbar.page <= 0, `the toolbar adds no horizontal page overflow at ${PHONE}px`);
  assert.ok(toolbar.scrolls, 'the toolbar scrolls sideways within itself');

  // They live in the toolbar, which print hides.
  await page('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evaluate("document.querySelector('[data-am=\"scale-down\"]').checkVisibility()"), false, 'the size buttons are hidden in print');
  await page('Emulation.setEmulatedMedia', { media: '' });
});

test('e2e scale: the end buttons keep keyboard focus and announce aria-disabled', { skip: SKIP, timeout: 120000 }, async () => {
  const focused = (action) => evaluate(`document.activeElement === document.querySelector('[data-am="${action}"]')`);
  const aria = (action) => evaluate(`document.querySelector('[data-am="${action}"]').getAttribute('aria-disabled')`);

  await fresh(DESKTOP);
  await evaluate("document.querySelector('[data-am=\"scale-up\"]').focus()");
  for (let i = 0; i < 10; i++) await pressKey('Enter');
  let s = await state();
  assert.equal(s.scale, 1.5, 'Enter on A+ reaches the top of the range');
  assert.equal(s.upDisabled, true, 'A+ announces it is unavailable');
  assert.equal(await focused('scale-up'), true, 'A+ keeps keyboard focus at the top of the range');
  assert.equal(await aria('scale-up'), 'true', 'A+ carries aria-disabled=true');
  await pressKey('Enter');
  assert.equal((await state()).scale, 1.5, 'one more Enter at the top changes nothing');
  assert.equal(await focused('scale-up'), true, 'focus stays on A+ after the ignored key');

  await pressKey('Tab', 8); // Shift+Tab
  assert.equal(await focused('scale-down'), true, 'Shift+Tab moves to A−');
  await pressKey('Enter');
  assert.equal((await state()).scale, 1.45, 'A− lowers the scale again');
  assert.equal((await state()).upDisabled, false, 'A+ is available again after A− lowers the scale');

  await fresh(DESKTOP);
  await evaluate("document.querySelector('[data-am=\"scale-down\"]').focus()");
  for (let i = 0; i < 4; i++) await pressKey('Enter');
  s = await state();
  assert.equal(s.scale, 0.8, 'Enter on A− reaches the bottom of the range');
  assert.equal(s.downDisabled, true, 'A− announces it is unavailable');
  assert.equal(await focused('scale-down'), true, 'A− keeps keyboard focus at the bottom of the range');
  assert.equal(await aria('scale-down'), 'true', 'A− carries aria-disabled=true');
  await pressKey('Enter');
  assert.equal((await state()).scale, 0.8, 'one more Enter at the bottom changes nothing');
  assert.equal(await focused('scale-down'), true, 'focus stays on A− after the ignored key');
});

test('e2e scale: a reload restores the reader\'s stored choice', { skip: SKIP, timeout: 120000 }, async () => {
  await fresh(DESKTOP);
  await click('scale-up');
  await click('scale-up');
  const chosen = await state();
  assert.ok(Math.abs(chosen.scale - 1.1) < 1e-9, `two clicks reach 1.1, got ${chosen.scale}`);

  await open(DESKTOP);
  const restored = await state();
  assert.ok(Math.abs(restored.scale - 1.1) < 1e-9, `the reload keeps 1.1, got ${restored.scale}`);
  assert.ok(Math.abs(restored.body - 15.4) < 0.01, `the restored page text is 15.4px, got ${restored.body}`);
  assert.equal(restored.svgWidth, Math.ceil(restored.vbWidth * 1.1), 'the restored drawing box also follows the stored scale');
});

test('e2e scale: the right-to-left toolbar mirrors its end and start', { skip: SKIP, timeout: 120000 }, async () => {
  await openFile(rtlFile, PHONE);
  const bar = await evaluate(TOOLBAR);
  assert.equal(bar.rtl, true, 'the toolbar inherits the page direction');
  assert.ok(bar.barLeft >= 0 && bar.barRight <= bar.innerWidth, `the mirrored toolbar stays inside the viewport: ${bar.barLeft}..${bar.barRight}`);
  assert.equal(bar.end.reply && bar.end.remark && bar.end.copy, true, 'the RTL toolbar opens at its end: Reply, Remark and Copy source are fully visible');
  assert.equal(bar.start.theme, true, 'scrolling to the RTL start reaches Theme fully');
  assert.ok(bar.oneRow, 'the toolbar stays on one row');
  assert.ok(Math.abs(bar.height - bar.controlHeight) <= 2, `the toolbar is one control high: ${bar.height} vs ${bar.controlHeight}`);
  assert.ok(bar.page <= 0, `the toolbar adds no horizontal page overflow at ${PHONE}px`);
});

test('e2e scale: with localStorage throwing, the buttons still work for the tab', { skip: SKIP, timeout: 120000 }, async () => {
  await open(DESKTOP);
  const { identifier } = await page('Page.addScriptToEvaluateOnNewDocument', {
    source: `Storage.prototype.getItem = function () { throw new Error('storage blocked'); };
      Storage.prototype.setItem = function () { throw new Error('storage blocked'); };`,
  });
  try {
    await open(DESKTOP);
    const start = await state();
    assert.equal(start.scale, 1, 'a blocked storage read leaves the page at its own scale');
    assert.equal(start.downHidden, false, 'the buttons are revealed without storage');

    await click('scale-up');
    assert.ok(Math.abs((await state()).scale - 1.05) < 1e-9, 'a click changes the scale in this tab');
    await wait(LAYOUT_WAIT_MS);
    assert.deepEqual((await overflow()).panels, [], 'the page lays out again without storage');
    await click('scale-down');
    assert.equal((await state()).scale, 1, 'a second click steps back');
  } finally {
    await page('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});
