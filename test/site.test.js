// The website's browser engine (site/build.mjs → assets/engine.js) is the real renderer: it must render what the CLI renders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleEngine, fillTemplate } from '../site/build.mjs';
import { renderDoc } from '../src/render.js';
import { CONFIG_KEYS } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(file, 'utf8');
// The footer names the minute the page was made; two renders can fall in different minutes.
const fixClock = (html) => html.replace(/ · \d{4}-\d\d-\d\d \d\d:\d\d<\/footer>/, ' · CLOCK</footer>');
const isPage = (html) => html.startsWith('<!doctype html>') && html.includes('<footer class="am-colophon">') && html.includes('id="am-source"');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

let dir;
let engine;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'am-site-'));
  const { file } = await bundleEngine(join(dir, 'engine.js'));
  engine = await import(pathToFileURL(file).href);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('site engine: exports the version and the page themes', () => {
  assert.equal(engine.VERSION, JSON.parse(read(join(ROOT, 'package.json'))).version);
  assert.ok(engine.THEMES.includes('blueprint') && engine.THEMES.includes('paper'));
  assert.ok(!engine.THEMES.includes('auto'));
});

test('site engine: every page example and every preset renders', () => {
  const examples = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.md') && !f.startsWith('video-')).map((f) => join(ROOT, 'examples', f));
  const presetDir = join(ROOT, 'site/presets');
  const presets = existsSync(presetDir) ? listFiles(presetDir).filter((f) => f.endsWith('.md')) : [];
  assert.ok(examples.length >= 4);
  for (const file of [...examples, ...presets]) {
    const r = engine.render(read(file));
    assert.equal(r.ok, true, `${relative(ROOT, file)}: ${r.error?.message}`);
    assert.ok(isPage(r.html), relative(ROOT, file));
    assert.equal(typeof r.ms, 'number');
  }
});

test('site engine: renders the same HTML as src/render.js', () => {
  const source = read(join(ROOT, 'examples/tcp.en.md'));
  const defaults = { theme: CONFIG_KEYS.theme.default, mode: CONFIG_KEYS.mode.default, style: CONFIG_KEYS.style.default };
  for (const overrides of [{}, { theme: 'shadcn', mode: 'dark' }]) {
    const r = engine.render(source, overrides);
    assert.equal(r.ok, true);
    assert.equal(fixClock(r.html), fixClock(renderDoc(source, overrides, defaults).html));
  }
});

test('site engine: a broken draft returns the error with its line and an example', () => {
  const r = engine.render('# Broken\n\n## A\n\n```flow\n[] -> B\n```\n');
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'RenderError');
  assert.equal(r.error.component, 'flow');
  assert.equal(typeof r.error.line, 'number');
  assert.match(r.error.example, /```flow/);
  const bad = engine.render('# T', { theme: 'nope' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.name, 'ParseError');
});

test('site engine: a local file degrades into the usual not-found error', () => {
  const r = engine.render('# T\n\n```js src=server.js\n```\n');
  assert.equal(r.ok, false);
  assert.match(r.error.message, /not found/);
});

test('site engine: lint checks plain prose with lines counted in the text', () => {
  const warnings = engine.lint('This method is utilized prior to the request.', 'en');
  assert.ok(warnings.some((w) => w.rule === 'word' && w.line === 1), JSON.stringify(warnings));
  assert.ok(engine.lint('One line.\n\nThe file was written by the server.').some((w) => w.rule === 'passive' && w.line === 3));
});

test('site build: fills built-in keys first and reports unknown ones', () => {
  const { html, missing } = fillTemplate('<html lang="{{LANG}}">{{ title }}{{nope}}', { title: '<b>Hi</b>', LANG: 'x' }, { LANG: 'en' });
  assert.equal(html, '<html lang="en"><b>Hi</b>{{nope}}');
  assert.deepEqual(missing, ['nope']);
});

test('site build: the built pages load no script or style from another site', { skip: !existsSync(join(ROOT, 'site/dist/index.html')) }, () => {
  for (const page of ['index.html', 'zh/index.html']) {
    const html = read(join(ROOT, 'site/dist', page));
    // canonical and hreflang links name the site's own address and load nothing, so only links that fetch count.
    const loaders = [...html.matchAll(/<script\b[^>]*>|<link\b[^>]*\brel=["']?(?:stylesheet|modulepreload|preload|icon)\b[^>]*>/gi)].map((m) => m[0]);
    const external = loaders.filter((tag) => /\s(?:src|href)=["']?(?:https?:)?\/\//i.test(tag));
    assert.deepEqual(external, [], page);
  }
});
