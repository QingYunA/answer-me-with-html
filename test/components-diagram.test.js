import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseFlow } from '../src/components/flow.js';
import { parseEr, relationships } from '../src/components/er.js';
import { parseSequence } from '../src/components/sequence.js';
import { smoothPath } from '../src/svg/shapes.js';
import { measure } from '../src/svg/text.js';

const ctx = (args = '') => ({ args, uid: () => 'u1' });
const render = (name, text, args) => COMPONENTS.get(name).render(text, ctx(args));
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

// ── er ──
const ER = '*User\n  id PK\n  email string UK\nOrder\n  id PK\n  user_id FK -> User\nUser 1--* Order: places';
const erThrows = (text) => {
  try {
    parseEr(text);
    return null;
  } catch (e) {
    return e;
  }
};
const endGroups = (svg) => [...svg.matchAll(/<g class="am-er-end[^"]*">([\s\S]*?)<\/g>/g)].map((m) => m[1]);

test('parseEr: entities, fields with an optional type and key, both relationship forms', () => {
  const m = parseEr(ER);
  assert.deepEqual([...m.entities.keys()], ['User', 'Order']);
  assert.equal(m.entities.get('User').hi, true);
  assert.equal(m.entities.get('Order').hi, false);
  assert.deepEqual(m.entities.get('User').fields, [
    { name: 'id', type: '', marker: 'PK', ref: null, line: 2 },
    { name: 'email', type: 'string', marker: 'UK', ref: null, line: 3 },
  ]);
  assert.deepEqual(m.entities.get('Order').fields[1], { name: 'user_id', type: '', marker: 'FK', ref: 'User', line: 6 });
  assert.deepEqual(m.written, [{ from: 'User', fromCard: '1', to: 'Order', toCard: '*', label: 'places', line: 7 }]);
});

test('er: a FK field implies the many-to-one relationship, and a written line replaces it', () => {
  const implied = relationships(parseEr('Order\n  id PK\n  user_id FK -> User'));
  assert.deepEqual(implied.map((r) => [r.from, r.fromCard, r.to, r.toCard]), [['Order', '*', 'User', '1']]);
  const replaced = relationships(parseEr('Order\n  user_id FK -> User\nUser 1--* Order: places'));
  assert.equal(replaced.length, 1);
  assert.deepEqual([replaced[0].from, replaced[0].to, replaced[0].label], ['User', 'Order', 'places']);
});

test('er: draws a box per entity with its fields, and an end per cardinality', () => {
  const svg = render('er', ER);
  assert.match(svg, /^<figure class="am-diagram am-er">/);
  assert.equal((svg.match(/class="am-node am-node--er/g) || []).length, 2);
  assert.match(svg, /class="am-node am-node--er am-node--hi" data-key="User"/);
  assert.match(svg, />email string</);
  assert.equal((svg.match(/class="am-er-key[^"]*"/g) || []).length, 4);
  assert.equal((endGroups(svg).length), 2);
  assert.match(svg, /class="am-edge-label"[\s\S]*>places</);
});

test('er: each cardinality draws its own end', () => {
  const end = (card) => endGroups(render('er', `A\nB\nA ${card}--1 B`))[1];
  assert.equal((end('1').match(/<line/g) || []).length, 1);
  assert.equal((end('0..1').match(/<circle/g) || []).length, 1);
  assert.equal((end('*').match(/<line/g) || []).length, 3);
  assert.equal((end('1..*').match(/<line/g) || []).length, 4);
});

test('er: a Mermaid relationship, a field before any entity and a bad FK are errors', () => {
  assert.match(erThrows('USER ||--o{ ORDER').message, /is not a relationship; write A 1--\* B/);
  assert.match(erThrows('  id PK').message, /must follow an entity/);
  assert.match(erThrows('User\n  id PK -> Order').message, /only a FK field/);
  assert.match(erThrows('User\n  x -> Order').message, /only a FK field/);
  assert.match(erThrows('User\n  id FK ->').message, /write the entity a field points at/);
  assert.match(erThrows('User\n  id PK int').message, /must be the last word before/);
  assert.match(erThrows('User\nUser').message, /written twice/);
  assert.equal(erThrows('   ').message, 'an entity relationship diagram needs at least one entity (a line at column 0)');
});

test('er: video mode gives every entity and relationship its own step', () => {
  const svg = COMPONENTS.get('er').render(ER, { args: '', uid: () => 'u1', video: true });
  assert.match(svg, /class="am-node am-node--er am-node--hi" data-key="User" data-step="0"/);
  assert.match(svg, /class="am-node am-node--er" data-key="Order" data-step="1"/);
  assert.match(svg, /<g data-step="2">/);
});
