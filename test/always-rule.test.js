import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const MARKER = '[answer-me-with-html always-on]';

// Always-on mode is a rule the user pastes into a rules file. SKILL.md recognizes it by this marker,
// so the README snippets must carry the same one.
test('always-on rule: SKILL.md and both README snippets use the same marker', () => {
  for (const file of ['skills/answer-me-with-html/SKILL.md', 'README.md', 'README.zh-CN.md']) {
    assert.ok(read(file).includes(MARKER), `${file} is missing ${MARKER}`);
  }
});

test('always-on rule: the README snippets ask for --no-open, so no browser opens', () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const snippet = read(file).split('\n').find((l) => l.includes(MARKER));
    assert.match(snippet, /--no-open/, file);
  }
});

test('always-on rule: the README snippets defer the page link format to SKILL.md', () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const snippet = read(file).split('\n').find((l) => l.includes(MARKER));
    assert.match(snippet, /SKILL\.md/, file);
    assert.doesNotMatch(snippet, /file:\/\//, file);
  }
});

// The rule is pasted into a rules file, so an inherited copy has to carry the audience boundary too;
// otherwise a subagent that inherits it renders a page for an internal report (#320).
test('always-on rule: both README snippets exclude internal agent-to-agent reports', () => {
  const en = read('README.md').split('\n').find((l) => l.includes(MARKER));
  assert.match(en, /[Ii]nternal report to another agent/);
  assert.match(en, /make no page/);
  const zh = read('README.zh-CN.md').split('\n').find((l) => l.includes(MARKER));
  assert.match(zh, /子 Agent 向父 Agent 汇报/);
  assert.match(zh, /不要生成页面/);
});

// The website's "copy prompt" button carries the same rule; it drifted from the README before (#324).
test('always-on rule: the website copies match the README snippets word for word', () => {
  for (const [lang, readme] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) {
    const snippet = read(readme).split('\n').find((l) => l.includes(MARKER)).replace(/^> /, '');
    const site = read(`site/i18n/${lang}.js`).split('\n').find((l) => l.startsWith('const ALWAYS_RULE = '));
    const rule = site.slice("const ALWAYS_RULE = '".length, -"';".length).replace(/\\'/g, "'");
    assert.equal(rule, snippet, lang);
  }
});
