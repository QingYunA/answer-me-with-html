// changelog/<x.y.z>.md: the bilingual notes of each version, one file each. The release workflow (.github/workflows/release.yml) publishes the file of the version in package.json,
// and the website's changelog page is built from all of them, so a release PR that forgot the notes must fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const VERSION = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')).version;
const DIR = new URL('changelog/', ROOT);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');

test('release notes: the file of the current version exists and its marker matches', () => {
  const first = read(`${VERSION}.md`).split(/\r?\n/, 1)[0];
  assert.match(first, new RegExp(`^<!-- release ${VERSION.replaceAll('.', '\\.')} \\d{4}-\\d{2}-\\d{2} -->$`), `write changelog/${VERSION}.md in the release PR (CONTRIBUTING.md)`);
});

test('release notes: English notes, a --- line, then the Chinese notes', () => {
  const [en, zh, ...rest] = read(`${VERSION}.md`).split(/^---$/m);
  assert.equal(rest.length, 0, 'only one --- line');
  assert.ok(en.trim() && /[一-鿿]/.test(zh ?? ''), 'English first, then Chinese');
  assert.ok(!/[一-鿿]/.test(en), 'no Chinese before the --- line');
});

test('release notes: every changelog file has a marker with its own version and a date', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 18);
  for (const f of files) {
    assert.match(f, /^\d+\.\d+\.\d+\.md$/, `${f}: name it <x.y.z>.md`);
    const m = /^<!-- release (\S+) (\d{4})-(\d{2})-(\d{2}) -->$/.exec(read(f).split(/\r?\n/, 1)[0]);
    assert.ok(m, `${f}: the first line must be <!-- release x.y.z YYYY-MM-DD -->`);
    assert.equal(`${m[1]}.md`, f, `${f}: the marker names another version`);
    const d = new Date(`${m[2]}-${m[3]}-${m[4]}T00:00:00Z`);
    assert.equal(d.toISOString().slice(0, 10), `${m[2]}-${m[3]}-${m[4]}`, `${f}: not a real date`);
  }
});
