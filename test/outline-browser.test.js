// Browser seam for the doc outline rail (src/templates/doc.js, src/runtime/outline.js): keyboard, touch, the open direction at the
// screen edge, the current section, no JavaScript, print and a right-to-left page. Needs Chrome, so it runs only with AM_E2E=1
// like test/csp-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser outline tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const ID = (i) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);
const draft = (frontmatter, title = 'Section') => {
  const sections = Array.from({ length: 24 }, (_, i) => `## ${ID(i)} ${title} number ${i + 1} of the long page\n\n${'A sentence that fills the section so the page scrolls. '.repeat(6)}\n`);
  return `---\ntemplate: doc\ntitle: Outline rail\n${frontmatter}---\nA short introduction to a long page.\n\n${sections.join('\n')}`;
};

let tmp;
let chrome;
let cdp;
let session;
const files = {};

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression, what) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}
async function open(name, width = 1440, { mobile = false, height = 900 } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(files[name]).href });
  await loaded;
}
const rect = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; })()`);
const isOpen = () => evaluate('document.querySelector(".am-outline").open');
const active = () => evaluate('document.activeElement.matches("summary") ? "summary" : document.activeElement.getAttribute("href")');
async function key(k, code, vk, text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
}
async function click(x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}
async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-outline-'));
  const drafts = {
    right: draft(''),
    left: draft('outline: left\n'),
    // lang: he only sets the direction and labels; the content stays English so the test reads its own ids
    rtlRight: draft('lang: he\n'),
    rtlLeft: draft('lang: he\noutline: left\n'),
  };
  for (const [name, src] of Object.entries(drafts)) {
    writeFileSync(join(tmp, `${name}.md`), src);
    files[name] = join(tmp, `${name}.html`);
    execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', join(tmp, `${name}.md`), '-o', files[name], '--no-open'], {
      env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
    });
  }
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
});

after(async () => {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((r) => {
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

test('outline: Enter opens the list, arrows move between links, Esc closes and returns to the rail', { skip: SKIP }, async () => {
  await open('right');
  assert.equal(await isOpen(), false);
  await evaluate('document.querySelector(".am-outline > summary").focus()');
  await key('Enter', 'Enter', 13, '\r');
  assert.equal(await isOpen(), true);
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await active(), '#panel-A');
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await active(), '#panel-B');
  await key('ArrowUp', 'ArrowUp', 38);
  assert.equal(await active(), '#panel-A');
  await key('End', 'End', 35);
  assert.equal(await active(), `#panel-${ID(23)}`);
  await key('Escape', 'Escape', 27);
  assert.equal(await isOpen(), false);
  assert.equal(await active(), 'summary');
});

test('outline: a link jumps to its section and closes the list', { skip: SKIP }, async () => {
  await open('right');
  await evaluate('document.querySelector(".am-outline > summary").focus()');
  await key(' ', 'Space', 32, ' ');
  assert.equal(await isOpen(), true);
  const r = await rect('.am-outline-list a[href="#panel-M"]');
  await click(...Object.values(center(r)));
  await until('location.hash === "#panel-M"', 'the hash');
  assert.equal(await isOpen(), false);
  await until('Math.abs(document.getElementById("panel-M").getBoundingClientRect().top) < 40', 'the jump');
});

test('outline: a tap opens the list and a tap outside closes it', { skip: SKIP }, async () => {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  try {
    await open('right', 390, { mobile: true, height: 844 });
    const c = center(await rect('.am-outline > summary'));
    await tap(c.x, c.y);
    await until('document.querySelector(".am-outline").open', 'the list to open');
    await tap(60, 600);
    await until('!document.querySelector(".am-outline").open', 'the list to close');
  } finally {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
});

test('outline: dwelling on the rail with a mouse opens the list', { skip: SKIP }, async () => {
  await open('right');
  const c = center(await rect('.am-outline > summary'));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  assert.equal(await isOpen(), false, 'not at once');
  await until('document.querySelector(".am-outline").open', 'the dwell');
});

test('outline: a list opened by hover stays open while a link has the keyboard focus', { skip: SKIP }, async () => {
  await open('right');
  const c = center(await rect('.am-outline > summary'));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await until('document.querySelector(".am-outline").open', 'the dwell');
  await evaluate('document.querySelector(".am-outline-list a").focus()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 600 });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await isOpen(), true, 'the focused list stays open after the pointer leaves');
});

test('outline: the toolbar and the reply bar stay above the rail', { skip: SKIP }, async () => {
  await open('right');
  const z = await evaluate('[".am-toc", ".am-toolbar", ".am-reply-bar"].map((s) => document.querySelector(s) && Number(getComputedStyle(document.querySelector(s)).zIndex))');
  assert.ok(z[0] < z[1], `rail ${z[0]} below toolbar ${z[1]}`);
  if (z[2] !== null) assert.ok(z[0] < z[2], `rail ${z[0]} below reply bar ${z[2]}`);
});

test('outline: the list opens away from the body when there is room and over it at the screen edge', { skip: SKIP }, async () => {
  for (const [name, side] of [['right', 'right'], ['left', 'left']]) {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await open(name, width);
      await evaluate('document.querySelector(".am-outline > summary").click()');
      const rail = await rect('.am-outline > summary');
      const list = await rect('.am-outline-list');
      const flow = await evaluate('document.querySelector(".am-toc").dataset.flow');
      assert.ok(list.left >= 0 && list.right <= width, `${name} rail at ${width}px: list ${list.left}..${list.right} stays in the viewport`);
      assert.ok(rail.left >= 0 && rail.right <= width, `${name} rail at ${width}px stays in the viewport`);
      if (width <= 390) assert.equal(flow, 'in', `${name} rail at ${width}px opens inward`);
      if (width >= 1440) assert.equal(flow, 'out', `${name} rail at ${width}px opens outward`);
      if (flow === 'out') assert.ok(side === 'right' ? list.left >= rail.right : list.right <= rail.left, `${name} rail opens outward`);
      else assert.ok(side === 'right' ? list.right <= rail.right : list.left >= rail.left, `${name} rail opens inward`);
    }
  }
});

test('outline: the preview label of a hovered tick stays in the viewport', { skip: SKIP }, async () => {
  for (const width of [390, 1440]) {
    await open('right', width);
    const c = center(await rect('.am-tick[data-id="C"]'));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    const label = await evaluate(`(() => { const t = document.querySelector('.am-tick[data-id="C"]'); const s = getComputedStyle(t, '::after'); return { display: s.display, text: s.content }; })()`);
    assert.equal(label.display, 'block');
    assert.match(label.text, /C · Section number 3/);
  }
});

test('outline: the section being read is marked on its tick and its link', { skip: SKIP }, async () => {
  await open('right');
  assert.equal(await evaluate('document.querySelector(".am-tick.is-current").dataset.id'), 'A');
  await evaluate('window.scrollTo(0, scrollY + document.getElementById("panel-M").getBoundingClientRect().top - innerHeight * 0.32)');
  await until('document.querySelector(".am-tick.is-current")?.dataset.id === "M"', 'the current tick');
  assert.equal(await evaluate('document.querySelector(".am-outline-list a[aria-current=true]").getAttribute("href")'), '#panel-M');
  assert.equal(await evaluate('document.querySelectorAll(".am-outline-list a[aria-current]").length'), 1);
});

test('outline: without JavaScript the list opens and the links jump', { skip: SKIP }, async () => {
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    await open('right');
    assert.equal(await evaluate('typeof window.__amRemarkData'), 'undefined');
    const c = center(await rect('.am-outline > summary'));
    await click(c.x, c.y);
    assert.equal(await isOpen(), true);
    const r = await rect('.am-outline-list a[href="#panel-G"]');
    assert.ok(r.left >= 0 && r.right <= 1440);
    await click(...Object.values(center(r)));
    await until('location.hash === "#panel-G"', 'the hash');
    await until('Math.abs(document.getElementById("panel-G").getBoundingClientRect().top) < 40', 'the jump');
  } finally {
    await send('Emulation.setScriptExecutionDisabled', { value: false });
  }
});

test('outline: print hides the rail', { skip: SKIP }, async () => {
  await open('right');
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".am-toc")).display'), 'none');
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  try {
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".am-toc")).display'), 'none');
  } finally {
    await send('Emulation.setEmulatedMedia', { media: '' });
  }
});

test('outline: the rail sits outside the body on the chosen side and mirrors on a right-to-left page', { skip: SKIP }, async () => {
  const sides = {};
  for (const name of ['right', 'left', 'rtlRight', 'rtlLeft']) {
    await open(name);
    const rail = await rect('.am-outline > summary');
    const body = await rect('.am-doc-body');
    sides[name] = rail.left > body.right ? 'right' : rail.right < body.left ? 'left' : 'inside';
    if (sides[name] === 'right') assert.ok(Math.abs(rail.left - body.right - 8) < 1, `${name}: 8px outside the body`);
    if (sides[name] === 'left') assert.ok(Math.abs(body.left - rail.right - 8) < 1, `${name}: 8px outside the body`);
  }
  assert.deepEqual(sides, { right: 'right', left: 'left', rtlRight: 'left', rtlLeft: 'right' });
  await open('rtlRight');
  assert.equal(await evaluate('document.documentElement.dir'), 'rtl');
});

test('outline: on a phone the body starts right after the head and the rail covers no text', { skip: SKIP }, async () => {
  for (const name of ['right', 'left']) {
    await open(name, 390, { mobile: true, height: 844 });
    const body = await rect('.am-doc-body');
    assert.ok(body.top < 300, `${name}: the body starts at ${body.top}px`);
    const rail = await rect('.am-outline > summary');
    assert.ok(rail.left >= 0 && rail.right <= 390, `${name}: the rail stays in the viewport`);
    assert.ok(name === 'right' ? rail.left >= body.right : rail.right <= body.left, `${name}: the rail does not overlap the body`);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'), `${name}: no sideways scroll`);
  }
});
