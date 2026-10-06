// Browser seam for answering on the page: render a page with asks, then pick, comment, open Reply and reload in headless Chrome.
// Needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) like test/layout-browser.test.js.
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
  ? 'set AM_E2E=1 to run the browser reply tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
title: Cache for the session store
lang: en
---
## A The cache keeps sessions
\`\`\`ask
Which cache do we use?
* Redis | keeps data after a restart
- Memcached
\`\`\`

## B The worker retries
\`\`\`ask multi
Which events do we log?
* Retry
- Every write
\`\`\`

## D Release
\`\`\`ask
Do we ship it this week?
* Yes
- No
\`\`\`

## C Where the change goes
\`\`\`ts
export const TTL = 30 * 60
\`\`\`
`;

let tmp;
let chrome;
let cdp;
let session;
let file;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const load = async () => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-reply-'));
  writeFileSync(join(tmp, 'd.md'), DRAFT);
  file = join(tmp, 'page.html');
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', join(tmp, 'd.md'), '-o', file, '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
  });
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

test('reply: picks and comments become one reply, and both survive a reload', { skip: SKIP }, async () => {
  await load();
  assert.equal(await evaluate('document.querySelectorAll(".am-comment-btn").length'), 4);
  const reply = await evaluate(`(() => {
    const mem = document.querySelector('input[value="Memcached"]');
    mem.checked = true;
    mem.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('input[value="Yes"]').click();
    document.querySelector('#panel-C .am-comment-btn').click();
    const box = document.querySelector('#panel-C .am-comment textarea');
    box.value = 'Make the TTL a setting.';
    box.dispatchEvent(new Event('input'));
    document.querySelector('[data-am="reply"]').click();
    return { open: document.querySelector('dialog.am-reply').open, text: document.querySelector('dialog.am-reply textarea').value };
  })()`);
  assert.equal(reply.open, true);
  assert.match(reply.text, /^# Re: Cache for the session store\n/);
  assert.match(reply.text, /1\. \[A\] Which cache do we use\?\n {3}→ \*\*Memcached\*\* _\(was: Redis\)_/);
  assert.match(reply.text, /2\. \[B\] Which events do we log\?\n {3}→ \*\*Retry\*\* _\(not answered; suggestion kept\)_/);
  assert.match(reply.text, /3\. \[D\] Do we ship it this week\?\n {3}→ \*\*Yes\*\* _\(suggestion confirmed\)_/);
  assert.match(reply.text, /- \*\*C · Where the change goes\*\*\n {2}> Make the TTL a setting\./);

  await load();
  const after = await evaluate(`({
    memcached: document.querySelector('input[value="Memcached"]').checked,
    comment: document.querySelector('#panel-C .am-comment textarea').value,
    open: !document.querySelector('#panel-C .am-comment').hidden,
  })`);
  assert.deepEqual(after, { memcached: true, comment: 'Make the TTL a setting.', open: true });
});
