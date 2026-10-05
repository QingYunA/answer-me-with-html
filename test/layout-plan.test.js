import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLayout } from '../src/runtime/layout-plan.js';

const WIDTH = 1000;
const GAP = 20;
const COLS = 3;

// Synthetic measurements. A text panel keeps a constant area, so it gets taller as it gets narrower.
const sampleWidths = (width) => {
  const ws = [];
  for (let w = 160; w < width; w += 10) ws.push(w);
  return [...ws, width];
};
const text = (area, over = {}) => ({
  samples: sampleWidths(WIDTH).map((w) => ({ w, h: Math.ceil(area / w) + 40 })),
  minWidth: 260,
  span: 1,
  ...over,
});
// A diagram panel: its height follows the width until the diagram stops growing (natural * 1.25 + pad).
const diagram = (natural, aspect, over = {}) => {
  const pad = 34;
  const maxWidth = natural * 1.25 + pad;
  return {
    samples: sampleWidths(WIDTH).map((w) => ({ w, h: Math.ceil(Math.min(w, maxWidth) - pad) * aspect + 70 })),
    minWidth: Math.ceil(natural * 0.75 + pad),
    maxWidth,
    natural,
    pad,
    span: 1,
    ...over,
  };
};
const plan = (panels, over = {}) => planLayout({ width: WIDTH, gap: GAP, cols: COLS, panels, ...over });
const order = (result) => result.rows.flatMap((r) => r.columns.flatMap((c) => c.panels));

test('a single panel gets one row with the full width', () => {
  const result = plan([text(60000)]);
  assert.deepEqual(result.rows.map((r) => r.columns.map((c) => ({ panels: c.panels, width: c.width }))), [[{ panels: [0], width: WIDTH }]]);
});

test('short text panels share one row instead of each taking a row', () => {
  const result = plan([text(40000), text(40000), text(40000)]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].columns.length, 3);
});

const MIXED = [
  text(90000), diagram(420, 0.6), text(30000), text(30000), diagram(300, 0.9),
  text(120000, { span: 2 }), text(50000), text(50000), text(50000),
];

test('every row fills the container: column widths plus gaps equal the width', () => {
  const result = plan(MIXED);
  for (const row of result.rows) {
    const sum = row.columns.reduce((s, c) => s + c.width, 0) + GAP * (row.columns.length - 1);
    assert.equal(sum, WIDTH);
    assert.ok(row.columns.length <= COLS);
  }
});

test('panels keep their reading order, each exactly once', () => {
  assert.deepEqual(order(plan(MIXED)), MIXED.map((_, i) => i));
});

test('no panel is narrower than its minimum width', () => {
  const result = plan(MIXED);
  for (const row of result.rows) {
    for (const col of row.columns) {
      for (const k of col.panels) assert.ok(col.width >= MIXED[k].minWidth, `panel ${k}: ${col.width} < ${MIXED[k].minWidth}`);
    }
  }
});

test('a tall diagram followed by two short text panels yields a stacked column', () => {
  const result = plan([diagram(480, 1.3), text(50000), text(50000)]);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].columns.map((c) => c.panels), [[0], [1, 2]]);
});

test('a table whose minimum width exceeds one column (about 320 px) gets that width or its own row', () => {
  const table = text(80000, { minWidth: 640 });
  const result = plan([text(40000), table, text(40000)]);
  const col = result.rows.flatMap((r) => r.columns).find((c) => c.panels.includes(1));
  assert.ok(col.width >= 640);
});

test('a full-width span hint stays alone in its row', () => {
  const result = plan([text(40000), text(40000), text(80000, { span: COLS }), text(40000), text(40000)]);
  const row = result.rows.find((r) => r.columns.some((c) => c.panels.includes(2)));
  assert.deepEqual(row.columns.map((c) => ({ panels: c.panels, width: c.width })), [{ panels: [2], width: WIDTH }]);
});

test('minimum widths that never fit give a single-column plan instead of throwing', () => {
  const wide = () => text(60000, { minWidth: WIDTH + 300 });
  const result = plan([wide(), wide(), wide()]);
  assert.deepEqual(result.rows.map((r) => r.columns.map((c) => ({ panels: c.panels, width: c.width }))), [
    [{ panels: [0], width: WIDTH }],
    [{ panels: [1], width: WIDTH }],
    [{ panels: [2], width: WIDTH }],
  ]);
});

test('unusable measurements give a single-column plan', () => {
  const result = plan([{ samples: [], minWidth: 100 }, text(40000)]);
  assert.deepEqual(order(result), [0, 1]);
  assert.ok(result.rows.every((r) => r.columns.length === 1 && r.columns[0].width === WIDTH));
});

test('no panels give no rows', () => {
  assert.deepEqual(plan([]).rows, []);
});

// Diagrams on one page stay in one scale band (spec #50, ticket #53): the page shows a diagram at min(result.maxScale, (width - pad) / natural).
const BAND_RATIO = 1.25;
const scales = (panels, result) => result.rows.flatMap((r) => r.columns.flatMap((c) => c.panels.filter((k) => panels[k].natural > 0).map((k) => Math.min(result.maxScale, (c.width - panels[k].pad) / panels[k].natural))));
const assertBand = (panels, result) => {
  const s = scales(panels, result);
  assert.ok(Math.max(...s) / Math.min(...s) <= BAND_RATIO + 1e-9, `scales ${s.map((x) => x.toFixed(2)).join(', ')} differ by more than ${BAND_RATIO}x`);
};

test('diagrams on one page differ in scale by at most the band ratio', () => {
  const cases = [
    [diagram(673, 0.6), text(50000), diagram(656, 0.6), text(50000), diagram(580, 0.7)],
    [diagram(699, 0.6), text(50000), diagram(200, 1), text(50000), diagram(541, 0.7), diagram(618, 0.6)],
    [diagram(337, 0.8), diagram(443, 0.7), text(50000), text(50000), text(50000), text(50000)],
    [diagram(300, 0.9), text(40000), text(40000), diagram(600, 0.5), text(30000)],
  ];
  for (const panels of cases) {
    const result = plan(panels);
    assert.deepEqual(order(result), panels.map((_, i) => i));
    assertBand(panels, result);
  }
});

test('a diagram that can only be small pulls the band of the others down', () => {
  // The wide diagram cannot show at more than about 0.92 on this page, so the others may not grow to 1.25 beside it.
  const panels = [diagram(460, 0.7), diagram(227, 0.7), diagram(918, 0.5), diagram(225, 0.7)];
  const result = plan(panels, { width: 882, cols: 2 });
  assert.deepEqual(order(result), panels.map((_, i) => i));
  for (const row of result.rows) assert.equal(row.columns.reduce((s, c) => s + c.width, 0) + GAP * (row.columns.length - 1), 882);
  assertBand(panels, result);
});

test('a diagram wider than the page can ever show it still gets a complete plan', () => {
  const panels = [diagram(1500, 0.4), diagram(300, 0.9), text(40000)];
  const result = plan(panels);
  assert.deepEqual(order(result), [0, 1, 2]);
  for (const row of result.rows) assert.equal(row.columns.reduce((s, c) => s + c.width, 0) + GAP * (row.columns.length - 1), WIDTH);
});

test('the planner source can be inlined into a page script by dropping its export keyword', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/runtime/layout-plan.js', import.meta.url), 'utf8');
  assert.deepEqual(src.match(/^export .*/gm).map((l) => l.match(/^export (?:const|function) (\w+)/)[1]), ['STEP', 'MAX_SCALE', 'MIN_SCALE', 'planLayout']);
  assert.ok(!/^import /m.test(src));
  const inlined = new Function(`${src.replace(/^export /gm, '')}\nreturn planLayout;`)();
  assert.deepEqual(inlined({ width: WIDTH, gap: GAP, cols: COLS, panels: MIXED }), plan(MIXED));
});

test('the DOM adapter takes the scale limits and the width step from the planner instead of repeating them', async () => {
  const { readFileSync } = await import('node:fs');
  const dom = readFileSync(new URL('../src/runtime/layout-dom.js', import.meta.url), 'utf8');
  assert.ok(!/\b(1\.25|0\.75)\b/.test(dom.replace(/\/\/.*$/gm, '')), 'no copy of the scale limits');
  assert.match(dom, /\bMAX_SCALE\b/);
  assert.match(dom, /\bMIN_SCALE\b/);
  assert.match(dom, /\bSTEP\b/);
});

test('planning a long page stays fast', () => {
  const panels = Array.from({ length: 24 }, (_, i) => (i % 5 === 1 ? diagram(360, 0.7) : text(40000 + (i % 4) * 15000)));
  const t0 = performance.now();
  const result = plan(panels);
  assert.deepEqual(order(result), panels.map((_, i) => i));
  assert.ok(performance.now() - t0 < 1500, `took ${performance.now() - t0} ms`);
});

test('a page with cols: 12 plans at most six columns per row and stays fast', () => {
  const panels = Array.from({ length: 24 }, (_, i) => (i % 5 === 1 ? diagram(360, 0.7) : text(40000 + (i % 4) * 15000)));
  const t0 = performance.now();
  const result = plan(panels, { cols: 12 });
  const ms = performance.now() - t0;
  assert.deepEqual(order(result), panels.map((_, i) => i));
  assert.ok(Math.max(...result.rows.map((r) => r.columns.length)) <= 6, 'no row has more than six columns');
  assert.ok(ms < 300, `planning 24 panels with cols: 12 took ${Math.round(ms)} ms`);
});

test('a span still means a share of cols when cols is above the planner cap', () => {
  const result = plan([text(60000, { span: 12 }), text(60000), text(60000)], { cols: 12 });
  assert.equal(result.rows[0].columns.length, 1, 'span >= cols keeps the panel alone in its row');
  assert.deepEqual(result.rows[0].columns[0].panels, [0]);
});

test('the page script is page.js plus the planner and the DOM adapter, and it parses', async () => {
  const { RUNTIME_JS } = await import('../src/assets.js');
  assert.match(RUNTIME_JS, /function planLayout\(/);
  assert.ok(!/^export /m.test(RUNTIME_JS));
  assert.doesNotThrow(() => new Function(RUNTIME_JS));
});
