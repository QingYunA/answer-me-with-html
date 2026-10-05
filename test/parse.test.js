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

test('frontmatter: parses key-values, strips trailing comments, converts number fields', () => {
  const doc = parseDoc(SAMPLE);
  assert.equal(doc.meta.template, 'sheet');
  assert.equal(doc.meta.theme, 'shadcn');
  assert.equal(doc.meta.title, 'TCP 三次握手');
  assert.equal(doc.meta.cols, 2);
  assert.equal(doc.meta.style, '80');
});

test('frontmatter: uses the defaults when absent', () => {
  const doc = parseDoc('## 只有一个面板\n内容');
  assert.deepEqual(
    { t: doc.meta.template, th: doc.meta.theme, s: doc.meta.style, c: doc.meta.cols },
    { t: 'sheet', th: 'auto', s: '80', c: 3 },
  );
});

test('panel split: explicit ID, title, attributes, line number', () => {
  const doc = parseDoc(SAMPLE);
  assert.equal(doc.panels.length, 2);
  const [a, b] = doc.panels;
  assert.equal(a.id, 'A');
  assert.equal(a.title, '握手流程');
  assert.deepEqual(a.attrs, { span: 2, meta: 'RFC 793' });
  assert.equal(a.line, 9);
  assert.equal(b.id, 'B', 'without an ID, the next free letter is assigned');
  assert.equal(b.title, '状态变化');
});

test('block split: markdown and fenced blocks are separated, with fence language, arguments and line number', () => {
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

test('fence arguments: ```flow LR splits into lang and args', () => {
  const doc = parseDoc('## X\n```flow LR\nA -> B\n```');
  const f = doc.panels[0].blocks[0];
  assert.equal(f.lang, 'flow');
  assert.equal(f.args, 'LR');
});

test('a ## inside a fenced block does not split a panel', () => {
  const doc = parseDoc('## A\n```md\n## 不是标题\n```\n## B\n文本');
  assert.equal(doc.panels.length, 2);
  assert.equal(doc.panels[0].blocks[0].text, '## 不是标题');
});

test('without a frontmatter title, the # heading in the intro is used', () => {
  const doc = parseDoc('# 我的标题\n导语\n## A\nx');
  assert.equal(doc.meta.title, '我的标题');
  assert.equal(doc.intro[0].text.trim(), '导语');
});

test('automatic IDs skip letters already taken explicitly', () => {
  const doc = parseDoc('## 一\nx\n## A 二\ny\n## 三\nz');
  assert.deepEqual(doc.panels.map((p) => p.id), ['B', 'A', 'C']);
});

test('error: an unclosed fenced block reports its start line', () => {
  assert.throws(
    () => parseDoc('## A\n文本\n```flow\nA -> B'),
    (err) => err instanceof ParseError && err.line === 3 && /not closed/.test(err.message),
  );
});

test('error: unclosed frontmatter', () => {
  assert.throws(() => parseDoc('---\ntitle: x\n## A'), (err) => err instanceof ParseError && err.line === 1);
});

test('error: an invalid template / theme / style lists the choices', () => {
  assert.throws(() => parseDoc('---\ntemplate: grid\n---'), /template.*sheet.*doc/);
  assert.throws(() => parseDoc('---\ntheme: neon\n---'), /theme.*blueprint.*shadcn/);
  assert.throws(() => parseDoc('---\nstyle: 50\n---'), /style.*off.*80.*strict/);
});

test('frontmatter: a # inside quotes is not a comment', () => {
  assert.equal(parseDoc('---\ntitle: "Issue #123"\n---\n## A\nx').meta.title, 'Issue #123');
  assert.equal(parseDoc('---\ntitle: "Issue #123" # 行尾注释\n---\n## A\nx').meta.title, 'Issue #123');
  assert.equal(parseDoc("---\ntitle: 'Issue #123'\n---\n## A\nx").meta.title, 'Issue #123');
  assert.equal(parseDoc('---\ntitle: Hello # comment\n---\n## A\nx').meta.title, 'Hello');
});

test('CRLF line endings parse correctly', () => {
  const doc = parseDoc('---\r\ntitle: T\r\n---\r\n## A\r\n内容\r\n');
  assert.equal(doc.meta.title, 'T');
  assert.equal(doc.panels[0].blocks[0].text.trim(), '内容');
});

test('applyOverrides: validates values, ignores undefined, returns a new object', () => {
  const meta = Object.freeze({ theme: 'blueprint', mode: 'auto', title: 'T' });
  assert.deepEqual(applyOverrides(meta, { theme: 'shadcn', mode: undefined }), { theme: 'shadcn', mode: 'auto', title: 'T' });
  assert.throws(() => applyOverrides(meta, { theme: '3b1b' }), /Invalid theme value "3b1b"/);
  assert.equal(applyOverrides(meta, { theme: '3b1b' }, { theme: ['3b1b'] }).theme, '3b1b');
});
