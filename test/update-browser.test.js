// Browser seam for the new-version button: open a page with the button from disk and over HTTP under another host name, as an app's
// built-in preview may load it, in headless Chrome. Needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) like test/layout-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser update tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

// A host app may load the page from an address of its own; Chrome maps this name to the local server.
const PREVIEW_HOST = 'preview.example';

let tmp;
let file;
let server;
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
const buttonShown = () => evaluate('!document.querySelector(\'[data-am="update"]\').hidden');

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-update-'));
  file = join(tmp, 'page.html');
  const update = { latest: '0.9.0', current: '0.5.0', command: 'npx skills update answer-me-with-html -y' };
  writeFileSync(file, renderDoc('---\nlang: en\n---\n## A\nText.', {}, {}, { update }).html);
  server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(readFileSync(file)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check',
    `--host-resolver-rules=MAP ${PREVIEW_HOST} 127.0.0.1`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
});

after(async () => {
  cdp?.close();
  server?.close();
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

test('update: from disk the button shows, opens the popover, and its copy button copies the command', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  assert.equal(await buttonShown(), true);
  const r = await evaluate(`(async () => {
    navigator.clipboard.writeText = async (text) => { window.copied = text; };
    document.querySelector('[data-am="update"]').click();
    const open = document.querySelector('#am-update').matches(':popover-open');
    const copy = document.querySelector('[data-am="copy-text"]');
    copy.click();
    await new Promise((r) => setTimeout(r, 50));
    return { open, copied: window.copied, label: copy.textContent };
  })()`);
  assert.deepEqual(r, { open: true, copied: 'npx skills update answer-me-with-html -y', label: 'Copied ✓' });
});

test('update: the page does not judge its address: the button also shows under another host name', { skip: SKIP }, async () => {
  await load(`http://${PREVIEW_HOST}:${server.address().port}/page.html`);
  assert.equal(await buttonShown(), true);
});
