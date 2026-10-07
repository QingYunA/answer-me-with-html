import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/parse.js';
import { lintDoc, splitSentences, sentenceLength, formatWarning } from '../src/lint/ste.js';

const lint = (body) => lintDoc(parseDoc(body));
const rules = (ws) => ws.map((w) => w.rule);

test('splitSentences: Chinese and English sentence-end punctuation, abbreviations are not split', () => {
  assert.deepEqual(splitSentences('先关阀门。再拆泵！好吗？'), ['先关阀门。', '再拆泵！', '好吗？']);
  assert.deepEqual(splitSentences('Close the valve. Remove the pump, e.g. the main one.'), ['Close the valve.', 'Remove the pump, e.g. the main one.']);
  assert.deepEqual(splitSentences('Version 3.5 is out.'), ['Version 3.5 is out.']);
});

test('sentenceLength: Chinese counts characters (an English word counts 1), English counts words', () => {
  assert.deepEqual(sentenceLength('用 Node 运行脚本。'), { lang: 'zh', count: 6 });
  assert.deepEqual(sentenceLength('Close the valve now.'), { lang: 'en', count: 4 });
});

test('a long Chinese descriptive sentence (>45 characters) reports sentence-length with the line number', () => {
  const long = '这'.repeat(46) + '。';
  const ws = lint(`## A\n第一行。\n${long}`);
  assert.deepEqual(rules(ws), ['sentence-length']);
  assert.equal(ws[0].line, 3);
});

test('ordered lists count as procedural, with a stricter limit (35 Chinese characters / 20 English words)', () => {
  const zh = '步'.repeat(36);
  assert.deepEqual(rules(lint(`## A\n1. ${zh}`)), ['sentence-length']);
  assert.deepEqual(rules(lint(`## A\n- ${zh}`)), [], 'unordered lists use the descriptive 45-character limit');
  const en = Array.from({ length: 21 }, () => 'go').join(' ');
  assert.deepEqual(rules(lint(`## A\n1. ${en}.`)), ['sentence-length']);
});

test('a paragraph over 6 sentences reports paragraph-length', () => {
  const ws = lint(`## A\n一。二。三。\n四。五。六。七。`);
  assert.deepEqual(rules(ws), ['paragraph-length']);
  assert.equal(ws[0].line, 2);
});

test('banned English words get a replacement, case-insensitive, multi-word phrases match', () => {
  const ws = lint('## A\nUtilize the tool prior to the test.');
  assert.deepEqual(ws.map((w) => w.suggestion), ['use', 'before']);
});

test('English passive voice heuristic', () => {
  assert.deepEqual(rules(lint('## A\nThe valve is closed by the operator.')), ['passive']);
  assert.deepEqual(rules(lint('## A\nThe operator closes the valve.')), []);
});

test('Chinese light verbs: `进行优化` → `优化`; `进行中` is not flagged', () => {
  const ws = lint('## A\n我们对接口进行优化。任务进行中。');
  assert.equal(ws.length, 1);
  assert.equal(ws[0].rule, 'word');
  assert.match(ws[0].suggestion, /优化/);
});

test('Chinese chained `的` and clichés', () => {
  assert.deepEqual(rules(lint('## A\n我的朋友的同事的电脑坏了。')), ['de-chain']);
  assert.deepEqual(rules(lint('## A\n基本的には具体的で効果的な手順を選ぶ。')), []);
  assert.deepEqual(rules(lint('## A\nこの文はとても長くて、四十五文字をこえるようにわざと言葉をたくさん足して書いた説明の文章になっている。')), ['sentence-length'], 'Japanese is still checked for sentence length');
  assert.deepEqual(rules(lint('## A\n这一步至关重要。')), ['cliche']);
});

test('skipped: code, inline code, strikethrough, no-status rows, headings, components', () => {
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

test('status cells followed by inline code agree with the render: no rows skipped, ok/warn prefix stripped', () => {
  const ws = lint('## A\n| a |\n|---|\n| no Commence with `utilize()`. |\n| ok Commence with `utilize()`. |\n| warn Commence with **care**. |');
  assert.deepEqual(ws.map((w) => [w.line, w.suggestion]), [[5, 'start'], [6, 'start']]);
});

test('callout bodies are checked; plain table cells are checked', () => {
  const ws = lint('## A\n```callout warn 注意\nUtilize it.\n```\n| a |\n|---|\n| Commence now. |');
  assert.deepEqual(ws.map((w) => [w.line, w.suggestion]), [[3, 'use'], [7, 'start']]);
});

test('Chinese non-approved words: typos, vague quantities, one-meaning-one-word; suggestions in order of appearance', () => {
  const ws = lint('## A\n尽快登陆系统，单击「保存」，缺省值见入参。');
  assert.deepEqual(rules(ws), ['word', 'word', 'word', 'word', 'word']);
  assert.deepEqual(ws.map((w) => w.suggestion), ['give a concrete deadline', '登录', '点击', '默认', '参数']);
  assert.equal(formatWarning(ws[1]), 'L2 [word] not recommended: "登陆" → 登录');
});

test('Chinese non-approved words: the range words only after a number; ordinary Chinese is not affected', () => {
  assert.deepEqual(rules(lint('## A\n并发数 100 以上，延迟 50 ms 以内。')), ['word', 'word']);
  assert.deepEqual(rules(lint('## A\n以上步骤完成后，服务可用。')), []);
  assert.deepEqual(rules(lint('## A\n配置文件会被服务读取，相关日志等信息稍后再看。')), [], 'passive 被, 相关, 等, 稍后 are not in the list');
  assert.deepEqual(rules(lint('## A\n1. 请点击「保存」。')), []);
  assert.deepEqual(rules(lint('## A\nログインして設定を保存する。')), [], 'Japanese does not get the Chinese word list');
});

test('the intro is checked too', () => {
  assert.equal(lint('导语里 utilize 一下。\n## A\nx').length, 1);
});

test('formatWarning: line + rule + message + suggestion', () => {
  const s = formatWarning({ line: 4, rule: 'word', message: 'not recommended: "utilize"', suggestion: 'use' });
  assert.equal(s, 'L4 [word] not recommended: "utilize" → use');
});

test('a Chinese sentence with one katakana word is still checked by the Chinese rules', async () => {
  const { lintDoc } = await import('../src/lint/ste.js');
  const { parseDoc } = await import('../src/parse.js');
  const w = lintDoc(parseDoc('## A\n我们的团队的项目的《ワンピース》很重要。\n'));
  assert.ok(w.some((x) => x.rule === 'de-chain'));
});

test('messages: English word rule quotes the flagged word and names the replacement', () => {
  const [w] = lint('## A\nUtilize the tool.');
  assert.equal(formatWarning(w), 'L2 [word] not recommended: "Utilize" → use');
});

test('messages: Chinese light verb quotes the span and the Chinese replacement', () => {
  const [w] = lint('## A\n我们对接口进行优化。');
  assert.equal(formatWarning(w), 'L2 [word] light verb "进行优化" (进行) → use "优化"');
});

test('messages: sentence length names the unit, the limit and a preview', () => {
  const [zh] = lint(`## A\n${'这'.repeat(46)}。`);
  assert.equal(zh.message, `sentence has 46 characters (max 45): "${'这'.repeat(24)}…"`);
  const [en] = lint(`## A\n1. ${Array.from({ length: 21 }, () => 'go').join(' ')}.`);
  assert.equal(en.message, 'step has 21 words (max 20): "go go go go go go go go …"');
});

test('messages: paragraph length names the count and the limit', () => {
  const [w] = lint('## A\n一。二。三。\n四。五。六。七。');
  assert.equal(w.message, 'paragraph has 7 sentences (max 6)');
});

test('messages: passive voice quotes the verb phrase', () => {
  const [w] = lint('## A\nThe valve is closed by the operator.');
  assert.deepEqual([w.message, w.suggestion], ['possible passive voice: "is closed"', 'use active voice']);
});

test('messages: chained `的` and clichés quote the Chinese text', () => {
  const [de] = lint('## A\n我的朋友的同事的电脑坏了。');
  assert.deepEqual([de.message, de.suggestion], ['chained "的": 我的朋友的同事的电脑坏了。', 'split the sentence or remove extra "的"']);
  const [c] = lint('## A\n这一步至关重要。');
  assert.deepEqual([c.message, c.suggestion], ['cliché "至关重要"', 'delete it or state a concrete fact']);
});
