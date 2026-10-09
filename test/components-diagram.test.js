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
  const implied = relationships(parseEr('Order\n  id PK\n  user_id FK -> User\nUser\n  id PK'));
  assert.deepEqual(implied.map((r) => [r.from, r.fromCard, r.to, r.toCard]), [['Order', '*', 'User', '1']]);
  const replaced = relationships(parseEr('Order\n  user_id FK -> User\nUser\n  id PK\nUser 1--* Order: places'));
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
  assert.match(erThrows('  id PK').message, /must follow an entity/);
  assert.match(erThrows('User\n  id PK -> Order').message, /only a FK field/);
  assert.match(erThrows('User\n  x -> Order').message, /only a FK field/);
  assert.match(erThrows('User\n  id FK ->').message, /write the entity a field points at/);
  assert.match(erThrows('User\n  id PK int').message, /must be the last word before/);
  assert.match(erThrows('User\nUser').message, /written twice/);
  assert.equal(erThrows('   ').message, 'an entity relationship diagram needs at least one entity (a line at column 0)');
});

test('er: a name a field or a relationship does not name is an error, not a broken drawing', () => {
  const fk = erThrows('Order\n  user_id FK -> Usr');
  assert.match(fk.message, /no entity "Usr"; write it at column 0/);
  assert.equal(fk.line, 2);
  assert.match(erThrows('User\nOrder\nUser 1--* Ordr').message, /no entity "Ordr"; write it at column 0/);
  assert.equal(erThrows('Order\n  user_id FK -> User\nUser\n  id PK\nUser 1--* Order'), null, 'a name that exists parses');
});

test('er: a Mermaid line is an error that shows the line to write instead', () => {
  assert.match(erThrows('USER ||--o{ ORDER : places').message, /is Mermaid syntax; write USER 1--\* ORDER: places/);
  assert.match(erThrows('USER }|..|{ ORDER').message, /write USER 1\.\.\*--1\.\.\* ORDER/);
  assert.match(erThrows('USER |o--|| ORDER').message, /write USER 0\.\.1--1 ORDER/);
  assert.match(erThrows('USER {').message, /is not an entity of this component/);
  assert.match(erThrows('}').message, /is not an entity of this component/);
});

test('er: two FK fields to one entity draw two relationships, and a written line replaces both', () => {
  const body = 'Order\n  billing_id FK -> Address\n  shipping_id FK -> Address\nAddress\n  id PK';
  assert.deepEqual(relationships(parseEr(body)).map((rel) => [rel.from, rel.to, rel.line]), [['Order', 'Address', 2], ['Order', 'Address', 3]]);
  assert.equal((render('er', body).match(/<path class="am-edge"/g) || []).length, 2);
  const written = relationships(parseEr(`${body}\nOrder *--1 Address: billed`));
  assert.equal(written.length, 1);
  assert.equal(written[0].label, 'billed');
});

test('er: a field that points at its own entity draws a loop that stays inside the drawing', () => {
  const svg = render('er', 'Employee\n  id PK\n  manager_id FK -> Employee');
  assert.doesNotMatch(svg, /NaN/);
  const [, left, width] = svg.match(/class="am-node-shape" x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"/).map(Number);
  const right = left + width;
  const loop = svg.match(/<path class="am-edge" d="M([\d.]+),([\d.]+) C([\d.]+),[\d.]+ ([\d.]+),[\d.]+ ([\d.]+),([\d.]+)"/).map(Number);
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
  assert.ok(Math.abs(loop[1] - right) < 0.2, 'the loop starts on the right edge of the box');
  assert.ok(loop[3] > right, 'and bulges outside it');
  assert.ok(loop[3] === loop[4], 'out and back with the same control point');
  assert.ok(view[1] >= loop[3] + 6, 'the drawing is wide enough to hold the loop');
  assert.equal((svg.match(/class="am-er-end/g) || []).length, 2, 'both ends of the self-reference are drawn');
  // Two self-references of one entity take their own distance, so both stay visible.
  const both = render('er', 'Employee\n  manager_id FK -> Employee\n  mentor_id FK -> Employee');
  const outs = [...both.matchAll(/<path class="am-edge" d="M[\d.]+,[\d.]+ C([\d.]+),/g)].map((m) => Number(m[1]));
  assert.equal(outs.length, 2);
  assert.ok(outs[1] > outs[0], 'the second loop goes farther out');
});

test('er: a box fits its widest field at the size the field renders, and a highlighted one is measured bold', () => {
  const field = 'shipping_address_reference bigint';
  const svg = render('er', `*Address\n  ${field} UK\nPlain\n  ${field} UK`);
  const boxes = [...svg.matchAll(/class="am-node-shape" x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"/g)].map((m) => Number(m[2]));
  assert.equal(boxes.length, 2);
  // 11px of padding on each side, then the 12px gap the FK/UK marker leaves; the fields render at 12px because the size
  // is set in the style attribute, which the stylesheet cannot override.
  const fits = (width, bold) => 11 + measure('shipping_address_reference', 12, { bold }) + 12 + measure('UK', 11, { mono: true, bold }) <= width - 11;
  assert.match(svg, /class="am-er-field" style="font-size:12px"/);
  assert.ok(fits(boxes[0], true), 'the highlighted entity is measured with bold text');
  assert.ok(fits(boxes[1], false));
  assert.ok(boxes[0] > boxes[1], 'bold text needs a wider box');
});

test('er: the canvas is finite and holds what is drawn, parallel edges and their labels included', () => {
  const bodies = [
    'Order\n  billing_id FK -> Address\n  shipping_id FK -> Address\nAddress\n  id PK',
    'A\nB\nA 0..1--* B: many',
    'Employee\n  manager_id FK -> Employee\n  mentor_id FK -> Employee',
    'A\n  id PK\n  self_id FK -> A\nA 1--1..* A: again',
  ];
  for (const body of bodies) {
    const svg = render('er', body);
    assert.doesNotMatch(svg, /NaN/, body);
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
    assert.ok(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0, `a finite canvas: ${w}x${h}`);
    // The drawing may carry a shift that keeps the origin at 0; every point still has to land inside the canvas.
    const shift = svg.match(/transform="translate\(([\d.-]+),([\d.-]+)\)"/);
    const [dx, dy] = shift ? [Number(shift[1]), Number(shift[2])] : [0, 0];
    for (const m of svg.matchAll(/<path class="am-edge" d="M([\d.]+),([\d.]+)/g)) {
      const [x, y] = [Number(m[1]) + dx, Number(m[2]) + dy];
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `a path starts inside the canvas: ${x},${y} of ${w}x${h}`);
    }
    for (const m of svg.matchAll(/<rect class="am-node-shape" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) {
      const [, x, y, bw, bh] = m.map(Number);
      assert.ok(x + dx >= 0 && y + dy >= 0 && x + bw + dx <= w && y + bh + dy <= h, 'a box is inside the canvas');
    }
    for (const m of svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="18"/g)) {
      const [, x, y, bw] = m.map(Number);
      assert.ok(x + dx >= 0 && x + bw + dx <= w, 'an edge label is inside the canvas');
    }
  }
});

test('er: video mode gives every entity and relationship its own step', () => {
  const svg = COMPONENTS.get('er').render(ER, { args: '', uid: () => 'u1', video: true });
  assert.match(svg, /class="am-node am-node--er am-node--hi" data-key="User" data-step="0"/);
  assert.match(svg, /class="am-node am-node--er" data-key="Order" data-step="1"/);
  assert.match(svg, /<g data-step="2">/);
});

// ── er on a right-to-left page ──
const erDir = (text, args, dir) => COMPONENTS.get('er').render(text, { args, uid: () => 'u1', ui: {}, dir });
const boxes = (svg) => [...svg.matchAll(/class="am-node-shape" x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
// The x of the text with this content, ignoring the left-to-right isolate marks (U+2066, U+2069) svgLine adds.
const textX = (svg, content) => Number(svg.match(new RegExp(`<text [^>]*? x="([\\d.-]+)"[^>]*>(?:\\u2066)?${content}(?:\\u2069)?</text>`))[1]);

test('er: a right-to-left page draws the mirror image, with direction="rtl" on the svg', () => {
  const ltr = erDir(ER, 'LR', 'ltr');
  const rtl = erDir(ER, 'LR', 'rtl');
  assert.equal(erDir(ER, 'LR', undefined), ltr, 'no page direction renders as before');
  assert.doesNotMatch(ltr, /direction=/);
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  const [a, b] = [boxes(ltr), boxes(rtl)];
  const [w] = viewBox(rtl);
  assert.equal(b.length, a.length);
  a.forEach(([x, width], i) => {
    assert.equal(b[i][1], width, 'the box keeps its width');
    // The viewBox rounds the drawing width up, so the mirror image is within one pixel.
    assert.ok(Math.abs(b[i][0] + width - (w - x)) <= 1, `box ${i} is the mirror image`);
  });
  assert.ok(a[0][0] < a[1][0] && b[0][0] > b[1][0], 'LR runs right to left');
});

test('er: on a right-to-left page a field name sits at the right edge of its box and the key marker at the left one', () => {
  const body = 'משתמש\n  id PK\nהזמנה\n  user_id FK -> משתמש';
  const ltr = erDir(body, '', 'ltr');
  const rtl = erDir(body, '', 'rtl');
  assert.deepEqual(boxes(rtl).map(([, width]) => width), boxes(ltr).map(([, width]) => width), 'the box width does not depend on the direction');
  const [left, width] = boxes(rtl)[1];
  // The svg's direction turns text-anchor "start" into the right end of the text: the name runs left from the right edge,
  // the marker (anchor "end") runs right from the left edge.
  assert.equal(textX(rtl, 'user_id'), left + width - 11);
  assert.equal(textX(rtl, 'FK'), left + 11);
  assert.equal(textX(rtl, 'הזמנה'), left + width - 11);
  assert.match(rtl, /\u2066user_id\u2069/, 'a Latin field name is isolated left to right so it stays inside the box');
  const [l, w] = boxes(ltr)[1];
  assert.equal(textX(ltr, 'user_id'), l + 11);
  assert.equal(textX(ltr, 'FK'), l + w - 11);
});

test('er: on a right-to-left page a self-reference loops out of the left side and stays inside the drawing', () => {
  const body = 'Employee\n  id PK\n  manager_id FK -> Employee\nEmployee 0..1--* Employee: reports to';
  const rtl = erDir(body, '', 'rtl');
  assert.doesNotMatch(rtl, /NaN/);
  const [left] = boxes(rtl)[0];
  const loop = rtl.match(/<path class="am-edge" d="M([\d.-]+),([\d.-]+) C([\d.-]+),[\d.-]+ ([\d.-]+),[\d.-]+ ([\d.-]+),([\d.-]+)"/).map(Number);
  assert.ok(Math.abs(loop[1] - left) < 0.2, 'the loop starts on the left edge of the box');
  assert.ok(loop[3] < left, 'and bulges outside it');
  assert.equal(loop[3], loop[4], 'out and back with the same control point');
  const label = rtl.match(/<g class="am-edge-label"><rect x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"/).slice(1).map(Number);
  // The drawing is shifted so that its leftmost point lands on the margin.
  const shift = Number(rtl.match(/<g transform="translate\(([\d.-]+),/)?.[1] ?? 0);
  assert.ok(label[0] + shift >= 0, 'the drawing is wide enough to hold the loop and its label');
  assert.ok(label[0] + label[1] < loop[3], 'the label lies beyond the loop');
  assert.ok(left + boxes(rtl)[0][1] + shift <= viewBox(rtl)[0], 'and the box fits on the right');
  // The end marks are drawn outside the left border.
  const ends = [...rtl.matchAll(/<g class="am-er-end am-edge">(.*?)<\/g>/g)];
  assert.equal(ends.length, 2);
  for (const [, marks] of ends) for (const m of marks.matchAll(/(?:x1|x2|cx)="([\d.-]+)"/g)) assert.ok(Number(m[1]) <= left + 0.01);
});
