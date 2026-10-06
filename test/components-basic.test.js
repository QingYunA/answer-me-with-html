import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';

const ctx = (args = '') => ({ args, uid: (() => { let n = 0; return () => `u${++n}`; })() });
const render = (name, text, args) => COMPONENTS.get(name).render(text, ctx(args));
const throwsAt = (fn, line) =>
  assert.throws(fn, (e) => e instanceof ComponentError && e.line === line);

test('every component provides name / summary / syntax / example, and the example renders', () => {
  assert.ok(COMPONENTS.size >= 4);
  for (const [name, c] of COMPONENTS) {
    for (const key of ['summary', 'syntax', 'example']) assert.ok(c[key], `${name}.${key}`);
    const m = c.example.match(/^```(\S+)[ \t]*(.*)\n([\s\S]*?)\n```$/);
    assert.ok(m, `${name}.example must be one complete fenced block`);
    assert.equal(m[1], name);
    assert.ok(c.render(m[3], ctx(m[2])).length > 0);
  }
});

// ── callout ──
test('callout: type + title + markdown body', () => {
  const html = render('callout', '先 **关闭** 阀门。', 'warn 注意');
  assert.match(html, /am-callout am-callout--warn/);
  assert.match(html, /am-callout-title">注意/);
  assert.match(html, /<strong>关闭<\/strong>/);
});

test('callout: when the first argument is not a type, it is all title and the type defaults to info', () => {
  const html = render('callout', '正文', '核心结论');
  assert.match(html, /am-callout--info/);
  assert.match(html, /核心结论/);
});

test('callout: error when both title and body are empty', () => {
  throwsAt(() => render('callout', '  ', ''), 1);
});

// ── kv ──
test('kv: key-value pairs, split at the first colon, fullwidth colon, * wide cell, cols argument', () => {
  const html = render('kv', '* Title: STE: overview\nOwner：ASD\nSheet: 1 of 1', 'cols=3');
  assert.match(html, /--kv-cols: 3/);
  assert.match(html, /am-kv-cell--wide"><dt>Title<\/dt><dd>STE: overview<\/dd>/);
  assert.match(html, /<dt>Owner<\/dt><dd>ASD<\/dd>/);
});

test('kv: a line without a colon reports its relative line number', () => {
  throwsAt(() => render('kv', 'a: 1\n\n没有冒号'), 3);
});

// ── timeline ──
test('timeline: horizontal by default; * marks a highlight; the third column is the description', () => {
  const html = render('timeline', '1979 | 启动 | AECMA 开始研究\n*Now | 免费下载');
  assert.match(html, /am-timeline--h" style="--n: 2"/);
  assert.match(html, /am-tl-item--hi/);
  assert.match(html, /am-tl-when">Now/);
  assert.match(html, /am-tl-text">AECMA 开始研究/);
});

test('timeline: vertical with more than 6 items or the v argument', () => {
  const many = Array.from({ length: 7 }, (_, i) => `${2000 + i} | 事件${i}`).join('\n');
  assert.match(render('timeline', many), /am-timeline--v/);
  assert.match(render('timeline', 'a | b', 'v'), /am-timeline--v/);
});

test('timeline: error when | is missing', () => {
  throwsAt(() => render('timeline', 'a | b\n只有一列'), 2);
});

// ── annot ──
test('annot: [text]{note} renders as an underlined span + note, the ! prefix gives the error style', () => {
  const html = render('annot', '# 1 程序性句子 | 13 words\nMake sure [the pump]{Technical name} is [on]{!Not "activated"}.\n> 说明');
  assert.match(html, /am-annot-head"><span>1 程序性句子<\/span><span class="am-annot-meta">13 words/);
  assert.match(html, /<span class="am-seg"><span class="am-seg-t">the pump<\/span><span class="am-seg-n" style="--row: 0">Technical name<\/span><\/span>/);
  assert.match(html, /am-seg am-seg--err/);
  assert.match(html, /am-annot-caption">说明/);
});

test('annot: overlapping notes move to separate rows', () => {
  const html = render('annot', '[a]{a long annotation text here} [b]{another long one}');
  assert.match(html, /--row: 1/);
  assert.match(html, /--rows: 2/);
});

test('annot: escapes HTML in the body', () => {
  const html = render('annot', 'if [a < b]{比较} then');
  assert.match(html, /a &lt; b/);
});

test('annot: error on an unclosed annotation', () => {
  throwsAt(() => render('annot', 'ok line\nbad [seg]{note'), 2);
});

test('annot: a sentence with only {!} and no note text may wrap', () => {
  const html = render('annot', 'It is [imperative]{!} that you [ensure]{!} it.');
  assert.match(html, /am-annot-line am-annot-line--wrap" style="--rows: 0"/);
});
