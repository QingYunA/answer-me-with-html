// Browser seam for the sheet layout under classic scrollbars, as on Windows. The other browser tests hide scrollbars (like macOS
// overlay scrollbars), so a vertical scrollbar there never takes width. Here it does: Chrome runs without --hide-scrollbars.
// Slow and needs Chrome, so it runs only with AM_E2E=1.
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
  ? 'set AM_E2E=1 to run the browser scrollbar tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DESKTOP = 1440;
const SHORT = 300; // a viewport shorter than any page here, so scrollHeight is the page's height
const RESIZE_DELAY_MS = 150; // RESIZE_DELAY in src/runtime/layout-dom.js

// The page from the long-ids table report (#413): its plain grid is taller than its justified rows.
const IDS = '| Change | Author | Landed | Vehicle | Live? | Verdict | Evidence |\n|---|---|---|---|---|---|---|\n'
  + '| 1001 End a stuck lease | alice | 10-21 | web_command_1051211795 | only_in_job_58546795927693416 | NOT_EXERCISED | job_1051223399_log_ends_at_plugin_install |\n'
  + '| 1002 Skip crash with no build | bob | 10-21 | async_tier_1051211796 | unverified | NOT_EXERCISED | key_field_missing_in_check_27030090071 |\n';
const CODE = IDS.replace(/(job_\w+|key_field_\w+)/g, '`$1`');
const HUGE = `| Name | Id |\n|---|---|\n| A short prose cell that reads normally | ${'W'.repeat(120)} |\n`;
const DRAFT = `---\ntitle: Ids that do not fit\nlang: en\ncols: 3\n---\n## A Ids {span=2}\n${IDS}\n## B Neighbour\nShort text.\n\n## C Two columns {span=3}\n${HUGE}\n## D Ids in code {span=2}\n${CODE}\n## E Neighbour\nShort text.\n`;

let tmp;
let file;
let chrome;
let cdp;
let session;

const page = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (width, height) => {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => true)');
  await sleep(RESIZE_DELAY_MS * 3); // past the late layout that fonts.ready schedules
};

// The grid's display, page height, scrollbar width, and whether every row of the justified layout adds up to the grid's width.
const STATE = `(() => {
  const grid = document.querySelector('.am-grid');
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const rows = [];
  for (const el of grid.children) {
    const r = el.getBoundingClientRect();
    let row = rows.find((x) => Math.abs(x.top - r.top) <= 1);
    if (!row) rows.push((row = { top: r.top, sum: -gap }));
    row.sum += r.width + gap;
  }
  return {
    display: getComputedStyle(grid).display,
    height: document.documentElement.scrollHeight,
    scrollbar: innerWidth - document.documentElement.clientWidth,
    rowsFill: rows.every((row) => Math.abs(row.sum - grid.clientWidth) <= 1),
  };
})()`;

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-scrollbar-'));
  file = join(tmp, 'ids.html');
  writeFileSync(file, renderDoc(DRAFT).html);
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--force-device-scale-factor=1', `--window-size=${DESKTOP},900`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable');
});

after(async () => {
  cdp?.close();
  if (chrome) {
    await new Promise((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    // Chrome helper processes can still write to the profile after the main process exits (#74).
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

test('e2e scrollbar: a page whose plain grid needs a scrollbar and whose justified rows do not still lays out', { skip: SKIP, timeout: 60000 }, async () => {
  // Page heights in a short viewport, where both scroll: the justified rows, then the plain grid (scripts off).
  await open(DESKTOP, SHORT);
  const rows = await evaluate(STATE);
  assert.equal(rows.display, 'flex', 'the page lays out when it scrolls anyway');
  await page('Emulation.setScriptExecutionDisabled', { value: true });
  let grid;
  try {
    await open(DESKTOP, SHORT);
    grid = await evaluate(STATE);
    assert.ok(grid.height - rows.height >= 60, `the plain grid (${grid.height}px) is clearly taller than the justified rows (${rows.height}px)`);

    // A viewport between the two: the grid scrolls, so it shows a classic scrollbar that takes width.
    const height = Math.round((rows.height + grid.height) / 2);
    await open(DESKTOP, height);
    assert.ok((await evaluate(STATE)).scrollbar > 0, 'Chrome draws a classic scrollbar that takes width');
  } finally {
    await page('Emulation.setScriptExecutionDisabled', { value: false });
  }

  // The layout script starts from the grid, with its scrollbar; the justified rows it plans fit without one, so the width grows.
  // It must settle on the wider width, not fall back to the grid.
  await open(DESKTOP, Math.round((rows.height + grid.height) / 2));
  const laidOut = await evaluate(STATE);
  assert.equal(laidOut.display, 'flex', 'the justified layout is in place, not the plain grid');
  assert.equal(laidOut.scrollbar, 0, 'the justified rows fit the viewport without a scrollbar');
  assert.ok(laidOut.rowsFill, 'every row adds up to the full width');
});
