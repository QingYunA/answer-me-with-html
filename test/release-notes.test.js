// .github/release-notes.md: the bilingual GitHub Release notes for the version in package.json.
// The release workflow (.github/workflows/release.yml) publishes this file when the version changes, so a release PR that forgot to update it must fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const VERSION = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')).version;
const NOTES = readFileSync(new URL('.github/release-notes.md', ROOT), 'utf8');

test('release notes: the first line is the version marker', () => {
  assert.equal(NOTES.split(/\r?\n/, 1)[0], `<!-- release ${VERSION} -->`, `write .github/release-notes.md for ${VERSION} in the release PR (CONTRIBUTING.md)`);
});

test('release notes: English notes, a --- line, then the Chinese notes', () => {
  const [en, zh, ...rest] = NOTES.split(/^---$/m);
  assert.equal(rest.length, 0, 'only one --- line');
  assert.ok(en.trim() && /[一-鿿]/.test(zh ?? ''), 'English first, then Chinese');
  assert.ok(!/[一-鿿]/.test(en), 'no Chinese before the --- line');
});
