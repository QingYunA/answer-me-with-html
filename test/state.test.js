// State machine component: one transition per line, initial and final pseudo-states, self-transition loops, change markers,
// the page direction and video steps. The drawing reuses flow's dagre layout and the shared self-loop geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseState } from '../src/components/state.js';
import { renderDoc } from '../src/render.js';

const ctx = (args = '', extra = {}) => ({ args, uid: () => 'u1', ui: {}, dir: 'ltr', ...extra });
const render = (text, args, extra) => COMPONENTS.get('state').render(text, ctx(args, extra));
const throwsAt = (fn, line) =>
  assert.throws(fn, (e) => e instanceof ComponentError && e.line === line);

const TCP = '[*] -> Idle\nIdle -> Connecting: connect()\nConnecting -> Open: SYN-ACK\nConnecting -> Closed: RST\nOpen -> Open: retransmit\nOpen -> Closed: close()\nClosed -> [*]';

test('state: every transition is one edge, with an optional event as its label', () => {
  const m = parseState(TCP);
  assert.deepEqual([...m.nodes.values()].map((n) => [n.label, n.kind]), [['[*]', 'initial'], ['Idle', 'state'], ['Connecting', 'state'], ['Open', 'state'], ['Closed', 'state'], ['[*]', 'final']]);
  assert.deepEqual(m.edges.map((e) => e.label), ['', 'connect()', 'SYN-ACK', 'RST', 'retransmit', 'close()', '']);
  assert.equal(m.edges.filter((e) => e.from === e.to).length, 1, 'Open -> Open is the only self-transition');
});

test('state: [*] on the left is one shared initial state, [*] on the right is one final state per transition', () => {
  const m = parseState('[*] -> A\n[*] -> B\nA -> [*]\nB -> [*]');
  const kinds = [...m.nodes.values()].map((n) => n.kind);
  assert.equal(kinds.filter((k) => k === 'initial').length, 1);
  assert.equal(kinds.filter((k) => k === 'final').length, 2);
});

test('state: a line without an arrow declares a state, and a marker alone marks it', () => {
  const m = parseState('A -> B\n~ A\n+ C');
  assert.equal(m.nodes.get('A').state, 'changed');
  assert.equal(m.nodes.get('B').state ?? null, null);
  assert.equal(m.nodes.get('C').state, 'added');
});

test('state: a state on a marked transition is removed or added unless an unmarked line keeps it', () => {
  const m = parseState('Keep -> Hub\n- Old -> Hub\n+ Hub -> New');
  assert.equal(m.nodes.get('Old').state, 'removed');
  assert.equal(m.nodes.get('New').state, 'added');
  assert.equal(m.nodes.get('Hub').state ?? null, null);
  assert.equal(m.nodes.get('Keep').state ?? null, null);
});

test('state: a self-transition is drawn as a loop with an arrowhead and its event, not as a straight edge', () => {
  const svg = render('Idle -> Idle: poll');
  const loop = svg.match(/<path class="am-edge" d="M([\d.]+),([\d.]+) C([\d.]+),[\d.]+ ([\d.]+),[\d.]+ ([\d.]+),([\d.]+)" marker-end="url\(#u1-arrow\)"\/>/);
  assert.ok(loop, 'one loop path');
  const [x1, , cx1, cx2, x2] = loop.slice(1).map(Number);
  assert.equal(x1, x2, 'both ends sit on the same side of the state');
  assert.ok(cx1 > x1 && cx2 > x1, 'the loop bulges out of that side');
  assert.match(svg, />poll<\/text>/);
});

test('state: in LR a self-transition loops below its state, clear of the edges beside it', () => {
  const svg = render('A -> B\nB -> B: retry', 'LR');
  const loop = svg.match(/<path class="am-edge" d="M([\d.]+),([\d.]+) C[\d.]+,([\d.]+) [\d.]+,([\d.]+) ([\d.]+),([\d.]+)" marker-end="url\(#u1-arrow\)"\/>/);
  assert.ok(loop, 'one loop path');
  const [x1, y1, cy1, , x2, y2] = loop.slice(1).map(Number);
  assert.equal(y1, y2);
  assert.ok(cy1 > y1, 'the loop goes below the state');
  assert.equal(x1 < x2, true, 'the ends keep the reading order');
});

test('state: a state is a rounded rectangle, the initial state a filled dot and the final one a ringed dot', () => {
  const svg = render('[*] -> A\nA -> [*]');
  assert.match(svg, /^<figure class="am-diagram am-state"><svg /);
  assert.match(svg, /<g class="am-node am-node--state" data-key="A"[^>]*><rect class="am-node-shape"[^>]* rx="8"\/>/);
  assert.match(svg, /<g class="am-node am-node--state am-node--initial"[^>]*><circle class="am-state-dot"[^>]* r="6"\/>/);
  assert.match(svg, /<g class="am-node am-node--state am-node--final"[^>]*><circle class="am-state-ring"[^>]* r="6"\/><circle class="am-state-core"[^>]* r="2\.8"\/>/);
});

test('state: the diagram label names the states and follows the page language', () => {
  assert.match(render('[*] -> Idle\nIdle -> Open: go'), /aria-label="State machine diagram: Idle, Open"/);
  const zh = COMPONENTS.get('state').render('[*] -> Idle', { args: '', uid: () => 'u1', ui: { state: '状态机图', colon: '：', sep: '、' } });
  assert.match(zh, /aria-label="状态机图：Idle"/);
});

test('state: the canvas is finite and holds the loops and labels', () => {
  const svg = render('[*] -> Idle\nIdle -> Idle: a very long event name that takes room\nIdle -> [*]', 'LR');
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
  const [w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert.ok(w > 0 && h > 0);
});

test('state: an unreadable line, an empty side and two arrows report the line number', () => {
  throwsAt(() => render('A -> B\nA: waiting'), 2);
  throwsAt(() => render('A -> B\n-> B'), 2);
  throwsAt(() => render('A -> B\nA ->'), 2);
  throwsAt(() => render('A -> B: x\nA -> B: y\nA -> -> C'), 3);
});

test('state: ~ on a transition is an error, and so is the same transition both marked and unmarked', () => {
  throwsAt(() => render('A -> B\n~ A -> C'), 2);
  throwsAt(() => render('A -> B\n+ A -> B'), 2);
  throwsAt(() => render('- A -> B\nA -> B'), 1);
});

test('state: a Mermaid line and a stateDiagram-v2 header are errors that show the line to write', () => {
  assert.throws(
    () => render('A -> B\nB --> C : go'),
    (e) => e instanceof ComponentError && e.line === 2 && /\bis Mermaid syntax; write B -> C: go$/.test(e.message),
  );
  assert.throws(
    () => render('stateDiagram-v2\n[*] --> Idle'),
    (e) => e instanceof ComponentError && e.line === 1 && /write its transitions one line each, for example: \[\*\] -> Idle/.test(e.message),
  );
  assert.throws(
    () => render('state Idle {'),
    (e) => e instanceof ComponentError && e.line === 1 && /composite state/.test(e.message),
  );
});

test('state: an empty block is an error at line 1', () => {
  throwsAt(() => render('   '), 1);
});

test('state: a right-to-left page draws the mirror image, with direction="rtl" on the svg', () => {
  const src = '[*] -> Idle\nIdle -> Idle: poll\nIdle -> Open: go';
  const ltr = render(src, 'LR', { dir: 'ltr' });
  const rtl = render(src, 'LR', { dir: 'rtl' });
  assert.doesNotMatch(ltr, / direction="rtl"/);
  assert.match(rtl, / direction="rtl" xmlns=/);
  const dotX = (svg) => Number(svg.match(/<circle class="am-state-dot" cx="([\d.]+)"/)[1]);
  assert.ok(dotX(rtl) > dotX(ltr), 'the first state sits on the right');
  // A self-transition below the state keeps its ends in reading order: the first end is the one where reading starts.
  const loop = (svg) => svg.match(/d="M([\d.]+),\d+ C[\d.]+,[\d.]+ [\d.]+,[\d.]+ ([\d.]+),\d+"/).slice(1).map(Number);
  assert.ok(loop(ltr)[0] < loop(ltr)[1], 'on a left-to-right page the loop starts at the left end');
  assert.ok(loop(rtl)[0] > loop(rtl)[1], 'on a right-to-left page it starts at the right end');
});

test('state: marked items carry data-delta, a badge and the count row; the switch starts hidden', () => {
  const html = render('[*] -> Idle\n- Idle -> Open\n+ Idle -> Closed');
  assert.match(html, /^<figure class="am-diagram am-state am-view-changes"><svg/);
  assert.match(html, /data-key="Open" data-step="\d+" data-delta="removed"/);
  assert.match(html, /data-key="Closed" data-step="\d+" data-delta="added"/);
  assert.match(html, /am-delta-badge--removed/);
  assert.match(html, /am-delta-badge--added/);
  assert.match(html, /am-delta-count--removed">−2 removed/);
  assert.match(html, /am-delta-count--added">\+2 added/);
  assert.match(html, /<span class="am-delta-switch" role="group" aria-label="View" hidden>/);
});

test('state: a diagram without markers has no delta markup at all', () => {
  const html = render('[*] -> Idle\nIdle -> Open: go');
  assert.doesNotMatch(html, /am-delta|am-view-changes/);
});

test('state: video mode gives each source line one step and leaves the view switch out', () => {
  const svg = render('[*] -> Idle\nIdle -> Open: connect()\nOpen -> Open: retransmit', '', { video: true });
  assert.doesNotMatch(svg, /am-delta-switch/);
  const steps = [...svg.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual([...new Set(steps)].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(steps.filter((s) => s === 2).length, 1, 'the self-transition line is one step');
  assert.match(svg, /<g data-step="2"><path class="am-edge" d="M[\d.,]+ C[\d.,]+ [\d.,]+ [\d.,]+"/, 'the loop is in that step');
});

test('state: the component renders inside a panel with its own figure class', () => {
  const { html } = renderDoc('## A Connection\n```state LR\n[*] -> Idle\nIdle -> Open: connect()\n```\n', { theme: 'blueprint' });
  assert.match(html, /<figure class="am-diagram am-state"><svg /);
});
