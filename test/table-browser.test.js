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
| Project [docs](https://example.com) | Stars | Updated | Kind |
| --- | ---: | --- | --- |
| alpha | 12000 | 2025-09-30 | Library |
| beta | 900 | 2026-10-20 | CLI |
| gamma | 3000 | 2024-01-01 | Library |
{table sort filter}

## B Static
| Name | Value |
| --- | ---: |
| delta | 4 |

## C Mixed values
| Item | Value |
| --- | ---: |
| empty |  |
| negative | -40 |
| grouped | $1,200 |
| currency | $900 |
| text | 10a |
| two | 2 |
| eight | 8 |
| ten | 10 |
| percent | 12% |
{table sort}

## D Exact integers and ties
| Item | Value |
| --- | ---: |
| larger | 9007199254740993 |
| smaller | 9007199254740992 |
| largest | 9007199254740994 |
| integer-first | 2 |
| decimal-second | 2.0 |
{table sort}

## E Impossible date
| Item | Value |
| --- | ---: |
| invalid | 2024-02-31 |
| march-first | 2024-03-01 |
| march-second | 2024-03-02 |
{table sort}

## F Exact integers with a zero fraction
| Item | Value |
| --- | ---: |
| larger | 9007199254740993.0 |
| smaller | 9007199254740992.0 |
{table sort}

## G API migration
\`\`\`api
~ GET /users/{id}
response 200 User
  id string required
  - email string optional
  + email string required
+ POST /users/batch
request BatchRequest
  ids string[] required
- RPC Users/GetLegacy
response OK User
  id string required
\`\`\`

## H Code diff palette
\`\`\`diff
-old
+new
\`\`\`
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
const projects = () => evaluate('[...document.querySelectorAll("table[data-am-table]")[0].tBodies[0].rows].map((row) => ({ name: row.cells[0].textContent, hidden: row.hidden }))');
const items = (table) => evaluate(`[...document.querySelectorAll('table[data-am-table]')[${table}].tBodies[0].rows].map((row) => row.cells[0].textContent)`);
const click = (column, table = 0) => evaluate(`document.querySelectorAll('table[data-am-table]')[${table}].tHead.rows[0].cells[${column}].querySelector('button').click()`);

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

test('e2e table: header links stay outside sort buttons and do not trigger sorting', { skip: SKIP }, async () => {
  const before = (await projects()).map((row) => row.name);
  const structure = await evaluate(`(() => {
    const head = document.querySelectorAll('table[data-am-table] th')[0];
    const link = head.querySelector('a');
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();
    return { nested: Boolean(head.querySelector('button a')), label: head.querySelector('button').getAttribute('aria-label') };
  })()`);
  assert.equal(structure.nested, false);
  assert.equal(structure.label, 'Project docs');
  assert.deepEqual((await projects()).map((row) => row.name), before);
  assert.equal(await evaluate('document.querySelectorAll("table[data-am-table] th")[0].hasAttribute("aria-sort")'), false);
});

test('e2e table: mixed value columns use one total order with parseable values before text', { skip: SKIP }, async () => {
  await click(1, 1);
  assert.deepEqual(await items(1), ['negative', 'two', 'eight', 'ten', 'percent', 'currency', 'grouped', 'empty', 'text']);
  await click(1, 1);
  assert.deepEqual(await items(1), ['text', 'empty', 'grouped', 'currency', 'percent', 'ten', 'eight', 'two', 'negative']);
});

test('e2e table: integers beyond 2^53 compare exactly and numeric ties stay stable', { skip: SKIP }, async () => {
  await click(1, 2);
  assert.deepEqual(await items(2), ['integer-first', 'decimal-second', 'smaller', 'larger', 'largest']);
  await click(1, 2);
  assert.deepEqual(await items(2), ['largest', 'larger', 'smaller', 'integer-first', 'decimal-second']);
});

test('e2e table: integers with an all-zero fraction beyond 2^53 compare exactly', { skip: SKIP }, async () => {
  await click(1, 4);
  assert.deepEqual(await items(4), ['smaller', 'larger']);
});

test('e2e table: the sort button replaces the first moved node, so text before a header link stays before it', { skip: SKIP }, async () => {
  const order = await evaluate(`[...document.querySelectorAll('table[data-am-table] th')[0].childNodes].map((node) => node.nodeType === 1 ? node.tagName : node.textContent.trim())`);
  assert.deepEqual(order, ['BUTTON', 'A']);
  assert.equal(await evaluate(`document.querySelectorAll('table[data-am-table] th')[0].querySelector('button').textContent.trim()`), 'Project');
});

test('e2e table: impossible ISO dates sort as text instead of overflowing into March', { skip: SKIP }, async () => {
  await click(1, 3);
  assert.deepEqual(await items(3), ['march-first', 'march-second', 'invalid']);
});

test('e2e table: the filter hides only non-matching rows and clearing restores all of them under the CSP', { skip: SKIP }, async () => {
  assert.equal(await evaluate('document.querySelector("[data-am-table-filter]").closest(".am-table-controls").hidden'), false);
  await evaluate(`(() => {
    const input = document.querySelector('[data-am-table-filter]');
    input.value = 'CLI';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  // Compared by name: the sort tests before this one leave the rows in their own order.
  const byName = (rows) => rows.map((row) => [row.name, row.hidden]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(byName(await projects()), [['alpha', true], ['beta', false], ['gamma', true]]);
  await evaluate(`(() => {
    const input = document.querySelector('[data-am-table-filter]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.deepEqual((await projects()).map((row) => row.hidden), [false, false, false]);
  assert.deepEqual(await evaluate('window.__csp'), []);
});

// API view changes must hide whole added/removed endpoints and select the correct old/new field definition together.
test('e2e api: one switch changes multiple HTTP/RPC contracts and their exact field definitions', { skip: SKIP }, async () => {
  // snapshot clicks the real view control and reads only contracts and rows that occupy visible layout boxes.
  const snapshot = (view) => evaluate(`(() => {
    const host = document.querySelector('#panel-G .am-api');
    host.querySelector('button[data-view="${view}"]').click();
    return [...host.querySelectorAll('.am-api-contract')].filter((el) => el.getClientRects().length).map((contract) => ({
      target: [...contract.querySelector('.am-api-endpoint').querySelectorAll('strong,code')].map((el) => el.textContent).join(' '),
      fields: [...contract.querySelectorAll('tbody tr')].filter((row) => row.getClientRects().length).map((row) => ({
        name: row.cells[0].querySelector('code').textContent,
        requirement: row.cells[2].textContent,
      })),
    }));
  })()`);
  const changes = await snapshot('changes');
  assert.deepEqual(changes.map((contract) => contract.target), ['GET /users/{id}', 'POST /users/batch', 'RPC Users/GetLegacy']);
  assert.deepEqual(changes[0].fields.map((field) => field.name), ['id', 'email', 'email']);
  const before = await snapshot('before');
  assert.deepEqual(before.map((contract) => contract.target), ['GET /users/{id}', 'RPC Users/GetLegacy']);
  assert.deepEqual(before[0].fields, [{ name: 'id', requirement: 'Required' }, { name: 'email', requirement: 'Optional' }]);
  const after = await snapshot('after');
  assert.deepEqual(after.map((contract) => contract.target), ['GET /users/{id}', 'POST /users/batch']);
  assert.deepEqual(after[0].fields, [{ name: 'id', requirement: 'Required' }, { name: 'email', requirement: 'Required' }]);
  assert.equal(await evaluate(`document.querySelector('#panel-G [data-view="after"]').getAttribute('aria-pressed')`), 'true');
  assert.deepEqual(await snapshot('changes'), changes);
  assert.deepEqual(await evaluate('window.__csp'), []);
});

// API additions and deletions must use the code diff palette for fields, endpoints, badges and counts, even when a theme's status color is blue.
test('e2e api: change colors match code diffs in all built-in themes and light/dark modes', { skip: SKIP }, async () => {
  for (const theme of ['blueprint', 'shadcn', 'paper']) {
    for (const mode of ['light', 'dark']) {
      const tones = await evaluate(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        document.documentElement.dataset.mode = '${mode}';
        const host = document.querySelector('#panel-G .am-api');
        return ['added', 'removed'].map((state) => {
          const sign = state === 'added' ? 'add' : 'del';
          return {
            expected: getComputedStyle(document.querySelector('.am-code-stat-' + sign)).color,
            expectedBg: getComputedStyle(document.querySelector('.am-ln--' + sign)).backgroundColor,
            field: getComputedStyle(host.querySelector('tr[data-delta="' + state + '"] th')).color,
            background: getComputedStyle(host.querySelector('tr[data-delta="' + state + '"] th')).backgroundColor,
            endpoint: getComputedStyle(host.querySelector('article[data-delta="' + state + '"] .am-api-endpoint strong')).color,
            badge: getComputedStyle(host.querySelector('.am-delta-badge--' + state)).color,
            count: getComputedStyle(host.querySelector('.am-delta-count--' + state)).color,
          };
        });
      })()`);
      for (const tone of tones) {
        for (const part of ['field', 'endpoint', 'badge', 'count']) assert.equal(tone[part], tone.expected, `${theme}/${mode}/${part}`);
        assert.equal(tone.background, tone.expectedBg, `${theme}/${mode}/background`);
      }
    }
  }
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
      rows: document.querySelectorAll('table[data-am-table]')[0].tBodies[0].rows.length,
      buttons: document.querySelectorAll('.am-table-sort').length,
      hidden: document.querySelector('.am-table-controls').hidden
    })`, returnByValue: true,
  }, plain);
  assert.deepEqual(JSON.parse(result.result.value), { rows: 3, buttons: 0, hidden: true });
  await cdp.send('Target.closeTarget', { targetId });
  assert.deepEqual(await evaluate('window.__csp'), []);
});
