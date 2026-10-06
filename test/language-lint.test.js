// The writing check follows the language of the draft (#84). Chinese and English keep their rules. A declared language selects the
// rule family: declared English turns the Chinese vocabulary rules off. Any other language gets only the language-neutral rules:
// sentence length (in words, or in characters for Chinese and Japanese text) and paragraph length. Tested through the render result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';

const warn = (lang, body) => renderDoc(`${lang === undefined ? '' : `---\nlang: ${lang}\n---\n`}## A Section\n${body}\n`).warnings;
const rules = (warnings) => warnings.map((w) => w.rule);
const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

test('writing check: English rules still flag passive voice and wordy words in an English draft', () => {
  assert.ok(rules(warn('en', 'The valve was closed by the operator.')).includes('passive'));
  assert.ok(rules(warn('en', 'Please utilize the valve.')).includes('word'));
  assert.ok(rules(warn(undefined, 'The valve was closed by the operator and the line stays open for now.')).includes('passive'));
});

test('writing check: a language without rules gets no English passive-voice or word-list warnings', () => {
  for (const lang of ['fr', 'es', 'ko', 'pt-BR']) {
    const w = warn(lang, 'The valve was closed by the operator. Please utilize the valve.');
    assert.deepEqual(rules(w).filter((r) => r === 'passive' || r === 'word'), [], lang);
  }
});

test('writing check: a language without rules still gets the sentence-length rule, in words', () => {
  const long = warn('fr', `${words(30)}.`);
  assert.deepEqual(rules(long), ['sentence-length']);
  assert.match(long[0].message, /30 words \(max 25\)/);
  assert.deepEqual(warn('fr', `${words(20)}.`), []);
  const step = warn('fr', `1. ${words(22)}.`);
  assert.match(step[0].message, /step has 22 words \(max 20\)/);
});

test('writing check: Korean is measured in space-separated words, not in syllables', () => {
  assert.deepEqual(warn('ko', '이것은 한국어로 쓴 짧은 설명입니다.'), []); // lang-ok: draft text under test
  assert.deepEqual(rules(warn('ko', `${words(30, '단어')}입니다.`)), ['sentence-length']); // lang-ok: draft text under test
});

test('writing check: Thai is measured in words found by word segmentation', () => {
  assert.deepEqual(warn('th', 'ฉันกินข้าวที่บ้าน'), []); // lang-ok: draft text under test
  const long = warn('th', 'ฉันกินข้าว'.repeat(10)); // lang-ok: draft text under test
  assert.deepEqual(rules(long), ['sentence-length']);
  assert.match(long[0].message, /words/);
});

test('writing check: a language without rules still gets the paragraph-length rule', () => {
  const seven = Array.from({ length: 7 }, (_, i) => `Phrase ${i}.`).join(' ');
  assert.deepEqual(rules(warn('fr', seven)), ['paragraph-length']);
});

test('writing check: an undeclared draft in another script uses the language-neutral rules too', () => {
  assert.deepEqual(warn(undefined, 'Это короткое описание на русском языке.'), []);
  assert.deepEqual(rules(warn(undefined, `${words(30, 'слово')}.`)), ['sentence-length']);
});

test('writing check: a declared English draft does not get Chinese vocabulary warnings; an undeclared Chinese one does', () => {
  const body = '我们对系统进行优化。'; // lang-ok: draft text under test
  assert.deepEqual(rules(warn('en', body)), []);
  assert.ok(warn(undefined, body).some((w) => w.rule === 'word' && /light verb/.test(w.message)));
  assert.ok(warn('zh', body).some((w) => /light verb/.test(w.message)));
});

test('writing check: Traditional Chinese uses the Chinese length limits', () => {
  const long = '這個句子用來測試繁體中文的長度限制，它一定超過四十五個字，所以系統應該把它標記出來，提醒作者拆成兩句話再寫。'; // lang-ok: draft text under test
  const w = warn('zh-Hant', long);
  assert.deepEqual(rules(w), ['sentence-length']);
  assert.match(w[0].message, /characters/);
  assert.deepEqual(warn('zh-Hant', '這是一個簡短的句子。'), []); // lang-ok: draft text under test
});

test('writing check: Japanese keeps only the length rules', () => {
  assert.deepEqual(warn('ja', '基本的には具体的で効果的な手順を説明します。'), []); // lang-ok: draft text under test
});
