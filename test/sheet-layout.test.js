import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';

const table = (n) => {
  const row = (cell) => `| ${Array.from({ length: n }, (_, i) => `${cell}${i + 1}`).join(' | ')} |`;
  return [row('列'), `|${'---|'.repeat(n)}`, row('值')].join('\n');
};
const WIDE_FLOW = [
  '(对话) -> to-spec: 整理成规格',
  'to-spec -> to-tickets: 拆成带依赖的票',
  'to-tickets -> implement-spec: 并行实现整个规格',
].join('\n');

// 取面板 id 对应的 grid-column 跨度；没有 style 说明只占 1 列。
const spanOf = (html, id) => {
  const m = html.match(new RegExp(`<section class="am-panel[^"]*" id="panel-${id}"([^>]*)>`));
  assert.ok(m, `panel ${id} 应存在`);
  return Number(m[1].match(/grid-column: span (\d+)/)?.[1] ?? 1);
};
// 后面跟两个短面板：只有一个面板或行尾面板时，fillRows 会把它拉满整行，测不出自动跨列。
const FILLERS = '\n\n## B 一\n文字\n\n## C 二\n文字';
const render = (head, body) => renderDoc(`---\n${head}\n---\n${body}${FILLERS}`).html;

test('sheet: 5 列表格没写 span 时自动占满一行', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(5)}`), 'A'), 3);
});

test('sheet: 4 列表格自动占 2 列', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(4)}`), 'A'), 2);
});

test('sheet: 3 列及以下的表格保持 1 列，布局不变', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(3)}`), 'A'), 1);
});

test('sheet: 作者显式写了 span 就不自动调整', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比 {span=1}\n${table(5)}`), 'A'), 1);
});

test('sheet: 自动跨列不超过 cols', () => {
  assert.equal(spanOf(render('cols: 2', `## A 对比\n${table(6)}`), 'A'), 2);
});

test('sheet: 画布比一列宽得多的图自动加宽', () => {
  const html = render('cols: 3', `## A 流程\n\`\`\`flow LR\n${WIDE_FLOW}\n\`\`\``);
  assert.ok(spanOf(html, 'A') >= 2);
});

test('sheet: 窄图保持 1 列', () => {
  const html = render('cols: 3', '## A 流程\n```sequence\nClient -> Server: SYN\nServer --> Client: ACK\n```');
  assert.equal(spanOf(html, 'A'), 1);
});

test('sheet: 自动加宽的面板之后，行尾面板仍拉满整行', () => {
  const html = render('cols: 3', `## A 对比\n${table(5)}`);
  assert.deepEqual(['A', 'B', 'C'].map((id) => spanOf(html, id)), [3, 1, 2]);
});
