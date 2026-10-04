import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/parse.js';
import { lintDoc, splitSentences, sentenceLength, formatWarning } from '../src/lint/ste.js';

const lint = (body) => lintDoc(parseDoc(body));
const rules = (ws) => ws.map((w) => w.rule);

test('splitSentences: 中英文句末标点，保留缩写不切断', () => {
  assert.deepEqual(splitSentences('先关阀门。再拆泵！好吗？'), ['先关阀门。', '再拆泵！', '好吗？']);
  assert.deepEqual(splitSentences('Close the valve. Remove the pump, e.g. the main one.'), ['Close the valve.', 'Remove the pump, e.g. the main one.']);
  assert.deepEqual(splitSentences('Version 3.5 is out.'), ['Version 3.5 is out.']);
});

test('sentenceLength: 中文按字计（英文单词算 1），英文按词计', () => {
  assert.deepEqual(sentenceLength('用 Node 运行脚本。'), { lang: 'zh', count: 6 });
  assert.deepEqual(sentenceLength('Close the valve now.'), { lang: 'en', count: 4 });
});

test('超长中文描述句（>45 字）报 sentence-length，带行号', () => {
  const long = '这'.repeat(46) + '。';
  const ws = lint(`## A\n第一行。\n${long}`);
  assert.deepEqual(rules(ws), ['sentence-length']);
  assert.equal(ws[0].line, 3);
});

test('有序列表视为程序性内容，上限更严（中文 35 字 / 英文 20 词）', () => {
  const zh = '步'.repeat(36);
  assert.deepEqual(rules(lint(`## A\n1. ${zh}`)), ['sentence-length']);
  assert.deepEqual(rules(lint(`## A\n- ${zh}`)), [], '无序列表按描述性 45 字');
  const en = Array.from({ length: 21 }, () => 'go').join(' ');
  assert.deepEqual(rules(lint(`## A\n1. ${en}.`)), ['sentence-length']);
});

test('段落超过 6 句报 paragraph-length', () => {
  const ws = lint(`## A\n一。二。三。\n四。五。六。七。`);
  assert.deepEqual(rules(ws), ['paragraph-length']);
  assert.equal(ws[0].line, 2);
});

test('英文禁用词给出替换建议，大小写不敏感，多词短语可识别', () => {
  const ws = lint('## A\nUtilize the tool prior to the test.');
  assert.deepEqual(ws.map((w) => w.suggestion), ['use', 'before']);
});

test('英文被动语态启发式', () => {
  assert.deepEqual(rules(lint('## A\nThe valve is closed by the operator.')), ['passive']);
  assert.deepEqual(rules(lint('## A\nThe operator closes the valve.')), []);
});

test('中文虚动词：进行优化 → 优化；进行中不误报', () => {
  const ws = lint('## A\n我们对接口进行优化。任务进行中。');
  assert.equal(ws.length, 1);
  assert.equal(ws[0].rule, 'word');
  assert.match(ws[0].suggestion, /优化/);
});

test('中文“的”字连用与套话', () => {
  assert.deepEqual(rules(lint('## A\n我的朋友的同事的电脑坏了。')), ['de-chain']);
  assert.deepEqual(rules(lint('## A\n基本的には具体的で効果的な手順を選ぶ。')), []);
  assert.deepEqual(rules(lint('## A\nこの文はとても長くて、四十五文字をこえるようにわざと言葉をたくさん足して書いた説明の文章になっている。')), ['sentence-length'], '日文仍查句长');
  assert.deepEqual(rules(lint('## A\n这一步至关重要。')), ['cliche']);
});

test('跳过：代码、行内代码、删除线、no 状态行、标题、组件', () => {
  const src = `## A
\`\`\`python
utilize = 1
\`\`\`
调用 \`utilize()\` 函数。~~Commence pumping.~~
| 写法 | 状态 |
|---|---|
| Commence pumping. | no |
### Utilize 标题
\`\`\`annot
[Utilize]{!Not approved} the tool.
\`\`\``;
  assert.deepEqual(lint(src), []);
});

test('callout 正文参与检查；表格普通单元格参与检查', () => {
  const ws = lint('## A\n```callout warn 注意\nUtilize it.\n```\n| a |\n|---|\n| Commence now. |');
  assert.deepEqual(ws.map((w) => [w.line, w.suggestion]), [[3, 'use'], [7, 'start']]);
});

test('intro 导语也参与检查', () => {
  assert.equal(lint('导语里 utilize 一下。\n## A\nx').length, 1);
});

test('formatWarning: 行号 + 规则 + 信息 + 建议', () => {
  const s = formatWarning({ line: 4, rule: 'word', message: '不推荐 "utilize"', suggestion: 'use' });
  assert.equal(s, 'L4 [word] 不推荐 "utilize" → use');
});

test('中文句子里夹一个片假名词，仍按中文规则检查', async () => {
  const { lintDoc } = await import('../src/lint/ste.js');
  const { parseDoc } = await import('../src/parse.js');
  const w = lintDoc(parseDoc('## A\n我们的团队的项目的《ワンピース》很重要。\n'));
  assert.ok(w.some((x) => x.rule === 'de-chain'));
});
