// Real-Chrome seam for opted-in Markdown tables: value sorting, keyboard access, filtering, print, no-JS output and the CSP.
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
  ? 'set AM_E2E=1 to run the browser table tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
title: Table interactions
lang: en
---
## A Projects
| Project | Stars | Updated | Kind |
| --- | ---: | --- | --- |
| alpha | 12000 | 2025-09-30 | Library |
| beta | 900 | 2026-10-20 | CLI |
| gamma | 3000 | 2024-01-01 | Library |
{table sort filter}

## B Static
| Name | Value |
| --- | ---: |
| delta | 4 |
`;

let tmp;
let chrome;
let cdp;
let session;
let file;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`page script error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
};
const projects = () => evaluate('[...document.querySelectorAll("table[data-am-table] tbody tr")].map((row) => ({ name: row.cells[0].textContent, hidden: row.hidden }))');
const click = (column) => evaluate(`document.querySelectorAll('table[data-am-table] th')[${column}].querySelector('button').click()`);

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-table-'));
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__csp = []; document.addEventListener("securitypolicyviolation", (event) => window.__csp.push({ directive: event.violatedDirective, sample: event.sample }));',
  });
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 300));
});

after(async () => {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      chrome.once('exit', () => { clearTimeout(timer); resolve(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (error) {
    console.warn(`Could not remove ${tmp}: ${error.message}`);
  }
});

test('e2e table: numeric and date columns sort by value, toggle direction, and set aria-sort with no CSP violation', { skip: SKIP }, async () => {
  assert.deepEqual((await projects()).map((row) => row.name), ['alpha', 'beta', 'gamma']);
  assert.equal(await evaluate('document.querySelectorAll(".am-table-wrap:not(:has(table[data-am-table])) .am-table-sort").length'), 0);

  await click(1);
  assert.deepEqual((await projects()).map((row) => row.name), ['beta', 'gamma', 'alpha']);
  assert.equal(await evaluate('document.querySelectorAll("table[data-am-table] th")[1].getAttribute("aria-sort")'), 'ascending');
  await click(1);
  assert.deepEqual((await projects()).map((row) => row.name), ['alpha', 'gamma', 'beta']);
  assert.equal(await evaluate('document.querySelectorAll("table[data-am-table] th")[1].getAttribute("aria-sort")'), 'descending');

  await evaluate('document.querySelectorAll("table[data-am-table] th")[2].querySelector("button").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  assert.deepEqual((await projects()).map((row) => row.name), ['gamma', 'alpha', 'beta']);
  assert.equal(await evaluate('document.querySelectorAll("table[data-am-table] th")[2].getAttribute("aria-sort")'), 'ascending');
  assert.equal(await evaluate('document.querySelectorAll("table[data-am-table] th")[1].hasAttribute("aria-sort")'), false);
  assert.deepEqual(await evaluate('window.__csp'), []);
});

test('e2e table: the filter hides only non-matching rows and clearing restores all of them under the CSP', { skip: SKIP }, async () => {
  assert.equal(await evaluate('document.querySelector("[data-am-table-filter]").closest(".am-table-controls").hidden'), false);
  await evaluate(`(() => {
    const input = document.querySelector('[data-am-table-filter]');
    input.value = 'CLI';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.deepEqual((await projects()).map((row) => [row.name, row.hidden]), [['gamma', true], ['alpha', true], ['beta', false]]);
  await evaluate(`(() => {
    const input = document.querySelector('[data-am-table-filter]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.deepEqual((await projects()).map((row) => row.hidden), [false, false, false]);
  assert.deepEqual(await evaluate('window.__csp'), []);
});

test('e2e table: print hides the controls and sort indicators', { skip: SKIP }, async () => {
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const print = await evaluate(`(() => {
    const controls = document.querySelector('.am-table-controls');
    const sort = document.querySelector('.am-table-sort');
    return { controls: getComputedStyle(controls).display, indicator: getComputedStyle(sort, '::after').content };
  })()`);
  assert.equal(print.controls, 'none');
  assert.ok(print.indicator === 'none' || print.indicator === 'normal');
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  assert.deepEqual(await evaluate('window.__csp'), []);
});

test('e2e table: without JavaScript every row renders, no sort buttons appear, and the filter stays hidden', { skip: SKIP }, async () => {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: plain } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, plain);
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true }, plain);
  const loaded = cdp.once('Page.loadEventFired', plain);
  await cdp.send('Page.navigate', { url: pathToFileURL(file).href }, plain);
  await loaded;
  const result = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      rows: document.querySelectorAll('table[data-am-table] tbody tr').length,
      buttons: document.querySelectorAll('.am-table-sort').length,
      hidden: document.querySelector('.am-table-controls').hidden
    })`, returnByValue: true,
  }, plain);
  assert.deepEqual(JSON.parse(result.result.value), { rows: 3, buttons: 0, hidden: true });
  await cdp.send('Target.closeTarget', { targetId });
  assert.deepEqual(await evaluate('window.__csp'), []);
});
