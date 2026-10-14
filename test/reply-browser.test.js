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
let closingFile;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const load = async (page = file) => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(page).href });
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
  // The same draft, made while close_after_reply is on.
  const closingHome = join(tmp, 'closing-home');
  const am = (...args) => execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), ...args], { env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: closingHome }, stdio: 'pipe' });
  am('config', 'set', 'close_after_reply', 'on');
  closingFile = join(tmp, 'closing.html');
  am('render', join(tmp, 'd.md'), '-o', closingFile, '--no-open');
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
  const bar = () => evaluate(`({ hidden: document.querySelector('.am-reply-bar').hidden, text: document.querySelector('.am-reply-bar-count').textContent })`);
  assert.equal((await bar()).hidden, true);
  await evaluate('document.querySelector("input[value=Memcached]").click()');
  assert.deepEqual(await bar(), { hidden: false, text: 'Answered: 1' });
  const reply = await evaluate(`(() => {
    document.querySelector('input[value="Yes"]').click();
    document.querySelector('#panel-C .am-comment-btn').click();
    const box = document.querySelector('#panel-C .am-comment textarea');
    box.value = 'Make the TTL a setting.';
    box.dispatchEvent(new Event('input'));
    document.querySelector('[data-am="reply"]').click();
    const sheet = document.querySelector('dialog.am-reply');
    return {
      open: sheet.open,
      text: sheet.querySelector('textarea').value,
      heading: sheet.querySelector('.am-reply-view .am-rv-h1')?.textContent,
      rawOpen: sheet.querySelector('details.am-reply-raw').open,
    };
  })()`);
  assert.deepEqual(await bar(), { hidden: false, text: 'Answered: 2 · Comments: 1' });
  assert.equal(reply.open, true);
  assert.equal(reply.heading, 'Re: Cache for the session store');
  assert.equal(reply.rawOpen, false);
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

// Opens the page made with close_after_reply on, stubs the clipboard and window.close, opens Reply and clicks Copy.
const copyReply = async ({ clipboardFails = false } = {}) => {
  await load(closingFile);
  await evaluate(`(() => {
    window.__closed = 0;
    window.close = () => { window.__closed += 1; };
    navigator.clipboard.writeText = ${clipboardFails ? '() => Promise.reject(new Error("denied"))' : '() => Promise.resolve()'};
    document.querySelector('input[value="Yes"]').click();
    document.querySelector('[data-am="reply"]').click();
    document.querySelector('dialog.am-reply [data-act="copy"]').click();
  })()`);
};
const until = async (expression, ms = 5000) => {
  for (const start = Date.now(); Date.now() - start < ms;) {
    if (await evaluate(expression)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
const SHEET_OPEN = 'document.querySelector("dialog.am-reply").open';
const NOTE_OPEN = 'document.querySelector(".am-closing")?.matches(":popover-open") ?? false';
const NOTE_TEXT = 'document.querySelector(".am-closing span").textContent';

test('close after reply: a copied reply closes the sheet, counts down and closes the tab, then says so when the browser refuses', { skip: SKIP }, async () => {
  await copyReply();
  assert.equal(await until(NOTE_OPEN), true, 'the countdown popover opens');
  assert.equal(await evaluate(SHEET_OPEN), false, 'the reply sheet is closed');
  assert.match(await evaluate(NOTE_TEXT), /^Closing this tab in [123]s$/);
  assert.equal(await evaluate('window.__closed'), 0);
  assert.equal(await until('window.__closed === 1', 5000), true, 'window.close runs after the countdown');
  assert.equal(await until(`${NOTE_TEXT} === "Reply copied. You can close this tab now."`, 2000), true, 'a tab that stays open says it can be closed');
  assert.equal(await evaluate(NOTE_OPEN), true);
  await evaluate('document.querySelector(".am-closing button").click()');
  assert.equal(await evaluate(NOTE_OPEN), false, 'the button dismisses the message');
});

test('close after reply: Keep open cancels the countdown', { skip: SKIP }, async () => {
  await copyReply();
  assert.equal(await until(NOTE_OPEN), true);
  await evaluate('document.querySelector(".am-closing button").click()');
  assert.equal(await evaluate(NOTE_OPEN), false);
  await new Promise((r) => setTimeout(r, 3600));
  assert.equal(await evaluate('window.__closed'), 0, 'window.close never runs');
  assert.equal(await evaluate(NOTE_OPEN), false);
});

test('close after reply: a clipboard that refuses starts no countdown and keeps the sheet open', { skip: SKIP }, async () => {
  await copyReply({ clipboardFails: true });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await evaluate(NOTE_OPEN), false);
  assert.equal(await evaluate(SHEET_OPEN), true);
  assert.equal(await evaluate('window.__closed'), 0);
});

test('close after reply: a page made without the setting never shows the countdown', { skip: SKIP }, async () => {
  await load();
  assert.equal(await evaluate('document.querySelector(".am-closing")'), null);
});

// Opens Reply on the plain page with the clipboard API refused and the fallback forced, then clicks Copy. The fallback is what
// runs on a file:// page, and its return value is the only signal the reader's browser gives.
const clickCopyWithFallback = async (fallbackWorks) => {
  await load();
  await evaluate(`(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    document.execCommand = () => ${fallbackWorks};
    document.querySelector('input[value="Memcached"]').click();
    document.querySelector('[data-am="reply"]').click();
    document.querySelector('dialog.am-reply [data-act="copy"]').click();
  })()`);
};
const COPY_LABEL = 'document.querySelector("dialog.am-reply [data-act=\\"copy\\"]").textContent';
const STUCK = `(() => {
  const tmp = [...document.querySelectorAll('textarea')].find((t) => t.style.top === '-100px');
  const text = document.querySelector('dialog.am-reply textarea');
  return {
    stuck: Boolean(tmp),
    selected: Boolean(tmp) && document.activeElement === tmp && tmp.selectionStart === 0 && tmp.selectionEnd === tmp.value.length,
    same: Boolean(tmp) && tmp.value === text.value && text.value.startsWith('# Re:'),
  };
})()`;

test('reply: a copy the fallback also refuses says so and keeps the text selected', { skip: SKIP }, async () => {
  await clickCopyWithFallback(false);
  assert.equal(await until(`${COPY_LABEL} !== 'Copy reply'`), true, 'the button reports the outcome');
  assert.equal(await evaluate(COPY_LABEL), 'Copy failed — press Cmd/Ctrl+C');
  assert.deepEqual(await evaluate(STUCK), { stuck: true, selected: true, same: true }, 'the reply text stays selected for Cmd/Ctrl+C');
  assert.equal(await until(`${COPY_LABEL} === 'Copy reply'`, 4500), true, 'the label returns to Copy reply');
  assert.equal((await evaluate(STUCK)).selected, true, 'the selection outlives the message');
  await evaluate('document.querySelector("dialog.am-reply [data-act=\\"close\\"]").click()');
  assert.equal(await until(`${STUCK}.stuck === false`, 2000), true, 'closing the sheet drops the leftover textarea');
});

test('reply: a copy the fallback accepts still says Copied ✓ and leaves nothing behind', { skip: SKIP }, async () => {
  await clickCopyWithFallback(true);
  assert.equal(await until(`${COPY_LABEL} !== 'Copy reply'`), true, 'the button reports the outcome');
  assert.equal(await evaluate(COPY_LABEL), 'Copied ✓');
  assert.equal((await evaluate(STUCK)).stuck, false, 'the temporary textarea is removed');
});

// The fallback for real, not stubbed: the click runs as a user gesture so execCommand may copy, and the test reads the clipboard
// itself, because execCommand can report success while it copies nothing. Seeds the clipboard first, so a copy that did not
// happen leaves the seed.
const copyForReal = async (opener) => {
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await load();
  const r = await send('Runtime.evaluate', { userGesture: true, awaitPromise: true, returnByValue: true, expression: `(async () => {
    await navigator.clipboard.writeText('SEED');
    const read = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    document.querySelector('input[value="Memcached"]').click();
    const btn = (${opener})();
    btn.click();
    await new Promise((r) => setTimeout(r, 100));
    return { label: btn.textContent, clipboard: (await read()).slice(0, 5) };
  })()` });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};

test('reply: with the clipboard API refused, the bottom bar still puts the reply on the clipboard', { skip: SKIP }, async () => {
  const r = await copyForReal(`() => document.querySelector('.am-reply-bar .am-btn--reply')`);
  assert.deepEqual(r, { label: 'Copied ✓', clipboard: '# Re:' });
});

test('reply: with the clipboard API refused, the sheet still puts the reply on the clipboard', { skip: SKIP }, async () => {
  const r = await copyForReal(`() => { document.querySelector('[data-am="reply"]').click(); return document.querySelector('dialog.am-reply [data-act="copy"]'); }`);
  assert.deepEqual(r, { label: 'Copied ✓', clipboard: '# Re:' });
});
