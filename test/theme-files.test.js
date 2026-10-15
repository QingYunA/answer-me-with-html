// Theme file fields beyond colors: font, requires, the external-resource check and the selector contract (issue #219).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { loadThemes } from '../src/themes/registry.js';
import { normalizeTheme, externalResources, COLOR_TOKENS } from '../src/themes/check.js';
import { THEME_SELECTORS } from '../src/themes/selectors.js';
import { FONT_NAMES } from '../src/themes/font-css.js';
import { VERSION } from '../src/assets.js';

let home;
before(() => { home = mkdtempSync(join(tmpdir(), 'am-theme-files-')); });
after(() => rmSync(home, { recursive: true, force: true }));

const DRAFT = '## A 流程\n客户端先发送请求，服务端再返回结果。\n```flow\nA -> B\n```\n';
const VIDEO = '---\ntitle: T\n---\n## A\n```flow\nA -> B\n```\n> A goes to B.\n';
const BANGERS_FACE = /@font-face \{\s*font-family: "Bangers"/g;

const light = { '--bg': '#ffffff', '--paper': '#ffffff', '--ink': '#111111', '--ink-2': '#333333', '--ink-3': '#666666', '--line': '#111111', '--line-2': '#dddddd', '--fill': '#f5f5f5', '--accent': '#0050a0', '--accent-bg': '#dff1fb', '--ok': '#1e6a3c', '--ok-bg': '#e0f3e5', '--err': '#b0122f', '--err-bg': '#fde3e7', '--warn': '#7a4c00', '--warn-bg': '#fff3c7', '--head-bg': '#ffe600', '--head-fg': '#111111' };
const dark = { '--bg': '#111114', '--paper': '#18181d', '--ink': '#f2f2f2', '--ink-2': '#c9c9c9', '--ink-3': '#a0a0a0', '--line': '#f2f2f2', '--line-2': '#36363f', '--fill': '#22222a', '--accent': '#5cc8f5', '--accent-bg': '#16334a', '--ok': '#7fd394', '--ok-bg': '#1b3424', '--err': '#ff8296', '--err-bg': '#45202a', '--warn': '#ffd24d', '--warn-bg': '#3b3014', '--head-bg': '#ffe600', '--head-fg': '#111111' };
const themeFile = (extra = {}) => ({ label: 'Test', tokens: { light, dark }, ...extra });

function install(name, data) {
  mkdirSync(join(home, 'themes'), { recursive: true });
  const file = join(home, 'themes', `${name}.json`);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

async function run(args) {
  let out = '';
  let err = '';
  const sink = (fn) => new Writable({ write(c, _e, cb) { fn(String(c)); cb(); } });
  const code = await main(args, {
    stdout: sink((s) => { out += s; }), stderr: sink((s) => { err += s; }), stdin: Readable.from(['']),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: home }, cwd: home,
  });
  return { code, out, err };
}

test('font: a user theme with font bangers embeds the Bangers face once; a built-in theme does not', () => {
  install('stripe', themeFile({ font: 'bangers', css: '& .am-head h1 { font-family: "Bangers", Impact, sans-serif; }' }));
  const themes = loadThemes(home);
  assert.deepEqual(themes.warnings, []);
  const { html } = renderDoc(DRAFT, { theme: 'stripe' }, {}, { themes });
  assert.equal(html.match(BANGERS_FACE)?.length, 1);
  assert.match(html, /SIL Open Font License/);
  for (const theme of ['blueprint', 'shadcn', 'paper']) {
    assert.doesNotMatch(renderDoc(DRAFT, { theme }, {}, { themes }).html, /Bangers|SIL Open Font License/, `${theme} page carries no font`);
  }
});

test('font: a theme without a font field embeds no font face, and a video page never does', async () => {
  install('plain', themeFile());
  install('stripe', themeFile({ font: 'bangers' }));
  const themes = loadThemes(home);
  assert.doesNotMatch(renderDoc(DRAFT, { theme: 'plain' }, {}, { themes }).html, /Bangers/);
  const { html } = await renderVideo(VIDEO, { overrides: { theme: 'stripe' }, themes });
  assert.doesNotMatch(html, /Bangers/);
});

test('font: an unknown font name is an error that names the allowed values', () => {
  for (const font of ['comic-sans', '', 3, null]) {
    const { errors } = normalizeTheme('x', themeFile({ font }));
    assert.ok(errors.some((e) => e.includes(`font must be one of: ${FONT_NAMES.join(', ')}`)), `font ${JSON.stringify(font)}: ${errors}`);
  }
  assert.deepEqual(normalizeTheme('x', themeFile({ font: 'bangers' })).errors, []);
  assert.equal(normalizeTheme('x', themeFile({ font: 'bangers' })).theme.font, 'bangers');
});

test('requires: a bad format is an error', () => {
  for (const requires of ['1.2', 'v1.2.3', '1.2.3-beta', 'latest', 3, null]) {
    const { errors } = normalizeTheme('x', themeFile({ requires }));
    assert.ok(errors.some((e) => /requires must be a version in x\.y\.z format/.test(e)), `requires ${JSON.stringify(requires)}`);
  }
});

test('requires: a version newer than the running one is an error, older or equal is fine', () => {
  const [major, minor, patch] = VERSION.split('.').map(Number);
  const newer = `${major}.${minor}.${patch + 1}`;
  const { errors } = normalizeTheme('x', themeFile({ requires: newer }));
  assert.deepEqual(errors, [`needs Answer me with HTML ${newer} or newer`]);
  assert.deepEqual(normalizeTheme('x', themeFile({ requires: VERSION })).errors, []);
  assert.deepEqual(normalizeTheme('x', themeFile({ requires: '0.0.1' })).errors, []);
});

test('requires: a theme that needs a newer version is skipped with the reason', () => {
  install('future', themeFile({ requires: '99.0.0' }));
  const themes = loadThemes(home);
  assert.equal(themes.get('future'), undefined);
  assert.ok(themes.warnings.some((w) => w.includes('themes/future.json skipped: needs Answer me with HTML 99.0.0 or newer')));
});

test('theme files: fields this version does not know are ignored', () => {
  const { theme, errors } = normalizeTheme('x', themeFile({ added_in_a_later_version: { anything: true }, other: 1 }));
  assert.deepEqual(errors, []);
  assert.ok(theme);
});

test('externalResources: finds http and protocol-relative urls, @import and @font-face', () => {
  assert.deepEqual(externalResources('& .am-head { background: url(http://a.example/x.png); }'), ['url(http://a.example/x.png)']);
  assert.deepEqual(externalResources('& .am-head { background: url("https://a.example/x.png") }'), ['url(https://a.example/x.png)']);
  assert.deepEqual(externalResources("& .am-head { background: url( '//cdn.example/x.png' ) }"), ['url(//cdn.example/x.png)']);
  assert.deepEqual(externalResources('@import url(a.css); & .am-head { color: red }'), ['@import']);
  assert.deepEqual(externalResources('@IMPORT "a.css";'), ['@import']);
  assert.deepEqual(externalResources('@font-face { font-family: X; src: local(X) }'), ['@font-face']);
});

test('externalResources: finds a link inside image-set() and -webkit-image-set(), which needs no url()', () => {
  assert.deepEqual(externalResources('& .am-head { background: image-set("https://x.example/a.png" 1x) }'), ['image-set(https://x.example/a.png)']);
  assert.deepEqual(externalResources("& .am-head { background: -webkit-image-set('//x.example/a.png' 1x, 'b.png' 2x) }"), ['image-set(//x.example/a.png)']);
  assert.deepEqual(externalResources('& .am-head { background: IMAGE-SET( "http://x.example/a.png" 1x ) }'), ['image-set(http://x.example/a.png)']);
  assert.deepEqual(externalResources('& .am-head { background: image-set("a.png" 1x, "b.png" 2x) }'), []);
});

test('externalResources: reports any backslash, because an escape can spell url( where no check reads it', () => {
  const escape = 'escape sequence (\\)';
  assert.deepEqual(externalResources('& .am-head { background: u\\72 l(https://x.example/a.png) }'), [escape]);
  assert.deepEqual(externalResources('& .am-head { background: \\75 rl(https://x.example/a.png) }'), [escape]);
  assert.deepEqual(externalResources('@\\69 mport "a.css";'), [escape]);
  assert.deepEqual(externalResources('/* a \\ in a comment */ & .am-head { color: red }'), []);
});

test('externalResources: a relative url() and a data url are still allowed', () => {
  assert.deepEqual(externalResources('& .am-head { background: url(img.png) }'), []);
  assert.deepEqual(externalResources('& .am-head { background: url("./img.png") }'), []);
  assert.deepEqual(externalResources('& .am-head { background: url(data:image/svg+xml;utf8,<svg/>) }'), []);
});

test('externalResources: ignores data urls, local references, comments and non-strings', () => {
  assert.deepEqual(externalResources('& .am-head { background: url(data:image/png;base64,AAAA); }'), []);
  assert.deepEqual(externalResources('& .am-head { background: url(#frag); mask: url(x.svg) }'), []);
  assert.deepEqual(externalResources('/* url(https://a.example/x.png) @import "a"; @font-face {} */ & .am-head { color: red }'), []);
  assert.deepEqual(externalResources(undefined), []);
});

test('externalResources: normalizeTheme does not turn them into errors, so existing themes keep working', () => {
  const css = '@import "a.css"; @font-face { font-family: X } & .am-head { background: url(https://a.example/x.png) }';
  const { errors } = normalizeTheme('x', themeFile({ css, video: { css: '& .amv-title { background: url(//a.example/x.png) }' } }));
  assert.ok(!errors.some((e) => /@import|@font-face|url|external/i.test(e)), errors.join('; '));
});

test('am theme check: warns about external resources in css and video.css and still passes', async () => {
  const file = install('linked', themeFile({
    css: '& .am-head { background: url(https://a.example/x.png); }\n/* url(https://b.example/ignored.png) */',
    video: { css: '@import "v.css"; & .amv-title { font-weight: 500; }' },
  }));
  const { code, out } = await run(['theme', 'check', file, '--no-open']);
  assert.equal(code, 0, out);
  assert.match(out, /^! css: url\(https:\/\/a\.example\/x\.png\) loads or embeds something outside the theme file/m);
  assert.match(out, /^! video\.css: @import loads or embeds/m);
  assert.doesNotMatch(out, /ignored\.png/);
  assert.match(out, /linked: 0 errors, 2 warnings/);
});

test('am theme check: a theme without external resources has no such warning', async () => {
  const file = install('clean', themeFile({ font: 'bangers', css: '& .am-head h1 { font-family: "Bangers", Impact, sans-serif; }' }));
  const { code, out } = await run(['theme', 'check', file, '--no-open']);
  assert.equal(code, 0, out);
  assert.match(out, /clean: 0 errors, 0 warnings/);
});

test('am help theme: describes font, requires, the selector list and the external-resource rule', async () => {
  const { out } = await run(['help', 'theme']);
  assert.match(out, /^- font \(optional\)/m);
  assert.match(out, /^- requires \(optional\)/m);
  for (const selector of THEME_SELECTORS) assert.ok(out.includes(selector), `help names ${selector}`);
  assert.match(out, /no url\(\) or image-set\(\) to http\(s\)/);
  assert.match(out, /no backslash escapes/);
});

test('selectors: every class in THEME_SELECTORS exists in base.css', () => {
  const base = readFileSync(new URL('../src/themes/base.css', import.meta.url), 'utf8');
  assert.ok(Object.isFrozen(THEME_SELECTORS));
  assert.equal(new Set(THEME_SELECTORS).size, THEME_SELECTORS.length, 'no duplicates');
  for (const selector of THEME_SELECTORS) {
    const classes = selector.match(/\.[a-z][a-z0-9_-]*/gi);
    assert.ok(classes?.length, `${selector} names a class`);
    for (const cls of classes) {
      assert.ok(new RegExp(`${cls.replace(/[-]/g, '\\-')}(?![\\w-])`).test(base), `${selector}: base.css has no ${cls}; classes in THEME_SELECTORS are not removed or renamed (CONTRIBUTING.md, Theme compatibility)`);
    }
  }
});

test('selectors: the built-in themes only target classes in THEME_SELECTORS', async () => {
  const { themes } = await import('../src/themes/registry.js');
  const known = new Set(THEME_SELECTORS.flatMap((s) => s.match(/\.[a-z][a-z0-9_-]*/gi)));
  for (const t of themes('page')) {
    for (const cls of (t.css ?? '').match(/\.am-[a-z0-9_-]+/gi) ?? []) assert.ok(known.has(cls), `${t.name} targets ${cls}, which THEME_SELECTORS does not list`);
  }
});

test('COLOR_TOKENS: pinned to 18 entries, because a theme file written today must keep rendering', () => {
  assert.deepEqual([...COLOR_TOKENS], [
    '--bg', '--paper', '--ink', '--ink-2', '--ink-3', '--line', '--line-2', '--fill', '--accent', '--accent-bg',
    '--ok', '--ok-bg', '--err', '--err-bg', '--warn', '--warn-bg', '--head-bg', '--head-fg',
  ], 'The required color tokens never grow: a new token must have a default instead (CONTRIBUTING.md, Theme compatibility).');
  assert.equal(COLOR_TOKENS.length, 18);
});
