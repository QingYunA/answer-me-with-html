// Browser check for the toolbar's Export menu (src/runtime/export-menu.js): the button shows on any page with a sheet or doc and opens a
// native popover menu (click, Esc and outside click close it; arrow keys move; focus goes in on open and back on close). Copy as
// image writes a real PNG to the clipboard; Download PNG saves the same PNG through <a download> with no clipboard at all; Save as
// PDF calls window.print(). An item that cannot run is aria-disabled and carries the reason as its second line, never as the toolbar
// button's text. Safari and unknown browsers keep both image items with an "effect not guaranteed" note, and a refused clipboard
// reports a failure without downloading anything. It needs a Chromium-family browser, so it runs only with AM_E2E=1 (and AM_CHROME
// when the binary is not auto-detected, e.g. Edge).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';
import { loadMath } from '../src/math-load.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser export test'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

let tmp;
let file;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const load = async (url) => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};

before(async () => {
  if (SKIP) return;
  await loadMath('$x$');
  tmp = mkdtempSync(join(tmpdir(), 'am-export-'));
  file = join(tmp, 'page.html');
  const preLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const src = `---\nlang: en\n---\n## A\nThe value is 42.\n\n## B\nA paragraph with **bold** and a table.\n\n| k | v |\n|---|---|\n| a | 1 |\n\n\`\`\`flow\n[A] -> [B]\n\`\`\`\n\n$$\nx = 1\n$$\n\n## C\n\`\`\`html\n<pre id="constrained-pre" style="max-height: 40px; overflow: auto">${preLines}</pre>\n\`\`\`\n\nA paragraph following constrained pre.\n`;
  writeFileSync(file, renderDoc(src, {}, {}, {}).html);
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

// Handles every script below starts from: the toolbar button, the menu and its three items.
const UI = `const toggle = document.querySelector('[data-am="export"]');
const menu = document.getElementById('am-export');
const copy = menu.querySelector('[data-export="copy"]');
const download = menu.querySelector('[data-export="download"]');
const pdf = menu.querySelector('[data-export="pdf"]');
const noteOf = (el) => document.getElementById(el.getAttribute('aria-describedby')).textContent;`;

// The menu's state after the runtime has read it: whether the button is shown, its text and width, and per item whether it is disabled
// and what its second line and accessible description say. The data-* texts come from the page, so the assertions compare against
// the page's own labels, not hard-coded strings.
const MENU_STATE = `(() => {
  ${UI}
  const item = (el) => ({ disabled: el.getAttribute('aria-disabled') === 'true', note: noteOf(el), described: el.getAttribute('aria-describedby') });
  return {
    hidden: toggle.hidden,
    text: toggle.textContent,
    width: toggle.getBoundingClientRect().width,
    copy: item(copy), download: item(download), pdf: item(pdf),
    text_: { ...menu.dataset },
  };
})()`;

// Capture what Copy writes to the clipboard (a real file:// page is a secure context, so the item enables itself), then read the PNG
// out of the ClipboardItem it passed.
const CLICK_AND_CAPTURE = `(async () => {
  ${UI}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const revealed = !toggle.hidden;
  let captured = null;
  try {
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items) => { captured = items; } });
  } catch (e) {
    navigator.clipboard.write = async (items) => { captured = items; };
  }
  copy.click();
  for (let i = 0; i < 200 && !captured; i++) await sleep(50);
  if (!captured) return { revealed, error: 'no clipboard write', label: toggle.textContent };
  const item = captured[0];
  const blob = await item.getType('image/png');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return { revealed, types: item.types, size: blob.size, png, label: toggle.textContent, copied: menu.dataset.copied };
})()`;

test('export: Copy as image writes a real PNG to the clipboard and the button reports it', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_AND_CAPTURE);
  assert.equal(r.revealed, true, 'the button is revealed in a Chromium secure context');
  assert.ok(r.types && r.types.includes('image/png'), `the ClipboardItem holds image/png (${JSON.stringify(r)})`);
  assert.ok(r.png, `the blob starts with the PNG signature (${JSON.stringify(r)})`);
  assert.ok(r.size > 1000, `the PNG has real pixels, not an empty canvas (${r.size} bytes)`);
  assert.equal(r.label, 'Copied ✓', 'the button reports the copy');
  assert.equal(r.copied, 'Copied ✓');
});

// Run the page with these overrides in place before its scripts, then remove them.
const withOverrides = async (source, fn) => {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
  try {
    await load(pathToFileURL(file).href);
    return await fn();
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
};
const NO_UA_DATA = "Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });";
const userAgent = (ua) => `Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ${JSON.stringify(ua)}, configurable: true });`;
const NO_CLIPBOARD_ITEM = 'delete window.ClipboardItem;';
const NO_SECURE_CONTEXT = "Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });";
const NO_POLICY = "Object.defineProperty(document, 'featurePolicy', { configurable: true, value: { allowsFeature: (name) => name !== 'clipboard-write' } });";

test('export: Safari keeps both image items enabled and says the effect is not guaranteed on each', { skip: SKIP }, async () => {
  // Safari exposes ClipboardItem and clipboard.write but no navigator.userAgentData, and no Chrome/ or Firefox/ in its user agent.
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  await withOverrides(NO_UA_DATA + userAgent(safari), async () => {
    assert.equal(await evaluate('typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function"'), true, 'the Clipboard API is there');
    const s = await evaluate(MENU_STATE);
    assert.equal(s.hidden, false, 'the button is shown');
    for (const kind of ['copy', 'download']) {
      assert.equal(s[kind].disabled, false, `${kind} stays enabled`);
      assert.equal(s[kind].note, s.text_.unverifiedEffect, `${kind} carries the unverified-effect note (${JSON.stringify(s[kind])})`);
    }
    assert.equal(s.pdf.note, '', 'Save as PDF carries no note');
    assert.equal(s.text, 'Export', 'the toolbar button keeps its short label');
  });
});

test('export: Firefox keeps both image items enabled (it rasterizes the page since 160)', { skip: SKIP }, async () => {
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0';
  await withOverrides(NO_UA_DATA + userAgent(firefox), async () => {
    const s = await evaluate(MENU_STATE);
    assert.equal(s.hidden, false, 'the button is shown');
    assert.deepEqual([s.copy.disabled, s.download.disabled], [false, false], 'both items stay enabled');
    assert.equal(s.copy.note, '', 'and carry no note');
  });
});

test('export: a Chromium host without navigator.userAgentData (Electron, WebView2) enables the image items with no note', { skip: SKIP }, async () => {
  const electron = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SomeApp/1.2.3 Chrome/128.0.6613.36 Electron/32.0.1 Safari/537.36';
  await withOverrides(NO_UA_DATA + userAgent(electron), async () => {
    const s = await evaluate(MENU_STATE);
    assert.equal(s.hidden, false, 'the button is shown');
    assert.deepEqual([s.copy.disabled, s.download.disabled, s.copy.note], [false, false, ''], JSON.stringify(s));
  });
});

test('export: a preview whose feature policy forbids clipboard-write disables only Copy, with the reason inside the item', { skip: SKIP }, async () => {
  await withOverrides(NO_POLICY, async () => {
    const s = await evaluate(MENU_STATE);
    assert.equal(s.hidden, false, 'the button is still shown');
    assert.equal(s.copy.disabled, true, 'Copy is disabled');
    assert.equal(s.copy.note, s.text_.unavailablePolicy, `Copy explains the policy on its second line (${JSON.stringify(s.copy)})`);
    assert.equal(s.copy.described, 'am-export-copy-note', 'and the reason is its accessible description');
    assert.deepEqual([s.download.disabled, s.pdf.disabled], [false, false], 'Download PNG and Save as PDF still work');
    assert.equal(s.text, 'Export', 'the toolbar button text does not carry the reason');
  });
});

for (const [what, source] of [['no ClipboardItem', NO_CLIPBOARD_ITEM], ['a page that is not a secure context', NO_SECURE_CONTEXT]]) {
  test(`export: with ${what}, Copy is disabled with the clipboard note and Download PNG still works`, { skip: SKIP }, async () => {
    await withOverrides(source, async () => {
      const s = await evaluate(MENU_STATE);
      assert.equal(s.copy.disabled, true, 'Copy is disabled');
      assert.equal(s.copy.note, s.text_.unavailableClipboard, `Copy explains the missing clipboard (${JSON.stringify(s.copy)})`);
      assert.deepEqual([s.download.disabled, s.pdf.disabled], [false, false], 'Download PNG and Save as PDF stay enabled');
    });
  });
}

test('export: the toolbar button stays as narrow when Copy is disabled as when it works', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const normal = await evaluate(MENU_STATE);
  await withOverrides(NO_CLIPBOARD_ITEM + NO_POLICY, async () => {
    const s = await evaluate(MENU_STATE);
    assert.equal(s.copy.disabled, true);
    assert.equal(s.width, normal.width, `the button is ${s.width}px, as wide as when everything works (${normal.width}px)`);
    assert.ok(s.width < 120, `the button is short (${s.width}px)`);
  });
});

// Real input: the popover's light dismiss and Esc answer trusted events only.
const key = async (k, code = k, vk = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const wait = async (expression, what) => {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const STATE = `(() => { ${UI} return { open: menu.matches(':popover-open') || menu.classList.contains('is-open'), expanded: toggle.getAttribute('aria-expanded'), active: document.activeElement === toggle ? 'toggle' : document.activeElement?.dataset?.export ?? 'other' }; })()`;
// Closed for good: the popover's toggle event comes after the state flips, and it is what puts the focus back.
const SETTLED = `(${STATE}).open === false && (${STATE}).expanded === 'false' && (${STATE}).active !== 'copy'`;
const openMenu = async () => {
  await evaluate(`(() => { ${UI} toggle.click(); })()`);
  await wait(`(${STATE}).active !== 'toggle' && (${STATE}).open`, 'the menu to open and take focus');
};

test('export: the menu opens from the button with focus on the first item, and Esc closes it and returns focus', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const closedState = await evaluate(`(() => { ${UI} return { haspopup: toggle.getAttribute('aria-haspopup'), expanded: toggle.getAttribute('aria-expanded'), role: menu.getAttribute('role'), open: menu.matches(':popover-open') }; })()`);
  assert.deepEqual(closedState, { haspopup: 'menu', expanded: 'false', role: 'menu', open: false });
  await openMenu();
  assert.deepEqual(await evaluate(STATE), { open: true, expanded: 'true', active: 'copy' }, 'open, announced, and focus on Copy as image');
  await key('Escape', 'Escape', 27);
  await wait(SETTLED, 'Esc to close the menu');
  assert.deepEqual(await evaluate(STATE), { open: false, expanded: 'false', active: 'toggle' }, 'closed, and focus is back on the button');
});

test('export: a click outside closes the menu, a click on the button toggles it', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  await openMenu();
  await click(300, 600);
  await wait(SETTLED, 'an outside click to close the menu');
  const at = await evaluate(`(() => { ${UI} const r = toggle.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await click(at.x, at.y);
  await wait(`(${STATE}).open`, 'a click on the button to open the menu');
  await click(at.x, at.y);
  await wait(SETTLED, 'a second click on the button to close it');
});

test('export: arrow keys, Home and End move between the items and wrap', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  await openMenu();
  const order = [];
  for (const [k, vk] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38], ['Home', 36], ['End', 35]]) {
    await key(k, k, vk);
    order.push((await evaluate(STATE)).active);
  }
  assert.deepEqual(order, ['download', 'pdf', 'copy', 'pdf', 'copy', 'pdf']);
});

test('export: with Copy disabled, focus opens on Download PNG and the arrow keys still reach the reason', { skip: SKIP }, async () => {
  await withOverrides(NO_CLIPBOARD_ITEM, async () => {
    await openMenu();
    assert.equal((await evaluate(STATE)).active, 'download', 'focus skips the disabled item on open');
    await key('ArrowUp', 'ArrowUp', 38);
    assert.equal((await evaluate(STATE)).active, 'copy', 'the arrow keys reach it, so a screen reader hears why it is off');
    await key('Escape', 'Escape', 27);
    await wait(SETTLED, 'Esc to close the menu');
  });
});

test('export: the menu stays inside the viewport at 390px, and in right-to-left', { skip: SKIP }, async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  try {
    for (const dir of ['ltr', 'rtl']) {
      await load(pathToFileURL(file).href);
      await evaluate(`document.documentElement.dir = '${dir}'`);
      await openMenu();
      const r = await evaluate(`(() => { ${UI} const m = menu.getBoundingClientRect(), b = toggle.getBoundingClientRect(); return { left: m.left, right: m.right, top: m.top, bottom: m.bottom, btnBottom: b.bottom, vw: document.documentElement.clientWidth }; })()`);
      assert.ok(r.left >= 0 && r.right <= r.vw, `${dir}: the menu (${r.left}..${r.right}) is inside ${r.vw}px`);
      assert.ok(r.top >= r.btnBottom, `${dir}: the menu sits under the button`);
      await key('Escape', 'Escape', 27);
      await wait(SETTLED, 'Esc to close the menu');
    }
  } finally {
    await send('Emulation.clearDeviceMetricsOverride');
  }
});

test('export: a browser without popovers gets the same menu from a class toggle, closed by Esc and an outside click', { skip: SKIP }, async () => {
  await withOverrides('delete HTMLElement.prototype.popover;', async () => {
    assert.equal(await evaluate(`(() => { ${UI} return toggle.hidden; })()`), false, 'the button is still shown');
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('am-export')).display`), 'none', 'the menu is hidden until opened');
    await openMenu();
    assert.deepEqual(await evaluate(STATE), { open: true, expanded: 'true', active: 'copy' });
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('am-export')).display`), 'flex', 'and drawn once open');
    await key('Escape', 'Escape', 27);
    await wait(SETTLED, 'Esc to close the menu');
    assert.equal((await evaluate(STATE)).active, 'toggle', 'focus returns to the button');
    await openMenu();
    await click(300, 600);
    await wait(SETTLED, 'an outside click to close the menu');
  });
});

// Download PNG: the same PNG through <a download>. The click on the link is intercepted so the run saves nothing to disk.
const CLICK_DOWNLOAD = (title) => `(async () => {
  ${UI}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ${title === undefined ? '' : `document.title = ${JSON.stringify(title)};`}
  let link = null;
  let saved = null;
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { saved = blob; return origCreate.call(URL, blob); };
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { link = { name: this.download, href: this.href }; };
  let wrote = false;
  if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { wrote = true; } });
  download.click();
  const working = toggle.textContent;
  for (let i = 0; i < 200 && !link; i++) await sleep(50);
  HTMLAnchorElement.prototype.click = orig;
  URL.createObjectURL = origCreate;
  if (!link) return { error: 'no download', label: toggle.textContent };
  const blob = saved;
  const buf = new Uint8Array(await blob.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  await sleep(50);
  return { name: link.name, scheme: link.href.split(':')[0], type: blob.type, size: blob.size, png, wrote, working, label: toggle.textContent, saved: menu.dataset.saved, workingText: menu.dataset.working };
})()`;

test('export: Download PNG saves the page as a PNG named after the title, and writes nothing to the clipboard', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_DOWNLOAD());
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.name, 'answer-me-with-html.png', 'the file is named after the page title');
  assert.equal(r.scheme, 'blob');
  assert.equal(r.type, 'image/png');
  assert.ok(r.png && r.size > 1000, `a real PNG (${r.size} bytes)`);
  assert.equal(r.wrote, false, 'the clipboard is not touched');
  assert.equal(r.working, r.workingText, 'the button shows the working state while it draws');
  assert.equal(r.label, r.saved, 'and reports the save');
});

test('export: a title in another script keeps its letters in the file name', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_DOWNLOAD('性能报告: Q3 / Mój raport'));
  assert.equal(r.name, '性能报告-q3-mój-raport.png');
});

test('export: Download PNG works with no clipboard API at all', { skip: SKIP }, async () => {
  await withOverrides(NO_CLIPBOARD_ITEM + "Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });", async () => {
    const r = await evaluate(CLICK_DOWNLOAD());
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.ok(r.png, 'a PNG was saved');
  });
});

test('export: Save as PDF closes the menu and calls window.print, with the clipboard unavailable too', { skip: SKIP }, async () => {
  await withOverrides(NO_CLIPBOARD_ITEM, async () => {
    await evaluate('window.__printed = 0; window.print = () => { window.__printed += 1; };');
    await openMenu();
    await evaluate(`(() => { ${UI} pdf.click(); })()`);
    assert.equal(await evaluate('window.__printed'), 1, 'the print dialog was asked for once');
    await wait(SETTLED, 'the menu to close');
    assert.equal((await evaluate(STATE)).active, 'toggle');
  });
});

// A refused clipboard reports a failure; it must not download a PNG.
const CLICK_FAILURE = `(async () => {
  ${UI}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const revealed = !toggle.hidden;
  let wrote = false;
  try { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { wrote = true; throw new Error('refused'); } }); }
  catch (e) { navigator.clipboard.write = async () => { wrote = true; throw new Error('refused'); }; }
  let clicked = 0;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicked += 1; };
  copy.click();
  for (let i = 0; i < 200 && !wrote; i++) await sleep(50);
  await sleep(100);
  HTMLAnchorElement.prototype.click = orig;
  return { revealed, wrote, clicked, label: toggle.textContent, failed: menu.dataset.failed, status: document.querySelector('[data-am="export-status"]')?.textContent ?? null };
})()`;

test('export: a refused clipboard reports the failure and downloads nothing', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_FAILURE);
  assert.equal(r.revealed, true, 'the button is revealed');
  assert.equal(r.wrote, true, 'the clipboard write was attempted');
  assert.equal(r.clicked, 0, `no download is triggered (${JSON.stringify(r)})`);
  assert.equal(r.label, r.failed, `the button reports a failed copy (${JSON.stringify(r)})`);
  assert.equal(r.status, r.failed, 'a screen reader hears the failure through the status region');
});

// The clipboard refuses at once (permission denied) while the page is still being drawn. The export must stay busy until the drawing
// has settled too, so a second Copy or Download cannot start a second full-page rasterization.
const CLICK_REFUSED_EARLY = `(async () => {
  ${UI}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isBusy = () => toggle.getAttribute('aria-busy') === 'true';
  let drawings = 0;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) {
      if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) {
        drawings += 1;
        const image = this;
        setTimeout(() => origSrc.set.call(image, val), 800); // a slow rasterization
        return;
      }
      origSrc.set.call(this, val);
    },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  copy.click();
  await sleep(300); // the write has been refused by now; the drawing has not finished
  const busyAfterRefusal = isBusy();
  const labelAfterRefusal = toggle.textContent;
  const blocked = [copy, download].map((el) => el.getAttribute('aria-disabled') === 'true');
  const pdfFree = pdf.getAttribute('aria-disabled') !== 'true';
  copy.click();
  download.click();
  await sleep(300);
  const drawingsAfterSecondClicks = drawings;
  let settled = false;
  for (let i = 0; i < 200 && !settled; i++) { await sleep(50); settled = !isBusy(); }
  const labelAtEnd = toggle.textContent;
  const freeAgain = [copy, download].map((el) => el.getAttribute('aria-disabled') !== 'true');
  copy.click(); // a retry after everything settled starts a new drawing
  await sleep(300);
  const drawingsAfterRetry = drawings;
  Object.defineProperty(Image.prototype, 'src', origSrc);
  return { busyAfterRefusal, labelAfterRefusal, working: menu.dataset.working, blocked, pdfFree, drawingsAfterSecondClicks, settled, labelAtEnd, failed: menu.dataset.failed, freeAgain, drawingsAfterRetry };
})()`;

test('export: a clipboard refusal during a slow rasterization keeps Copy and Download busy until the drawing settles', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_REFUSED_EARLY);
  assert.equal(r.busyAfterRefusal, true, `the export is still busy while the page is being drawn (${JSON.stringify(r)})`);
  assert.equal(r.labelAfterRefusal, r.working, `the button still shows the working state (${JSON.stringify(r)})`);
  assert.deepEqual(r.blocked, [true, true], `Copy and Download are aria-disabled meanwhile (${JSON.stringify(r)})`);
  assert.equal(r.pdfFree, true, 'Save as PDF stays free');
  assert.equal(r.drawingsAfterSecondClicks, 1, `a Copy or Download during the drawing starts no second rasterization (${JSON.stringify(r)})`);
  assert.equal(r.settled, true, `the export is free again once the drawing has settled (${JSON.stringify(r)})`);
  assert.equal(r.labelAtEnd, r.failed, `the refusal is reported when everything has settled (${JSON.stringify(r)})`);
  assert.deepEqual(r.freeAgain, [true, true], 'both items work again');
  assert.equal(r.drawingsAfterRetry, 2, `a retry after everything settled draws again (${JSON.stringify(r)})`);
});

// A custom theme can give the body a multi-layer background. The PNG must keep its background (the wrapper is opaque), which
// breaks if the colour and image are combined in one background shorthand.
const CLICK_MULTI_BG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.body.style.backgroundColor = 'rgb(10, 20, 30)';
  document.body.style.backgroundImage = 'linear-gradient(45deg, #123456, #654321), radial-gradient(circle, #222, #444)';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const btn = document.querySelector('[data-export="copy"]');
  let captured = null;
  Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items) => { captured = items; } });
  btn.click();
  for (let i = 0; i < 200 && !captured; i++) await sleep(50);
  if (!captured) return { error: 'no clipboard write' };
  const blob = await captured[0].getType('image/png');
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(1, 1, 1, 1).data;
  return { alpha: px[3], rgb: [px[0], px[1], px[2]] };
})()`;

test('copy-image: a multi-layer body background stays opaque in the PNG', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_MULTI_BG);
  assert.equal(r.error, undefined, `the capture succeeded (${JSON.stringify(r)})`);
  assert.equal(r.alpha, 255, `the corner is opaque, so the background was drawn (${JSON.stringify(r)})`);
});

const CAPTURE_SVG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let svgSrc = null;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) {
      if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) {
        svgSrc = decodeURIComponent(val.split(',')[1]);
      }
      origSrc.set.call(this, val);
    },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  const btn = document.querySelector('[data-export="copy"]');
  btn.click();
  for (let i = 0; i < 200 && !svgSrc; i++) await sleep(50);
  Object.defineProperty(Image.prototype, 'src', origSrc);
  if (!svgSrc) return { error: 'svg not captured' };
  const doc = new DOMParser().parseFromString(svgSrc, 'image/svg+xml');
  const tableWrap = doc.querySelector('.am-table-wrap');
  const diagram = doc.querySelector('.am-diagram');
  const mathBlock = doc.querySelector('.am-math-block');
  return {
    found: !!tableWrap && !!diagram && !!mathBlock,
    tableWrap: {
      overflow: tableWrap?.style?.overflow ?? null,
      height: tableWrap?.style?.height ?? null,
      maxHeight: tableWrap?.style?.maxHeight ?? null,
    },
    diagram: {
      overflow: diagram?.style?.overflow ?? null,
      height: diagram?.style?.height ?? null,
      maxHeight: diagram?.style?.maxHeight ?? null,
    },
    mathBlock: {
      overflow: mathBlock?.style?.overflow ?? null,
      height: mathBlock?.style?.height ?? null,
      maxHeight: mathBlock?.style?.maxHeight ?? null,
    },
  };
})()`;

test('copy-image: scrolling containers reset overflow to visible, height to auto, and max-height to none in rasterized SVG', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CAPTURE_SVG);
  assert.equal(r.found, true, 'table wrap, diagram, and math block exist in the rendered SVG');
  assert.equal(r.tableWrap.overflow, 'visible', 'table wrap overflow is reset to visible');
  assert.equal(r.tableWrap.height, 'auto', 'table wrap height is reset to auto');
  assert.equal(r.tableWrap.maxHeight, 'none', 'table wrap max-height is reset to none');
  assert.equal(r.diagram.overflow, 'visible', 'diagram overflow is reset to visible');
  assert.equal(r.diagram.height, 'auto', 'diagram height is reset to auto');
  assert.equal(r.diagram.maxHeight, 'none', 'diagram max-height is reset to none');
  assert.equal(r.mathBlock.overflow, 'visible', 'math block overflow is reset to visible');
  assert.equal(r.mathBlock.height, 'auto', 'math block height is reset to auto');
  assert.equal(r.mathBlock.maxHeight, 'none', 'math block max-height is reset to none');
});

const CAPTURE_CONSTRAINED = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let svgSrc = null;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) {
      if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) {
        svgSrc = decodeURIComponent(val.split(',')[1]);
      }
      origSrc.set.call(this, val);
    },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  const btn = document.querySelector('[data-export="copy"]');
  btn.click();
  for (let i = 0; i < 200 && !svgSrc; i++) await sleep(50);
  Object.defineProperty(Image.prototype, 'src', origSrc);
  if (!svgSrc) return { error: 'svg not captured' };

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = svgSrc;
  document.body.appendChild(container);

  const pre = container.querySelector('#constrained-pre');
  const panel = pre ? pre.closest('.am-panel') : null;
  const p = panel ? panel.querySelector('p') : null;
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  const pRect = p ? p.getBoundingClientRect() : null;
  const preStyle = pre ? {
    overflow: pre.style.overflow,
    height: pre.style.height,
    maxHeight: pre.style.maxHeight,
  } : null;

  const res = {
    found: !!panel && !!pre && !!p,
    preStyle,
    panelRect: panelRect ? { top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height } : null,
    pRect: pRect ? { top: pRect.top, bottom: pRect.bottom, height: pRect.height } : null,
    withinBounds: panelRect && pRect ? pRect.bottom <= panelRect.bottom : false,
  };
  container.remove();
  return res;
})()`;

test('copy-image: constrained code block keeps max-height and hides overflow without clipping following content in panel', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CAPTURE_CONSTRAINED);
  assert.equal(r.found, true, `panel, constrained pre, and following paragraph exist in the rendered SVG (${JSON.stringify(r)})`);
  assert.equal(r.preStyle.overflow, 'hidden', 'constrained pre overflow is set to hidden');
  assert.equal(r.preStyle.maxHeight, '40px', 'constrained pre max-height is preserved');
  assert.ok(r.preStyle.height && r.preStyle.height !== 'auto', 'constrained pre height is preserved and not reset to auto');
  assert.equal(r.withinBounds, true, `paragraph bottom (${r.pRect?.bottom}) is within panel bottom (${r.panelRect?.bottom})`);
});
