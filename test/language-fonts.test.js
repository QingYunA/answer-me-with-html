// Per-language fonts, tested through the rendered page and video: the font rules a reader's browser receives.
// A rule must match the language the way :lang() does (a prefix of the tag), so one rule covers zh-Hant and the Taiwan, Hong Kong
// and Macao tags, and ja covers ja-JP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';

const PAGE = '## A 概要\n这是一段用来测试字体的内容。\n'; // lang-ok: draft text under test
const VIDEO = '## 概要\n```flow\nA -> B\n```\n> 这是一句用来测试字体的旁白。\n'; // lang-ok: draft text under test

const HANT_TAGS = ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO'];
const list = (suffix, prefix = 'html') => HANT_TAGS.map((t) => `${prefix}:lang(${t})${suffix}`).join(', ');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruleOf = (css, selector) => css.match(new RegExp(`${escape(selector)} \\{[^}]*\\}`))?.[0];
const before = (text, a, b) => text.indexOf(a) !== -1 && text.indexOf(a) < text.indexOf(b);

test('fonts: Traditional Chinese pages list Traditional fonts before Simplified ones, for every Traditional tag', () => {
  const { html } = renderDoc(PAGE);
  const rule = ruleOf(html, list('[data-theme][data-mode]'));
  assert.ok(rule, 'one rule covers zh-Hant, zh-TW, zh-HK and zh-MO');
  assert.ok(before(rule, '"PingFang TC"', '"PingFang SC"'));
  assert.ok(before(rule, '"Microsoft JhengHei"', '"Microsoft YaHei"'));
  assert.ok(before(rule, '"Noto Sans CJK TC"', '"PingFang SC"'));
});

test('fonts: Japanese pages list Japanese fonts before Chinese ones, and the rule covers regional tags such as ja-JP', () => {
  const rule = ruleOf(renderDoc(PAGE).html, 'html:lang(ja)[data-theme][data-mode]');
  assert.ok(rule);
  assert.ok(before(rule, '"Hiragino Sans"', '"PingFang SC"'));
});

test('fonts: Simplified Chinese and English get no language font rule of their own', () => {
  const { html } = renderDoc(PAGE);
  assert.doesNotMatch(html, /:lang\(zh\)|:lang\(zh-Hans\)|:lang\(zh-CN\)|:lang\(en\)/);
});

test('fonts: the paper theme has a Traditional serif for prose, and Japanese keeps its serif unchanged', () => {
  const css = renderDoc(PAGE).html;
  const hant = ruleOf(css, `${HANT_TAGS.map((t) => `html[data-theme="paper"]:lang(${t})[data-mode]`).join(', ')}`);
  assert.ok(hant, 'paper has a Traditional serif rule');
  assert.ok(before(hant, '"Songti TC"', '"Songti SC"'));
  assert.match(hant, /--font-serif: "Iowan Old Style", Palatino, Georgia, /);
  const ja = ruleOf(css, 'html[data-theme="paper"]:lang(ja)[data-mode]');
  assert.ok(ja);
  assert.match(ja, /--font-serif: "Iowan Old Style", Palatino, Georgia, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "Songti SC", serif;/);
});

test('fonts: the 3b1b video theme has a Traditional title font, and only the title font changes', async () => {
  const { html } = await renderVideo(`---\ntheme: 3b1b\n---\n${VIDEO}`);
  const rule = ruleOf(html, HANT_TAGS.map((t) => `html[data-video][data-theme="3b1b"]:lang(${t})[data-mode]`).join(', '));
  assert.ok(rule, '3b1b has a Traditional title font rule');
  assert.ok(before(rule, '"Songti TC"', '"Songti SC"'));
  assert.match(rule, /--v-title-font: "CMU Serif"/);
  assert.doesNotMatch(rule, /--font-sans/, 'the serif rule applies only to titles');
  const generic = ruleOf(html, list('[data-theme][data-mode]'));
  assert.ok(generic, 'the general Traditional font rule is in the video too');
  assert.doesNotMatch(generic, /--v-title-font/);
});
