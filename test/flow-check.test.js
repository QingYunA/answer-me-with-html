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
import { overlaps, segmentHits } from '../src/svg/geometry.js';
import { renderDoc } from '../src/render.js';

// Home -> Pricing is routed past the Docs fan-out in LR; TB draws it clean.
const THROUGH_NODE = 'Home -> Install\nHome -> Pricing\nHome -> Docs\nDocs -> Video\nDocs -> Settings\nDocs -> Checks';
// The label of Sync -> Laptop covers the edge Sync -> Phone in LR; TB draws it clean.
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
  for (const [text, dir] of [['A -> B -> C', 'LR'], [THROUGH_NODE, 'TB'], [THROUGH_LABEL, 'TB'], [FAN, 'TB']]) {
    const { model, run } = check(text, dir);
    assert.deepEqual(crossings(run, model), [], `${dir}: ${text}`);
  }
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

test('crossingWarnings: a label crossing names both edges and the label, and suggests flow TB', () => {
  const [w, ...rest] = warnings(THROUGH_LABEL, 'LR');
  assert.equal(rest.length, 0);
  assert.equal(w.line, 6);
  assert.equal(w.message, 'the edge "Sync -> Phone" runs through the label "pull changes and confirmed ids" of "Sync -> Laptop"; ```flow TB draws this diagram without crossings');
  const { model, relayout } = check(THROUGH_LABEL, 'LR');
  assert.deepEqual(crossings(relayout('TB'), model), []);
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
  assert.deepEqual(flowWarnings(doc(THROUGH_NODE, ' BT')), []);
  const [w, ...rest] = flowWarnings(doc(NODE_EVERYWHERE, ' BT'));
  assert.deepEqual(rest, []);
  assert.equal(w.line, 6 + 5);
  assert.equal(w.message, 'the edge "Docs -> Video" runs through the node "Pricing"; split the diagram into an overview and a detail diagram');
});

// The group name finds no free place in TB, so TB is drawn with room reserved for it; the advice must come from that layout.
const CROWDED_GROUP = 'DB -> Gateway\nTop -> Queue\nQueue -> Gateway: HTTPS\nTop -> Worker\nAuth -> Worker: HTTPS\nClient -> Worker\nQueue -> Worker: HTTPS\ngroup A very long backend group name here: Auth, Queue';

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
