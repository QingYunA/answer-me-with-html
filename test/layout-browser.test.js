// Browser seam for the photo-wall layout (spec #50, ticket #52): render sheet pages with the CLI, open them in headless Chrome
// and check what a reader sees. Slow and needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) and skips without Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser layout tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DESKTOP = 1440;
const TABLET = 1000;
const PHONE = 390;
const A4_PORTRAIT = 794; // CSS px: A4 at 96 dpi, before margins
const BAND_RATIO = 1.25; // diagrams on one page differ in scale by at most this (see BAND_RATIO in src/runtime/layout-plan.js)
const SCALE_TOLERANCE = 0.03; // the browser rounds widths to whole pixels
const BUDGET_MS = 1000; // generous: a re-layout takes well under 300 ms on a developer laptop
const RESIZE_DELAY_MS = 150; // the page script waits this long after the last resize before it lays out (RESIZE_DELAY in layout-dom.js)

const filler = (id, n) => `## ${id} 说明${n}\n这一段是普通文字，用来和其他面板排成一行，长度适中，换行后大约占四五行。这一段是普通文字，用来和其他面板排成一行。\n`;
const fillerEn = (id, n) => `## ${id} Note ${n}\nThis panel is plain text. It sits in a row with other panels and wraps to a few lines. It is here to give the planner something to balance.\n`;

const STRESS = {
  'wide-table.zh': `---
title: 宽表压力测试
cols: 3
---
## A 方案对比
| 方案 | 做法 | 适用场景 |
|---|---|---|
| 先拆分再合并 | 把大任务拆成多个小任务，各自完成之后再统一合并回主分支 | 团队人数较多，任务之间依赖较少，需要并行推进的项目 |
| 持续集成 | 每次提交都自动构建并运行全部测试，失败时立即通知提交者 | 代码变动频繁，需要尽早发现问题的项目 |
| 功能开关 | 新功能默认关闭，上线后逐步对部分用户开启，出问题时一键关闭 | 风险较高、需要灰度发布的功能 |

${filler('B', 1)}
${filler('C', 2)}
${filler('D', 3)}`,
  'wide-table.en': `---
title: Wide table stress test
cols: 3
lang: en
---
## A Options
| Option | How it works | When to use it |
|---|---|---|
| Split, then merge | Cut a large task into small tasks, finish each one, and merge them back into the main branch together | Large teams, tasks with few dependencies, work that must run in parallel |
| Continuous integration | Every commit builds and runs the whole test suite, and a failure tells the author at once | Code that changes often and must be checked early |
| Feature flags | A new feature starts switched off, opens for a few users after release, and one switch turns it off again | Risky features that need a staged release |

${fillerEn('B', 1)}
${fillerEn('C', 2)}
${fillerEn('D', 3)}`,
  'narrow-diagrams.zh': `---
title: 窄图压力测试
cols: 3
---
## A 握手
\`\`\`flow
客户端 -> 服务器: 请求
服务器 -> 客户端: 应答
\`\`\`

## B 挥手
\`\`\`flow
主动方 -> 被动方: 关闭
被动方 -> 主动方: 确认
\`\`\`

${filler('C', 1)}
${filler('D', 2)}
${filler('E', 3)}`,
  'narrow-diagrams.en': `---
title: Narrow diagram stress test
cols: 3
lang: en
---
## A Open
\`\`\`flow
Client -> Server: request
Server -> Client: reply
\`\`\`

## B Close
\`\`\`flow
Sender -> Receiver: close
Receiver -> Sender: confirm
\`\`\`

${fillerEn('C', 1)}
${fillerEn('D', 2)}
${fillerEn('E', 3)}`,
  'mixed-diagrams.en': `---
title: Mixed diagram sizes stress test
cols: 3
lang: en
---
## A Many actors
\`\`\`sequence
participants: Browser, Gateway, Auth service, Orders service, Database
Browser -> Gateway: POST /orders
Gateway -> Auth service: check the token
Auth service -> Gateway: token is valid
Gateway -> Orders service: create the order
Orders service -> Database: insert one row
Database -> Orders service: done
Orders service -> Gateway: order created
Gateway -> Browser: 201 Created
\`\`\`

## B Short
\`\`\`flow
Ask -> Reply: answer
\`\`\`

${fillerEn('C', 1)}
## D Small states
\`\`\`flow LR
(A) -> B: go
B -> *C: stop
\`\`\`

## E Handshake
\`\`\`flow
Client -> Server: request
Server -> Client: reply
\`\`\`

${fillerEn('F', 2)}
${fillerEn('G', 3)}`,
  // Short cells in four columns beside a key-value grid: the table used to get about 96 px a column, one word per line.
  'short-table.en': `---
title: Narrow table
cols: 3
lang: en
---
## A What was tested {bare}
\`\`\`kv 3
Dry-run model: z-ai/glm-5.3
Problems: 10 (7 proven optimal, 3 best known)
Harness checks: 68 + 82, all passing
\`\`\`

## B How we got here
- The decision: no UI first, check whether the process helps at all.
- Four dry runs on GLM 5.3, two runs of the second arm stopped halfway.
- The key returns 401, the key itself is invalid, not only the balance.

## C What the dry runs showed
| Problem | Arm | Result | State |
|---|---|---|---|
| golomb-12 | plain loop | length 85, known optimum | warn likely recalled |
| golomb-12 | branch search | stopped after 22 events | no did not finish |
| circle-packing-26 | plain loop | 1.4746, 56% of record | ok within budget |
| circle-packing-26 rerun | plain loop | 99.76% of record | warn no headroom |

## D What not to start
Do not build the three screens. The decision waits for the kill test, and the dry runs show an open problem.

## E Next step
A new API key, then a full run: 10 problems by 2 arms by 3 seeds.
`,
};

// Drafts where the server pads or widens a panel's span (row filling, wide tables and diagrams): the padding is no hint from the author,
// so these panels must share rows instead of each taking a whole row.
const PADDED = {
  'padded-text.zh': `---
title: 四个短面板
cols: 3
---
${filler('A', 1)}
${filler('B', 2)}
${filler('C', 3)}
${filler('D', 4)}`,
  'padded-table.zh': `---
title: 短面板加宽表
cols: 3
---
## A 说明
这一段是普通文字，用来和宽表排在同一行。

## B 对比
| 方案 | 做法 | 场景 | 成本 | 风险 |
|---|---|---|---|---|
| 拆分 | 拆成小任务 | 人多 | 中 | 低 |
| 集成 | 每次提交构建 | 变动多 | 低 | 低 |`,
  'padded-diagram.en': `---
title: Short panel and a flow diagram
cols: 3
lang: en
---
## A Note
This panel is plain text. It shares a row with the diagram.

## B Pipeline
\`\`\`flow LR
(Idea) -> spec: write it
spec -> tickets: split it
tickets -> code: build it
\`\`\``,
};

// A page whose grid gets narrower once it is laid out (a stand-in for a scrollbar that appears with the new row heights), so the width
// the layout was planned for never holds. And a page with an image inside the grid, whose late load changes panel heights.
const UNSTABLE = {
  'unstable.en': `---
title: Unstable width
cols: 3
lang: en
---
${fillerEn('A', 1)}
${fillerEn('B', 2)}
## C Style
\`\`\`html
<style>.am-grid[style*="display: flex"] { max-width: 900px; }</style>
<img alt="dot" width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20'/%3E%3C/svg%3E">
\`\`\``,
  'image.en': `---
title: Image in a panel
cols: 3
lang: en
---
${fillerEn('A', 1)}
${fillerEn('B', 2)}
## C Image
\`\`\`html
<img alt="dot" width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20'/%3E%3C/svg%3E">
\`\`\``,
};

// Everything the checks need, read in the page in one call. A "row" is the set of grid children with the same top edge.
const MEASURE = `(() => {
  const grid = document.querySelector('.am-grid');
  const box = (e) => e.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const rows = [];
  for (const el of grid.children) {
    const r = box(el);
    let row = rows.find((x) => Math.abs(x.top - r.top) <= 1);
    if (!row) rows.push((row = { top: r.top, items: [] }));
    row.items.push({ width: r.width, bottom: r.bottom });
  }
  const clipped = [];
  for (const p of grid.querySelectorAll('.am-panel')) {
    if (p.scrollWidth > p.clientWidth + 1) clipped.push(p.id + ' (panel, wide)');
    if (p.scrollHeight > p.clientHeight + 1) clipped.push(p.id + ' (panel, tall)');
    for (const e of p.querySelectorAll('.am-table-wrap, .am-diagram, pre')) {
      if (e.scrollWidth > e.clientWidth + 1) clipped.push(p.id + ' (' + e.className + ' scrolls sideways)');
    }
  }
  const panels = [...grid.querySelectorAll('.am-panel')];
  const gridBox = box(grid);
  // Rendered scale of every panel that holds only a diagram (the planner controls those): rendered width / natural width.
  const diagramScales = panels.map((p) => {
    const body = p.querySelector(':scope > .am-panel-body');
    const svg = body && body.children.length === 1 ? body.querySelector(':scope > .am-diagram > svg') : null;
    return svg ? { id: p.id, scale: box(svg).width / Number(svg.getAttribute('width')) } : null;
  }).filter(Boolean);
  return {
    display: getComputedStyle(grid).display,
    gap,
    width: grid.clientWidth,
    rows,
    clipped,
    order: panels.map((p) => p.id),
    wrappers: [...grid.children].filter((e) => !e.classList.contains('am-panel')).length,
    panelWidths: panels.map((p) => box(p).width),
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    gridLeft: gridBox.left,
    diagramScales,
    gridOverflow: grid.scrollWidth - grid.clientWidth,
    // The justified layout is in place and fits the current container: every row adds up to the grid's width.
    settled: getComputedStyle(grid).display === 'flex' && rows.every((row) => Math.abs(row.items.reduce((sum, it) => sum + it.width, 0) + gap * (row.items.length - 1) - grid.clientWidth) <= 1),
  };
})()`;
const SETTLED = `(${MEASURE}).settled`;

let tmp;
let chrome;
let cdp;
let session;
const pages = [];
const special = {}; // drafts for the tests that need a page of their own, by name

const page = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const setWidth = (width) => page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
const waitFor = async (condition, what, timeout = 4000) => {
  const t0 = Date.now();
  for (;;) {
    const value = await evaluate(condition);
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const open = async (file, width) => {
  await setWidth(width);
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await evaluate('document.fonts.ready.then(() => true)');
};
const measure = () => evaluate(MEASURE);

before(() => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-layout-'));
  const render = (src, name) => {
    const out = join(tmp, `${name}.html`);
    execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', src, '-o', out, '--no-open'], {
      env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
    });
    const html = readFileSync(out, 'utf8');
    return { name, file: out, ids: [...html.matchAll(/<section class="am-panel[^"]*" id="(panel-[^"]+)"/g)].map((m) => m[1]) };
  };
  const examples = readdirSync(join(ROOT, 'examples'))
    .filter((f) => f.endsWith('.md') && !f.startsWith('video-') && !/^template: doc/m.test(readFileSync(join(ROOT, 'examples', f), 'utf8')))
    .map((f) => render(join(ROOT, 'examples', f), f.replace(/\.md$/, '')));
  mkdirSync(join(tmp, 'drafts'));
  const stress = Object.entries({ ...STRESS, ...PADDED }).map(([name, text]) => {
    const src = join(tmp, 'drafts', `${name}.md`);
    writeFileSync(src, text);
    return render(src, name);
  });
  pages.push(...examples, ...stress);
  for (const [name, text] of Object.entries(UNSTABLE)) {
    const src = join(tmp, 'drafts', `${name}.md`);
    writeFileSync(src, text);
    special[name] = render(src, name);
  }
});

const launch = async () => {
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', `--window-size=${DESKTOP},900`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable');
};

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
    // A leftover temp directory is not a test failure.
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

// The laid-out page, as a reader sees it, must keep these invariants at any width above the single-column breakpoint.
function assertJustified(name, width, m, ids) {
  const where = `${name} @${width}px`;
  assert.equal(m.display, 'flex', `${where}: the grid is a flex container`);
  assert.deepEqual(m.order, ids, `${where}: panel order is unchanged`);
  assert.ok(m.rows.length >= 1);
  m.rows.forEach((row, i) => {
    const sum = row.items.reduce((s, it) => s + it.width, 0) + m.gap * (row.items.length - 1);
    assert.ok(Math.abs(sum - m.width) <= 1, `${where}: row ${i + 1} widths add up to ${m.width}px, got ${sum}px`);
    const bottoms = row.items.map((it) => it.bottom);
    assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 1, `${where}: row ${i + 1} shares a bottom edge, got ${bottoms.join(', ')}`);
  });
  assert.deepEqual(m.clipped, [], `${where}: nothing overflows or is clipped`);
  assert.ok(m.pageOverflow <= 0, `${where}: the page does not scroll sideways`);
  assertScaleBand(where, m);
}

// Diagram-only panels on one page stay in one scale band.
function assertScaleBand(where, m) {
  if (m.diagramScales.length < 2) return;
  const scales = m.diagramScales.map((d) => d.scale);
  const ratio = Math.max(...scales) / Math.min(...scales);
  assert.ok(ratio <= BAND_RATIO + SCALE_TOLERANCE, `${where}: diagram scales ${scales.map((x) => x.toFixed(2)).join(', ')} differ by ${ratio.toFixed(2)}x (limit ${BAND_RATIO}x)`);
}

test('e2e: sheet pages lay out as justified rows at 1440 px, and a re-layout after a resize finishes within budget', { skip: SKIP, timeout: 180000 }, async () => {
  await launch();
  assert.ok(pages.length >= 6, 'examples and stress drafts rendered');
  for (const p of pages) {
    await open(p.file, DESKTOP);
    await waitFor(SETTLED, `${p.name} to lay out`);
    const m = await measure();
    assertJustified(p.name, DESKTOP, m, p.ids);
    // Time a forced resize: the script waits for the resize to settle, then plans and applies the new layout.
    const t0 = Date.now();
    await setWidth(DESKTOP - 120);
    await waitFor(`document.querySelector('.am-grid').clientWidth !== ${m.width} && ${SETTLED}`, `${p.name} to re-lay out`);
    const took = Date.now() - t0 - RESIZE_DELAY_MS;
    assertJustified(p.name, DESKTOP - 120, await measure(), p.ids);
    assert.ok(took < BUDGET_MS, `${p.name}: re-layout took about ${took} ms (budget ${BUDGET_MS} ms)`);
    console.log(`  re-layout ${p.name}: about ${took} ms, ${m.rows.length} rows, ${m.order.length} panels`);
  }
});

// Panels that sit alone in a row are only right when the author asked for it (these drafts have no span).
const itemsPerRow = (m) => m.rows.map((r) => r.items.length);

test('e2e: panels padded by the server share rows: four short panels, a short panel with a wide table or a diagram', { skip: SKIP, timeout: 120000 }, async () => {
  if (!cdp) await launch();
  const cases = [['padded-text.zh', DESKTOP], ['padded-table.zh', DESKTOP], ['padded-diagram.en', DESKTOP], ['padded-diagram.en', TABLET]];
  const alone = [];
  for (const [name, width] of cases) {
    const p = pages.find((x) => x.name === name);
    await open(p.file, width);
    await waitFor("document.querySelector('.am-grid').style.display === 'flex'", `${name} to lay out`);
    const m = await measure();
    assertJustified(name, width, m, p.ids);
    if (!itemsPerRow(m).every((n) => n >= 2)) alone.push(`${name} @${width}px: panels per row ${itemsPerRow(m).join(', ')} (widths ${m.panelWidths.map(Math.round).join(', ')})`);
  }
  assert.deepEqual(alone, [], 'every row has at least two panels');
});

test('e2e: resizing re-lays out the page, and a phone width restores one column', { skip: SKIP, timeout: 120000 }, async () => {
  if (!cdp) await launch();
  for (const name of ['tcp', 'wide-table.zh', 'narrow-diagrams.en']) {
    const p = pages.find((x) => x.name === name);
    assert.ok(p, `${name} page`);
    await open(p.file, DESKTOP);
    await waitFor(SETTLED, `${name} to lay out`);
    const wide = await measure();
    assertJustified(name, DESKTOP, wide, p.ids);

    await setWidth(TABLET);
    await waitFor(`document.querySelector('.am-grid').clientWidth !== ${wide.width} && ${SETTLED}`, `${name} to re-lay out at ${TABLET}px`);
    const tablet = await measure();
    assertJustified(name, TABLET, tablet, p.ids);

    await setWidth(PHONE);
    await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid'", `${name} to restore the grid at ${PHONE}px`);
    const phone = await measure();
    assert.equal(phone.wrappers, 0, `${name}: no column wrappers on a phone`);
    assert.deepEqual(phone.order, p.ids);
    assert.ok(phone.panelWidths.every((w) => Math.abs(w - phone.width) <= 1), `${name}: one column on a phone, widths ${phone.panelWidths.join(', ')} in ${phone.width}px`);
    assert.ok(phone.rows.every((r) => r.items.length === 1), `${name}: one panel per row on a phone`);
    assert.ok(phone.pageOverflow <= 0, `${name}: the phone page does not scroll sideways`);

    await setWidth(DESKTOP);
    await waitFor("document.querySelector('.am-grid').style.display === 'flex'", `${name} to lay out again at ${DESKTOP}px`);
    assertJustified(name, DESKTOP, await measure(), p.ids);
  }
});

// Print: the justified widths are tied to the screen width, so printing falls back to the plain grid (never a mix of both).
// Emulating print media tests the layout; Page.printToPDF checks that real printing goes through the same path.
const assertPrintLayout = (where, m, ids) => {
  assert.equal(m.display, 'grid', `${where}: the print layout is the plain grid`);
  assert.equal(m.wrappers, 0, `${where}: no column wrappers in print`);
  assert.deepEqual(m.order, ids, `${where}: panel order is unchanged in print`);
  assert.deepEqual(m.clipped, [], `${where}: no panel is clipped or overflows in print`);
  assert.ok(m.gridOverflow <= 0, `${where}: the grid does not overflow its box in print`);
  assert.ok(m.pageOverflow <= 0, `${where}: the printed page does not scroll sideways`);
  assert.ok(m.panelWidths.every((w) => w <= m.width + 1), `${where}: every panel fits the printed width ${m.width}px`);
};

test('e2e: printing restores the plain grid with complete panels, and screen layout comes back afterwards', { skip: SKIP, timeout: 180000 }, async () => {
  if (!cdp) await launch();
  for (const p of pages) {
    await open(p.file, DESKTOP);
    await waitFor(SETTLED, `${p.name} to lay out`);
    assertJustified(p.name, DESKTOP, await measure(), p.ids);

    await page('Emulation.setEmulatedMedia', { media: 'print' });
    await setWidth(A4_PORTRAIT);
    await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid'", `${p.name} to switch to the print layout`);
    assertPrintLayout(`${p.name} (print, ${A4_PORTRAIT}px)`, await measure(), p.ids);

    await page('Emulation.setEmulatedMedia', { media: '' });
    await setWidth(DESKTOP);
    await waitFor("document.querySelector('.am-grid').style.display === 'flex'", `${p.name} to lay out again after print`);
    assertJustified(p.name, DESKTOP, await measure(), p.ids);
  }

  // Real printing: Chrome prints the page (A4 portrait, 10 mm margins) and the script goes through its print path.
  for (const name of ['tcp', 'wide-table.zh', 'narrow-diagrams.en']) {
    const p = pages.find((x) => x.name === name);
    await open(p.file, DESKTOP);
    await waitFor(SETTLED, `${name} to lay out`);
    // This listener is added after the page script's own, so it runs after it: it records what the script left for the printer.
    await evaluate("window.__gridAtBeforePrint = []; addEventListener('beforeprint', () => window.__gridAtBeforePrint.push(getComputedStyle(document.querySelector('.am-grid')).display))");
    const { data } = await page('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4, printBackground: true });
    assert.equal(Buffer.from(data, 'base64').subarray(0, 5).toString(), '%PDF-', `${name}: Chrome produced a PDF`);
    assert.deepEqual(await evaluate('window.__gridAtBeforePrint'), ['grid'], `${name}: the page script had restored the grid when printing began`);
    await waitFor("document.querySelector('.am-grid').style.display === 'flex'", `${name} to lay out again after printing`);
    assertJustified(name, DESKTOP, await measure(), p.ids);
  }
});

// A cell of two or more words shown one word per line is the defect: a table panel needs the width its columns read well at.
const STACKED_CELLS = `[...document.querySelectorAll('.am-md td')].filter((td) => {
  const words = td.textContent.trim().split(/\\s+/).length;
  const range = document.createRange();
  range.selectNodeContents(td);
  const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  return words >= 2 && lines >= words;
}).map((td) => td.textContent.trim())`;

test('e2e: a table with short cells keeps its words together on wide screens, and print leaves no hole beside a wide panel', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  for (const name of ['short-table.en', 'wide-table.en']) {
    const p = pages.find((x) => x.name === name);
    for (const width of [DESKTOP, 1300]) {
      await open(p.file, width);
      await waitFor(SETTLED, `${name} to lay out`);
      assert.deepEqual(await evaluate(STACKED_CELLS), [], `${name} @${width}px: no cell shows one word per line`);
    }
  }
  const p = pages.find((x) => x.name === 'short-table.en');
  await open(p.file, DESKTOP);
  await waitFor(SETTLED, 'short-table.en to lay out');
  await page('Emulation.setEmulatedMedia', { media: 'print' });
  await setWidth(A4_PORTRAIT);
  await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid'", 'the print layout');
  const widths = await evaluate("[...document.querySelectorAll('.am-grid > .am-panel')].map((el) => Math.round(el.getBoundingClientRect().width))");
  const grid = await evaluate("Math.round(document.querySelector('.am-grid').getBoundingClientRect().width)");
  assert.ok(widths.every((w) => Math.abs(w - grid) <= 1), `print: every panel takes the full row, got ${widths.join(', ')} of ${grid}`);
  await page('Emulation.setEmulatedMedia', { media: '' });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nColumns = "getComputedStyle(document.querySelector('.am-grid')).gridTemplateColumns.split(' ').length";
const plainGrid = (where, m, columns) => {
  assert.equal(m.display, 'grid', `${where}: the grid is the plain CSS grid`);
  assert.equal(m.wrappers, 0, `${where}: no column wrappers`);
  assert.equal(columns, 3, `${where}: three grid tracks`);
};

test('e2e: with JavaScript off the sheet keeps its CSS grid', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  await page('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    for (const name of ['padded-text.zh', 'tcp']) {
      const p = pages.find((x) => x.name === name);
      await open(p.file, DESKTOP);
      await sleep(300); // longer than the script's resize delay, in case anything still ran
      const m = await measure();
      plainGrid(`${name} (no JavaScript)`, m, await evaluate(nColumns));
      // The server's row filling is what shows: the fourth short panel is padded to a full row.
      if (name === 'padded-text.zh') assert.deepEqual(itemsPerRow(m), [3, 1], `${name}: the server's rows`);
      assert.equal(await evaluate('document.querySelectorAll(".am-panel[style*=width], .am-panel[style*=flex]").length'), 0, `${name}: no widths from the layout script`);
      assert.deepEqual(m.order, p.ids, `${name}: panel order`);
    }
  } finally {
    await page('Emulation.setScriptExecutionDisabled', { value: false });
  }
});

test('e2e: a late resize or media change cannot lay the page out again between beforeprint and afterprint', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const p = pages.find((x) => x.name === 'tcp');
  await open(p.file, DESKTOP);
  await waitFor(SETTLED, 'tcp to lay out');
  await evaluate("window.dispatchEvent(new Event('beforeprint'))");
  assert.equal((await measure()).display, 'grid', 'beforeprint restores the grid at once');
  await setWidth(DESKTOP - 140); // a late resize: the debounced layout fires while the print layout is meant to stand
  await sleep(RESIZE_DELAY_MS * 3);
  const during = await measure();
  assert.equal(during.display, 'grid', 'the grid is still plain after the late resize');
  assert.equal(during.wrappers, 0, 'no column wrappers appeared');
  assert.equal(await evaluate('document.querySelectorAll(".am-panel[style*=width]").length'), 0, 'no flex widths were applied');
  await evaluate("window.dispatchEvent(new Event('afterprint'))");
  await waitFor(`${SETTLED}`, 'the screen layout to come back after afterprint');
  assertJustified('tcp', DESKTOP - 140, await measure(), p.ids);
});

test('e2e: when the width keeps changing under the layout, the page falls back to the grid instead of oversized columns', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const p = special['unstable.en'];
  await open(p.file, DESKTOP);
  await sleep(RESIZE_DELAY_MS * 2);
  plainGrid('unstable.en', await measure(), await evaluate(nColumns));
  assert.equal(await evaluate('document.querySelectorAll(".am-panel[style*=width], .am-panel[style*=flex]").length'), 0, 'no widths from the layout script');
});

// Counts changes to the grid's attributes and children, which is what a layout pass does (it restores the markup first).
const WATCH = `(() => {
  window.__layoutPasses = 0;
  new MutationObserver((records) => { window.__layoutPasses += records.length; }).observe(document.querySelector('.am-grid'), { attributes: true, childList: true });
})()`;

test('e2e: a late image load or a late font load lays the page out again', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const p = special['image.en'];

  await open(p.file, DESKTOP);
  await waitFor(SETTLED, 'image.en to lay out');
  await evaluate(WATCH);
  await evaluate("document.querySelector('.am-grid img').dispatchEvent(new Event('load'))");
  await sleep(RESIZE_DELAY_MS * 3);
  assert.ok(await evaluate('window.__layoutPasses') > 0, 'an image load inside the grid scheduled a layout');
  assert.ok(await evaluate(SETTLED), 'and the page is laid out again');

  // The page waits for document.fonts.ready; hand it a promise the test settles later.
  const { identifier } = await page('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(document.fonts, 'ready', { get: () => (window.__fonts ??= new Promise((r) => { window.__fontsDone = r; })) })" });
  try {
    await setWidth(DESKTOP);
    const loaded = cdp.once('Page.loadEventFired');
    await page('Page.navigate', { url: pathToFileURL(p.file).href });
    await loaded;
    await waitFor(SETTLED, 'image.en to lay out with fonts pending');
    await evaluate(WATCH);
    await evaluate('window.__fontsDone()');
    await sleep(RESIZE_DELAY_MS * 3);
    assert.ok(await evaluate('window.__layoutPasses') > 0, 'document.fonts.ready scheduled a layout');
    assert.ok(await evaluate(SETTLED), 'and the page is laid out again');
  } finally {
    await page('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});

test('e2e: doc pages have no sheet grid and stay untouched', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const src = join(tmp, 'drafts', 'doc.md');
  writeFileSync(src, '---\ntemplate: doc\ntitle: Doc\n---\n## A One\nText.\n\n## B Two\nMore text.\n');
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', src, '-o', join(tmp, 'doc.html'), '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
  });
  await open(join(tmp, 'doc.html'), DESKTOP);
  assert.equal(await evaluate('document.querySelector(".am-grid")'), null);
  assert.equal(await evaluate('document.querySelectorAll(".am-panel[style*=width]").length'), 0);
});

test('e2e: diagram expand button opens lightbox and Escape closes it', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const tcp = pages.find((x) => x.name === 'tcp');
  assert.ok(tcp, 'tcp page with diagram');
  await open(tcp.file, DESKTOP);
  await waitFor(SETTLED, 'tcp to lay out');

  const diagramCount = await evaluate('document.querySelectorAll(".am-grid .am-diagram, .am-doc .am-diagram").length');
  assert.equal(await evaluate('document.querySelectorAll(".am-diagram-expand").length'), diagramCount, 'exactly one expand button per diagram');
  assert.equal(await evaluate('document.querySelector(".am-lightbox-canvas .am-diagram-expand")'), null, 'canvas has no expand button');
  assert.equal(await evaluate('document.querySelector(".am-lightbox").hasAttribute("hidden")'), true, 'lightbox starts hidden');

  await evaluate('document.querySelector(".am-diagram-expand").click()');
  assert.equal(await evaluate('document.querySelector(".am-lightbox").hasAttribute("hidden")'), false, 'lightbox opens after clicking expand');
  assert.equal(await evaluate('document.activeElement.classList.contains("am-lightbox-close")'), true, 'close button is focused');
  assert.equal(await evaluate('document.querySelector(".am-lightbox-canvas svg").getAttribute("viewBox") === document.querySelector(".am-diagram > svg").getAttribute("viewBox")'), true, 'lightbox shows the diagram, not the button icon');

  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await evaluate('document.querySelector(".am-lightbox").hasAttribute("hidden")'), true, 'lightbox closes on Escape');
});

test('e2e: the expand button stays in view when a wide diagram scrolls sideways', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const tcp = pages.find((x) => x.name === 'tcp');
  assert.ok(tcp, 'tcp page with diagram');
  await open(tcp.file, PHONE);
  await waitFor("getComputedStyle(document.querySelector('.am-grid')).display === 'grid'", `tcp to use the grid at ${PHONE}px`);

  const inView = `(() => {
    const d = [...document.querySelectorAll('.am-diagram')].find((el) => el.scrollWidth > el.clientWidth);
    if (!d) return null;
    d.scrollLeft = d.scrollWidth;
    const b = d.querySelector('.am-diagram-expand').getBoundingClientRect();
    const r = d.getBoundingClientRect();
    return b.left >= r.left && b.right <= r.right;
  })()`;
  assert.equal(await evaluate(inView), true, 'expand button stays inside the visible part of a scrolled diagram');
});

test('e2e: the expand button does not cover a node at the right edge of the drawing', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const { html } = renderDoc('---\ntitle: Expand overlap\nlang: en\ntheme: blueprint\n---\n## A Flow plan {span=2}\n```flow LR\nClient -> Gateway\nGateway -> [(Cache)]: lookup\nCache -> Service: miss\nGateway -> Service\n*Service\n```\n');
  const file = join(tmp, 'expand-overlap.html');
  writeFileSync(file, html);
  await open(file, PHONE);
  const clear = `(() => {
    const d = document.querySelector('.am-diagram');
    const b = d.querySelector('.am-diagram-expand').getBoundingClientRect();
    const s = d.querySelector(':scope > svg').getBoundingClientRect();
    return b.bottom <= s.top;
  })()`;
  assert.equal(await evaluate(clear), true, 'expand button sits above the drawing, not on it');
});

// A horizontal timeline is a row of centered columns joined by a line. On a phone it reads like timeline v instead:
// one item per row, the dots and the line on the left, the text on the right.
test('e2e: a horizontal timeline turns vertical on a phone and stays horizontal on a desktop', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const { html } = renderDoc('---\ntitle: Timeline\nlang: en\n---\n## A Plan\n```timeline\n2026-09 | Private beta | Ten design partners try the agent on real work\n2026-10 | Public beta\n*2026-11 | Paid plans | Pro and Team plans open with higher limits\n2027-Q1 | Mobile app\n```\n');
  const file = join(tmp, 'timeline.html');
  writeFileSync(file, html);
  const shape = `(() => {
    const items = [...document.querySelector('.am-timeline--h').children].map((li) => ({
      top: li.getBoundingClientRect().top,
      dotLeftOfTitle: li.querySelector('.am-tl-dot').getBoundingClientRect().right <= li.querySelector('.am-tl-title').getBoundingClientRect().left,
      lineAcross: getComputedStyle(li, '::before').borderTopWidth !== '0px',
    }));
    return {
      stacked: items.every((it, i) => i === 0 || it.top > items[i - 1].top),
      oneRow: items.every((it) => it.top === items[0].top),
      dotsLeft: items.every((it) => it.dotLeftOfTitle),
      linesAcross: items.filter((it) => it.lineAcross).length,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;

  await open(file, PHONE);
  const phone = await evaluate(shape);
  assert.equal(phone.stacked, true, `one item per row at ${PHONE}px`);
  assert.equal(phone.dotsLeft, true, `every dot is left of its title at ${PHONE}px`);
  assert.equal(phone.linesAcross, 0, `no horizontal line at ${PHONE}px`);
  assert.ok(phone.pageOverflow <= 0, `the page does not scroll sideways at ${PHONE}px`);

  await open(file, DESKTOP);
  const desktop = await evaluate(shape);
  assert.equal(desktop.oneRow, true, `all items in one row at ${DESKTOP}px`);
  assert.equal(desktop.linesAcross, 4, `every item has its part of the horizontal line at ${DESKTOP}px`);
});

// The switch to the vertical layout follows the width the timeline has, not the window: a sheet puts panels two per row at 768 px,
// and a five-item timeline in one of them got about 58 px a column, so its dates wrapped and the dots covered them.
test('e2e: a horizontal timeline turns vertical in a narrow panel and stays horizontal in a wide one', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const tl = '```timeline\n2026-09 | Private beta | Ten design partners try the agent on real work\n2026-10 | Public beta | Anyone can sign up\n*2026-11 | Paid plans | Pro and Team plans open\n2027-Q1 | Mobile app | The phone app reaches parity\n2027-Q2 | Enterprise | Single sign-on and audit log\n```\n';
  const { html } = renderDoc(`---\ntitle: Narrow timeline\nlang: en\n---\n## A Release plan\n${tl}\n## B History\n${tl}`);
  const file = join(tmp, 'timeline-narrow.html');
  writeFileSync(file, html);
  const rows = `(() => [...document.querySelectorAll('.am-timeline--h')].map((ol) => {
    const tops = [...ol.children].map((li) => li.getBoundingClientRect().top);
    return { oneRow: tops.every((t) => t === tops[0]), panelWidth: Math.round(ol.getBoundingClientRect().width) };
  }))()`;

  await open(file, 768);
  const narrow = await evaluate(rows);
  assert.equal(narrow.length, 2);
  assert.ok(narrow.every((t) => t.panelWidth < 400), `the panels sit two per row at 768 px (${JSON.stringify(narrow)})`);
  assert.ok(narrow.every((t) => !t.oneRow), 'a timeline in a half-width panel lists its items one per row');

  await open(file, DESKTOP);
  const wide = await evaluate(rows);
  assert.ok(wide.every((t) => t.panelWidth >= 400), `the panels are wider at ${DESKTOP}px (${JSON.stringify(wide)})`);
});

// A host that serves the page inside its own document drops the page's <html> tag, so the real root has none of the page's settings.
const inHost = (html, rootAttrs = '') => `<!doctype html><html${rootAttrs}><body>${html.replace(/<!doctype[^>]*>\s*/i, '').replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '')}`;
const ROOT_ATTRS = "[...['lang','data-theme','data-mode','data-style']].map((a) => document.documentElement.getAttribute(a))";

test('e2e: a page inside a host document gets its theme, mode, style and language back on the root', { skip: SKIP, timeout: 60000 }, async () => {
  if (!cdp) await launch();
  const { html } = renderDoc('---\ntemplate: doc\nlang: ja\ntheme: blueprint\nmode: dark\nstyle: off\n---\n## A Note\nText.\n');
  const bare = join(tmp, 'host-bare.html');
  writeFileSync(bare, inHost(html));
  await open(bare, DESKTOP);
  assert.deepEqual(await evaluate(ROOT_ATTRS), ['ja', 'blueprint', 'dark', 'off']);
  assert.equal(await evaluate("document.querySelector('select[data-am=theme]').value"), 'blueprint');
  assert.equal(await evaluate("document.querySelector('select[data-am=mode]').value"), 'dark');
  assert.notEqual(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"), '', 'theme variables resolve');
  // A value the host root already has, even an empty one, is not replaced.
  const own = join(tmp, 'host-own.html');
  writeFileSync(own, inHost(html, ' lang="fr" data-theme=""'));
  await open(own, DESKTOP);
  assert.deepEqual(await evaluate(ROOT_ATTRS), ['fr', '', 'dark', 'off']);
});

// An annot block on a right-to-left page: the sentence reads from the right, each note starts at the right edge of its span, and notes that
// share a row do not run into each other (the rows are chosen from widths estimated for the sans font the sentence is set in).
const ANNOT_DRAFT = (lang, sentences, head) => `---\nlang: ${lang}\n---\n## A Annot\n\`\`\`annot\n${head}\n${sentences.join('\n')}\n\`\`\`\n`;
const ANNOT_ROWS = `(() => [...document.querySelectorAll('.am-annot-line')].map((line) => {
  const edge = (r) => ({ left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 });
  const notes = [...line.querySelectorAll('.am-seg-n')].map((n) => ({
    row: n.style.getPropertyValue('--row'), note: edge(n.getBoundingClientRect()), seg: edge(n.parentElement.getBoundingClientRect()),
  }));
  const head = line.closest('.am-annot').querySelector('.am-annot-head');
  return {
    font: getComputedStyle(line).fontFamily, body: getComputedStyle(document.body).fontFamily, notes,
    title: edge(head.firstElementChild.getBoundingClientRect()), meta: head.children[1] ? edge(head.children[1].getBoundingClientRect()) : null,
  };
}))()`;

for (const [lang, sentences, head] of [
  ['he', [
    'ודאו שה[מאגר ההידראולי]{השם הטכני המלא} [מלא]{!לא "מוחלף"} לפני שמתחילים לעבוד עם [Redis]{שם המוצר בלבד} בסביבה.',
    'ערכו את [src/]{נתיב התיקייה} ואת [המטמון]{רכיב} [ידנית]{!לא אוטומטית אף פעם} היום.',
  ], '# משפט | 13 מילים'],
  ['en', [
    'Make sure that [the hydraulic reservoir]{The full technical name} is [full]{!Not "replenished"} before you work with [Redis]{Product name only}.',
    'Edit [src/]{The folder path} and [the cache]{A component} [by hand]{!Never automatic at all} today.',
  ], '# Sentence | 13 words'],
]) {
  test(`e2e: annot on a ${lang} page keeps its notes at the start edge of their span, with no two notes of a row overlapping`, { skip: SKIP, timeout: 60000 }, async () => {
    if (!cdp) await launch();
    const file = join(tmp, `annot-${lang}.html`);
    writeFileSync(file, renderDoc(ANNOT_DRAFT(lang, sentences, head)).html);
    await open(file, DESKTOP);
    const lines = await evaluate(ANNOT_ROWS);
    assert.equal(lines.length, 2);
    const rtl = lang === 'he';
    for (const l of lines) {
      assert.ok(l.notes.length >= 3, 'the notes are drawn');
      for (const n of l.notes) {
        // A note starts at the start edge of its span: the right edge on a right-to-left page.
        assert.ok(Math.abs((rtl ? n.note.right - n.seg.right : n.note.left - n.seg.left)) <= 1, `${lang}: note ${JSON.stringify(n)} starts at its span`);
      }
      for (const [i, a] of l.notes.entries()) {
        for (const b of l.notes.slice(i + 1).filter((x) => x.row === a.row)) {
          assert.ok(a.note.right <= b.note.left + 0.5 || b.note.right <= a.note.left + 0.5, `${lang}: notes ${JSON.stringify(a)} and ${JSON.stringify(b)} share a row and overlap`);
        }
      }
      // The title is on the start side of the head, the meta on the other.
      if (l.meta) assert.ok(rtl ? l.title.left > l.meta.left : l.title.left < l.meta.left, `${lang}: head order`);
      // No monospace font on a right-to-left page; the sentence takes the font of the page.
      if (rtl) assert.equal(l.font, l.body);
      else assert.notEqual(l.font, l.body);
    }
  });
}
