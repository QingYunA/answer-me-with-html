// The image viewer in a real browser: click, Enter / Space, Esc, the close button and the backdrop.
// Needs Chrome, so it runs only with AM_E2E=1, like test/layout-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser image tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;
const IMAGE = fileURLToPath(new URL('../docs/images/text-vs-page.png', import.meta.url));

let tmp;
let file;
let cardsFile;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const load = async (url) => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-image-lightbox-'));
  file = join(tmp, 'page.html');
  writeFileSync(file, renderDoc(`---\nlang: en\n---\n## A Image\n![Text and page](${IMAGE})\n`).html);
  cardsFile = join(tmp, 'cards.html');
  writeFileSync(cardsFile, renderDoc(`---
title: Cards
lang: en
---
## A Pick
\`\`\`ask cards
Which landing?
* Lead with the outcome | the headline states the result
  :::html
  <b class="pick-mark">lead</b>
  :::
- Open with a visual | a full-width image sets the tone
  :::html
  <img class="preview-image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=" alt="Preview">
  :::
\`\`\`
`).html);
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

test('image lightbox: click, Enter / Space, Esc, close button, backdrop and focus return', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const result = await evaluate(`(() => {
    const image = document.querySelector('.am-figure img');
    const box = document.querySelector('.am-image-lightbox');
    const close = box.querySelector('.am-image-lightbox-close');
    const isOpen = () => box.hidden === false;
    const isClosed = () => box.hidden === true;
    const closeHasFocus = () => document.activeElement === close;
    const imageHasFocus = () => document.activeElement === image;
    const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

    image.click();
    const clicked = isOpen() && closeHasFocus();

    key(window, 'Escape');
    const escaped = isClosed() && imageHasFocus();

    image.focus();
    key(image, 'Enter');
    const entered = isOpen() && closeHasFocus();
    close.click();
    const closedByButton = isClosed() && imageHasFocus();

    image.focus();
    key(image, ' ');
    const spaced = isOpen() && closeHasFocus();
    box.click();
    const closedByBackdrop = isClosed() && imageHasFocus();

    image.click();
    box.querySelector('img').click();
    const closedByLargeImage = isClosed() && imageHasFocus();

    return { clicked, escaped, entered, closedByButton, spaced, closedByBackdrop, closedByLargeImage };
  })()`);
  assert.deepEqual(result, {
    clicked: true,
    escaped: true,
    entered: true,
    closedByButton: true,
    spaced: true,
    closedByBackdrop: true,
    closedByLargeImage: true,
  });
});

test('image lightbox: a preview image opens without picking the card', { skip: SKIP }, async () => {
  await load(pathToFileURL(cardsFile).href);
  const result = await evaluate(`(() => {
    const image = document.querySelector('.preview-image');
    const input = image.closest('.am-ask-card').querySelector('input[type="radio"]');
    image.click();
    return {
      open: document.querySelector('.am-image-lightbox')?.hidden === false,
      picked: input.checked,
      replyHidden: document.querySelector('.am-reply-bar')?.hidden,
      closeFocused: document.activeElement === document.querySelector('.am-image-lightbox-close'),
    };
  })()`);
  assert.deepEqual(result, { open: true, picked: false, replyHidden: true, closeFocused: true });
});
