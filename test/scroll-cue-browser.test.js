// Browser seam for the diagram floor and the sideways scroll cue: render pages, load them in headless Chrome at a set width and read
// the sizes and classes. Needs Chrome, so it runs only with AM_E2E=1 like test/remark-browser.test.js.
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
  ? 'set AM_E2E=1 to run the browser scroll cue tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const CHAIN = 'Client -> FrontendRequestRouterService -> AuthenticationTokenValidator -> SessionLookupRepository -> UserProfileAggregationLayer -> NotificationPreferenceLoader -> ResponseSerializer';
const WIDE = `---
title: Wide flow
---
## A Wide sideways flow
Text above the diagram, so the panel holds more than the diagram alone.
\`\`\`flow LR
${CHAIN}
\`\`\`

## B Short
Short text.
`;
// A wide fan-out top to bottom: no other layout to fall back on, so it scrolls.
const FAN = `---
title: Wide fan-out
---
## A Wide fan-out
Text above the diagram, so the panel holds more than the diagram alone.
\`\`\`flow
Gateway -> ${CHAIN.split(' -> ').slice(1).join(' & ')}
\`\`\`

## B Short
Short text.
`;
const RTL_FAN = `---
title: מניפה רחבה
lang: he
---
## A מניפה
טקסט מעל התרשים.
\`\`\`flow
Gateway -> ${CHAIN.split(' -> ').slice(1).join(' & ')}
\`\`\`

## B קצר
טקסט קצר.
`;

let tmp;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const page = (name, draft) => {
  writeFileSync(join(tmp, `${name}.md`), draft);
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', join(tmp, `${name}.md`), '-o', join(tmp, `${name}.html`), '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
  });
  return join(tmp, `${name}.html`);
};
const load = async (file, width) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await evaluate('new Promise((r) => setTimeout(r, 400))');
};
const moreClasses = (sel) => `[...document.querySelector('${sel}').classList].filter((c) => c.startsWith('am-more-'))`;

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-scroll-cue-'));
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

test('scroll cue: a wide diagram keeps 0.75 of its width, scrolls instead, and fades the edge that hides more', { skip: SKIP }, async () => {
  await load(page('fan', FAN), 1000);
  const state = await evaluate(`(async () => {
    const fig = document.querySelector('#panel-A .am-diagram');
    const svg = fig.querySelector(':scope > svg');
    const natural = Number(svg.getAttribute('width'));
    const shown = svg.getBoundingClientRect().width;
    const atStart = ${moreClasses('#panel-A .am-diagram')};
    fig.scrollLeft = fig.scrollWidth;
    await new Promise((r) => setTimeout(r, 50));
    const atEnd = ${moreClasses('#panel-A .am-diagram')};
    return { floor: shown >= Math.floor(natural * 0.75), scrolls: fig.scrollWidth > fig.clientWidth, atStart, atEnd };
  })()`);
  assert.deepEqual(state, { floor: true, scrolls: true, atStart: ['am-more-right'], atEnd: ['am-more-left'] });
});

test('scroll cue: the floor follows the reader text size, and a box that fits has no fade', { skip: SKIP }, async () => {
  await load(page('wide', WIDE), 1000);
  const state = await evaluate(`(async () => {
    const svg = document.querySelector('#panel-A .am-diagram > svg');
    document.querySelector('[data-am="scale-up"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const floor = parseFloat(svg.style.minWidth) === Math.floor(Number(svg.getAttribute('width')) * 0.75);
    try { localStorage.removeItem('am-scale'); } catch {}
    return { floor, short: [...document.querySelectorAll('#panel-B [class*="am-more-"]')].length };
  })()`);
  assert.deepEqual(state, { floor: true, short: 0 });
});

test('scroll cue: a wide diagram on a right-to-left page starts at the right and fades its left edge', { skip: SKIP }, async () => {
  await load(page('rtl', RTL_FAN), 1000);
  const state = await evaluate(`(async () => {
    const fig = document.querySelector('#panel-A .am-diagram');
    const atStart = ${moreClasses('#panel-A .am-diagram')};
    fig.scrollLeft = -fig.scrollWidth;
    await new Promise((r) => setTimeout(r, 50));
    return { atStart, atEnd: ${moreClasses('#panel-A .am-diagram')}, table: document.querySelectorAll('.am-table-wrap[class*="am-more-"]').length };
  })()`);
  assert.deepEqual(state, { atStart: ['am-more-left'], atEnd: ['am-more-right'], table: 0 });
});
