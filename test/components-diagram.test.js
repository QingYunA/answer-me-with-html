import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseFlow } from '../src/components/flow.js';
import { parseSequence } from '../src/components/sequence.js';
import { smoothPath } from '../src/svg/shapes.js';
import { measure } from '../src/svg/text.js';

const ctx = (args = '', dir) => ({ args, uid: () => 'u1', dir });
const render = (name, text, args, dir) => COMPONENTS.get(name).render(text, ctx(args, dir));
const throwsAt = (fn, line) =>
  assert.throws(fn, (e) => e instanceof ComponentError && e.line === line);
const viewBox = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

// ── shapes ──
test('smoothPath: two points give a straight line, more give a smooth curve', () => {
  assert.equal(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'M0,0 L10,0');
  assert.match(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), /^M0,0 L5,0 Q10,0 10,5 L10,10$/);
});

// ── sequence ──
test('parseSequence: participants in order of appearance, solid/dashed lines, self-calls, notes', () => {
  const m = parseSequence('A -> B: 请求\nB --> A: 响应\nB -> B: 校验\nnote A, B: 建立连接');
  assert.deepEqual(m.participants, ['A', 'B']);
  assert.deepEqual(m.steps.map((s) => s.kind), ['msg', 'msg', 'msg', 'note']);
  assert.equal(m.steps[1].dashed, true);
  assert.equal(m.steps[2].from, m.steps[2].to);
  assert.deepEqual(m.steps[3].over, ['A', 'B']);
});

test('parseSequence: a participants line fixes the order', () => {
  const m = parseSequence('participants: Server, Client\nClient -> Server: SYN');
  assert.deepEqual(m.participants, ['Server', 'Client']);
});

test('sequence: outputs SVG with participant boxes, lifelines and arrow labels', () => {
  const svg = render('sequence', 'Client -> Server: SYN\nServer --> Client: SYN-ACK');
  assert.match(svg, /^<figure class="am-diagram am-seq">/);
  assert.equal((svg.match(/class="am-actor"/g) || []).length, 2);
  assert.equal((svg.match(/class="am-lifeline"/g) || []).length, 2);
  assert.match(svg, />SYN<\/text>/);
  assert.match(svg, /am-edge am-edge--dashed/);
  assert.match(svg, /marker-end="url\(#u1-arrow\)"/);
});

test('sequence: long message labels widen the gap between participants', () => {
  const short = viewBox(render('sequence', 'A -> B: x'))[0];
  const long = viewBox(render('sequence', 'A -> B: 这是一个非常非常长的消息标签需要更大的间距'))[0];
  assert.ok(long > short + 100, `short=${short} long=${long}`);
});

test('sequence: the num argument adds step numbers', () => {
  assert.match(render('sequence', 'A -> B: x', 'num'), /class="am-step"[^>]*>1<\/text>/);
});

test('sequence: an unparseable line reports its line number', () => {
  throwsAt(() => render('sequence', 'A -> B: ok\nA => B'), 2);
});

// ── flow ──
test('parseFlow: chains, fan-out, shape markers, highlights, edge labels', () => {
  const m = parseFlow('(开始) -> 输入 -> {合法?}\n合法? -> 处理 & *[(数据库)]: 是\n合法? --> 报错: 否');
  const shape = Object.fromEntries([...m.nodes.values()].map((n) => [n.id, n.shape]));
  assert.deepEqual(shape, { 开始: 'round', 输入: 'rect', '合法?': 'diamond', 处理: 'rect', 数据库: 'db', 报错: 'rect' });
  assert.equal(m.nodes.get('数据库').hi, true);
  assert.equal(m.edges.length, 5);
  assert.deepEqual(m.edges.filter((e) => e.label === '是').map((e) => e.to), ['处理', '数据库']);
  assert.equal(m.edges.find((e) => e.to === '报错').dashed, true);
});

test('parseFlow: square brackets protect node text that contains a colon', () => {
  const m = parseFlow('[Part 1: rules] -> [Part 2: dict]: 引用');
  assert.ok(m.nodes.has('Part 1: rules'));
  assert.equal(m.edges[0].label, '引用');
});

test('parseFlow: group declares a group', () => {
  const m = parseFlow('网关 -> 鉴权\n网关 -> 业务\ngroup 后端: 鉴权, 业务');
  assert.deepEqual(m.groups, [{ name: '后端', members: ['鉴权', '业务'], line: 3 }]);
});

test('flow: outputs SVG with all nodes, edges, labels and groups', () => {
  const svg = render('flow', '用户 -> 网关: HTTPS\n网关 -> 鉴权\n网关 -> 业务\ngroup 后端: 鉴权, 业务');
  assert.match(svg, /^<figure class="am-diagram am-flow">/);
  assert.equal((svg.match(/class="am-node /g) || []).length, 4);
  assert.equal((svg.match(/class="am-edge"/g) || []).length, 3);
  assert.match(svg, /class="am-edge-label".*>HTTPS<\/text>/s);
  assert.match(svg, /class="am-cluster"/);
  assert.match(svg, />后端<\/text>/);
});

test('flow: LR is wider, TB is taller', () => {
  const src = 'A -> B -> C -> D';
  const [wTB, hTB] = viewBox(render('flow', src));
  const [wLR, hLR] = viewBox(render('flow', src, 'LR'));
  assert.ok(hTB > wTB && wLR > hLR);
});

test('flow: diamond nodes draw as a polygon, databases as a cylinder', () => {
  const svg = render('flow', '{判断?} -> [(DB)]');
  assert.match(svg, /<polygon class="am-node-shape"/);
  assert.match(svg, /am-node--db/);
});

test('flow: error on a group that references a missing node; error on an empty graph', () => {
  throwsAt(() => render('flow', 'A -> B\ngroup G: A, X'), 2);
  throwsAt(() => render('flow', '  '), 1);
});

test('flow: error on an unclosed shape bracket', () => {
  throwsAt(() => render('flow', 'A -> B\n(未闭合 -> C'), 2);
});

test('flow: lays out nodes whose names equal dagre reserved ids or internal group ids', () => {
  assert.match(render('flow', '\u0000 -> B'), /<svg/);
  assert.match(render('flow', '__group0 -> B\ngroup G: B'), /am-cluster/);
  assert.match(render('flow', 'g0 -> n0\ngroup g0: n0'), /am-cluster/);
});

// A group name never sits on an edge, an edge label or a node, in any direction, on left-to-right and right-to-left pages.
// On a right-to-left page the text is anchored at its right end and set in the sans font, so its box extends left from x.
function labelClashes(svg, dir, which = 0) {
  const label = [...svg.matchAll(/<text class="am-cluster-label" x="([\d.]+)" y="([\d.]+)">([^<]*)<\/text>/g)][which];
  const [x, y] = [Number(label[1]), Number(label[2])];
  const w = measure(label[3].replace(/[\u2066-\u2069]/g, ''), 11, { mono: dir !== 'rtl' });
  const box = dir === 'rtl' ? [x - w, y - 11, x, y + 3] : [x, y - 11, x + w, y + 3];
  const inside = (p) => p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3];
  const clashes = [];
  for (const [, d] of svg.matchAll(/class="am-edge[^"]*" d="([^"]+)"/g)) {
    const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let k = 1; k < pts.length; k++) {
      for (let t = 0; t <= 1; t += 0.02) {
        const p = [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
        if (inside(p)) clashes.push(`edge ${d}`);
      }
    }
  }
  const rects = [
    ...svg.matchAll(/<rect class="am-node-shape" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
    ...svg.matchAll(/<g class="am-edge-label"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
  ];
  for (const m of rects) {
    const [rx, ry, rw, rh] = m.slice(1).map(Number);
    if (rx < box[2] && box[0] < rx + rw && ry < box[3] && box[1] < ry + rh) clashes.push(`box at ${rx},${ry}`);
  }
  return [...new Set(clashes)];
}

const CROWDED = {
  TB: 'Source PDF -> pdf_to_text.py: text in reading order\npdf_to_text.py -> Index: build\nIndex -> Search\ngroup Preparation (one time): pdf_to_text.py, Index',
  BT: 'Source file -> Convert: text in reading order\nConvert -> Index: build\nIndex -> Search\ngroup Preparation (one time only): Convert, Index',
  LR: 'Top -> Worker\nClient -> Gateway: HTTPS\nGateway -> Worker\nWorker -> DB\ngroup A very long backend group name here: Gateway, Worker',
  RL: 'Top -> Worker\nClient -> Gateway: HTTPS\nGateway -> Worker\nWorker -> DB\ngroup A very long backend group name here: Gateway, Worker',
};
// The right-to-left TB case is written in Hebrew, so the name is measured and anchored as on a real page.
const CROWDED_HE_TB = 'קובץ PDF -> pdf_to_text.py: טקסט בסדר קריאה\npdf_to_text.py -> אינדקס: brainrag index\nאינדקס -> חיפוש\ngroup הכנה (פעם אחת): pdf_to_text.py, אינדקס';

for (const [rankdir, text] of Object.entries(CROWDED)) {
  for (const dir of ['ltr', 'rtl']) {
    test(`flow: a group name stays clear of edges and nodes (${rankdir}, ${dir})`, () => {
      const svg = render('flow', dir === 'rtl' && rankdir === 'TB' ? CROWDED_HE_TB : text, rankdir, dir);
      assert.deepEqual(labelClashes(svg, dir), []);
      // The name stays inside its box.
      const [bx, , bw] = svg.match(/<rect class="am-cluster" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/).slice(1).map(Number);
      const x = Number(svg.match(/<text class="am-cluster-label" x="([\d.]+)"/)[1]);
      assert.ok(x >= bx && x <= bx + bw);
    });
  }
}

for (const dir of ['ltr', 'rtl']) {
  test(`flow: two crowded groups side by side both find a clear place (${dir})`, () => {
    const svg = render('flow', 'A -> B\nA -> C\nB -> D\nC -> D\ngroup Left side group label: B\ngroup Right side group label: C', 'TB', dir);
    const labels = [...svg.matchAll(/<text class="am-cluster-label"[^>]*>/g)];
    assert.equal(labels.length, 2);
    for (const which of [0, 1]) assert.deepEqual(labelClashes(svg, dir, which), []);
  });
}

test('flow: a group name that is already clear stays in the top left corner', () => {
  const svg = render('flow', 'A -> B\nB -> C\ngroup G: B, C');
  const [bx, by] = svg.match(/<rect class="am-cluster" x="([\d.]+)" y="([\d.]+)"/).slice(1).map(Number);
  const [lx, ly] = svg.match(/<text class="am-cluster-label" x="([\d.]+)" y="([\d.]+)"/).slice(1).map(Number);
  assert.deepEqual([Math.round(lx - bx), Math.round(ly - by)], [8, 14]);
});

test('flow: on a right-to-left page a group name that is already clear stays in the top right corner', () => {
  const svg = render('flow', 'A -> B\nB -> C\ngroup G: B, C', 'TB', 'rtl');
  const [bx, by, bw] = svg.match(/<rect class="am-cluster" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/).slice(1).map(Number);
  const [lx, ly] = svg.match(/<text class="am-cluster-label" x="([\d.]+)" y="([\d.]+)"/).slice(1).map(Number);
  assert.deepEqual([Math.round(bx + bw - lx), Math.round(ly - by)], [8, 14]);
});

// Wrapping by script (issue #85): a Korean label breaks at its spaces, and a Thai one inside the node budget, which is 150 for flow.
const textLines = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test('flow: a Korean label breaks at a space, not inside a word', () => {
  assert.deepEqual(textLines(render('flow', '데이터베이스 연결을 확인하고 재시도합니다')), ['데이터베이스 연결을', '확인하고 재시도합니다']);
});

test('flow: a Thai label wraps inside the node budget instead of one wide line', () => {
  const lines = textLines(render('flow', 'ตรวจสอบการเชื่อมต่อฐานข้อมูลแล้วลองอีกครั้ง'));
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(measure(l, 13) <= 150, `line too wide: ${l}`);
});

test('sequence: Korean and Thai messages wrap the same way', () => {
  assert.deepEqual(textLines(render('sequence', 'A -> B: 데이터베이스 연결을 확인하고 재시도합니다')), ['A', 'B', '데이터베이스 연결을 확인하고', '재시도합니다']);
  const thai = textLines(render('sequence', 'A -> B: ตรวจสอบการเชื่อมต่อฐานข้อมูลแล้วลองอีกครั้ง'));
  for (const l of thai) assert.ok(measure(l, 13) <= 240, `line too wide: ${l}`);
});
