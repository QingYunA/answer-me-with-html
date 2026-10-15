// Browser seam for live reload under am serve: open a served page in headless Chrome, give it reader input, change its file, and look
// at the notice. Needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) like test/layout-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { pageLink, startServer } from '../src/serve.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser live-reload tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const draft = (version) => `---
title: Live check
lang: en
---
## A Cache
\`\`\`ask
Which cache?
* Redis
- Memcached
\`\`\`

## B Notes
Version ${version}.
`;

let tmp;
let home;
let srv;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const until = async (expression, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const render = (version) => {
  writeFileSync(join(tmp, 'd.md'), draft(version));
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', join(tmp, 'd.md'), '-o', join(home, 'pages', 'live.html'), '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: home }, stdio: 'pipe',
  });
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-live-'));
  home = join(tmp, 'home');
  mkdirSync(join(home, 'pages'), { recursive: true });
  render(1);
  srv = await startServer({ home, port: 0 });
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
});

after(async () => {
  cdp?.close();
  srv?.close();
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

const RECT = (selector) => `(() => {
  const r = document.querySelector('${selector}')?.getBoundingClientRect();
  return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
})()`;

test('live: with the reply bar shown, the "Page updated" notice sits above it, not on it', { skip: SKIP }, async () => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pageLink(srv, 'pages', 'live.html') });
  await loaded;
  // A pick that is not the suggestion is reader input: the page keeps it and shows the reply bar, and a change asks before reloading.
  await evaluate('document.querySelector(\'input[value="Memcached"]\').click()');
  assert.equal(await until('Boolean(document.querySelector(".am-reply-bar:not([hidden])"))'), true, 'the reply bar shows');
  render(2);
  assert.equal(await until('Boolean(document.querySelector(\'[role="status"]\'))'), true, 'the notice shows');
  const notice = await evaluate(RECT('[role="status"]'));
  const bar = await evaluate(RECT('.am-reply-bar'));
  assert.ok(notice.bottom <= bar.top, `the notice (bottom ${notice.bottom}) ends above the bar (top ${bar.top})`);
  assert.equal(await evaluate('document.querySelector(\'input[value="Memcached"]\').checked'), true, 'the page did not reload');
});
