import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, parseDocLoose, ParseError, DraftErrors, applyOverrides } from '../src/parse.js';

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

test('error: a fractional cols, span or rows is rejected where it is read (#308)', () => {
  for (const value of ['2.5', '-3.5', '9.5', '.5']) {
    assert.throws(
      () => parseDoc(`---\ntitle: x\ncols: ${value}\n---\n## A\nbody`),
      (err) => err instanceof ParseError && err.line === 3 && err.message === `cols must be a whole number, not "${value}"`,
    );
  }
  // Every fractional span and rows of the draft is reported in one parse.
  assert.throws(
    () => parseDoc('## A {span=2.5}\na\n## B {rows=1.5}\nb'),
    (err) => err.errors?.length === 2
      && err.errors[0].line === 1 && err.errors[0].message === 'span must be a whole number, not "2.5"'
      && err.errors[1].line === 3 && err.errors[1].message === 'rows must be a whole number, not "1.5"',
  );
});

test('a whole, out-of-range or non-numeric cols, span or rows keeps its fallback (#308)', () => {
  for (const value of ['3', 'abc', '0', '-2', '999999', '2.0']) {
    assert.doesNotThrow(() => parseDoc(`---\ncols: ${value}\n---\n## A {span=${value} rows=${value}}\nbody`), value);
  }
  assert.doesNotThrow(() => parseDoc('## A {span}\nbody'));
  // Each count is checked only where the page reads it: span and rows in the frontmatter are meta text, cols in a heading is an attribute.
  assert.doesNotThrow(() => parseDoc('---\nspan: 2.5\nrows: 1.5\n---\n## A {cols=2.5}\nbody'));
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

test('explicit IDs and auto-assigned panels never collide', () => {
  const doc = parseDoc('## A 一\na\n## 二\nb\n## B 三\nc\n## 四\nd');
  assert.deepEqual(doc.panels.map((p) => [p.id, p.title]), [
    ['A', '一'],
    ['C', '二'],
    ['B', '三'],
    ['D', '四'],
  ]);
});

test('a normal multi-panel draft keeps A, B, C', () => {
  const doc = parseDoc('## 一\na\n## 二\nb\n## 三\nc');
  assert.deepEqual(doc.panels.map((p) => [p.id, p.title]), [
    ['A', '一'],
    ['B', '二'],
    ['C', '三'],
  ]);
});

test('error: two panels with the same explicit ID are rejected and both headings are named', () => {
  assert.throws(
    () => parseDoc('---\ntitle: Dup\n---\n\n## A First\n\nalpha\n\n## A Second\n\nbeta\n'),
    (err) => err instanceof ParseError
      && err.line === 9
      && /Duplicate panel ID "A"/.test(err.message)
      && /"## A First" \(L5\)/.test(err.message)
      && /"## A Second" \(L9\)/.test(err.message)
      && /different explicit ID/.test(err.message)
      && /remove one explicit ID/.test(err.message),
  );
});

test('a title that starts with a word such as "A" or "I" keeps that word (#208)', () => {
  const doc = parseDoc('## The app asks the cache\nx\n## A miss goes to the database\ny\n## I think we should cache\nz\n## C programs leak memory\nw');
  assert.deepEqual(doc.panels.map((p) => [p.id, p.title]), [
    ['A', 'The app asks the cache'],
    ['B', 'A miss goes to the database'],
    ['C', 'I think we should cache'],
    ['D', 'C programs leak memory'],
  ]);
});

test('the 27th panel keeps the P27 form', () => {
  const src = Array.from({ length: 28 }, (_, i) => `## Panel ${i + 1}\n\nt`).join('\n\n');
  const ids = parseDoc(src).panels.map((p) => p.id);
  assert.deepEqual(ids.slice(24), ['Y', 'Z', 'P27', 'P28']);
});

test('an explicit ID past Z is read as an ID (#292)', () => {
  const doc = parseDoc('## P27 First\n\na\n\n## P28 Second\n\nb');
  assert.deepEqual(doc.panels.map((p) => [p.id, p.title]), [
    ['P27', 'First'],
    ['P28', 'Second'],
  ]);
});

test('error: two panels with the same explicit ID past Z are rejected (#292)', () => {
  assert.throws(
    () => parseDoc('## P27 One\n\na\n\n## P27 Two\n\nb\n'),
    (err) => err instanceof ParseError
      && /Duplicate panel ID "P27"/.test(err.message)
      && /"## P27 One" \(L1\)/.test(err.message)
      && /"## P27 Two" \(L5\)/.test(err.message),
  );
});

test('an explicit P27 stops the automatic series from handing out a second P27 (#292)', () => {
  const rest = Array.from({ length: 27 }, (_, i) => `## Panel ${i + 1}\n\nt`).join('\n\n');
  const ids = parseDoc(`## P27 First\n\na\n\n${rest}`).panels.map((p) => p.id);
  assert.equal(ids[0], 'P27');
  assert.deepEqual(ids.slice(1), [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    'P28',
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test('a letter is still an ID before a capitalized, non-Latin or numbered title', () => {
  const doc = parseDoc('## A Where data goes\nx\n## B 三次握手\ny\n## C1 `npm` scripts\nz\n## D 2024 results {span=2}\nw');
  assert.deepEqual(doc.panels.map((p) => [p.id, p.title]), [
    ['A', 'Where data goes'],
    ['B', '三次握手'],
    ['C1', '`npm` scripts'],
    ['D', '2024 results'],
  ]);
});

test('error: an unclosed fenced block reports its start line', () => {
  assert.throws(
    () => parseDoc('## A\n文本\n```flow\nA -> B'),
    (err) => err instanceof ParseError && err.line === 3 && /not closed/.test(err.message),
  );
});

test('error: a table without a delimiter row reports its header line and shows the fix', () => {
  assert.throws(
    () => parseDoc('## A\n文本\n\n| 事 | 影响 |\n| 误提交 | 混进了 PR |'),
    (err) => err instanceof ParseError && err.line === 4 && /delimiter row/.test(err.message) && err.example === '| 事 | 影响 |\n|---|---|\n| 误提交 | 混进了 PR |',
  );
});

test('error: a table after an HTML block that has ended is checked', () => {
  assert.throws(() => parseDoc('## A\n<pre>x</pre>\n| a | b |\n| 1 | 2 |'), (err) => err instanceof ParseError && err.line === 3);
  assert.throws(() => parseDoc('## A\n<div>\nx\n</div>\n\n| a | b |\n| 1 | 2 |'), (err) => err instanceof ParseError && err.line === 6);
});

test('error: a delimiter row with a different number of cells than the header', () => {
  assert.throws(
    () => parseDoc('## A\n| a | b |\n|---|\n| 1 | 2 |'),
    (err) => err instanceof ParseError && err.line === 2 && /2 cells.*1/.test(err.message) && err.example.startsWith('| a | b |\n|---|---|'),
  );
  // A | inside a code span still splits a cell, as in GFM: the header has 3 cells.
  assert.throws(() => parseDoc('## A\n| a | `x|y` |\n|---|---|'), (err) => err instanceof ParseError && err.line === 2);
});

test('valid tables, and pipe lines in code blocks, pass the table check', () => {
  for (const body of [
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '| a | b |\n| :-- | --: |',
    '| a \\| x | b |\n|---|---|',
    '| a \\\\| b |\n|---|---|',
    '文本\n\n    | a | b |\n    | 1 | 2 |',
    'a | b\n--- | ---\n1 | 2',
    '文本\n| a | b |\n|---|---|',
    '| 只有一行 |',
    '<pre>\n| a |\n| b |\n</pre>',
    '<div>\n| a | b |\n| 1 | 2 |\n</div>',
    '```text\n| a | b |\n| 1 | 2 |\n```',
  ]) {
    assert.doesNotThrow(() => parseDoc(`## A\n${body}`), body);
  }
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

test('a UTF-8 BOM before a # heading still extracts the title', () => {
  const doc = parseDoc('\uFEFF# 真实标题\n导语\n## A\nx');
  assert.equal(doc.meta.title, '真实标题');
  assert.equal(doc.intro[0].text.trim(), '导语');
});

test('a UTF-8 BOM before frontmatter still parses', () => {
  const doc = parseDoc('\uFEFF---\ntitle: T\n---\n## A\nx');
  assert.equal(doc.meta.title, 'T');
});

test('error: every broken table is reported in one parse, in line order', () => {
  assert.throws(
    () => parseDoc('## A\n| a | b |\n| 1 | 2 |\n\n## B\n| x | y |\n|---|\n| 1 | 2 |\n'),
    (err) => err instanceof DraftErrors
      && err.errors.map((e) => e.line).join() === '2,6'
      && err.errors.every((e) => e instanceof ParseError && e.example),
  );
});

test('parseDocLoose: returns the document and the collected table errors', () => {
  const { doc, errors } = parseDocLoose('## A\n| a | b |\n| 1 | 2 |\n');
  assert.equal(doc.panels.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

test('error: an unclosed fence still stops at once, even after a broken table', () => {
  assert.throws(() => parseDocLoose('## A\n| a | b |\n| 1 | 2 |\n```flow\nA -> B'), (err) => err instanceof ParseError && err.line === 4);
});
