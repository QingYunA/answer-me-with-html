// Browser check for the "Copy as image" toolbar button (src/runtime/copy-image.js): the button is revealed only where the
// rasterizer and the Clipboard API exist, and a click reaches navigator.clipboard.write with a real PNG blob. It needs a
// Chromium-family browser, so it runs only with AM_E2E=1 (and AM_CHROME when the binary is not auto-detected, e.g. Edge).
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
