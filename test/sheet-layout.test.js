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

// The grid-column span of panel id; no style means it takes 1 column.
const spanOf = (html, id) => {
  const m = html.match(new RegExp(`<section class="am-panel[^"]*" id="panel-${id}"([^>]*)>`));
  assert.ok(m, `panel ${id} must exist`);
  return Number(m[1].match(/grid-column: span (\d+)/)?.[1] ?? 1);
};
// Two short panels follow: a lone panel or a row-end panel is stretched to the full row by fillRows, which would hide automatic spanning.
const FILLERS = '\n\n## B 一\n文字\n\n## C 二\n文字';
const render = (head, body) => renderDoc(`---\n${head}\n---\n${body}${FILLERS}`).html;

test('sheet: a 5-column table without span fills a whole row', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(5)}`), 'A'), 3);
});

test('sheet: a 4-column table takes 2 columns', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(4)}`), 'A'), 2);
});

test('sheet: a table with 3 or fewer columns keeps 1 column and the layout is unchanged', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比\n${table(3)}`), 'A'), 1);
});

test('sheet: an explicit span from the author is not adjusted', () => {
  assert.equal(spanOf(render('cols: 3', `## A 对比 {span=1}\n${table(5)}`), 'A'), 1);
});

test('sheet: automatic spanning never exceeds cols', () => {
  assert.equal(spanOf(render('cols: 2', `## A 对比\n${table(6)}`), 'A'), 2);
});

test('sheet: a diagram much wider than one column is widened', () => {
  const html = render('cols: 3', `## A 流程\n\`\`\`flow LR\n${WIDE_FLOW}\n\`\`\``);
  assert.ok(spanOf(html, 'A') >= 2);
});

test('sheet: a narrow diagram keeps 1 column', () => {
  const html = render('cols: 3', '## A 流程\n```sequence\nClient -> Server: SYN\nServer --> Client: ACK\n```');
  assert.equal(spanOf(html, 'A'), 1);
});

test('sheet: after a widened panel, the row-end panel still fills the row', () => {
  const html = render('cols: 3', `## A 对比\n${table(5)}`);
  assert.deepEqual(['A', 'B', 'C'].map((id) => spanOf(html, id)), [3, 1, 2]);
});

// At phone width, tables and diagrams no longer shrink: the outer overflow-x: auto scrolls them sideways.
// Checked in a browser at 390px: 5-column table cells are >= 66px and diagrams keep their size. This test only guards the rules from removal.
test('base.css: at 760px or less, table cells have a minimum width and diagrams do not shrink with the container', async () => {
  const { BASE_CSS } = await import('../src/assets.js');
  const narrow = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 760px)'));
  const block = narrow.slice(0, narrow.indexOf('\n}') + 2);
  assert.match(block, /\.am-md th,\s*\.am-md td\s*\{[^}]*min-width:\s*6em/);
  assert.match(block, /\.am-diagram svg\s*\{[^}]*max-width:\s*none/);
});

// The layout script reads the author's width hint from data-span. The inline grid-column written by the
// server (automatic spans, row filling) is only the no-JavaScript fallback and must not be mistaken for a hint.
const panelTag = (html, id) => html.match(new RegExp(`<section class="am-panel[^"]*" id="panel-${id}"[^>]*>`))[0];

test('sheet: data-span carries only what the author wrote; rows stays a plain-grid style', () => {
  const html = renderDoc('---\ncols: 4\n---\n## A 宽 {span=2 rows=3}\n文字\n\n## B 默认\n文字\n\n## C 一列 {span=1}\n文字').html;
  assert.match(panelTag(html, 'A'), /data-span="2"/);
  assert.match(panelTag(html, 'A'), /grid-row: span 3/);
  assert.doesNotMatch(panelTag(html, 'A'), /data-rows/);
  assert.doesNotMatch(panelTag(html, 'B'), /data-span/);
  assert.match(panelTag(html, 'C'), /data-span="1"/);
});

test('sheet: spans added by the server (row filling, wide tables) are not rendered as hints', () => {
  const html = render('cols: 3', `## A 对比\n${table(5)}`);
  assert.match(panelTag(html, 'A'), /grid-column: span 3/);
  for (const id of ['A', 'B', 'C']) assert.doesNotMatch(panelTag(html, id), /data-span/, `panel ${id}`);
  const filled = renderDoc('---\ncols: 3\n---\n## A 一\n文字\n\n## B 二\n文字\n\n## C 三\n文字\n\n## D 四\n文字').html;
  assert.match(panelTag(filled, 'D'), /grid-column: span 3/);
  assert.doesNotMatch(panelTag(filled, 'D'), /data-span/);
});

test('sheet: an author span larger than cols is rendered clamped to cols', () => {
  const html = renderDoc('---\ncols: 3\n---\n## A 宽 {span=5}\n文字').html;
  assert.match(panelTag(html, 'A'), /data-span="3"/);
});
