// Change markers (#122, #155): a line in flow, tree or er that starts with "+ ", "- " or "~ " shows what a plan adds, removes and changes.
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
import { parseEr, relationships } from '../src/components/er.js';
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
  assert.match(html, /^<figure class="am-diagram am-flow am-view-changes"><svg/);
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
  assert.match(html, /<li data-key="legacy\/" data-step="5" data-delta="removed"[^>]*>/);
  assert.match(html, /<li data-key="components\/" data-step="1"[^>]*><span class="am-tree-label">components\/<\/span><ul>/);
});

test('tree: children inherit + and -, ~ is not inherited, and the badge shows on every node', () => {
  const html = treeOf(TREE);
  assert.match(html, /<li data-key="old-flow.js" data-step="6" data-delta="removed"[^>]*>/);
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
  assert.match(html, /<li class="am-tree-hi" data-key="New" data-step="1" data-delta="added"[^>]*>/);
  assert.match(html, /am-tree-sub">a note</);
});

test('tree: org chart mode marks the root, columns and boxes, and hides in a view by data-delta alone', () => {
  const html = treeOf('Root\n  + New\n  - Old\n  ~ Same', '');
  assert.match(html, /<div class="am-tree-col" data-delta="added"[^>]*><div class="am-tree-box" data-key="New"[^>]*data-delta="added">/);
  assert.match(html, /<div class="am-tree-col" data-delta="removed"[^>]*>/);
  const gone = treeOf('- Root\n  A\n  B', '');
  assert.match(gone, /<div class="am-tree-root" data-delta="removed"[^>]*><div class="am-tree-box am-tree-box--root"[^>]*data-delta="removed">/);
  assert.match(gone, /<div class="am-tree-col" data-delta="removed"[^>]*>/);
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

test('tree: the view class sits on the tree element when it has markers', () => {
  const html = treeOf(TREE);
  assert.match(html, /^<div class="am-tree am-view-changes">/);
  assert.match(html, /<div class="am-delta-bar">.*<\/div><\/div>$/);
});

test('tree: the labels follow the page language', () => {
  assert.match(render('tree', TREE, 'list', { ui: zh }), /\+1 新增/);
});

// ── er ──
const ER = 'User\n  id PK\n  ~ email varchar(320) UK\n  + phone string\nOrder\n  id PK\n  user_id FK -> User\n  + coupon_id FK -> Coupon\n  - legacy_ref string\n+ Coupon\n  id PK\n  code string UK\n- AuditLog\n  id PK\n  user_id FK -> User\n~ Product\n  id PK';
const erOf = (text, args = '', extra) => render('er', text, args, extra);
const entityStates = (model) => Object.fromEntries([...model.entities.values()].map((e) => [e.name, e.state ?? null]));
const fieldStates = (model, name) => model.entities.get(name).fields.map((x) => [x.name, x.state ?? null]);
const relStates = (text) => relationships(parseEr(text)).map((r) => [r.from, r.to, r.state ?? null]);

test('parseEr: an entity line takes + - or ~, and the marker combines with *', () => {
  const m = parseEr(ER);
  assert.deepEqual(entityStates(m), { User: null, Order: null, Coupon: 'added', AuditLog: 'removed', Product: 'changed' });
  const hi = parseEr('+ *Coupon\n~ *Product\n- AuditLog');
  assert.equal(hi.entities.get('Coupon').hi, true);
  assert.deepEqual(entityStates(hi), { Coupon: 'added', Product: 'changed', AuditLog: 'removed' });
});

test('parseEr: a field marker comes after the indentation; the fields of an added or removed entity inherit its marker, ~ is not inherited', () => {
  const m = parseEr(ER);
  assert.deepEqual(fieldStates(m, 'User'), [['id', null], ['email', 'changed'], ['phone', 'added']]);
  assert.deepEqual(fieldStates(m, 'Order'), [['id', null], ['user_id', null], ['coupon_id', 'added'], ['legacy_ref', 'removed']]);
  assert.deepEqual(fieldStates(m, 'Coupon'), [['id', 'added'], ['code', 'added']]);
  assert.deepEqual(fieldStates(m, 'AuditLog'), [['id', 'removed'], ['user_id', 'removed']]);
  assert.deepEqual(fieldStates(m, 'Product'), [['id', null]]);
  assert.deepEqual(m.entities.get('Order').fields[2], { name: 'coupon_id', type: '', marker: 'FK', ref: 'Coupon', line: 8, state: 'added' });
  assert.deepEqual(fieldStates(parseEr('~ T\n  ~ a\n  b'), 'T'), [['a', 'changed'], ['b', null]]);
});

test('parseEr: marked fields do not mark their entity', () => {
  assert.deepEqual(entityStates(parseEr('User\n  + phone string\n  - legacy string\n  ~ email string')), { User: null });
});

test('parseEr: a field whose marker differs from the marker of its added or removed entity is an error at its line; the same marker is fine', () => {
  const removed = lineError(() => parseEr('- AuditLog\n  id PK\n  + note string'), 3);
  assert.match(removed, /"\+" under the removed entity AuditLog contradicts it/);
  lineError(() => parseEr('+ Coupon\n  - code string'), 2);
  lineError(() => parseEr('+ Coupon\n  ~ code string'), 2);
  assert.deepEqual(fieldStates(parseEr('+ Coupon\n  + code string'), 'Coupon'), [['code', 'added']]);
  assert.deepEqual(fieldStates(parseEr('- Coupon\n  - code string'), 'Coupon'), [['code', 'removed']]);
});

test('parseEr: a relationship line takes + or -, and ~ is an error with the - then + example', () => {
  const m = parseEr('User\nCoupon\nAuditLog\n+ User 1--* Coupon: has\n- User 1--* AuditLog\nUser 1--1 Coupon');
  assert.deepEqual(m.written.map((r) => [r.from, r.to, r.label, r.state ?? null]), [['User', 'Coupon', 'has', 'added'], ['User', 'AuditLog', '', 'removed'], ['User', 'Coupon', '', null]]);
  const msg = lineError(() => parseEr('User\nOrder\n~ User 1--* Order'), 3);
  assert.match(msg, /~ marks an entity or a field, not a relationship/);
  assert.match(msg, /"- A 1--\* B" then "\+ A 1--1 B"/);
});

test('parseEr: a marker needs a space after it; otherwise the line is plain text as before', () => {
  const m = parseEr('User\n  -legacy string\n  +1 votes\n  ~x');
  assert.deepEqual(m.entities.get('User').fields.map((x) => [x.name, x.state ?? null]), [['-legacy', null], ['+1', null], ['~x', null]]);
  assert.deepEqual(entityStates(parseEr('-Old\n+New')), { '-Old': null, '+New': null });
});

test('parseEr: a marked entity written twice, a marked Mermaid line and a bad name are still errors', () => {
  assert.match(errorOf(() => parseEr('User\n+ User')).message, /written twice/);
  assert.match(errorOf(() => parseEr('+ USER ||--o{ ORDER : places')).message, /write \+ USER 1--\* ORDER: places/);
  assert.match(errorOf(() => parseEr('~ USER ||--o{ ORDER')).message, /write USER 1--\* ORDER$/);
  assert.match(errorOf(() => parseEr('+ Order\n  + user_id FK -> Usr')).message, /no entity "Usr"/);
});

test('er relationships: an implied one takes the + or - of its FK field, a ~ field leaves it unmarked', () => {
  const states = (text) => relStates(`${text}\nUser\n  id PK\nCoupon\n  id PK`);
  assert.deepEqual(states('Order\n  + coupon_id FK -> Coupon\n  user_id FK -> User\n  - old_id FK -> User'), [['Order', 'Coupon', 'added'], ['Order', 'User', null], ['Order', 'User', 'removed']]);
  assert.deepEqual(states('Order\n  ~ coupon_id FK -> Coupon'), [['Order', 'Coupon', null]]);
});

test('er relationships: otherwise a relationship is added or removed with an entity at either end', () => {
  const m = 'Order\n  user_id FK -> User\nUser\n  id PK\n+ Coupon\n  order_id FK -> Order\n- AuditLog\n  user_id FK -> User\nOrder 1--* Coupon: used\nAuditLog 1--1 User';
  assert.deepEqual(relStates(m), [['Order', 'User', null], ['Order', 'Coupon', 'added'], ['AuditLog', 'User', 'removed']]);
  assert.deepEqual(relStates('~ A\nB\nA 1--1 B'), [['A', 'B', null]]);
});

test('parseEr: an unmarked relationship line between an added and a removed entity is an error at its line', () => {
  const written = lineError(() => parseEr('+ A\n- B\nA 1--1 B'), 3);
  assert.match(written, /joins the added entity A and the removed entity B, so it exists in neither view/);
  lineError(() => parseEr('+ A\n  id PK\nC\n- B\n  id PK\nC 1--* A\nB 1--* C\nA *--1 B'), 8);
});

test('parseEr: a + relationship cannot touch a removed entity, written or from a + FK field (error at its line)', () => {
  const written = lineError(() => parseEr('User\n- AuditLog\n+ User 1--* AuditLog'), 3);
  assert.match(written, /the \+ relationship User to AuditLog touches the removed entity AuditLog, so it would dangle in the After view/);
  const field = lineError(() => parseEr('- AuditLog\n  id PK\nOrder\n  + log_id FK -> AuditLog'), 4);
  assert.match(field, /touches the removed entity AuditLog/);
  const inherited = lineError(() => parseEr('- AuditLog\n  id PK\n+ Coupon\n  id PK\n  x FK -> AuditLog'), 5);
  assert.match(inherited, /touches the removed entity AuditLog/);
});

test('parseEr: a - relationship cannot touch an added entity, written or from a - FK field (error at its line)', () => {
  const written = lineError(() => parseEr('User\n+ Coupon\n- User 1--* Coupon'), 3);
  assert.match(written, /the - relationship User to Coupon touches the added entity Coupon, so it would dangle in the Before view/);
  const field = lineError(() => parseEr('+ Coupon\n  id PK\nOrder\n  - coupon_id FK -> Coupon'), 4);
  assert.match(field, /touches the added entity Coupon/);
});

test('parseEr: relationships whose markers agree with their ends are fine, including a - field of a removed entity and a replaced FK', () => {
  assert.equal(errorOf(() => parseEr('User\n  id PK\n- AuditLog\n  id PK\n  user_id FK -> User')), null);
  assert.equal(errorOf(() => parseEr('User\n  id PK\n+ Coupon\n  id PK\n  + owner FK -> User\n- User 1--* Order\nOrder')), null);
  assert.equal(errorOf(() => parseEr('A\n- B\n- A 1--1 B')), null);
  assert.equal(errorOf(() => parseEr('A\n+ B\n+ A 1--1 B')), null);
});

test('er relationships: a written line without a marker keeps the state of the FK field it replaces', () => {
  assert.deepEqual(relStates('Order\n  + coupon_id FK -> Coupon\nCoupon\nOrder *--1 Coupon: uses'), [['Order', 'Coupon', 'added']]);
});

test('er relationships: an own marker on a written line wins, and it replaces the implied relationship of the same pair', () => {
  const rels = relationships(parseEr('Order\n  user_id FK -> User\nUser\n- User 1--* Order\n+ User 1--1 Order'));
  assert.deepEqual(rels.map((r) => [r.fromCard, r.toCard, r.state]), [['1', '*', 'removed'], ['1', '1', 'added']]);
});

test('er: the count row counts marked entities, fields and written relationship lines, and an implied relationship is not counted again', () => {
  const html = erOf(ER);
  assert.match(html, /^<figure class="am-diagram am-er am-view-changes"><svg/);
  // added: Coupon + its 2 fields + phone + coupon_id; removed: AuditLog + its 2 fields + legacy_ref; changed: Product + email
  assert.match(html, /<span class="am-delta-count am-delta-count--added">\+5 added<\/span>/);
  assert.match(html, /<span class="am-delta-count am-delta-count--removed">−4 removed<\/span>/);
  assert.match(html, /<span class="am-delta-count am-delta-count--changed">~2 changed<\/span>/);
  assert.match(html, /<span class="am-delta-switch" role="group" aria-label="View" hidden>/);
  const lines = erOf('User\nCoupon\n+ User 1--* Coupon\n- User 1--1 Coupon');
  assert.match(lines, /\+1 added/);
  assert.match(lines, /−1 removed/);
});

test('er: marked entities and relationships carry data-delta and the entity gets a corner badge', () => {
  const html = erOf(ER);
  for (const [state, name] of [['added', 'Coupon'], ['removed', 'AuditLog'], ['changed', 'Product']]) {
    assert.match(html, new RegExp(`<g class="am-node am-node--er" data-key="${name}" data-step="\\d+" data-delta="${state}">`));
  }
  assert.doesNotMatch(html, /data-key="Order"[^>]*data-delta/);
  assert.equal((html.match(/<g class="am-delta-badge am-delta-badge--/g) || []).length, 3);
  assert.match(html, /<g class="am-delta-badge am-delta-badge--removed" data-delta="removed"[^>]*><circle[^>]*\/><text[^>]*>−<\/text><\/g>/);
  assert.equal((html.match(/<g data-step="\d+" data-delta="added"><path class="am-edge"/g) || []).length, 1, 'coupon_id');
  assert.equal((html.match(/<g data-step="\d+" data-delta="removed"><path class="am-edge"/g) || []).length, 1, 'AuditLog user_id');
});

test('er: a self-reference with a marker carries it too', () => {
  const html = erOf('Employee\n  id PK\n+ Employee 1--* Employee: manages');
  assert.match(html, /<g data-step="\d+" data-delta="added"><path class="am-edge"/);
});

test('er: a marked field row has a band, a sign at the start of the row, and data-delta on every part; unmarked rows are untouched', () => {
  const html = erOf('User\n  id PK\n  ~ email string UK\n  + phone string\n  - legacy string');
  assert.equal((html.match(/<rect class="am-er-band" data-delta="(added|removed|changed)"/g) || []).length, 3);
  assert.match(html, /<text class="am-er-sign" data-delta="changed" x="[\d.]+" y="[\d.]+" dominant-baseline="central">~<\/text>/);
  assert.match(html, /<text class="am-er-sign" data-delta="removed"[^>]*>−<\/text>/);
  assert.match(html, /<text class="am-er-field" data-delta="added" style="font-size:12px"[^>]*>[^<]*phone string[^<]*<\/text>/);
  assert.match(html, /<text class="am-er-key am-cluster-label" data-delta="changed"[^>]*>UK<\/text>/);
  assert.match(html, /<text class="am-er-field" style="font-size:12px"[^>]*>id<\/text><text class="am-er-key am-cluster-label"[^>]*>PK<\/text>/, 'the unmarked row has no data-delta');
  assert.equal((html.match(/class="am-er-sign"/g) || []).length, 3);
});

test('er: the fields of an added entity all carry its state', () => {
  const html = erOf('+ Coupon\n  id PK\n  code string');
  assert.equal((html.match(/<rect class="am-er-band" data-delta="added"/g) || []).length, 2);
  assert.match(html, /\+3 added/);
});

test('er: an entity with a marked field makes room for the sign; an entity without one keeps its size', () => {
  const widthOf = (text, name) => Number(erOf(text).match(new RegExp(`data-key="${name}"[^>]*><rect class="am-node-shape" x="[\\d.]+" y="[\\d.]+" width="([\\d.]+)"`))[1]);
  assert.ok(widthOf('User\n  email varchar(320) UK', 'User') < widthOf('User\n  ~ email varchar(320) UK', 'User'));
  assert.equal(widthOf('User\n  email varchar(320) UK\nOrder\n  + id PK', 'User'), widthOf('User\n  email varchar(320) UK', 'User'));
});

test('er: the sign sits at the start of the row, which is the right on a right-to-left page', () => {
  const text = 'User\n  + phone string';
  const at = (html, re) => Number(html.match(re)[1]);
  const ltr = erOf(text, '', { dir: 'ltr' });
  const rtl = erOf(text, '', { dir: 'rtl' });
  const box = (html) => html.match(/<rect class="am-node-shape" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).slice(1).map(Number);
  const [lx, lw] = box(ltr);
  const [rx, rw] = box(rtl);
  const sign = (html) => at(html, /class="am-er-sign"[^>]* x="([\d.]+)"/);
  const name = (html) => at(html, /class="am-er-field"[^>]* x="([\d.]+)"[^>]*>[^<]*phone/);
  assert.ok(sign(ltr) < name(ltr) && sign(ltr) < lx + lw / 2, 'left to right: sign first, on the left');
  assert.ok(sign(rtl) > name(rtl) && sign(rtl) > rx + rw / 2, 'right to left: sign first, on the right');
  assert.ok(Math.abs(sign(rtl) - (rx + rw - 11)) < 0.2);
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
});

test('er: the entity badge sits in the corner opposite the one where reading starts', () => {
  const box = (html) => html.match(/<rect class="am-node-shape" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).slice(1).map(Number);
  const badgeX = (html) => Number(html.match(/class="am-delta-badge[^>]*transform="translate\(([\d.]+),/)[1]);
  const ltr = erOf('+ User\n  id PK', '', { dir: 'ltr' });
  const rtl = erOf('+ User\n  id PK', '', { dir: 'rtl' });
  assert.ok(Math.abs(badgeX(ltr) - (box(ltr)[0] + box(ltr)[1])) < 0.2);
  assert.ok(Math.abs(badgeX(rtl) - box(rtl)[0]) < 0.2);
});

test('er: a diagram without markers has no delta markup', () => {
  const plain = ER.replace(/^[+\-~] /gm, '').replace(/^( {2})[+\-~] /gm, '$1');
  const html = erOf(plain, 'LR');
  assert.doesNotMatch(html, /delta|am-er-band|am-er-sign/);
  assert.match(html, /^<figure class="am-diagram am-er">/);
});

test('er: marked and unmarked layouts place the boxes alike when no field is marked (the view switch moves nothing)', () => {
  const boxes = (h) => [...h.matchAll(/<rect class="am-node-shape" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).join(','));
  assert.deepEqual(boxes(erOf('User\n  id PK\n+ Coupon\n  id PK\nUser 1--* Coupon')), boxes(erOf('User\n  id PK\nCoupon\n  id PK\nUser 1--* Coupon')));
});

test('er: the labels follow the page language', () => {
  const html = erOf(ER, '', { ui: zh });
  assert.match(html, /\+5 新增/);
  assert.match(html, /−4 删除/);
  assert.match(html, /~2 修改/);
});

// ── page and video ──
const page = (fence) => `---\ntitle: T\nlang: en\n---\n## A Panel\n${fence}\n`;

test('page: the delta styles and script come only with a page that has markers', () => {
  const marked = renderDoc(page(`\`\`\`flow\n${FLOW}\n\`\`\``)).html;
  const plain = renderDoc(page('```flow\nA -> B\n```')).html;
  assert.match(marked, /\.am-view-before \[data-delta="added"\]/);
  assert.match(marked, /\.am-delta-switch/);
  assert.doesNotMatch(plain, /data-delta|am-delta/);
  assert.equal(pageCss(undefined, {}).includes('data-delta'), false);
});

test('page: a tree with markers brings the same styles and script', () => {
  assert.match(renderDoc(page(`\`\`\`tree\n${TREE}\n\`\`\``)).html, /\.am-view-after \[data-delta="removed"\]/);
});

test('page: an er with markers brings the same styles and script, and an er without does not', () => {
  const marked = renderDoc(page(`\`\`\`er\n${ER}\n\`\`\``)).html;
  assert.match(marked, /\.am-view-after \[data-delta="removed"\]/);
  assert.match(marked, /\.am-er-band/);
  assert.match(marked, /am-view-changes/);
  assert.doesNotMatch(renderDoc(page('```er\nUser\n  id PK\n```')).html, /data-delta|am-delta|am-er-band/);
});

test('page: the view switch script swaps the am-view class of its diagram and the pressed button', () => {
  const { html } = renderDoc(page(`\`\`\`flow\n${FLOW}\n\`\`\``));
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  assert.match(script, /\.am-delta-switch/);
  assert.match(script, /am-view-\$\{/);
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

test('video: a marked er scene keeps its colors, badges and count row, with no switch', async () => {
  const src = `---\ntitle: T\nlang: en\n---\n> Intro.\n\n## First\n\`\`\`er\n${ER}\n\`\`\`\n> One line.\n`;
  const { html } = await renderVideo(src);
  assert.match(html, /data-delta="added"/);
  assert.match(html, /am-delta-badge/);
  assert.match(html, /class="am-er-band" data-delta=/);
  assert.match(html, /\+5 added/);
  assert.doesNotMatch(html, /data-view=/);
  assert.match(html, /\.am-er-band/);
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
    assert.match(html, /\.am-view-before \[data-delta="added"\]/);
    assert.match(html, /New text\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: am help er documents the markers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-delta-'));
  try {
    const r = await run(dir, ['help', 'er']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Change markers/);
    assert.match(r.out, /Before \/ Changes \/ After/);
    assert.match(r.out, /\+ coupon_id FK -> Coupon/);
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

// ── only the Changes view is styled ──
const cssOf = () => pageCss(undefined, { delta: true }).split('/* Change markers')[1];
const rules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

test('delta css: every color, strike-through, fade and arrowhead rule is scoped to the Changes view', () => {
  const styled = rules(cssOf()).filter((r) => /data-delta="(added|removed|changed)"|am-arrow--/.test(r.selector) && /stroke|fill|color|opacity|text-decoration/.test(r.body));
  assert.ok(styled.length > 10);
  for (const r of styled) {
    for (const sel of r.selector.split(',').map((s) => s.trim())) {
      if (/am-view-(before|after)/.test(sel) && /visibility: hidden/.test(r.body)) continue;
      assert.match(sel, /^\.am-view-changes /, `not scoped to the Changes view: ${sel}`);
    }
  }
});

test('delta css: Before hides added items and badges, After hides removed items and badges, and nothing leaves the layout', () => {
  const css = cssOf();
  assert.match(css, /\.am-view-before \[data-delta="added"\], \.am-view-after \[data-delta="removed"\] \{ visibility: hidden; \}/);
  assert.match(css, /\.am-view-before \.am-delta-badge, \.am-view-after \.am-delta-badge \{ visibility: hidden; \}/);
  assert.doesNotMatch(css, /display: none[^}]*\}\s*\n?[^{}]*data-delta="/);
  const rule = rules(css).find((r) => /\.am-tree-label > \.am-delta-badge/.test(r.selector) && /display: none/.test(r.body));
  assert.ok(rule, 'a list label badge takes no space in Before and After');
  assert.match(rule.selector, /\.am-view-before[^,]*,\s*\.am-view-after/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.am-tree-box > \.am-delta-badge[^{]*\{[^}]*display: none/);
});

// ── connector lines in a view that hides siblings ──
// The data-line-* hooks of the list item or column that holds the node `key`.
const hooks = (html, key) => {
  const tag = html.match(new RegExp(`<li[^>]*data-key="${key}"[^>]*>`)) ?? html.match(new RegExp(`<div class="am-tree-col"[^>]*>(?=<div class="am-tree-box[^"]*" data-key="${key}")`));
  assert.ok(tag, `no node ${key}`);
  return [...tag[0].matchAll(/data-line-(?:before|after)="\w+"/g)].map((m) => m[0]).join(' ');
};

test('tree list: the sibling before a hidden last sibling ends its line in that view, and a hidden sibling keeps the line whole', () => {
  const html = treeOf('A\n  p\n  + q\n  r\n  - s', 'list');
  assert.equal(hooks(html, 'p'), '');
  assert.equal(hooks(html, 'q'), '', 'before: q is hidden, the line still runs through its place');
  assert.equal(hooks(html, 'r'), 'data-line-after="short"', 'after: s is gone, r is the last one left');
  assert.equal(hooks(html, 's'), 'data-line-after="none"');
  const added = treeOf('A\n  p\n  + q', 'list');
  assert.equal(hooks(added, 'p'), 'data-line-before="short"');
  assert.equal(hooks(added, 'q'), 'data-line-before="none"');
});

test('tree list: the children of a hidden node draw no line in that view', () => {
  const html = treeOf('A\n  p\n  - b\n    c\n    d', 'list');
  assert.equal(hooks(html, 'p'), 'data-line-after="short"');
  assert.equal(hooks(html, 'b'), 'data-line-after="none"');
  assert.equal(hooks(html, 'c'), 'data-line-after="none"');
  assert.equal(hooks(html, 'd'), 'data-line-after="none"');
});

test('tree org chart: the bar over the columns runs from the first to the last column that stays', () => {
  const html = treeOf('Root\n  + a\n  b\n  - c\n  d', '');
  assert.equal(hooks(html, 'a'), 'data-line-before="none"');
  assert.equal(hooks(html, 'b'), 'data-line-before="start"');
  assert.equal(hooks(html, 'c'), '', 'a hidden column between two that stay keeps its stretch of the bar');
  assert.equal(hooks(html, 'd'), '');
  const end = treeOf('Root\n  a\n  b\n  + c', '');
  assert.equal(hooks(end, 'b'), 'data-line-before="end"');
  assert.equal(hooks(end, 'c'), 'data-line-before="none"');
});

test('tree columns of several roots follow the same rule', () => {
  const html = treeOf('x\n- y\n+ z', '');
  assert.equal(hooks(html, 'x'), '');
  assert.equal(hooks(html, 'y'), 'data-line-before="end"');
  assert.equal(hooks(html, 'z'), 'data-line-before="none"');
});

test('tree org chart: the line from a root has nothing to reach in a view that hides every column', () => {
  assert.match(treeOf('Root\n  + a\n  + b', ''), /<div class="am-tree-root" data-line-before="none">/);
  assert.match(treeOf('Root\n  - a\n  - b', ''), /<div class="am-tree-root" data-line-after="none">/);
});

test('tree: a tree without markers has no connector hooks', () => {
  for (const args of ['list', '']) assert.doesNotMatch(treeOf('Root\n  a\n  b\n    c\n    d\n  e', args), /data-line/);
});

test('delta css: the connector hooks redraw the stretches in Before and After', () => {
  const css = cssOf();
  for (const view of ['before', 'after']) {
    for (const kind of ['full', 'short', 'none']) assert.match(css, new RegExp(`\\.am-view-${view} \\.am-tree-list li\\[data-line-${view}="${kind}"\\]::after`));
    for (const kind of ['full', 'start', 'end', 'none']) assert.match(css, new RegExp(`\\.am-view-${view} \\.am-tree-col\\[data-line-${view}="${kind}"\\]::before`));
  }
});

test('delta css: er rows are tinted, colored and signed in the Changes view only, and Before and After hide the bands and signs without moving anything', () => {
  const css = cssOf();
  for (const [state, tone] of [['added', 'ok'], ['removed', 'err'], ['changed', 'warn']]) {
    assert.match(css, new RegExp(`\\.am-view-changes \\.am-er-band\\[data-delta="${state}"\\] \\{ fill: var\\(--${tone}-bg\\); \\}`));
    for (const part of ['sign', 'field', 'key']) assert.match(css, new RegExp(`\\.am-view-changes \\.am-er-${part}\\[data-delta="${state}"\\][^{]*\\{ fill: var\\(--${tone}\\); \\}`));
  }
  const hide = rules(css).find((r) => /\.am-er-band/.test(r.selector) && /visibility: hidden/.test(r.body));
  assert.ok(hide);
  for (const sel of ['.am-view-before .am-er-band', '.am-view-after .am-er-band', '.am-view-before .am-er-sign', '.am-view-after .am-er-sign']) assert.ok(hide.selector.includes(sel), sel);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.am-er[^{]*\{[^}]*display: none/);
});
