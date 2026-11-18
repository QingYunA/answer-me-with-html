// Browser check for the "Copy as image" toolbar button (src/runtime/copy-image.js): the button is revealed in Chromium wherever
// the page can be rasterized (without the Clipboard API a click downloads the PNG), and a click reaches navigator.clipboard.write
// with a real PNG blob. It needs a Chromium-family browser, so it runs only with AM_E2E=1 (and AM_CHROME when the binary is not
// auto-detected, e.g. Edge).
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
  ? 'set AM_E2E=1 to run the browser copy-image test'
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
  tmp = mkdtempSync(join(tmpdir(), 'am-copy-image-'));
  file = join(tmp, 'page.html');
  const src = `---\nlang: en\n---\n## A\nThe value is 42.\n\n## B\nA paragraph with **bold** and a table.\n\n| k | v |\n|---|---|\n| a | 1 |\n`;
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

// Capture what the button writes to the clipboard (a real file:// page is a secure context, so the button reveals itself), then
// read the PNG out of the ClipboardItem it passed.
const CLICK_AND_CAPTURE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('[data-am="copy-image"]');
  if (!btn) return { error: 'button not in the page' };
  const revealed = !btn.hidden;
  let captured = null;
  try {
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items) => { captured = items; } });
  } catch (e) {
    navigator.clipboard.write = async (items) => { captured = items; };
  }
  btn.click();
  for (let i = 0; i < 200 && !captured; i++) await sleep(50);
  if (!captured) return { revealed, error: 'no clipboard write', label: btn.textContent };
  const item = captured[0];
  const blob = await item.getType('image/png');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return { revealed, types: item.types, size: blob.size, png, label: btn.textContent };
})()`;

test('copy-image: the button appears and a click writes a real PNG to the clipboard', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_AND_CAPTURE);
  assert.equal(r.revealed, true, 'the button is revealed in a Chromium secure context');
  assert.ok(r.types && r.types.includes('image/png'), `the ClipboardItem holds image/png (${JSON.stringify(r)})`);
  assert.ok(r.png, `the blob starts with the PNG signature (${JSON.stringify(r)})`);
  assert.ok(r.size > 1000, `the PNG has real pixels, not an empty canvas (${r.size} bytes)`);
  assert.equal(r.label, 'Copied ✓', 'the button reports the copy');
});

// A refused clipboard is a copy failure. Only the download action creates a file.
const CLICK_FALLBACK = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('[data-am="copy-image"]');
  const revealed = !btn.hidden;
  let wrote = false;
  try { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { wrote = true; throw new Error('refused'); } }); }
  catch (e) { navigator.clipboard.write = async () => { wrote = true; throw new Error('refused'); }; }
  let clicked = 0;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicked += 1; };
  btn.click();
  for (let i = 0; i < 200 && btn.getAttribute('aria-disabled') === 'true'; i++) await sleep(50);
  HTMLAnchorElement.prototype.click = orig;
  await sleep(30);
  return { revealed, wrote, clicked, label: btn.textContent, status: document.querySelector('[data-am="copy-image-status"]')?.textContent ?? null };
})()`;

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
const HIDDEN = 'document.querySelector(\'[data-am="copy-image"]\').hidden';

test('copy-image: a browser that is not Chromium keeps the button hidden, even with the async Clipboard API', { skip: SKIP }, async () => {
  // Safari and Firefox expose ClipboardItem and clipboard.write but no navigator.userAgentData, and no Chrome/ in their user agent.
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  await withOverrides(NO_UA_DATA + userAgent(safari), async () => {
    assert.equal(await evaluate('typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function"'), true, 'the Clipboard API is there');
    assert.equal(await evaluate(HIDDEN), true, 'the button stays hidden');
  });
});

test('copy-image: a Chromium host without navigator.userAgentData (Electron, WebView2) shows the button', { skip: SKIP }, async () => {
  const electron = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SomeApp/1.2.3 Chrome/128.0.6613.36 Electron/32.0.1 Safari/537.36';
  await withOverrides(NO_UA_DATA + userAgent(electron), async () => {
    assert.equal(await evaluate(HIDDEN), false, 'the button is shown');
  });
});

// Capture the PNG handed to the browser's download action without writing a file.
const DOWNLOAD_PNG = `(async () => {
  const btn = document.querySelector('[data-am="download-image"]');
  let blob;
  let name;
  let writes = 0;
  const original = HTMLAnchorElement.prototype.click;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = value => { blob = value; return createUrl(value); };
  HTMLAnchorElement.prototype.click = function () { name = this.download; };
  if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { writes++; } });
  try {
    btn.click();
    for (let i = 0; i < 200 && btn.getAttribute('aria-disabled') === 'true'; i++) await new Promise(r => setTimeout(r, 50));
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
    return { hidden: btn.hidden, writes, name, signature: Array.from(bytes.slice(0, 8)), label: btn.textContent };
  } finally {
    HTMLAnchorElement.prototype.click = original;
    URL.createObjectURL = createUrl;
  }
})()`;

const EXPECTED_DOWNLOAD = { hidden: false, writes: 0, name: 'answer-me-with-html.png',
  signature: [137, 80, 78, 71, 13, 10, 26, 10], label: 'Downloaded' };

test('download-image: clicking Download image does not use the clipboard', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  assert.deepEqual(await evaluate(DOWNLOAD_PNG), EXPECTED_DOWNLOAD);
});

for (const [what, source] of [
  ['no ClipboardItem', 'delete window.ClipboardItem;'],
  ['a page that is not a secure context', "Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });"],
]) {
  test(`download-image: works with ${what} while unavailable copy stays hidden`, { skip: SKIP }, async () => {
    await withOverrides(source, async () => {
      assert.equal(await evaluate(HIDDEN), true);
      assert.deepEqual(await evaluate(DOWNLOAD_PNG), EXPECTED_DOWNLOAD);
    });
  });
}

test('copy-image: a refused clipboard leaves downloads untouched and reports failure', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_FALLBACK);
  assert.equal(r.revealed, true, 'the button is revealed');
  assert.equal(r.wrote, true, 'the clipboard write was attempted');
  assert.equal(r.clicked, 0, 'copy must not trigger a download');
  assert.equal(r.label, 'Copy failed');
  assert.equal(r.status, 'Copy failed', 'a screen reader hears the failure');
});

// A custom theme can give the body a multi-layer background. The PNG must keep its background (the wrapper is opaque), which
// breaks if the colour and image are combined in one background shorthand.
const CLICK_MULTI_BG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.body.style.backgroundColor = 'rgb(10, 20, 30)';
  document.body.style.backgroundImage = 'linear-gradient(45deg, #123456, #654321), radial-gradient(circle, #222, #444)';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const btn = document.querySelector('[data-am="copy-image"]');
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
