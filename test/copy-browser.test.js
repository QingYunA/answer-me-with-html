// Browser seam for the three copy buttons outside the Reply sheet — the toolbar's Copy source, a code block's Copy and the
// new-version popover's Copy. Each reads data-done for a moment after a click; this is what a second click inside that moment does
// to the label, which decides whether the button ever says what it is again.
// Needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) like test/update-browser.test.js.
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
  ? 'set AM_E2E=1 to run the browser copy tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

let tmp;
let file;
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
  tmp = mkdtempSync(join(tmpdir(), 'am-copy-'));
  file = join(tmp, 'page.html');
  const update = { latest: '0.9.0', current: '0.5.0', command: 'npx skills update answer-me-with-html -y' };
  writeFileSync(file, renderDoc('---\nlang: en\n---\n## A\nText.\n\n```js\nconst a = 1;\n```\n', {}, {}, { update }).html);
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

// Every copy button is clicked twice, 300 ms apart, inside the 1.4 s its "Copied ✓" label lasts.
const PRESS_TWICE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const copied = [];
  navigator.clipboard.writeText = async (text) => { copied.push(text); };
  const buttons = {
    toolbar: document.querySelector('[data-am="copy"]'),
    code: document.querySelector('[data-am="copy-code"]'),
    update: document.querySelector('[data-am="copy-text"]'),
  };
  const labels = () => Object.fromEntries(Object.entries(buttons).map(([name, btn]) => [name, btn.textContent]));
  const idle = labels();
  for (const btn of Object.values(buttons)) { btn.click(); await sleep(300); btn.click(); }
  const during = labels();
  await sleep(1700);
  return { idle, during, after: labels(), copied: copied.length };
})()`;

test('copy: a button clicked twice inside its "Copied ✓" moment still comes back to its own label', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(PRESS_TWICE);
  assert.deepEqual(r.idle, { toolbar: 'Copy source', code: 'Copy', update: 'Copy' }, 'each button starts from its own label');
  assert.deepEqual(r.during, { toolbar: 'Copied ✓', code: 'Copied ✓', update: 'Copied ✓' }, 'the second click shows the copied label again');
  assert.deepEqual(r.after, r.idle, 'and the label comes back to the one the button started from');
  assert.equal(r.copied, 6, 'both clicks copied, on every button');
});

// The moment restarts on each click, so a second click inside it dates the label from that click, not from the first one. Measured
// per button: click, wait 800 ms, then watch the label change (a MutationObserver, not a poll, so nothing races the page's own
// timer) while a second click lands. The last change is the label coming back, and its time is kept relative to the second click.
const PRESS_TWICE_MEASURED = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  navigator.clipboard.writeText = async () => {};
  const buttons = {
    toolbar: document.querySelector('[data-am="copy"]'),
    code: document.querySelector('[data-am="copy-code"]'),
    update: document.querySelector('[data-am="copy-text"]'),
  };
  const out = {};
  for (const [name, btn] of Object.entries(buttons)) {
    const idle = btn.textContent;
    btn.click();
    await sleep(800);
    const t0 = performance.now();
    const stamps = [];
    const observer = new MutationObserver(() => stamps.push(Math.round(performance.now() - t0)));
    observer.observe(btn, { childList: true, characterData: true, subtree: true });
    btn.click();
    // Two changes to wait for: the copied label, then the label coming back. Either behaviour reaches both, so this never depends
    // on how long a timer takes here; only on when the second change lands.
    while (stamps.length < 2 && performance.now() - t0 < 5000) await sleep(50);
    observer.disconnect();
    out[name] = { idle, label: btn.textContent, backAt: stamps[1] ?? null };
  }
  return out;
})()`;

test('copy: the moment starts again on the second click, so the label lasts a full one from it', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(PRESS_TWICE_MEASURED);
  for (const [name, m] of Object.entries(r)) {
    assert.equal(m.label, m.idle, `${name}: the label comes back to the one the button started from (${JSON.stringify(m)})`);
    assert.notEqual(m.backAt, null, `${name}: the label comes back at all`);
    // A timer never fires early, so on a loaded runner this only reads higher. The old behaviour reads ~600 ms here: it cancelled
    // nothing, so the first click's restore arrived 1.4 s after that click, 600 ms after this one.
    assert.ok(m.backAt >= 1300, `${name}: the label lasts a full moment from the second click (${m.backAt} ms)`);
  }
});
