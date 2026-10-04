import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, ParseError, applyOverrides } from '../src/parse.js';

const SAMPLE = `---
template: sheet
theme: shadcn
title: TCP 三次握手   # 行尾注释
cols: 2
---
开场一段话。

## A 握手流程 {span=2 meta="RFC 793"}
\`\`\`sequence
Client -> Server: SYN
\`\`\`
## 状态变化
| a | b |
|---|---|
| 1 | ok |
`;

test('frontmatter: 解析键值、去行尾注释、数字字段转型', () => {
  const doc = parseDoc(SAMPLE);
  assert.equal(doc.meta.template, 'sheet');
  assert.equal(doc.meta.theme, 'shadcn');
  assert.equal(doc.meta.title, 'TCP 三次握手');
  assert.equal(doc.meta.cols, 2);
  assert.equal(doc.meta.style, '80');
});

test('frontmatter 缺省时使用默认值', () => {
  const doc = parseDoc('## 只有一个面板\n内容');
  assert.deepEqual(
    { t: doc.meta.template, th: doc.meta.theme, s: doc.meta.style, c: doc.meta.cols },
    { t: 'sheet', th: 'blueprint', s: '80', c: 3 },
  );
});

test('面板切分：显式 ID、标题、属性、行号', () => {
  const doc = parseDoc(SAMPLE);
  assert.equal(doc.panels.length, 2);
  const [a, b] = doc.panels;
  assert.equal(a.id, 'A');
  assert.equal(a.title, '握手流程');
  assert.deepEqual(a.attrs, { span: 2, meta: 'RFC 793' });
  assert.equal(a.line, 9);
  assert.equal(b.id, 'B', '无 ID 时自动分配下一个未占用字母');
  assert.equal(b.title, '状态变化');
});

test('块切分：markdown 与围栏块分离，记录围栏语言、参数和行号', () => {
  const doc = parseDoc(SAMPLE);
  const blocks = doc.panels[0].blocks;
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    type: 'fence', lang: 'sequence', args: '', text: 'Client -> Server: SYN', line: 10,
  });
  assert.equal(doc.panels[1].blocks[0].type, 'md');
  assert.equal(doc.panels[1].blocks[0].line, 14);
  assert.equal(doc.intro[0].text.trim(), '开场一段话。');
});

test('围栏块参数：```flow LR 拆成 lang 与 args', () => {
  const doc = parseDoc('## X\n```flow LR\nA -> B\n```');
  const f = doc.panels[0].blocks[0];
  assert.equal(f.lang, 'flow');
  assert.equal(f.args, 'LR');
});

test('围栏块内的 ## 不会切分面板', () => {
  const doc = parseDoc('## A\n```md\n## 不是标题\n```\n## B\n文本');
  assert.equal(doc.panels.length, 2);
  assert.equal(doc.panels[0].blocks[0].text, '## 不是标题');
});

test('无 frontmatter 标题时，取 intro 中的 # 一级标题', () => {
  const doc = parseDoc('# 我的标题\n导语\n## A\nx');
  assert.equal(doc.meta.title, '我的标题');
  assert.equal(doc.intro[0].text.trim(), '导语');
});

test('自动 ID 跳过已被显式占用的字母', () => {
  const doc = parseDoc('## 一\nx\n## A 二\ny\n## 三\nz');
  assert.deepEqual(doc.panels.map((p) => p.id), ['B', 'A', 'C']);
});

test('错误：未闭合的围栏块报告起始行号', () => {
  assert.throws(
    () => parseDoc('## A\n文本\n```flow\nA -> B'),
    (err) => err instanceof ParseError && err.line === 3 && /未闭合/.test(err.message),
  );
});

test('错误：未闭合的 frontmatter', () => {
  assert.throws(() => parseDoc('---\ntitle: x\n## A'), (err) => err instanceof ParseError && err.line === 1);
});

test('错误：非法模板 / 主题 / 严格度给出可选值', () => {
  assert.throws(() => parseDoc('---\ntemplate: grid\n---'), /template.*sheet.*doc/);
  assert.throws(() => parseDoc('---\ntheme: neon\n---'), /theme.*blueprint.*shadcn/);
  assert.throws(() => parseDoc('---\nstyle: 50\n---'), /style.*off.*80.*strict/);
});

test('frontmatter: 引号内的 # 不是注释', () => {
  assert.equal(parseDoc('---\ntitle: "Issue #123"\n---\n## A\nx').meta.title, 'Issue #123');
  assert.equal(parseDoc('---\ntitle: "Issue #123" # 行尾注释\n---\n## A\nx').meta.title, 'Issue #123');
  assert.equal(parseDoc("---\ntitle: 'Issue #123'\n---\n## A\nx").meta.title, 'Issue #123');
  assert.equal(parseDoc('---\ntitle: Hello # comment\n---\n## A\nx').meta.title, 'Hello');
});

test('CRLF 换行也能正确解析', () => {
  const doc = parseDoc('---\r\ntitle: T\r\n---\r\n## A\r\n内容\r\n');
  assert.equal(doc.meta.title, 'T');
  assert.equal(doc.panels[0].blocks[0].text.trim(), '内容');
});

test('applyOverrides: 校验取值、忽略 undefined、返回新对象', () => {
  const meta = Object.freeze({ theme: 'blueprint', mode: 'auto', title: 'T' });
  assert.deepEqual(applyOverrides(meta, { theme: 'shadcn', mode: undefined }), { theme: 'shadcn', mode: 'auto', title: 'T' });
  assert.throws(() => applyOverrides(meta, { theme: '3b1b' }), /theme 的值 "3b1b" 无效/);
  assert.equal(applyOverrides(meta, { theme: '3b1b' }, { theme: ['3b1b'] }).theme, '3b1b');
});
