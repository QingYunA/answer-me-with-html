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
