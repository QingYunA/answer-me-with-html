// catalogProblems (src/themes/catalog-rules.js) is the one list of rules for a catalog file. test/marketplace.test.js runs it on every
// file in marketplace/themes/; this file shows that each rule fails on a small bad input, and that the problem names the right field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogProblems, MAX_BYTES, MAX_NAME } from '../src/themes/catalog-rules.js';

const read = (name) => readFileSync(fileURLToPath(new URL(`../marketplace/themes/${name}.json`, import.meta.url)), 'utf8');
const COMIC = read('comic');
const DIAGRAM_KEY = /^--(node|edge|hi|actor|note|cluster|lifeline)-/;

// The text of comic.json after change(data) edited a copy of it.
const edited = (change) => {
  const data = JSON.parse(COMIC);
  change(data);
  return JSON.stringify(data);
};
const fields = (name, text, options) => catalogProblems(name, text, options).map((p) => p.field);
const dropDiagramTokens = (group) => {
  for (const k of Object.keys(group)) if (DIAGRAM_KEY.test(k)) delete group[k];
};

test('catalogProblems: every file of the catalog passes', () => {
  for (const name of ['comic', 'manga', 'pop']) assert.deepEqual(catalogProblems(name, read(name)), [], name);
});

test('catalogProblems: a name has at most MAX_NAME characters', () => {
  assert.deepEqual(catalogProblems('a'.repeat(MAX_NAME), read('comic')), []);
  assert.deepEqual(catalogProblems('a'.repeat(MAX_NAME + 1), read('comic')).map((p) => p.field), ['name']);
});

test('catalogProblems: each problem is a field and a plain sentence', () => {
  const problems = catalogProblems('Bad Name', edited((d) => { d.version = '1'; }));
  assert.ok(problems.length >= 2);
  for (const p of problems) {
    assert.deepEqual(Object.keys(p).sort(), ['field', 'message']);
    assert.match(p.message, /^[A-Z].*[.!?]$/, p.message);
  }
});

test('catalogProblems: the text must be a JSON object', () => {
  for (const text of ['{ nope', '[]', '"text"', 'null', '']) assert.deepEqual(fields('x', text), ['json'], JSON.stringify(text));
  assert.match(catalogProblems('x', '{ nope')[0].message, /not valid JSON/);
});

test('catalogProblems: the name uses lowercase letters, digits and -', () => {
  for (const name of ['Comic2', 'a b', '../x', '-x', '', 'a_b', 'a.json']) assert.deepEqual(fields(name, COMIC), ['name'], JSON.stringify(name));
  assert.deepEqual(fields(undefined, COMIC), ['name']);
  assert.deepEqual(fields('comic-2', COMIC), []);
});

test('catalogProblems: a built-in name and index are taken', () => {
  for (const name of ['blueprint', 'shadcn', 'paper', 'index', 'new']) assert.deepEqual(fields(name, COMIC), ['name'], name);
});

test('catalogProblems: a name already in the catalog is taken, whatever its case', () => {
  assert.deepEqual(fields('pop', COMIC, { existing: ['pop'] }), ['name']);
  assert.deepEqual(fields('pop', COMIC, { existing: ['POP'] }), ['name']);
  assert.deepEqual(fields('pop', COMIC, { existing: ['manga'] }), []);
});

test('catalogProblems: at most 16 KB, counted in bytes', () => {
  assert.ok(fields('x', edited((d) => { d.description.zh = 'x'.repeat(MAX_BYTES); })).includes('size'));
  // 5500 characters of 3 bytes each are 16.1 KB, but only 5500 UTF-16 units.
  const wide = edited((d) => { d.description.zh = '字'.repeat(5500); });
  assert.ok(wide.length < MAX_BYTES);
  assert.ok(fields('x', wide).includes('size'));
  assert.ok(!fields('x', edited((d) => { d.description.zh = '字'.repeat(100); })).includes('size'));
});

test('catalogProblems: normalizeTheme errors point at the field they belong to', () => {
  const light = catalogProblems('x', edited((d) => { delete d.tokens.light['--ink']; }));
  assert.deepEqual(light.map((p) => p.field), ['tokens.light']);
  assert.equal(light[0].message, 'Light mode is missing --ink.');
  assert.ok(fields('x', edited((d) => { d.tokens.dark['--ink'] = 'red;'; })).every((f) => f === 'tokens.dark'));
  assert.deepEqual(fields('x', edited((d) => { d.font = 'comic-sans'; })), ['font']);
  assert.deepEqual(fields('x', edited((d) => { d.requires = 'soon'; })), ['requires']);
  assert.deepEqual(fields('x', edited((d) => { d.css = 'body { color: red; }'; })), ['css']);
  assert.deepEqual(fields('x', edited((d) => { d.label = { en: 5, zh: 'x' }; })), ['label', 'label.en']);
});

test('catalogProblems: a color pair with too little contrast is a problem', () => {
  const found = catalogProblems('x', edited((d) => { d.tokens.dark['--ink'] = d.tokens.dark['--paper']; }));
  assert.ok(found.length > 0);
  assert.ok(found.every((p) => p.field === 'tokens.dark'));
  assert.match(found[0].message, /contrast/);
});

test('catalogProblems: no link, font face or escape in css or a token', () => {
  const css = edited((d) => { d.css = `${d.css ?? ''}\n& .am-head { background: url(https://example.com/a.png); }`; });
  assert.ok(fields('x', css).every((f) => f === 'css'));
  assert.ok(catalogProblems('x', css).some((p) => /from outside the theme file/.test(p.message)));
  for (const bad of ['@import "a.css";', '@font-face { font-family: A; }', '& .am-head { content: "\\41"; }']) {
    assert.ok(catalogProblems('x', edited((d) => { d.css = bad; })).some((p) => p.field === 'css'), bad);
  }
  const token = edited((d) => { d.tokens.common['--node-shadow'] = 'drop-shadow(0 0 1px url(https://example.com/a.svg))'; });
  assert.ok(fields('x', token).includes('tokens.common'));
});

test('catalogProblems: the metadata is complete', () => {
  assert.deepEqual(fields('x', edited((d) => { delete d.version; })), ['version']);
  assert.deepEqual(fields('x', edited((d) => { d.version = '1.0'; })), ['version']);
  assert.deepEqual(fields('x', edited((d) => { d.author = '  '; })), ['author']);
  assert.deepEqual(fields('x', edited((d) => { delete d.license; })), ['license']);
  assert.deepEqual(fields('x', edited((d) => { delete d.description; })), ['description.en']);
  assert.deepEqual(fields('x', edited((d) => { d.description.en = ''; })), ['description.en']);
  assert.deepEqual(fields('x', edited((d) => { d.description.fr = 7; })), ['description.fr']);
  assert.deepEqual(fields('x', edited((d) => { d.label = 'Comic'; })), ['label']);
  assert.deepEqual(fields('x', edited((d) => { delete d.label.zh; })), ['label.zh']);
  assert.deepEqual(fields('x', edited((d) => { delete d.label.en; })), ['label.en']);
});

test('catalogProblems: css targets only the classes a theme may style', () => {
  const found = catalogProblems('x', edited((d) => { d.css = '& .not-a-class, & .am-head { color: inherit; } /* .only-in-a-comment */'; }));
  assert.deepEqual(found.map((p) => p.field), ['css']);
  assert.match(found[0].message, /\.not-a-class/);
  assert.doesNotMatch(found[0].message, /only-in-a-comment/);
  assert.deepEqual(fields('x', edited((d) => { d.css = '& .am-head h1 { color: inherit; }'; })), []);
});

test('catalogProblems: diagrams are styled with at least 8 tokens in light and dark', () => {
  const none = edited((d) => { for (const mode of ['common', 'light', 'dark']) dropDiagramTokens(d.tokens[mode]); });
  assert.deepEqual(fields('x', none), ['tokens.light', 'tokens.dark']);
  // Tokens in common count for both modes, so only the mode that lost them is a problem.
  const lightOnly = edited((d) => { dropDiagramTokens(d.tokens.common); dropDiagramTokens(d.tokens.light); });
  assert.deepEqual(fields('x', lightOnly), ['tokens.light']);
});

test('catalogProblems: css does not reach into a diagram', () => {
  for (const css of ['& svg { color: red; }', '& [data-key] { color: red; }']) assert.deepEqual(fields('x', edited((d) => { d.css = css; })), ['css'], css);
  // .am-node is also not a class a theme may style, so it is two problems.
  assert.deepEqual(fields('x', edited((d) => { d.css = '& .am-node { fill: red; }'; })), ['css', 'css']);
});
