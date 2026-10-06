// Language behavior, tested through the draft-to-page and draft-to-video render entry points (the one seam for language, see #84).
// A draft goes in; the test asserts what the reader gets: the page's lang attribute, which language the labels are in,
// and what the returned language says. Nothing here names an internal function of the language module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';

// One label per language, taken from the toolbar button (page) and the play button (video).
const COPY = { zh: '复制源稿', en: 'Copy source', ja: '原稿をコピー' }; // lang-ok: the page labels under test
const PLAY = { zh: '播放', en: 'Play', ja: '再生' }; // lang-ok: the player labels under test

const htmlLangOf = (html) => html.match(/<html lang="([^"]*)"/)?.[1];
const pageLabels = (html) => Object.keys(COPY).filter((k) => html.includes(`>${COPY[k]}</button>`));
const playerLabels = (html) => Object.keys(PLAY).filter((k) => html.includes(`>${PLAY[k]}<`) || html.includes(`"${PLAY[k]}"`));

const ZH_BODY = '## A 概要\n这是一段用来测试语言的中文内容。\n'; // lang-ok: Chinese draft text under test
const draft = (lang, body = ZH_BODY) => `${lang === undefined ? '' : `---\nlang: ${lang}\n---\n`}${body}`;
const page = (lang, body) => renderDoc(draft(lang, body));

// Declared language: [declared tag, <html lang> written, language of the labels].
// A tag is never rewritten, except that a bare "zh" keeps the "zh-CN" it has always been written as.
// A language without labels gets English labels, never another language's.
const DECLARED = [
  ['zh', 'zh-CN', 'zh'],
  ['zh-CN', 'zh-CN', 'zh'],
  ['ZH', 'zh-CN', 'zh'],
  ['zh-Hans', 'zh-Hans', 'zh'],
  ['zh-SG', 'zh-SG', 'zh'],
  ['en', 'en', 'en'],
  ['en-US', 'en-US', 'en'],
  ['EN-gb', 'en-GB', 'en'],
  ['ja', 'ja', 'ja'],
  ['ja-JP', 'ja-JP', 'ja'],
  ['zh-tw', 'zh-TW', 'en'],
  ['zh_TW', 'zh-TW', 'en'],
  ['ZH-hant', 'zh-Hant', 'en'],
  ['zh-HK', 'zh-HK', 'en'],
  ['fr', 'fr', 'en'],
  ['ko', 'ko', 'en'],
  ['ar', 'ar', 'en'],
  ['pt-BR', 'pt-BR', 'en'],
];

for (const [declared, written, labels] of DECLARED) {
  test(`page language: "lang: ${declared}" is written as lang="${written}" with ${labels} labels`, () => {
    const { html, language } = page(declared);
    assert.equal(htmlLangOf(html), written);
    assert.deepEqual(pageLabels(html), [labels]);
    assert.equal(language.htmlLang, written);
  });
}

test('page language: the theme picker names themes in the label language', () => {
  assert.match(page('fr').html, /<option value="blueprint"[^>]*>Blueprint<\/option>/, 'fr gets English theme names');
  assert.match(page('zh').html, /<option value="blueprint"[^>]*>图纸<\/option>/); // lang-ok: Chinese theme name under test
  assert.match(page('ja').html, /<option value="blueprint"[^>]*>図面<\/option>/); // lang-ok: Japanese theme name under test
});

// Undeclared drafts: the language comes from the text.
const DETECTED = [
  ['Chinese', '## A 概要\n全中文内容，用来测试语言识别。\n', 'zh-CN', 'zh'], // lang-ok: draft text under test
  ['English', '# Hello world\n## A Overview\nThis is a plain English page about things.\n', 'en', 'en'],
  ['Japanese with kana', '## A 概要\n接続は3回のやりとりで行う。\n', 'ja', 'ja'], // lang-ok: draft text under test
  ['kana-heavy title', '## A 概要\nTCP の3ウェイハンドシェイク\n', 'ja', 'ja'], // lang-ok: draft text under test
  ['Chinese without kana', '## A 概要\n三次握手建立连接。\n', 'zh-CN', 'zh'], // lang-ok: draft text under test
  ['English with one kana', '## A Overview\na long english sentence with one あ\n', 'en', 'en'], // lang-ok: draft text under test
  ['Chinese quoting one katakana title', '## A 概要\n这部动画叫《ワンピース》，讲的是海贼的故事，主角想成为海贼王。\n', 'zh-CN', 'zh'], // lang-ok: draft text under test
  ['Japanese with a high kana share', '## A 概要\n基本的には具体的で効果的な手順を説明します。\n', 'ja', 'ja'], // lang-ok: draft text under test
];

for (const [name, body, written, labels] of DETECTED) {
  test(`page language: an undeclared ${name} draft is ${written} with ${labels} labels`, () => {
    const { html } = page(undefined, body);
    assert.equal(htmlLangOf(html), written);
    assert.deepEqual(pageLabels(html), [labels]);
  });
}

test('page language: a declared language wins over detection', () => {
  const { html } = page('en', ZH_BODY);
  assert.equal(htmlLangOf(html), 'en');
  assert.deepEqual(pageLabels(html), ['en']);
});

test('page language: an empty, undetermined or malformed declaration is ignored and the text decides', () => {
  for (const declared of ['""', 'und', 'not a tag!!', '12345']) {
    const { html } = page(declared, ZH_BODY);
    assert.equal(htmlLangOf(html), 'zh-CN', `declared ${declared}`);
    assert.deepEqual(pageLabels(html), ['zh'], `declared ${declared}`);
  }
  const en = page('und', '## A Overview\nThis is a plain English page about things.\n').html;
  assert.equal(htmlLangOf(en), 'en');
});

test('page language: the result reports script, direction and whether the language has labels', () => {
  const read = (declared) => page(declared).language;
  assert.deepEqual([read('zh').script, read('zh-tw').script, read('ar').script, read('fr').script], ['Hans', 'Hant', 'Arab', 'Latn']);
  assert.deepEqual([read('ar').dir, read('he').dir, read('zh').dir, read('ja').dir, read('fr').dir], ['rtl', 'rtl', 'ltr', 'ltr', 'ltr']);
  assert.deepEqual([read('zh').supported, read('en-US').supported, read('ja').supported], [true, true, true]);
  assert.deepEqual([read('fr').supported, read('ko').supported], [false, false]);
});

test('page language: right-to-left languages do not emit a dir attribute yet (mirrored layout is a separate issue)', () => {
  assert.doesNotMatch(page('ar').html, /<html[^>]*\sdir=/);
});

// The video player reads the same language.
const VIDEO = (lang) => `${lang === undefined ? '' : `---\nlang: ${lang}\n---\n`}## S\n\`\`\`flow\nA -> B\n\`\`\`\n> beat\n`;

for (const [declared, written, labels] of [['zh', 'zh-CN', 'zh'], ['ja', 'ja', 'ja'], ['en', 'en', 'en'], ['zh-tw', 'zh-TW', 'en'], ['fr', 'fr', 'en']]) {
  test(`video language: "lang: ${declared}" is written as lang="${written}" with ${labels} player labels`, async () => {
    const { html, language } = await renderVideo(VIDEO(declared));
    assert.equal(htmlLangOf(html), written);
    assert.deepEqual(playerLabels(html), [labels]);
    assert.equal(language.htmlLang, written);
  });
}

test('video language: the page components inside a video use the same label language', async () => {
  const { html } = await renderVideo(VIDEO('fr'));
  assert.match(html, /aria-label="Flowchart: A, B"/);
});

test('video language: an undeclared Chinese video is zh-CN with Chinese player labels', async () => {
  const { html } = await renderVideo('## 概要\n```flow\nA -> B\n```\n> 这是一句用来测试语言的旁白。\n'); // lang-ok: draft text under test
  assert.equal(htmlLangOf(html), 'zh-CN');
  assert.deepEqual(playerLabels(html), ['zh']);
});
