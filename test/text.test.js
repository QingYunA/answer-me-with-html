import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, wrap, esc, isCJK } from '../src/svg/text.js';

test('esc: escapes HTML special characters', () => {
  assert.equal(esc(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(undefined), '');
});

test('isCJK: recognizes CJK characters and fullwidth punctuation', () => {
  assert.ok(isCJK('中'));
  assert.ok(isCJK('，'));
  assert.ok(!isCJK('a'));
});

test('measure: a Chinese character is about as wide as the font size, English is clearly narrower', () => {
  assert.equal(measure('中文', 10), 20);
  const latin = measure('ab', 10);
  assert.ok(latin > 8 && latin < 14, `latin=${latin}`);
  assert.ok(measure('WWW', 10) > measure('iii', 10));
});

test('measure: each Latin character is 0.6em in monospace mode', () => {
  assert.equal(measure('abcd', 10, { mono: true }), 24);
  assert.equal(measure('中', 10, { mono: true }), 10);
});

test('wrap: English wraps by word without splitting words', () => {
  const lines = wrap('the quick brown fox jumps', 60, 10);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(' '), 'the quick brown fox jumps');
  for (const l of lines) assert.ok(!l.startsWith(' ') && !l.endsWith(' '));
});

test('wrap: Chinese wraps by character and no line is too wide', () => {
  const lines = wrap('一二三四五六七八九十', 40, 10);
  assert.deepEqual(lines, ['一二三四', '五六七八', '九十']);
});

test('wrap: an overlong word takes its own line and loses no characters', () => {
  const lines = wrap('supercalifragilistic ok', 50, 10);
  assert.equal(lines[0], 'supercalifragilistic');
  assert.equal(lines[1], 'ok');
});

test('wrap: an empty string returns one empty line', () => {
  assert.deepEqual(wrap('', 50, 10), ['']);
});

// ── scripts that do not separate words the Latin way ──
test('wrap: Korean breaks at the spaces the script writes, never inside a word', () => {
  assert.deepEqual(wrap('데이터베이스 연결을 확인하고 재시도합니다', 150, 13), ['데이터베이스 연결을', '확인하고 재시도합니다']);
});

test('wrap: a Korean word wider than the line falls back to syllables and loses no character', () => {
  const lines = wrap('데이터베이스연결을확인하고', 60, 13);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), '데이터베이스연결을확인하고');
});

test('wrap: Thai wraps by word inside the line, with no character lost', () => {
  const text = 'ตรวจสอบการเชื่อมต่อฐานข้อมูลแล้วลองอีกครั้ง';
  const lines = wrap(text, 150, 13);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), text);
  for (const l of lines) assert.ok(measure(l, 13) <= 150, `line too wide: ${l}`);
});

test('wrap: a full stop stays with the Thai word before it', () => {
  const lines = wrap('ตรวจสอบการเชื่อมต่อฐานข้อมูลแล้วลองอีกครั้ง.', 150, 13);
  assert.equal(lines.join(''), 'ตรวจสอบการเชื่อมต่อฐานข้อมูลแล้วลองอีกครั้ง.');
  assert.ok(!lines.includes('.'));
});

test('wrap: a Thai word wider than the line falls back to graphemes, so a combining mark stays with its base', () => {
  const lines = wrap('ตรวจสอบการเชื่อมต่อ', 40, 13);
  assert.equal(lines.join(''), 'ตรวจสอบการเชื่อมต่อ');
  assert.ok(lines.every((l) => measure(l, 13) <= 40));
});

test('wrap: the other scripts that write no space between words are split the same way', () => {
  for (const [text, width] of [['ກວດສອບການເຊື່ອມຕໍ່', 90], ['ពិនិត្យការតភ្ជាប់', 90], ['စစ်ဆေးပါ', 90]]) {
    const lines = wrap(text, width, 13);
    assert.equal(lines.join(''), text);
    for (const l of lines) assert.ok(measure(l, 13) <= width, `line too wide: ${l}`);
  }
});

test('wrap: Japanese still breaks per character, as Chinese does', () => {
  assert.deepEqual(wrap('これはとても長い日本語の説明文です', 130, 13), ['これはとても長い日本', '語の説明文です']);
});

