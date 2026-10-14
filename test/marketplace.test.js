// The theme catalog (issue #219): every file in marketplace/themes/ must be a valid, self-contained theme that renders.
// A contributor's catalog PR is checked by this file; see CONTRIBUTING.md, "Theme catalog".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDoc } from '../src/render.js';
import { loadThemes, BUILTIN_NAMES } from '../src/themes/registry.js';
import { normalizeTheme, checkColors, themeLinks, DIAGRAM_TOKENS, NAME } from '../src/themes/check.js';
import { THEME_SELECTORS } from '../src/themes/selectors.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'marketplace/themes');
const MAX_BYTES = 16 * 1024;
const FILES = readdirSync(DIR).sort();
const KNOWN_CLASSES = new Set(THEME_SELECTORS.flatMap((s) => s.match(/\.[a-z][a-z0-9_-]*/gi)));
const BANGERS_FACE = /@font-face \{\s*font-family: "Bangers"/g;

const parse = (file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'));
const nameOf = (file) => file.replace(/\.json$/, '');

let home;
before(() => {
  home = mkdtempSync(join(tmpdir(), 'am-marketplace-'));
  mkdirSync(join(home, 'themes'));
  for (const f of FILES) copyFileSync(join(DIR, f), join(home, 'themes', f));
});
after(() => rmSync(home, { recursive: true, force: true }));

test('catalog: the first themes are there', () => {
  assert.deepEqual(FILES, ['comic.json', 'manga.json', 'pop.json']);
});

for (const file of FILES) {
  const name = nameOf(file);

  test(`catalog ${name}: valid JSON, a name nobody else can take, and at most 16 KB`, () => {
    assert.match(file, /\.json$/);
    assert.match(name, NAME, 'the file name is the theme name');
    assert.ok(!BUILTIN_NAMES.includes(name), `"${name}" is a built-in theme name`);
    assert.notEqual(name, 'index', 'themes/index.json is the catalog list');
    assert.doesNotThrow(() => parse(file));
    assert.ok(statSync(join(DIR, file)).size <= MAX_BYTES, `${file} is larger than 16 KB`);
  });

  test(`catalog ${name}: normalizeTheme finds no error, and the colors pass in light and dark`, () => {
    const { theme, errors } = normalizeTheme(name, parse(file), BUILTIN_NAMES);
    assert.deepEqual(errors, []);
    assert.deepEqual(checkColors(theme).errors, []);
  });

  test(`catalog ${name}: no link or embedded font in css, video.css or a token value`, () => {
    const { theme } = normalizeTheme(name, parse(file), BUILTIN_NAMES);
    assert.deepEqual(themeLinks(theme), []);
  });

  test(`catalog ${name}: styles its diagrams with tokens, in light and dark, and never with selectors`, () => {
    const data = parse(file);
    const set = (mode) => ({ ...data.tokens.common, ...data.tokens[mode] });
    for (const mode of ['light', 'dark']) {
      assert.ok(DIAGRAM_TOKENS.filter((k) => set(mode)[k] !== undefined).length >= 8, `${mode} sets at least 8 diagram tokens`);
    }
    assert.doesNotMatch(data.css ?? '', /\.am-(diagram|node|edge|arrow|cluster|lifeline|actor|note|step)|\bsvg\b|data-key/, 'css does not reach into a diagram');
  });

  test(`catalog ${name}: carries its catalog metadata`, () => {
    const data = parse(file);
    assert.match(data.version, /^\d+\.\d+\.\d+$/);
    assert.ok(typeof data.author === 'string' && data.author.trim(), 'author');
    assert.ok(typeof data.license === 'string' && data.license.trim(), 'license');
    assert.ok(typeof data.description?.en === 'string' && data.description.en.trim(), 'description.en');
    for (const text of Object.values(data.description)) assert.equal(typeof text, 'string');
    assert.ok(data.label && typeof data.label === 'object' && data.label.en && data.label.zh, 'label has en and zh');
  });

  test(`catalog ${name}: css targets only classes in THEME_SELECTORS`, () => {
    const css = (parse(file).css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const cls of css.match(/\.[a-z][a-z0-9_-]*/gi) ?? []) assert.ok(KNOWN_CLASSES.has(cls), `${file} targets ${cls}, which THEME_SELECTORS does not list`);
  });

  test(`catalog ${name}: renders examples/tcp.en.md from a themes folder and embeds the Bangers face once`, () => {
    const themes = loadThemes(home);
    assert.deepEqual(themes.warnings, []);
    assert.ok(themes.get(name), `${name} is loaded`);
    const { html } = renderDoc(readFileSync(join(ROOT, 'examples/tcp.en.md'), 'utf8'), { theme: name }, {}, { themes });
    assert.equal(html.match(BANGERS_FACE)?.length, 1);
    assert.ok(html.includes(`html[data-theme="${name}"]`));
    assert.doesNotMatch(html, /http-equiv|@import/);
  });
}

test('catalog: names are unique even when case or separators differ', () => {
  const names = FILES.map((f) => nameOf(f).toLowerCase());
  assert.equal(new Set(names).size, names.length);
});
