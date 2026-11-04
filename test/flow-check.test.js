// Flow crossing check: an edge that runs through a node or through another edge's label is a component warning with a way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.js';
import { COMPONENTS } from '../src/components/index.js';
import { parseFlow, runLayout, reservedLayout } from '../src/components/flow.js';
import { measure } from '../src/svg/text.js';
import { DRAWING } from '../src/themes/type-scale.js';
import { crossings, crossingWarnings } from '../src/components/flow-check.js';
import { curvePoints, overlaps, segmentHits } from '../src/svg/geometry.js';
import { renderDoc } from '../src/render.js';

// Home -> Pricing is routed past the Docs fan-out in LR; TB draws it clean.
const THROUGH_NODE = 'Home -> Install\nHome -> Pricing\nHome -> Docs\nDocs -> Video\nDocs -> Settings\nDocs -> Checks';
// The label of Sync -> Laptop covers the edge Sync -> Phone in LR. In TB the drawn curve still grazes a label by 1.3px, so it is no
// clean direction; the TB advice is covered by the node fixtures.
const THROUGH_LABEL = 'Phone -> Queue\nSync -> Auth: token to user\nAuth -> [(Postgres)]: version on every row\n[(Postgres)] --> Sync: read changes by cursor\nSync --> Laptop: pull changes and confirmed ids\nSync --> Phone: pull';
// A longer label than THROUGH_LABEL: the edge crosses it in every direction.
const LABEL_EVERYWHERE = 'Phone -> Queue\nSync -> Auth: token to user to workspace\nAuth -> [(Postgres)]: version number on every row\n[(Postgres)] --> Sync: read changes by cursor\nSync --> Laptop: pull changes and confirmed mutation ids\nSync --> Phone: pull';
// Two sources into the same four targets: the edges cross nodes in LR; TB draws it clean.
const FAN = 'Full -> Page & Video & Check & Audio\nBasic -> Page & Video & Check & Audio';
// An edge runs through Pricing in every direction.
const NODE_EVERYWHERE = 'Home -> Install\nHome -> Examples\nHome -> Pricing\nHome -> Docs\nDocs -> Video\nDocs -> Settings\nDocs -> Checks\nDocs -> Contributing';

const lay = (model, dir) => runLayout(model, dir, false, model.groups.map(() => 60), new Set());
const check = (text, dir) => {
  const model = parseFlow(text);
  return { model, run: lay(model, dir), relayout: (alt) => lay(model, alt) };
};
const warnings = (text, dir) => {
  const { model, run, relayout } = check(text, dir);
  return crossingWarnings(model, dir, run, relayout);
};
const ids = (list) => list.map((c) => [`${c.edge.from} -> ${c.edge.to}`, c.kind, c.kind === 'node' ? c.other : c.other.label]);

// ── detection ──
test('crossings: an edge that runs through a node that is not its end is reported once, with the node', () => {
  const { model, run } = check(THROUGH_NODE, 'LR');
  assert.deepEqual(ids(crossings(run, model)), [['Docs -> Video', 'node', 'Pricing']]);
});

test('crossings: an edge that runs through the label of another edge is reported with that edge', () => {
  const { model, run } = check(THROUGH_LABEL, 'LR');
  assert.deepEqual(ids(crossings(run, model)), [['Sync -> Phone', 'label', 'pull changes and confirmed ids']]);
});

test('crossings: one report for each edge and kind, however many nodes the edge runs through', () => {
  const { model, run } = check(FAN, 'LR');
  const found = crossings(run, model);
  assert.deepEqual(ids(found), [['Full -> Audio', 'node', 'Check'], ['Basic -> Page', 'node', 'Video']]);
  assert.equal(new Set(found.map((c) => `${c.edge.line}${c.edge.to}${c.kind}`)).size, found.length);
});

test('crossings: a diagram without crossings, and the same diagram in the clean direction, report nothing', () => {
  for (const [text, dir] of [['A -> B -> C', 'LR'], [THROUGH_NODE, 'TB'], [FAN, 'TB']]) {
    const { model, run } = check(text, dir);
    assert.deepEqual(crossings(run, model), [], `${dir}: ${text}`);
  }
});

const name = (e) => `${e.from} -> ${e.to}`;
const distToSegment = (q, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y);
};

// An L-shaped edge A (0,0) -> bend (100,0) -> B (100,100). smoothPath draws the bend as a curve from (50,0) to (100,50), which
// passes (87.5,12.5): the drawn edge cuts the corner, so the check must follow the curve, not the dagre points.
const bent = (center, size) => {
  const at = { A: { x: 0, y: 0 }, B: { x: 100, y: 100 }, C: center };
  const g = { edge: () => ({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }), node: (k) => at[k] };
  const ids = ['A', 'B', 'C'];
  const run = { g, key: new Map(ids.map((id) => [id, id])), sizes: new Map(ids.map((id) => [id, id === 'C' ? size : { width: 4, height: 4 }])), labels: [null] };
  return crossings(run, { nodes: new Map(ids.map((id) => [id, {}])), edges: [{ from: 'A', to: 'B' }] });
};

test('crossings: a label inside the corner that the drawn curve cuts through is crossed, as a node is', () => {
  const pts = { e0: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], e1: [{ x: 300, y: 300 }, { x: 400, y: 300 }] };
  const at = { A: { x: 0, y: 0 }, B: { x: 100, y: 100 }, C: { x: 300, y: 300 }, D: { x: 400, y: 300 } };
  // The label of C -> D sits at (84,14), where the curve of A -> B passes; the dagre points stay on the outer corner.
  const g = { edge: ({ name: n }) => (n === 'e1' ? { points: pts.e1, x: 84, y: 14 } : { points: pts.e0 }), node: (k) => at[k] };
  const ids = Object.keys(at);
  const run = { g, key: new Map(ids.map((id) => [id, id])), sizes: new Map(ids.map((id) => [id, { width: 4, height: 4 }])), labels: [null, { width: 14, height: 10 }] };
  const edges = [{ from: 'A', to: 'B' }, { from: 'C', to: 'D', label: 'L' }];
  assert.deepEqual(crossings(run, { nodes: new Map(ids.map((id) => [id, {}])), edges }).map((c) => [name(c.edge), c.kind, name(c.other)]), [['A -> B', 'label', 'C -> D']]);
});

test('curvePoints: the sampled curve stays within 0.25px of the drawn curve, however long the bend', () => {
  for (const leg of [100, 600, 2400]) {
    const points = [{ x: 0, y: 0 }, { x: leg, y: 0 }, { x: leg, y: leg }];
    const drawn = curvePoints(points);
    const [p0, c, p2] = [{ x: leg / 2, y: 0 }, points[1], { x: leg, y: leg / 2 }];
    let worst = 0;
    for (let k = 0; k <= 1000; k++) {
      const t = k / 1000;
      const u = 1 - t;
      const q = { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
      worst = Math.max(worst, Math.min(...drawn.slice(1).map((b, i) => distToSegment(q, drawn[i], b))));
    }
    assert.ok(worst <= 0.25, `leg ${leg}: ${worst.toFixed(3)}px`);
  }
});

test('crossings: a node on the bend point that the drawn curve passes inside of is not crossed', () => {
  assert.deepEqual(bent({ x: 100, y: 0 }, { width: 16, height: 10 }), []);
});

test('crossings: a node inside the corner that the drawn curve cuts through is crossed', () => {
  assert.deepEqual(bent({ x: 84, y: 14 }, { width: 14, height: 10 }).map((c) => [c.kind, c.other]), [['node', 'C']]);
});

// ── warnings ──
test('crossingWarnings: a node crossing names the edge and the node, points at the draft line and suggests flow TB', () => {
  const [w, ...rest] = warnings(THROUGH_NODE, 'LR');
  assert.equal(rest.length, 0);
  assert.equal(w.line, 4);
  assert.equal(w.message, 'the edge "Docs -> Video" runs through the node "Pricing"; ```flow TB draws this diagram without crossings');
  // The suggestion has to be true.
  const { model, relayout } = check(THROUGH_NODE, 'LR');
  assert.deepEqual(crossings(relayout('TB'), model), []);
});

test('crossingWarnings: a label crossing names both edges and the label, on the draft line of the crossing edge', () => {
  const [w, ...rest] = warnings(THROUGH_LABEL, 'LR');
  assert.equal(rest.length, 0);
  assert.equal(w.line, 6);
  assert.ok(w.message.startsWith('the edge "Sync -> Phone" runs through the label "pull changes and confirmed ids" of "Sync -> Laptop"; '), w.message);
});

test('crossingWarnings: when the other direction crosses too, a node warning says to split the diagram', () => {
  const [w, ...rest] = warnings(NODE_EVERYWHERE, 'LR');
  assert.equal(rest.length, 0);
  assert.equal(w.line, 5);
  assert.equal(w.message, 'the edge "Docs -> Video" runs through the node "Pricing"; split the diagram into an overview and a detail diagram');
  const { model, relayout } = check(NODE_EVERYWHERE, 'LR');
  assert.notDeepEqual(crossings(relayout('TB'), model), []);
});

test('crossingWarnings: when the other direction crosses too, a label warning says to split the diagram', () => {
  const [w, ...rest] = warnings(LABEL_EVERYWHERE, 'LR');
  assert.equal(rest.length, 0);
  assert.equal(w.line, 6);
  assert.match(w.message, /^the edge "Sync -> Phone" runs through the label "pull changes and confirmed mutation ids" of "Sync -> Laptop"; /);
  assert.match(w.message, /; split the diagram into an overview and a detail diagram$/);
  assert.doesNotMatch(w.message, /flow TB/);
});

test('crossingWarnings: the other direction is TB for LR and RL, and LR for TB and BT; a clean diagram is not laid out again', () => {
  const { model, run } = check(THROUGH_NODE, 'LR');
  for (const [dir, alt] of [['LR', 'TB'], ['RL', 'TB'], ['TB', 'LR'], ['BT', 'LR']]) {
    const asked = [];
    crossingWarnings(model, dir, run, (d) => { asked.push(d); return lay(model, d); });
    assert.deepEqual(asked, [alt]);
  }
  const clean = check('A -> B', 'TB');
  crossingWarnings(clean.model, 'TB', clean.run, () => assert.fail('no crossing, no second layout'));
});

// ── the component ──
const doc = (flow, args = '') => `---\ntitle: T\nlang: en\n---\n## A Panel\n\`\`\`flow${args}\n${flow}\n\`\`\`\n`;
const flowWarnings = (src) => renderDoc(src).stats.componentWarnings.filter((w) => w.component === 'flow');

test('render: the warning reaches the render result with the draft line, and the diagram is still drawn', () => {
  const { html, stats } = renderDoc(doc(THROUGH_NODE, ' LR'));
  assert.match(html, /am-flow/);
  assert.equal(stats.componentWarnings.length, 1);
  assert.equal(stats.componentWarnings[0].line, 6 + 4);
  assert.equal(stats.componentWarnings[0].component, 'flow');
  assert.match(stats.componentWarnings[0].message, /runs through the node "Pricing"; ```flow TB draws/);
});

test('render: the direction in the fence decides, so the clean direction has no warning', () => {
  assert.deepEqual(flowWarnings(doc(THROUGH_NODE, ' TB')), []);
  assert.deepEqual(flowWarnings(doc(THROUGH_NODE)), []);
  assert.equal(flowWarnings(doc(THROUGH_NODE, ' RL')).length, 1);
});

test('render: a flow drawn BT is checked too: clean like TB, and a crossing it draws is warned with its draft line', () => {
  // The fence direction is honoured: BT draws the source Home below Install, TB above it.
  const nodeY = (html, id) => Number(html.match(new RegExp(`data-key="${id}"[^>]*><rect[^>]* y="([\\d.]+)"`))[1]);
  const bt = renderDoc(doc(THROUGH_NODE, ' BT')).html;
  const tb = renderDoc(doc(THROUGH_NODE, ' TB')).html;
  assert.ok(nodeY(bt, 'Home') > nodeY(bt, 'Install'), 'BT: Home below Install');
  assert.ok(nodeY(tb, 'Home') < nodeY(tb, 'Install'), 'TB: Home above Install');
  assert.deepEqual(flowWarnings(doc(THROUGH_NODE, ' BT')), []);
  const [w, ...rest] = flowWarnings(doc(NODE_EVERYWHERE, ' BT'));
  assert.deepEqual(rest, []);
  assert.equal(w.line, 6 + 5);
  assert.equal(w.message, 'the edge "Docs -> Video" runs through the node "Pricing"; split the diagram into an overview and a detail diagram');
});

// The group name finds no free place in TB, so TB is drawn with room reserved for it; the advice must come from that layout.
const CROWDED_GROUP = 'Top -> Worker: HTTPS\nClient -> DB\nAuth -> Worker\nTop -> Client\nGateway -> Auth: HTTPS\nDB -> Queue\nAuth -> Client\ngroup A very long backend group name here: Auth, Queue';

test('render: in a grouped flow, the direction the warning suggests is drawn without crossings, group-name room included', () => {
  const model = parseFlow(CROWDED_GROUP);
  const widths = model.groups.map((g) => measure(g.name, DRAWING.cluster, { mono: true }) + 2);
  assert.deepEqual([...reservedLayout(model, 'TB', false, widths).reserve], [[0, 'top']], 'the fixture needs room for its group name in TB');
  const [w] = flowWarnings(doc(CROWDED_GROUP, ' LR'));
  assert.match(w.message, /```flow TB draws this diagram without crossings/);
  assert.deepEqual(flowWarnings(doc(CROWDED_GROUP, ' TB')), []);
});

test('render: a video takes no crossing warning, and the component works without a warn function', () => {
  const flow = COMPONENTS.get('flow');
  const seen = [];
  flow.render(THROUGH_NODE, { args: 'LR', uid: () => 'u1', warn: (w) => seen.push(w), video: true });
  assert.deepEqual(seen, []);
  flow.render(THROUGH_NODE, { args: 'LR', uid: () => 'u1', warn: (w) => seen.push(w) });
  assert.equal(seen.length, 1);
  assert.doesNotThrow(() => flow.render(THROUGH_NODE, { args: 'LR', uid: () => 'u1' }));
});

test('render: the warning does not change the page', () => {
  const { html } = renderDoc(doc(THROUGH_NODE, ' LR'));
  assert.doesNotMatch(html, /runs through/);
});

// ── no false positives ──
const markdownIn = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return markdownIn(path);
  return name.endsWith('.md') ? [path] : [];
});

test('the examples and the site presets draw their flow diagrams without crossing warnings', () => {
  const files = [...markdownIn('examples'), ...markdownIn('site/presets')];
  let blocks = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    blocks += (src.match(/^```flow/gm) ?? []).length;
    const { stats } = renderDoc(src);
    const crossing = (stats.componentWarnings ?? []).filter((w) => w.component === 'flow' && /runs through/.test(w.message));
    assert.deepEqual(crossing, [], file);
  }
  assert.ok(blocks > 0, 'the corpus has flow blocks');
});

// ── cli ──
const sink = () => { let text = ''; return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } }; };
const run = async (dir, args, stdin = '') => {
  const out = sink();
  const err = sink();
  const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: join(dir, 'home') }, cwd: dir });
  return { code, out: out.text, err: err.text };
};

test('cli: a crossing is listed as a diagram warning with its draft line, and the page is still written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-flow-check-'));
  try {
    const r = await run(dir, ['render', '-', '-o', 'out/page.html'], doc(THROUGH_NODE, ' LR'));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /diagram 1 warning/);
    assert.match(r.out, /L10 \[flow\] the edge "Docs -> Video" runs through the node "Pricing"; ```flow TB draws this diagram without crossings/);
    assert.ok(existsSync(join(dir, 'out', 'page.html')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── geometry ──
// These pin what the two functions return today, edge cases included. The crossing check relies on them.
const P = (x, y) => ({ x, y });
const BOX = [0, 0, 10, 10];

test('overlaps: boxes that only touch along an edge or at a corner do not overlap; any shared area does', () => {
  assert.equal(overlaps([0, 0, 10, 10], [10, 0, 20, 10]), false);
  assert.equal(overlaps([0, 0, 10, 10], [10, 10, 20, 20]), false);
  assert.equal(overlaps([0, 0, 10, 10], [9, 9, 20, 20]), true);
  assert.equal(overlaps([0, 0, 10, 10], [2, 2, 4, 4]), true);
  assert.equal(overlaps([0, 0, 10, 10], [11, 0, 20, 10]), false);
});

test('segmentHits: a segment through the box, inside it, or ending on its boundary hits; one that stops short or runs outside does not', () => {
  assert.equal(segmentHits(P(-5, 5), P(15, 5), BOX), true);
  assert.equal(segmentHits(P(2, 2), P(8, 8), BOX), true);
  assert.equal(segmentHits(P(-5, 5), P(0, 5), BOX), true);
  assert.equal(segmentHits(P(-5, 5), P(-0.1, 5), BOX), false);
  assert.equal(segmentHits(P(-5, -1), P(15, -1), BOX), false);
});

test('segmentHits: touching counts, unlike overlaps: a segment along a side or through a corner point hits', () => {
  assert.equal(segmentHits(P(-5, 0), P(15, 0), BOX), true);
  assert.equal(segmentHits(P(-5, 5), P(5, -5), BOX), true);
  assert.equal(segmentHits(P(-5, 4), P(4, -5), BOX), false);
});

test('segmentHits: a zero-length segment hits when its point is in or on the box; a degenerate box is a line, an inverted one is empty', () => {
  assert.equal(segmentHits(P(5, 5), P(5, 5), BOX), true);
  assert.equal(segmentHits(P(10, 5), P(10, 5), BOX), true);
  assert.equal(segmentHits(P(15, 5), P(15, 5), BOX), false);
  assert.equal(segmentHits(P(-5, 5), P(15, 5), [5, 0, 5, 10]), true);
  assert.equal(segmentHits(P(-5, 5), P(15, 5), [6, 0, 5, 10]), false);
});
