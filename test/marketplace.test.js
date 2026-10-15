// The theme catalog (issue #219): every file in marketplace/themes/ must be a valid, self-contained theme that renders.
// A contributor's catalog PR is checked by this file; the per-file rules live in src/themes/catalog-rules.js (shared with the website
// and the submission Action); see CONTRIBUTING.md, "Theme catalog".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDoc } from '../src/render.js';
import { loadThemes } from '../src/themes/registry.js';
import { catalogProblems } from '../src/themes/catalog-rules.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'marketplace/themes');
const FILES = readdirSync(DIR).sort();
const BANGERS_FACE = /@font-face \{\s*font-family: "Bangers"/g;

const nameOf = (file) => file.replace(/\.json$/, '');

let home;
before(() => {
  home = mkdtempSync(join(tmpdir(), 'am-marketplace-'));
  mkdirSync(join(home, 'themes'));
  for (const f of FILES) copyFileSync(join(DIR, f), join(home, 'themes', f));
});
after(() => rmSync(home, { recursive: true, force: true }));

// Submitted themes join the catalog, so the list only has to keep the first ones.
test('catalog: the first themes are there', () => {
  for (const file of ['comic.json', 'manga.json', 'pop.json']) assert.ok(FILES.includes(file), file);
});

for (const file of FILES) {
  const name = nameOf(file);

  test(`catalog ${name}: the file is <name>.json and follows every catalog rule`, () => {
    assert.match(file, /\.json$/);
    const others = FILES.filter((f) => f !== file).map(nameOf);
    const problems = catalogProblems(name, readFileSync(join(DIR, file), 'utf8'), { existing: others });
    assert.deepEqual(problems, [], 'src/themes/catalog-rules.js lists the rules');
  });

  test(`catalog ${name}: renders examples/tcp.en.md from a themes folder with the requested shipped font`, () => {
    const themes = loadThemes(home);
    assert.deepEqual(themes.warnings, []);
    assert.ok(themes.get(name), `${name} is loaded`);
    const { html } = renderDoc(readFileSync(join(ROOT, 'examples/tcp.en.md'), 'utf8'), { theme: name }, {}, { themes });
    const expectedBangersFaces = JSON.parse(readFileSync(join(DIR, file), 'utf8')).font === 'bangers' ? 1 : 0;
    assert.equal((html.match(BANGERS_FACE) ?? []).length, expectedBangersFaces);
    assert.ok(html.includes(`html[data-theme="${name}"]`));
    // The page's own Content-Security-Policy is the one http-equiv it may carry.
    assert.doesNotMatch(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), /http-equiv|@import/);
  });
}

test('catalog: names are unique even when case or separators differ', () => {
  const names = FILES.map((f) => nameOf(f).toLowerCase());
  assert.equal(new Set(names).size, names.length);
});
