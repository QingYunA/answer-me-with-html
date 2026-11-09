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

test('state: all [*] lines share one initial state and one final state', () => {
  const m = parseState('[*] -> A\n[*] -> B\nA -> [*]\nB -> [*]');
  const kinds = [...m.nodes.values()].map((n) => n.kind);
  assert.equal(kinds.filter((k) => k === 'initial').length, 1);
  assert.equal(kinds.filter((k) => k === 'final').length, 1);
});

test('state: U+0000 in a written name is an error, so it cannot merge with a pseudo-state id', () => {
  throwsAt(() => render('\u0000initial -> B'), 1);
  throwsAt(() => render('A -> B\n\u0000final'), 2);
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

test('state: transitions leave the initial dot and stop at the final ring', () => {
  const svg = render('[*] -> A\nA -> [*]');
  const centre = (re) => {
    const m = svg.match(re);
    return [Number(m[1]), Number(m[2])];
  };
  const dot = centre(/<circle class="am-state-dot" cx="([\d.]+)" cy="([\d.]+)"/);
  const ring = centre(/<circle class="am-state-ring" cx="([\d.]+)" cy="([\d.]+)"/);
  const paths = [...svg.matchAll(/<path class="am-edge" d="([^"]+)"/g)].map((m) => m[1]);
  const start = paths[0].match(/^M([\d.]+),([\d.]+)/).slice(1).map(Number);
  const end = paths[1].match(/L([\d.]+),([\d.]+)$/).slice(1).map(Number);
  const distance = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1]);
  assert.ok(Math.abs(distance(start, dot) - 6) < 0.01, `line starts ${distance(start, dot)} from the dot centre`);
  assert.ok(Math.abs(distance(end, ring) - 6) < 0.01, `line ends ${distance(end, ring)} from the ring centre`);
});

test('state: the diagram label names the states and follows the page language', () => {
  assert.match(render('[*] -> Idle\nIdle -> Open: go'), /aria-label="State machine diagram: Idle, Open"/);
  const zh = COMPONENTS.get('state').render('[*] -> Idle', { args: '', uid: () => 'u1', ui: { state: '状态机图', colon: '：', sep: '、' } }); // lang-ok: expected Chinese UI label
  assert.match(zh, /aria-label="状态机图：Idle"/); // lang-ok: expected Chinese UI label
});

test('state: the canvas is finite and holds the loops and labels', () => {
  const svg = render('[*] -> Idle\nIdle -> Idle: a very long event name that takes room\nIdle -> [*]', 'LR');
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
  const [w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert.ok(w > 0 && h > 0);
  const [, sx, sy] = svg.match(/<g transform="translate\(([\d.-]+),([\d.-]+)\)"/) ?? [0, 0, 0];
  const loops = [...svg.matchAll(/<path class="am-edge" d="M([\d.-]+),([\d.-]+) C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(loops.length, 1);
  for (const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] of loops) {
    for (const x of [x1, cx1, cx2, x2]) assert.ok(x + Number(sx) >= 0 && x + Number(sx) <= w, 'the loop lies inside the viewBox');
    for (const y of [y1, cy1, cy2, y2]) assert.ok(y + Number(sy) >= 0 && y + Number(sy) <= h, 'the loop lies inside the viewBox');
  }
  const labels = [...svg.matchAll(/<g class="am-edge-label"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(labels.length, 1);
  for (const [x, y, lw, lh] of labels) {
    assert.ok(x + Number(sx) >= 0 && y + Number(sy) >= 0 && x + lw + Number(sx) <= w && y + lh + Number(sy) <= h, 'the label lies inside the viewBox');
  }
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
  throwsAt(() => render('A -> [*]\n+ A -> [*]'), 2);
});

test('state: two events between the same states are two transitions, each with its own marker', () => {
  const m = parseState('A -> B: timeout\n+ A -> B: cancel');
  assert.equal(m.edges.length, 2);
  assert.equal(m.edges[1].state, 'added');
});

test('state: an event may contain -> or -->; only a second arrow before the colon is a second transition', () => {
  const m = parseState('Idle -> Busy: retry -> wait');
  assert.deepEqual(m.edges.map((e) => [e.from, e.to, e.label]), [['Idle', 'Busy', 'retry -> wait']]);
  assert.match(render('Idle -> Busy: retry -> wait'), />retry -&gt; wait<\/text>/);
  assert.match(render('Idle -> Busy: received A --> B'), />received A --&gt; B<\/text>/);
});

test('state: a Mermaid line and a stateDiagram-v2 header are errors that show the line to write', () => {
  assert.throws(
    () => render('A -> B\nB --> C : go'),
    (e) => e instanceof ComponentError && e.line === 2 && /\bis Mermaid syntax; write B -> C: go$/.test(e.message),
  );
  assert.throws(
    () => render('B --> C: x --> y'),
    (e) => e instanceof ComponentError && e.line === 1 && /write B -> C: x --> y$/.test(e.message),
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

test('state: a line that only marks a state still gets a video step, and the badge appears on it', () => {
  const svg = render('A -> B\n~ A', '', { video: true });
  const steps = [...svg.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual([...new Set(steps)].sort((a, b) => a - b), [0, 1]);
  assert.match(svg, /<g class="am-delta-badge am-delta-badge--changed" data-step="1"/);
});

test('state: a line that repeats a state still gets a video step, so later lines keep their beat', () => {
  const svg = render('A -> B\nB\nC -> B', '', { video: true });
  const steps = [...svg.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual([...new Set(steps)].sort((a, b) => a - b), [0, 1, 2]);
  assert.match(svg, /<g data-step="1"><\/g>/, 'the repeated declaration is an empty step');
  assert.match(svg, /data-step="2"><path class="am-edge"/, 'the next transition stays on step 2');
});

test('state: a labelled loop keeps room from the next state of its rank', () => {
  const svg = render('A -> C\nA -> B\nB -> B: a long retry event');
  const node = (key) => {
    const m = svg.match(new RegExp(`data-key="${key}"[^>]*><rect class="am-node-shape" x="([\\d.]+)" y="[\\d.]+" width="([\\d.]+)"`));
    return { left: Number(m[1]), right: Number(m[1]) + Number(m[2]) };
  };
  const labels = [...svg.matchAll(/<g class="am-edge-label"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
  const right = Math.max(...labels);
  assert.ok(right < node('C').left, `loop label ends at ${right}, C starts at ${node('C').left}`);
  assert.ok(node('C').left - node('B').right > 100, 'the room beside B keeps C away');
});

test('state: the labels of two beside-loops do not cover each other', () => {
  const svg = render('A -> B\nB -> B: retry request\nB -> B: cancel request');
  const labels = [...svg.matchAll(/<g class="am-edge-label"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }));
  assert.equal(labels.length, 2);
  assert.equal(labels[0].y, labels[1].y, 'both labels sit at the centre of their loop');
  assert.ok(labels[0].x + labels[0].w + 5 <= labels[1].x, `labeled ${labels[0].x + labels[0].w} then ${labels[1].x}`);
});

test('state: a multi-line loop label stays inside the drawing', () => {
  const svg = render('A -> B\nB -> B: first\\nsecond', 'LR');
  const shift = svg.match(/<g transform="translate\(([-\d.]+),([-\d.]+)\)">/);
  const shiftY = shift ? Number(shift[2]) : 0;
  const label = svg.match(/<g class="am-edge-label"><rect x="[-\d.]+" y="([-\d.]+)" width="[\d.]+" height="([\d.]+)"/);
  const bottom = Number(label[1]) + Number(label[2]) + shiftY;
  const height = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  assert.ok(bottom <= height, `label ends at ${bottom}, drawing at ${height}`);
});

test('state: a tall below-loop label clears its state and the next loop', () => {
  const svg = render('A -> B\nB -> B: first\\nsecond\\nthird\\nfourth\\nfifth\\nsixth\nB -> B: seventh\\neighth\\nninth\\ntenth\\neleventh\\ntwelfth', 'LR');
  const box = svg.match(/data-key="B"[^>]*><rect class="am-node-shape" x="[-\d.]+" y="([-\d.]+)" width="[\d.]+" height="([\d.]+)"/);
  const boxBottom = Number(box[1]) + Number(box[2]);
  const labels = [...svg.matchAll(/<g class="am-edge-label"><rect x="[-\d.]+" y="([-\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
    .map((m) => ({ top: Number(m[1]), bottom: Number(m[1]) + Number(m[2]) }));
  assert.equal(labels.length, 2);
  assert.ok(labels[0].top >= boxBottom, `first label starts at ${labels[0].top}, state ends at ${boxBottom}`);
  assert.ok(labels[0].bottom < labels[1].top, `labels ${labels[0].bottom} and ${labels[1].top} overlap`);
});

test('state: the component renders inside a panel with its own figure class', () => {
  const { html } = renderDoc('## A Connection\n```state LR\n[*] -> Idle\nIdle -> Open: connect()\n```\n', { theme: 'blueprint' });
  assert.match(html, /<figure class="am-diagram am-state"><svg /);
});
