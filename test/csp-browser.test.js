// Browser seam for the page's Content-Security-Policy: a raw html fence holding a script and an inline handler must not run, and the
// page's own runtime must still work with no violation from its own scripts. Needs Chrome, so it runs only with AM_E2E=1 (CI job
// `video`) like test/reply-browser.test.js.
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
  ? 'set AM_E2E=1 to run the browser CSP tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
title: Injected page
lang: en
---
## A Raw html
\`\`\`html
<p id="raw">raw text</p>
<script>window.__pwn = 1</script>
<img src=x onerror="window.__pwn2 = 1">
<img src="https://example.com/leak.png" alt="remote">
<div style="background:url(https://example.com/leak.css)">styled</div>
\`\`\`

## B Choice
\`\`\`ask
Which cache?
* Redis
- Memcached
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

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-csp-'));
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
  // Record every violation from before the first script runs.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample }));`,
  });
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

test('csp: an injected script and handler stay silent, remote loads are blocked, and the page runtime still works', { skip: SKIP }, async () => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await evaluate('typeof window.__pwn'), 'undefined', 'the injected <script> did not run');
  assert.equal(await evaluate('typeof window.__pwn2'), 'undefined', 'the onerror handler did not run');
  assert.equal(await evaluate('Boolean(document.querySelector("#raw"))'), true, 'the raw html is still on the page');

  const violations = await evaluate('window.__csp');
  const directives = violations.map((v) => v.directive.split(' ')[0]);
  assert.ok(directives.includes('script-src-elem'), `the injected script was reported: ${JSON.stringify(violations)}`);
  assert.ok(directives.includes('script-src-attr'), 'the onerror attribute was reported');
  assert.ok(violations.some((v) => v.blocked.includes('example.com/leak.png')), 'the remote image was blocked');
  assert.ok(violations.some((v) => v.blocked.includes('example.com/leak.css')), 'the remote CSS url was blocked');
  // The draft's markup accounts for exactly one blocked script and one blocked handler; a script the page ships would add another.
  assert.equal(directives.filter((d) => d === 'script-src-elem').length, 1, 'only the injected script is blocked');
  assert.equal(directives.filter((d) => d === 'script-src-attr').length, 1, 'only the injected handler is blocked');
  assert.deepEqual(directives.filter((d) => d !== 'script-src-elem' && d !== 'script-src-attr').filter((d) => d !== 'img-src'), [], 'nothing else is blocked');

  const opened = await evaluate(`(() => {
    document.querySelector('input[value="Memcached"]').click();
    document.querySelector('[data-am="reply"]').click();
    return document.querySelector('dialog.am-reply').open;
  })()`);
  assert.equal(opened, true, 'the Reply button opens the sheet');
  assert.equal(await evaluate('window.__csp.length'), violations.length, 'using the page adds no violation');
});
