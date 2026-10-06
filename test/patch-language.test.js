// `am patch` keeps the language of the page it patches (#84). The language of a detected page is not stored in the draft, so patching
// a panel with text that does not show a language must not flip the page to another language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-patch-lang-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const sink = () => {
  let text = '';
  return { stream: new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } }), get text() { return text; } };
};
async function run(args, stdin = '') {
  const out = sink();
  const err = sink();
  const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: dir }, cwd: dir });
  return { code, out: out.text, err: err.text };
}
const htmlLangOf = (file) => readFileSync(join(dir, file), 'utf8').match(/<html lang="([^"]*)"/)?.[1];

// Traditional Chinese, undeclared; the second panel and the replacement text show no script of their own.
const TRADITIONAL = '## A 甲\n這是繁體中文的內容。\n## B 乙\n另一段。\n'; // lang-ok: draft text under test
const NEUTRAL_PANEL = '## A 甲\n三次握手。\n'; // lang-ok: draft text under test

test('cli patch: a detected Traditional Chinese page stays Traditional when the new panel shows no script', async () => {
  assert.equal((await run(['render', '-', '-o', 'trad.html'], TRADITIONAL)).code, 0);
  assert.equal(htmlLangOf('trad.html'), 'zh-Hant');
  const patched = await run(['patch', 'trad.html', '--panel', '甲'], NEUTRAL_PANEL); // lang-ok: panel name under test
  assert.equal(patched.code, 0, patched.err);
  assert.equal(htmlLangOf('trad.html'), 'zh-Hant');
  assert.match(readFileSync(join(dir, 'trad.html'), 'utf8'), /複製源稿/); // lang-ok: Traditional label under test
});

test('cli patch: a detected Korean page keeps its language tag', async () => {
  const korean = '## A 개요\n이것은 한국어로 쓴 짧은 설명입니다.\n## B 설명\n다른 단락입니다.\n'; // lang-ok: draft text under test
  assert.equal((await run(['render', '-', '-o', 'ko.html'], korean)).code, 0);
  assert.equal(htmlLangOf('ko.html'), 'ko');
  assert.equal((await run(['patch', 'ko.html', '--panel', 'A'], '## A 개요\nOK\n')).code, 0); // lang-ok: panel text under test
  assert.equal(htmlLangOf('ko.html'), 'ko');
});

test('cli patch: a declared language stays declared, and a Simplified page stays zh-CN', async () => {
  assert.equal((await run(['render', '-', '-o', 'fr.html'], '---\nlang: fr\n---\n## A One\nBonjour.\n## B Two\nSalut.\n')).code, 0);
  assert.equal((await run(['patch', 'fr.html', '--panel', 'A'], '## A One\nNouvelle phrase.\n')).code, 0);
  assert.equal(htmlLangOf('fr.html'), 'fr');
  assert.equal((await run(['render', '-', '-o', 'zh.html'], '## A 甲\n这是简体中文的内容。\n## B 乙\n另一段。\n')).code, 0); // lang-ok: draft text under test
  assert.equal((await run(['patch', 'zh.html', '--panel', 'A'], '## A 甲\n三次握手。\n')).code, 0); // lang-ok: draft text under test
  assert.equal(htmlLangOf('zh.html'), 'zh-CN');
});

test('cli patch: a Traditional Chinese video stays Traditional when the new scene shows no script', async () => {
  const video = '## 甲\n```flow\nA -> B\n```\n> 這是繁體中文的旁白。\n## 乙\n```flow\nB -> C\n```\n> 另一段旁白。\n'; // lang-ok: draft text under test
  assert.equal((await run(['video', '-', '-o', 'v.html', '--voice', 'off'], video)).code, 0);
  assert.equal(htmlLangOf('v.html'), 'zh-Hant');
  const patched = await run(['patch', 'v.html', '--panel', '甲', '--voice', 'off'], '## 甲\n```flow\nA -> B\n```\n> 三次握手。\n'); // lang-ok: scene text under test
  assert.equal(patched.code, 0, patched.err);
  assert.equal(htmlLangOf('v.html'), 'zh-Hant');
});
