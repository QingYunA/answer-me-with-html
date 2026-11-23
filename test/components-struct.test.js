import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { niceScale } from '../src/components/limits.js';

const ctx = (args = '') => ({ args, uid: () => 'u1' });
const render = (name, text, args) => COMPONENTS.get(name).render(text, ctx(args));
const throwsAt = (fn, line) =>
  assert.throws(fn, (e) => e instanceof ComponentError && e.line === line);

const STE_TREE = `ASD-STE100 | Simplified Technical English
  Part 1: Writing rules
    \`Section 1\` Words
    \`Section 2\` Noun clusters
  *Part 2: Dictionary
    Approved words | 大写关键词，一词一义
      子项`;

// ── tree ──
test('tree: one root + 2 to 4 children uses org-chart mode (root box + columns + child lists)', () => {
  const html = render('tree', STE_TREE);
  assert.match(html, /am-tree-box am-tree-box--root"[^>]*>ASD-STE100<small>Simplified Technical English<\/small>/);
  assert.match(html, /am-tree-cols" style="--n: 2"/);
  assert.match(html, /<span class="am-tree-tag">Section 1<\/span> Words/);
  assert.match(html, /am-tree-sub">大写关键词，一词一义/);
  assert.match(html, /<li[^>]*><span class="am-tree-label">子项<\/span><\/li>/, 'the third level nests as a sub-list');
});

test('tree: the * prefix highlights a node', () => {
  assert.match(render('tree', STE_TREE), /am-tree-box am-tree-box--hi"[^>]*>Part 2: Dictionary/);
});

test('tree: the list argument or more than 4 children uses plain list mode', () => {
  assert.match(render('tree', STE_TREE, 'list'), /am-tree-root--solo/);
  const wide = `根\n${['a', 'b', 'c', 'd', 'e'].map((x) => `  ${x}`).join('\n')}`;
  const html = render('tree', wide);
  assert.doesNotMatch(html, /am-tree-cols/);
  assert.match(html, /am-tree-list/);
});

test('tree: several roots show side by side without a root box', () => {
  const html = render('tree', '甲\n  a\n乙\n  b');
  assert.match(html, /am-tree-cols am-tree-cols--free" style="--n: 2"/);
  assert.doesNotMatch(html, /am-tree-box--root/);
});

test('tree: a tab indent equals two spaces', () => {
  const html = render('tree', '根\n\t子1\n\t子2');
  assert.match(html, /--n: 2/);
});

test('tree: a long unbroken label or note can wrap after . @ / _ :, and tags, attributes and entities stay intact', () => {
  const html = render('tree', '出口 1 · 216.36.88.169 | 2 个 pro100\n  家宽 2serein7z@163.com | https://a.example.com/very/long_path\n  Tom&Jerry-and-friends.txt\n    short.txt | a.b');
  assert.match(html, /216\.<wbr>36\.<wbr>88\.<wbr>169/, 'an IP breaks after its dots');
  assert.match(html, /2serein7z@<wbr>163\.<wbr>com<\/a>/, 'an email breaks after @ and the dot');
  assert.match(html, /<a href="mailto:2serein7z@163\.com">/, 'the autolink target has no break');
  assert.match(html, /<a href="https:\/\/a\.example\.com\/very\/long_path">/, 'a link target has no break');
  assert.match(html, /https:\/\/<wbr>a\.<wbr>example\.<wbr>com\/<wbr>very\/<wbr>long_<wbr>path/, 'a URL note breaks after its separators');
  assert.match(html, /Tom&amp;Jerry-and-friends\.<wbr>txt/, 'an entity is not split');
  assert.match(html, /<li[^>]*><span class="am-tree-label">short\.txt<\/span><span class="am-tree-sub">a\.b<\/span>/, 'a short word gets no break');
  assert.match(html, /data-key="出口 1 · 216\.36\.88\.169"/, 'the video key keeps the raw label');
  assert.doesNotMatch(html, /<[^>]*<wbr>[^>]*>/, 'no break inside a tag');
  const quoted = render('tree', '根\n  <a href="https://example.com/a>b/long_resource">Download</a>');
  assert.match(quoted, /href="https:\/\/example\.com\/a>b\/long_resource"/, 'a quoted > in an attribute does not end the tag');
});

test('tree: error on empty content', () => {
  throwsAt(() => render('tree', '\n  \n'), 1);
});

// ── limits ──
test('niceScale: the axis maximum is rounded up with headroom, at most 7 ticks', () => {
  assert.deepEqual(niceScale(20), { max: 30, step: 5 });
  assert.deepEqual(niceScale(6), { max: 10, step: 2 });
  assert.deepEqual(niceScale(3), { max: 5, step: 1 });
  for (const v of [1, 7, 13, 99, 1234]) {
    const { max, step } = niceScale(v);
    assert.ok(max >= v * 1.2 && max / step <= 7, `v=${v} → ${max}/${step}`);
  }
});

test('limits: value / limit → fill width, limit mark, unit', () => {
  const html = render('limits', '程序性句子 | 13 / 20 | words');
  assert.match(html, /am-lim-fill" style="width: 43.33%"/);
  assert.match(html, /am-lim-mark" style="left: 66.67%"/);
  assert.match(html, /am-lim-val">13 \/ max 20 words/);
});

test('limits: a limit alone fills to the limit; the max prefix is supported', () => {
  const html = render('limits', '名词簇 | max 3 | words');
  assert.match(html, /am-lim-fill" style="width: 60%"/);
  assert.match(html, /am-lim-val">max 3 words/);
});

test('limits: over the limit is marked red; the fourth column is a note', () => {
  const html = render('limits', '段落句数 | 8 / 6 | 句 | 例外：列表');
  assert.match(html, /am-lim is-over/);
  assert.match(html, /am-lim-note">例外：列表/);
});

test('limits: the scale includes 0 and the limit', () => {
  const html = render('limits', 'x | 20');
  assert.match(html, /<span style="left: 0%">0<\/span>/);
  assert.match(html, /<span style="left: 100%">30<\/span>/);
});

test('limits: 0 / 0 and max 0 render, and the scale step is greater than 0', { timeout: 2000 }, () => {
  assert.deepEqual(niceScale(0), { max: 1, step: 1 });
  assert.equal(niceScale(-3).step > 0, true);
  assert.match(render('limits', 'x | 0 / 0'), /am-lim/);
  assert.match(render('limits', 'y | max 0'), /am-lim-val">max 0/);
  assert.doesNotMatch(render('limits', 'x | 0 / 0'), /NaN|Infinity/);
});

test('limits: a non-number or a missing column is an error', () => {
  throwsAt(() => render('limits', 'a | 1 / 2\nb | 很多'), 2);
  throwsAt(() => render('limits', '只有标签'), 1);
});

test('niceScale: an integer limit uses only integer ticks', () => {
  assert.deepEqual(niceScale(1), { max: 2, step: 1 });
  assert.deepEqual(niceScale(2), { max: 3, step: 1 });
});

test('tree: a label that is all inline code keeps the code style', () => {
  assert.match(render('tree', '根\n  `bin/am.js` | 入口\n  `src/`', 'list'), /<span class="am-tree-label"><code>bin\/am.js<\/code><\/span>/);
});
