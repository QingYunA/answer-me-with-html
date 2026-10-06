// The language directory is data. This test keeps it complete: a language file may not be missing a label that English has,
// and every built-in theme must have a name in every language. Its output is the translation status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, FALLBACK } from '../src/languages/registry.js';
import { themes } from '../src/themes/registry.js';

// The label keys of a label set, nested keys as dotted paths.
const keysOf = (value, prefix = '') =>
  Object.entries(value).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();

for (const entry of LANGUAGES) {
  test(`languages: ${entry.id} has every page and player label that English has`, () => {
    assert.deepEqual(keysOf(entry.ui), keysOf(FALLBACK.ui));
    assert.deepEqual(keysOf(entry.videoUi), keysOf(FALLBACK.videoUi));
  });

  test(`languages: ${entry.id} has a label for every built-in page theme`, () => {
    for (const theme of themes('page')) {
      assert.equal(typeof theme.label[entry.id], 'string', `theme ${theme.name} has no ${entry.id} label`);
      assert.ok(theme.label[entry.id].length > 0);
    }
  });
}

test('languages: ids are unique, and a language file with several scripts names its script', () => {
  const ids = LANGUAGES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const language of new Set(LANGUAGES.map((l) => l.language))) {
    const entries = LANGUAGES.filter((l) => l.language === language);
    if (entries.length > 1) assert.ok(entries.every((e) => e.script), `${language} has several files, each must name a script`);
  }
});

test('languages: a language that sets fonts also names the language ranges the fonts apply to', () => {
  for (const entry of LANGUAGES.filter((l) => l.fonts)) {
    assert.ok(Array.isArray(entry.langs) && entry.langs.length > 0, `${entry.id} sets fonts without langs`);
    assert.equal(typeof entry.fonts.sans, 'string');
    assert.equal(typeof entry.fonts.serif, 'string');
  }
});
