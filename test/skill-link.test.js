import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL = readFileSync(`${ROOT}/skills/answer-me-with-html/SKILL.md`, 'utf8');

// DeepSeek Harness turns a Markdown link to a path into a file reference that opens the page in its
// right sidebar. A `file://` URL stays plain text there, so the instruction needs both forms.
test('page link: SKILL.md gives DeepSeek Harness a path link and the other hosts a file:// URL', () => {
  const line = SKILL.split('\n').find((l) => l.includes('In DeepSeek Harness write the path'));
  assert.ok(line, 'the page-link instruction has no DeepSeek Harness branch');
  assert.match(line, /\[reports\/page\.html\]\(reports\/page\.html\)/, 'no relative path link');
  assert.match(line, /\[page\.html\]\(<C:\/Users\/you\/pages\/page\.html>\)/, 'no absolute path link');
  assert.match(line, /angle brackets/, 'no angle-bracket rule for a path with a space');
  assert.match(line, /\[file:\/\/\/abs\/path\.html\]\(file:\/\/\/abs\/path\.html\)/, 'the other hosts lost the file:// URL');
});
