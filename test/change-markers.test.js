// Change markers (#122): a line in flow or tree that starts with "+ ", "- " or "~ " shows what a plan adds, removes and changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.js';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { splitMarker } from '../src/components/delta.js';
import { parseFlow } from '../src/components/flow.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { LANGUAGES } from '../src/languages/registry.js';
import { pageCss } from '../src/themes/index.js';

const ctx = (args = '', extra = {}) => ({ args, uid: () => 'u1', ...extra });
const render = (name, text, args, extra) => COMPONENTS.get(name).render(text, ctx(args, extra));
const errorOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};
const lineError = (fn, line) => {
  const err = errorOf(fn);
  assert.ok(err instanceof ComponentError, `expected a ComponentError, got ${err}`);
  assert.equal(err.line, line);
  return err.message;
};
const states = (model) => Object.fromEntries([...model.nodes.values()].map((n) => [n.id, n.state ?? null]));
const zh = LANGUAGES.find((l) => l.id === 'zh').ui;

const FLOW = 'Client -> Gateway\n+ Gateway -> [(Cache)]: lookup\n+ Cache -> Service: miss\n- Gateway -> Service\n~ *Service';
const TREE = 'src/\n  components/\n    + delta.js | parses change markers\n    ~ flow.js\n    ~ tree.js\n  - legacy/\n    old-flow.js';

// ── the marker itself ──
test('splitMarker: a marker is + - or ~ followed by a space; without the space the line stays plain text', () => {
  assert.deepEqual(splitMarker('+ A -> B'), { mark: '+', text: 'A -> B' });
  assert.deepEqual(splitMarker('-   A'), { mark: '-', text: 'A' });
  assert.deepEqual(splitMarker('~ A'), { mark: '~', text: 'A' });
  for (const plain of ['-Gateway', '+1 votes', '~A', '-', '+', 'A - B']) assert.deepEqual(splitMarker(plain), { mark: null, text: plain });
});

// ── flow: before and after ──
test('parseFlow: a node on an unmarked, - or ~ line exists before; on an unmarked, + or ~ line it exists after', () => {
  const m = parseFlow(FLOW);
  assert.deepEqual(states(m), { Client: null, Gateway: null, Cache: 'added', Service: 'changed' });
  assert.deepEqual(m.edges.map((e) => [e.from, e.to, e.state ?? null]), [
    ['Client', 'Gateway', null], ['Gateway', 'Cache', 'added'], ['Cache', 'Service', 'added'], ['Gateway', 'Service', 'removed'],
  ]);
});

test('parseFlow: a node only on - lines is removed, one only on + lines is added, one on both is unchanged even if its links changed', () => {
  const m = parseFlow('- Old -> Hub\n+ Hub -> New\n- Hub -> Gone\n+ Hub -> Kept\n- Hub -> Kept');
  assert.deepEqual(states(m), { Old: 'removed', Hub: null, New: 'added', Gone: 'removed', Kept: null });
});

test('parseFlow: ~ on a line without an arrow marks the node changed, also for several nodes and a node that is new to the graph', () => {
  const m = parseFlow('A -> B\n~ A & B\n~ [(Fresh)]');
  assert.deepEqual(states(m), { A: 'changed', B: 'changed', Fresh: 'changed' });
});

test('parseFlow: a node on a ~ line and a - line exists on both sides and is changed', () => {
  assert.equal(parseFlow('- A -> B\n~ A').nodes.get('A').state, 'changed');
});

test('parseFlow: markers combine with * and with every shape bracket', () => {
  const m = parseFlow('+ *Gateway -> [(Cache)] & (Queue) & {Hit?} & [Box]\n~ *[(Cache)]\n- (Queue) -> {Hit?}');
  const gateway = m.nodes.get('Gateway');
  assert.equal(gateway.hi, true);
  assert.equal(gateway.state, 'added');
  assert.deepEqual([...m.nodes.values()].map((n) => n.shape), ['rect', 'db', 'round', 'diamond', 'rect']);
  assert.equal(m.nodes.get('Cache').hi, true);
  assert.equal(m.nodes.get('Cache').state, 'changed');
  assert.equal(m.nodes.get('Queue').state ?? null, null, 'on a + line and a - line');
});

test('parseFlow: without a space after it a marker is plain text; a bracket keeps a label that starts with one', () => {
  const m = parseFlow('-Gateway -> +1 votes\n[- Gateway] -> B');
  assert.deepEqual([...m.nodes.keys()], ['-Gateway', '+1 votes', '- Gateway', 'B']);
  assert.deepEqual(states(m), { '-Gateway': null, '+1 votes': null, '- Gateway': null, B: null });
});

test('parseFlow: + group and - group mark a group box; groups do not count as an appearance of their members', () => {
  const m = parseFlow('A -> B\n+ C -> A\n+ group Backend: A, B\n- group Old: C');
  assert.deepEqual(m.groups.map((g) => [g.name, g.state]), [['Backend', 'added'], ['Old', 'removed']]);
  assert.equal(m.nodes.get('C').state, 'added');
});

// ── flow: errors and the warning ──
test('parseFlow: ~ on a line with an arrow is an error that shows the - then + way', () => {
  const message = lineError(() => parseFlow('A -> B\n~ A -> C'), 2);
  assert.match(message, /"- A -> B"/);
  assert.match(message, /"\+ A -> C"/);
});

test('parseFlow: ~ cannot mark a group', () => {
  lineError(() => parseFlow('A -> B\n~ group G: A, B'), 2);
});

test('parseFlow: the same link both unmarked and marked is an error at the marked line, in either order', () => {
  const a = lineError(() => parseFlow('A -> B\n+ A -> B'), 2);
  assert.match(a, /line 1/);
  lineError(() => parseFlow('- A -> B\nA -> B'), 1);
  lineError(() => parseFlow('A -> B & C\n- A -> C'), 2);
});

test('parseFlow: a removed and an added link between the same nodes is how a label changes, not an error', () => {
  const m = parseFlow('X -> Y\n- A -> B: old\n+ A -> B: new');
  assert.deepEqual(m.edges.map((e) => e.state ?? null), [null, 'removed', 'added']);
});

test('parseFlow: a group that is not removed and holds only removed nodes is a warning, a removed group or one with a survivor is not', () => {
  const only = parseFlow('Keep -> Hub\n- Old -> Older\n- group Gone: Old, Older\ngroup Empty: Old, Older');
  assert.equal(only.warnings.length, 1);
  assert.equal(only.warnings[0].line, 4);
  assert.match(only.warnings[0].message, /Empty/);
  assert.deepEqual(parseFlow('Keep -> Hub\n- Old\ngroup Mixed: Old, Keep').warnings, []);
  assert.deepEqual(parseFlow('A -> B').warnings, []);
});

test('the warning reaches the render result with the draft line, and the page is still written', () => {
  const src = '---\ntitle: T\n---\n## A Panel\n```flow\nKeep -> Hub\n- Old -> Older\ngroup Empty: Old, Older\n```\n';
  const { html, stats } = renderDoc(src);
  assert.match(html, /am-cluster/);
  assert.equal(stats.componentWarnings.length, 1);
  assert.equal(stats.componentWarnings[0].line, 8);
  assert.equal(stats.componentWarnings[0].component, 'flow');
});

// ── flow: drawing ──
test('flow: marked items carry data-delta, a corner badge and the count row; the switch is hidden until the page script shows it', () => {
  const html = render('flow', FLOW, 'LR');
  assert.match(html, /^<figure class="am-diagram am-flow" data-delta-view="changes"><svg/);
  assert.equal((html.match(/<g class="am-node [^"]*" data-key="[^"]*" data-step="\d+" data-delta="added"/g) || []).length, 1);
  assert.equal((html.match(/<g class="am-node [^"]*" data-key="[^"]*" data-step="\d+" data-delta="changed"/g) || []).length, 1);
  assert.equal((html.match(/<g data-step="\d+" data-delta="added">/g) || []).length, 2);
  assert.equal((html.match(/<g data-step="\d+" data-delta="removed">/g) || []).length, 1);
  assert.match(html, /<g class="am-delta-badge am-delta-badge--added"[^>]*><circle[^>]*\/><text[^>]*>\+<\/text><\/g>/);
  assert.match(html, /<g class="am-delta-badge am-delta-badge--changed"[^>]*><circle[^>]*\/><text[^>]*>~<\/text><\/g>/);
  assert.match(html, /<span class="am-delta-count am-delta-count--added">\+3 added<\/span>/);
  assert.match(html, /<span class="am-delta-count am-delta-count--removed">−1 removed<\/span>/);
  assert.match(html, /<span class="am-delta-count am-delta-count--changed">~1 changed<\/span>/);
  assert.match(html, /<span class="am-delta-switch" role="group" aria-label="View" hidden>/);
  for (const [view, label] of [['before', 'Before'], ['changes', 'Changes'], ['after', 'After']]) {
    assert.match(html, new RegExp(`<button type="button" data-view="${view}" aria-pressed="${view === 'changes'}">${label}</button>`));
  }
});

test('flow: added and removed links point with a matching arrowhead, and a removed dashed link stays dashed', () => {
  const html = render('flow', 'A -> B\n+ A --> C\n- B -> D');
  assert.match(html, /<marker id="u1-arrow-added"/);
  assert.match(html, /<marker id="u1-arrow-removed"/);
  assert.match(html, /am-edge am-edge--dashed"[^>]*marker-end="url\(#u1-arrow-added\)"/);
  assert.match(html, /class="am-edge"[^>]*marker-end="url\(#u1-arrow-removed\)"/);
  assert.match(html, /marker-end="url\(#u1-arrow\)"/);
});

test('flow: only the states in use are counted, and a group counts as one marked item', () => {
  const html = render('flow', 'A -> B\n+ C -> A\n+ group G: A, C');
  assert.match(html, /\+3 added/);
  assert.doesNotMatch(html, / removed</);
  assert.doesNotMatch(html, / changed</);
  assert.doesNotMatch(html, /arrow-removed/);
  assert.match(html, /<rect class="am-cluster" data-delta="added"/);
});

test('flow: a diagram without markers has no delta markup at all', () => {
  const html = render('flow', 'Client -> Gateway: HTTPS\nGateway -> Auth & *Service\ngroup Backend: Auth, Service', 'LR');
  assert.doesNotMatch(html, /delta/);
  assert.doesNotMatch(html, /arrow-added|arrow-removed/);
  assert.match(html, /^<figure class="am-diagram am-flow">/);
});

test('flow: marked and unmarked layouts place nodes at the same coordinates (the view switch moves nothing)', () => {
  const plain = render('flow', 'A -> B\nA -> C');
  const marked = render('flow', 'A -> B\n+ A -> C');
  const sizes = (h) => [...h.matchAll(/<rect class="am-node-shape" x="([\d.]+)" y="([\d.]+)"/g)].map((m) => m.slice(1).join(','));
  assert.deepEqual(sizes(marked), sizes(plain));
});

test('flow: the labels follow the page language', () => {
  const html = render('flow', FLOW, 'LR', { ui: zh });
  assert.match(html, /\+3 新增/);
  assert.match(html, /−1 删除/);
  assert.match(html, /~1 修改/);
  assert.match(html, /data-view="before"[^>]*>改前</);
  assert.match(html, /data-view="after"[^>]*>改后</);
});

test('flow: in a video the count row stays and the switch, which needs a script, is left out', () => {
  const html = render('flow', FLOW, 'LR', { video: true });
  assert.match(html, /\+3 added/);
  assert.doesNotMatch(html, /am-delta-switch/);
});

// ── tree ──
const treeOf = (text, args = 'list') => render('tree', text, args);

test('tree: the marker comes after the indentation; indentation still sets the level', () => {
  const html = treeOf(TREE);
  assert.match(html, /<li data-key="delta.js" data-step="2" data-delta="added">/);
  assert.match(html, /<li data-key="flow.js" data-step="3" data-delta="changed">/);
  assert.match(html, /<li data-key="legacy\/" data-step="5" data-delta="removed">/);
  assert.match(html, /<li data-key="components\/" data-step="1"><span class="am-tree-label">components\/<\/span><ul>/);
});

test('tree: children inherit + and -, ~ is not inherited, and the badge shows on every node', () => {
  const html = treeOf(TREE);
  assert.match(html, /<li data-key="old-flow.js" data-step="6" data-delta="removed">/);
  const kids = treeOf('A\n  ~ B\n    C\n  + D\n    E\n    F');
  assert.match(kids, /data-key="B" data-step="1" data-delta="changed"/);
  assert.match(kids, /data-key="C" data-step="2"><span/);
  assert.match(kids, /data-key="E" data-step="4" data-delta="added"/);
  assert.match(kids, /data-key="F" data-step="5" data-delta="added"/);
  assert.equal((treeOf(TREE).match(/<span class="am-delta-badge am-delta-badge--/g) || []).length, 5);
});

test('tree: the count row counts every node with a state, children included', () => {
  const html = treeOf(TREE);
  assert.match(html, /\+1 added/);
  assert.match(html, /−2 removed/);
  assert.match(html, /~2 changed/);
});

test('tree: a child of an added or removed node that carries another marker is an error at its line; the same marker is fine', () => {
  const removed = lineError(() => treeOf('A\n  - B\n    + C'), 3);
  assert.match(removed, /removed/);
  lineError(() => treeOf('A\n  + B\n    - C'), 3);
  lineError(() => treeOf('A\n  + B\n    ~ C'), 3);
  assert.match(treeOf('A\n  - B\n    - C'), /data-key="C"[^>]*data-delta="removed"/);
});

test('tree: a marker without a space, or escaped with a backslash, is a plain label', () => {
  const html = treeOf('A\n  -b\n  +1 votes\n  \\- item\n  \\+ plus\n  \\~ tilde');
  assert.doesNotMatch(html, /data-delta/);
  assert.match(html, />- item</);
  assert.match(html, />\+ plus</);
  assert.match(html, />~ tilde</);
  assert.match(html, />-b</);
});

test('tree: a marker combines with the * highlight and with the label | note form', () => {
  const html = treeOf('A\n  + *New | a note');
  assert.match(html, /<li class="am-tree-hi" data-key="New" data-step="1" data-delta="added">/);
  assert.match(html, /am-tree-sub">a note</);
});

test('tree: org chart mode marks the root, columns and boxes, and hides in a view by data-delta alone', () => {
  const html = treeOf('Root\n  + New\n  - Old\n  ~ Same', '');
  assert.match(html, /<div class="am-tree-col" data-delta="added"><div class="am-tree-box" data-key="New"[^>]*data-delta="added">/);
  assert.match(html, /<div class="am-tree-col" data-delta="removed">/);
  const gone = treeOf('- Root\n  A\n  B', '');
  assert.match(gone, /<div class="am-tree-root" data-delta="removed"><div class="am-tree-box am-tree-box--root"[^>]*data-delta="removed">/);
  assert.match(gone, /<div class="am-tree-col" data-delta="removed">/);
});

test('tree: several roots can carry their own markers', () => {
  const html = treeOf('+ One\n- Two', '');
  assert.match(html, /data-key="One"[^>]*data-delta="added"/);
  assert.match(html, /data-key="Two"[^>]*data-delta="removed"/);
});

test('tree: a tree without markers has no delta markup and keeps its first element', () => {
  const html = treeOf('Root\n  A\n  B\n    C', '');
  assert.doesNotMatch(html, /delta/);
  assert.match(html, /^<div class="am-tree">/);
});

test('tree: the switch state sits on the tree element when it has markers', () => {
  const html = treeOf(TREE);
  assert.match(html, /^<div class="am-tree" data-delta-view="changes">/);
  assert.match(html, /<div class="am-delta-bar">.*<\/div><\/div>$/);
});

test('tree: the labels follow the page language', () => {
  assert.match(render('tree', TREE, 'list', { ui: zh }), /\+1 新增/);
});

// ── page and video ──
const page = (fence) => `---\ntitle: T\nlang: en\n---\n## A Panel\n${fence}\n`;

test('page: the delta styles and script come only with a page that has markers', () => {
  const marked = renderDoc(page(`\`\`\`flow\n${FLOW}\n\`\`\``)).html;
  const plain = renderDoc(page('```flow\nA -> B\n```')).html;
  assert.match(marked, /\[data-delta-view="before"\] \[data-delta="added"\]/);
  assert.match(marked, /data-delta-view/);
  assert.match(marked, /\.am-delta-switch/);
  assert.doesNotMatch(plain, /data-delta|am-delta/);
  assert.equal(pageCss(undefined, {}).includes('data-delta'), false);
});

test('page: a tree with markers brings the same styles and script', () => {
  assert.match(renderDoc(page(`\`\`\`tree\n${TREE}\n\`\`\``)).html, /\[data-delta-view="after"\] \[data-delta="removed"\]/);
});

test('page: the view switch script changes data-delta-view on its diagram and the pressed button', () => {
  const { html } = renderDoc(page(`\`\`\`flow\n${FLOW}\n\`\`\``));
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  assert.match(script, /\.am-delta-switch/);
  assert.match(script, /deltaView/);
});

test('video: marked items use the same colors and badges, with no switch', async () => {
  const src = `---\ntitle: T\nlang: en\n---\n> Intro.\n\n## First\n\`\`\`flow LR\n${FLOW}\n\`\`\`\n> One line.\n`;
  const { html } = await renderVideo(src);
  assert.match(html, /data-delta="added"/);
  assert.match(html, /am-delta-badge/);
  assert.match(html, /am-delta-count/);
  assert.doesNotMatch(html, /data-view=/);
  assert.match(html, /\.am-delta-badge/);
});

test('video: a video without markers is not touched', async () => {
  const { html } = await renderVideo('---\ntitle: T\nlang: en\n---\n> Intro.\n\n## First\n```flow\nA -> B\n```\n> One line.\n');
  assert.doesNotMatch(html, /data-delta|am-delta/);
});

// ── cli ──
const sink = () => { let text = ''; return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } }; };
const run = async (dir, args, stdin = '') => {
  const out = sink();
  const err = sink();
  const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: join(dir, 'home') }, cwd: dir });
  return { code, out: out.text, err: err.text };
};

test('cli: a group that would be empty after the change is listed as a diagram warning and the page is still written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-delta-'));
  try {
    const src = '---\ntitle: T\nlang: en\n---\n## A Panel\n```flow\nKeep -> Hub\n- Old -> Older\ngroup Empty: Old, Older\n```\n';
    const r = await run(dir, ['render', '-', '-o', 'out/page.html'], src);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /diagram 1 warning/);
    assert.match(r.out, /L9 \[flow\] group Empty holds only removed nodes/);
    assert.ok(existsSync(join(dir, 'out', 'page.html')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli patch: a page with change markers keeps them, with their styles and script, when another panel is patched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-delta-'));
  try {
    const src = `---\ntitle: T\nlang: en\n---\n## A Plan\n\`\`\`flow\n${FLOW}\n\`\`\`\n\n## B Other\nText.\n`;
    assert.equal((await run(dir, ['render', '-', '-o', 'out/page.html'], src)).code, 0);
    const p = await run(dir, ['patch', 'out/page.html', '--panel', 'B', '-'], 'New text.');
    assert.equal(p.code, 0, p.err);
    const html = readFileSync(join(dir, 'out', 'page.html'), 'utf8');
    assert.match(html, /data-delta="added"/);
    assert.match(html, /\[data-delta-view="before"\]/);
    assert.match(html, /New text\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: am help flow and am help tree document the markers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-delta-'));
  try {
    for (const name of ['flow', 'tree']) {
      const r = await run(dir, ['help', name]);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /Change markers/);
      assert.match(r.out, /Before \/ Changes \/ After/);
    }
    assert.match((await run(dir, ['help', 'flow'])).out, /\[- Gateway\]/);
    assert.match((await run(dir, ['help', 'tree'])).out, /\\- item/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
