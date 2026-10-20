// Diagram tokens: a theme restyles what is inside a diagram with optional tokens. Each has a default, so a theme that sets none
// draws what it always did; values are validated; text tokens are contrast-checked; values go through the external-resource check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { renderDoc } from '../src/render.js';
import { BASE_CSS, CHART_CSS } from '../src/assets.js';
import { themes, withThemes } from '../src/themes/registry.js';
import { normalizeTheme, checkColors, themeLinks, externalResourceWarnings, DIAGRAM_TOKENS, COLOR_TOKENS } from '../src/themes/check.js';

const light = { '--bg': '#ffffff', '--paper': '#ffffff', '--ink': '#111111', '--ink-2': '#333333', '--ink-3': '#666666', '--line': '#111111', '--line-2': '#dddddd', '--fill': '#f5f5f5', '--accent': '#0050a0', '--accent-bg': '#dff1fb', '--ok': '#1e6a3c', '--ok-bg': '#e0f3e5', '--err': '#b0122f', '--err-bg': '#fde3e7', '--warn': '#7a4c00', '--warn-bg': '#fff3c7', '--head-bg': '#ffe600', '--head-fg': '#111111' };
const dark = { '--bg': '#111114', '--paper': '#18181d', '--ink': '#f2f2f2', '--ink-2': '#c9c9c9', '--ink-3': '#a0a0a0', '--line': '#f2f2f2', '--line-2': '#36363f', '--fill': '#22222a', '--accent': '#5cc8f5', '--accent-bg': '#16334a', '--ok': '#7fd394', '--ok-bg': '#1b3424', '--err': '#ff8296', '--err-bg': '#45202a', '--warn': '#ffd24d', '--warn-bg': '#3b3014', '--head-bg': '#ffe600', '--head-fg': '#111111' };
// A theme file with extra tokens in common, light and dark.
const themeWith = ({ common = {}, light: l = {}, dark: d = {}, ...rest } = {}) => ({ label: 'T', tokens: { common, light: { ...light, ...l }, dark: { ...dark, ...d } }, ...rest });
const check = (data) => {
  const { theme, errors } = normalizeTheme('t', data);
  return { theme, errors, ...checkColors(theme) };
};

let home;
before(() => { home = mkdtempSync(join(tmpdir(), 'am-diagram-tokens-')); });
after(() => rmSync(home, { recursive: true, force: true }));

test('DIAGRAM_TOKENS: the list is frozen, and the required color tokens did not grow', () => {
  assert.ok(Object.isFrozen(DIAGRAM_TOKENS));
  assert.equal(new Set(DIAGRAM_TOKENS).size, DIAGRAM_TOKENS.length);
  assert.equal(COLOR_TOKENS.length, 18);
  for (const token of DIAGRAM_TOKENS) assert.ok(!COLOR_TOKENS.includes(token), `${token} is optional`);
});

test('base.css: every diagram token is read with a fallback, so a theme that sets none draws what it always did', () => {
  // The series tokens are read by chart.css, which a page carries only when it has a chart.
  const css = `${BASE_CSS}\n${CHART_CSS}`;
  for (const token of DIAGRAM_TOKENS) {
    assert.match(css, new RegExp(`var\\(${token}, `), `the page styles read ${token} with a fallback`);
    assert.doesNotMatch(css, new RegExp(`var\\(${token}\\)`), `${token} is never read without a fallback`);
  }
  // The built-in themes set none of them.
  for (const t of themes('video')) {
    for (const set of [t.tokens, t.video?.tokens].filter(Boolean).flatMap((g) => [g.common, g.light, g.dark])) {
      for (const token of DIAGRAM_TOKENS) assert.ok(!(token in (set ?? {})), `${t.name} does not set ${token}`);
    }
  }
});

test('base.css: the radius defaults equal the attributes the components write, so the markup keeps its look', () => {
  assert.match(BASE_CSS, /\.am-node--rect \.am-node-shape, \.am-node--er \.am-node-shape \{ rx: var\(--node-radius, 3px\); \}/);
  assert.match(BASE_CSS, /\.am-actor \{[^}]*rx: var\(--node-radius, 2px\)/);
  assert.match(BASE_CSS, /\.am-note \{[^}]*rx: var\(--note-radius, 2px\)/);
  const { html } = renderDoc('## A\n```flow\n[A] -> (B)\n```\n```sequence\nA -> B: x\nnote A: y\n== p ==\n```\n```er\nU\n  id PK\n```\n', { theme: 'blueprint' });
  assert.match(html, /<rect class="am-node-shape"[^>]* rx="3"/, 'a flow rectangle keeps its rx attribute (the fallback for Safari before 17.4)');
  assert.match(html, /<rect class="am-actor"[^>]* rx="2"/);
  assert.match(html, /<rect class="am-note"[^>]* rx="2"/);
});

test('base.css: tree boxes take the node tokens, the root and highlighted boxes and the highlighted timeline dot take the highlight tokens', () => {
  const rule = (selector) => BASE_CSS.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  const box = BASE_CSS.match(/\.am-tree-box \{([^}]*)\}/)[1];
  for (const token of ['--node-width', '--node-stroke', '--node-fill', '--node-radius', '--node-text', '--node-shadow']) assert.match(box, new RegExp(`var\\(${token}, `), `a tree box reads ${token}`);
  assert.match(rule('.am-tree-box--root'), /background: var\(--hi-fill, var\(--accent-bg\)\)/, 'the root box keeps its accent tint by default');
  assert.match(rule('.am-tree-box--hi'), /background: var\(--hi-fill, var\(--node-fill, var\(--paper\)\)\)/, 'a highlighted box looks like any other by default');
  assert.match(rule('.am-tree-box--root, .am-tree-box--hi'), /border-color: var\(--hi-stroke, .*; color: var\(--hi-text, /);
  assert.match(rule('.am-tl-item--hi .am-tl-dot'), /background: var\(--hi-stroke, var\(--accent\)\); border-color: var\(--hi-stroke, var\(--accent\)\)/);
});

test('markup: node and actor labels carry their own class, so a theme never needs a structural selector', () => {
  const { html } = renderDoc('## A\n```flow\nA -> *B: go\n```\n```sequence\nA -> B: x\n== phase ==\n```\n```er\n*User\n  id PK\n  name string\n```\n', { theme: 'blueprint' });
  assert.match(html, /<text [^>]*class="am-node-text"[^>]*>A<\/text>/);
  assert.match(html, /<text [^>]*class="am-actor-text" font-weight="600"[^>]*>A<\/text>/);
  assert.match(html, /<text [^>]*class="am-actor-text" style="font-size:12px"[^>]*>phase<\/text>/, 'the box of a divider is an actor, so its text is too');
  assert.match(html, /class="am-er-head am-node-text"/);
  assert.match(html, /class="am-er-field am-node-text"/);
  assert.doesNotMatch(html, /<text [^>]*class="am-node-text"[^>]*>go<\/text>/, 'an edge label is not node text');
});

test('tokens: a theme that sets diagram tokens emits them under its own root, and the built-in themes emit none', () => {
  const { theme, errors } = normalizeTheme('t', themeWith({ common: { '--node-width': '2.5px', '--node-shadow': 'drop-shadow(3px 3px 0 #111111)' }, light: { '--hi-fill': '#ffe600', '--hi-text': '#111111' } }));
  assert.deepEqual(errors, []);
  const { html } = renderDoc('## A\n```flow\nA -> *B\n```\n', { theme: 't' }, {}, { themes: withThemes([theme]) });
  const block = html.match(/html\[data-theme="t"\], html\[data-theme="t"\]\[data-mode="light"\] \{([^}]*)\}/)[1];
  assert.match(block, /--node-width: 2\.5px;/);
  assert.match(block, /--node-shadow: drop-shadow\(3px 3px 0 #111111\);/);
  assert.match(block, /--hi-fill: #ffe600;/);
  const builtin = renderDoc('## A\n```flow\nA -> *B\n```\n', { theme: 'blueprint' }).html;
  assert.doesNotMatch(builtin, /--(node|hi|edge|actor|note|cluster|lifeline)-[a-z]+: /);
});

test('lengths: a bare number means px, and a bad length is an error in common, light, dark and video tokens', () => {
  const ok = normalizeTheme('t', themeWith({ common: { '--node-width': '2', '--edge-width': '2.2', '--node-radius': '0', '--note-radius': '10px', '--note-width': '.5em' } }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(
    ['--node-width', '--edge-width', '--node-radius', '--note-radius', '--note-width'].map((k) => ok.theme.tokens.common[k]),
    ['2px', '2.2px', '0px', '10px', '.5em'],
  );
  for (const bad of ['thick', '-2px', '2%', '2px 3px', 'calc(1px + 1px)', 'var(--bw)', '', '2pt']) {
    const r = normalizeTheme('t', themeWith({ light: { '--node-width': bad } }));
    assert.equal(r.errors.length, 1, `"${bad}" is rejected`);
    assert.match(r.errors[0], /^tokens\.light: --node-width must be a number or a px \/ em value/);
  }
  const video = normalizeTheme('t', themeWith({ video: { tokens: { dark: { '--edge-width': 'wide' } } } }));
  assert.match(video.errors.join(), /video\.tokens\.dark: --edge-width must be a number or a px \/ em value/);
});

test('shadow: none or drop-shadow(...) only, with no url()', () => {
  for (const good of ['none', 'drop-shadow(3px 3px 0 #111111)', 'drop-shadow(3px 3px 0 rgba(0, 0, 0, 0.5)) drop-shadow(1px 1px 0 var(--ink))', ' DROP-SHADOW(2px 2px 0 red) ']) {
    assert.deepEqual(normalizeTheme('t', themeWith({ common: { '--node-shadow': good } })).errors, [], good);
  }
  for (const bad of ['blur(3px)', '3px 3px 0 #111', 'drop-shadow(3px 3px 0 #111) blur(2px)', 'drop-shadow(3px 3px 0 #111', 'drop-shadow(url(#f))', 'url(#shadow)', 'none drop-shadow(1px 1px 0 red)', 'var(--x)']) {
    const r = normalizeTheme('t', themeWith({ common: { '--node-shadow': bad } }));
    assert.equal(r.errors.length, 1, `"${bad}" is rejected`);
    assert.match(r.errors[0], /^tokens\.common: --node-shadow must be none or one or more drop-shadow\(\.\.\.\), with no url\(\)/);
  }
});

test('contrast: actor-text on actor-fill, in light and in dark, is an error below 4.5:1', () => {
  const r = check(themeWith({ light: { '--actor-fill': '#111111', '--actor-text': '#333333' }, dark: { '--actor-fill': '#f2f2f2', '--actor-text': '#c9c9c9' } }));
  assert.deepEqual(r.errors.filter((e) => !/actor/.test(e)), []);
  assert.match(r.errors.find((e) => e.startsWith('light:')), /^light: --actor-text on --actor-fill has contrast 1\.\d\d:1, needs 4\.5:1$/);
  assert.match(r.errors.find((e) => e.startsWith('dark:')), /^dark: --actor-text on --actor-fill has contrast 1\.\d\d:1, needs 4\.5:1$/);
});

test('contrast: node, highlighted node, note and edge label are checked, only when the theme sets a side', () => {
  assert.deepEqual(check(themeWith()).errors, [], 'a theme that sets no diagram token is not checked');
  assert.deepEqual(check(themeWith({ light: { '--node-stroke': '#ff0000', '--hi-stroke': '#00ff00' } })).errors, [], 'a stroke is not text');
  const cases = [
    [{ '--node-fill': '#111111' }, '--ink', '--node-fill'],
    [{ '--hi-fill': '#0050a0' }, '--accent', '--hi-fill'],
    [{ '--note-fill': '#111111' }, '--ink', '--note-fill'],
    [{ '--edge-label': '#eeeeee' }, '--edge-label', '--paper'],
  ];
  for (const [tokens, fg, bg] of cases) {
    const errors = check(themeWith({ light: tokens })).errors.filter((e) => e.startsWith('light:'));
    assert.equal(errors.length, 1, `${fg} on ${bg}: ${errors.join('; ')}`);
    assert.match(errors[0], /needs 4\.5:1$/);
  }
  const fine = check(themeWith({ light: { '--hi-fill': '#ffe600', '--hi-text': '#111111', '--actor-fill': '#111111', '--actor-text': '#ffffff', '--note-fill': '#ffe600' } }));
  assert.deepEqual(fine.errors.filter((e) => /^light:/.test(e)), []);
});

test('contrast: the actor falls back to the node tokens, and a var() reference is followed', () => {
  const viaNode = check(themeWith({ light: { '--node-fill': '#111111' } })).errors.filter((e) => e.startsWith('light:'));
  assert.deepEqual(viaNode, ['light: --ink on --node-fill has contrast 1.00:1, needs 4.5:1'], 'the node and the actor read the same pair, and it is said once');
  const ref = check(themeWith({ light: { '--actor-fill': 'var(--ink)', '--actor-text': 'var(--paper)' } }));
  assert.deepEqual(ref.errors.filter((e) => /^light:/.test(e)), [], 'white on the ink color passes');
  const bad = check(themeWith({ light: { '--actor-fill': 'var(--ink)', '--actor-text': 'var(--ink-2)' } }));
  assert.ok(bad.errors.some((e) => /^light: --actor-text on --actor-fill/.test(e)));
  const unreadable = check(themeWith({ light: { '--actor-fill': 'color-mix(in srgb, red, blue)' } }));
  assert.deepEqual(unreadable.errors.filter((e) => /actor/.test(e)), []);
  assert.ok(unreadable.warnings.some((w) => /not checked/.test(w)), 'a color the check cannot read is a warning, not an error');
});

test('contrast: dark mode keeps a light value it does not override, so the pair is checked there too', () => {
  const r = check(themeWith({ light: { '--note-fill': '#ffe600' } }));
  assert.deepEqual(r.errors.filter((e) => e.startsWith('light:')), []);
  assert.ok(r.errors.some((e) => /^dark: --ink on --note-fill/.test(e)), r.errors.join('; '));
  assert.deepEqual(check(themeWith({ light: { '--note-fill': '#ffe600' }, dark: { '--note-fill': '#4d4200' } })).errors, []);
});

test('series colors: below 3:1 against --paper is a warning, not an error, and only for a token the theme sets', () => {
  assert.deepEqual(check(themeWith()).warnings, [], 'a theme that sets no series token is not checked');
  const pale = check(themeWith({ light: { '--series-2': '#ffe600' }, dark: { '--series-2': '#18181d' } }));
  assert.deepEqual(pale.errors, [], 'the bars carry their value, so a pale color is no error');
  const light = pale.warnings.find((w) => w.startsWith('light:'));
  assert.match(light, /^light: --series-2 on --paper has contrast 1\.\d\d:1, needs 3:1; the bars carry their value, and the legend and the data table name each series/);
  assert.match(pale.warnings.find((w) => w.startsWith('dark:')), /^dark: --series-2 on --paper has contrast 1\.\d\d:1, needs 3:1/);
  const good = check(themeWith({ light: { '--series-2': '#b87400', '--series-3': '#009e73' }, dark: { '--series-2': '#e69f00', '--series-3': '#009e73' } }));
  assert.deepEqual([good.errors, good.warnings], [[], []]);
  // Only the tokens that are set are read: setting --series-3 says nothing about --series-4.
  assert.equal(check(themeWith({ light: { '--series-3': '#ffe600' }, dark: { '--series-3': '#18181d' } })).warnings.length, 2);
});

test('series colors: var() follows a token, and a value the check cannot read is a warning', () => {
  assert.deepEqual(check(themeWith({ light: { '--series-1': 'var(--accent)' }, dark: { '--series-1': 'var(--accent)' } })).warnings, []);
  const weak = check(themeWith({ light: { '--series-1': 'var(--fill)' } }));
  assert.ok(weak.warnings.some((w) => /^light: --series-1 on --paper has contrast/.test(w)));
  const unreadable = check(themeWith({ light: { '--series-4': 'color-mix(in srgb, red, blue)' }, dark: { '--series-4': 'color-mix(in srgb, red, blue)' } }));
  assert.deepEqual(unreadable.errors, []);
  assert.ok(unreadable.warnings.some((w) => /^light: --series-4 on --paper was not checked/.test(w)));
});

test('series colors: a token value goes through the external-resource check and the plain-value check', () => {
  const linked = normalizeTheme('t', themeWith({ common: { '--series-5': 'url(https://a.example/x.png)' } }));
  assert.deepEqual(themeLinks(linked.theme).map((f) => f.where), ['tokens.common --series-5']);
  assert.match(normalizeTheme('t', themeWith({ light: { '--series-6': 'red; }' } })).errors.join(), /--series-6 must be a string without/);
});

test('series colors: chart.css reads each token with the fixed palette as its fallback, one set for light and one for dark', () => {
  for (let n = 1; n <= 6; n++) {
    assert.match(CHART_CSS, new RegExp(`\\.am-ch-s${n} \\{ fill: var\\(--series-${n}, var\\(--am-ch-${n}\\)\\); \\}`));
    assert.match(CHART_CSS, new RegExp(`th:nth-child\\(${n + 1}\\)::before \\{ background: var\\(--series-${n}, var\\(--am-ch-${n}\\)\\)`), 'the data table head carries the swatch');
  }
  const set = (re) => [...CHART_CSS.match(re)[1].matchAll(/--am-ch-(\d): (#[0-9a-f]{6})/g)].map((m) => m[2]);
  const light = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#b07aa1'];
  const dark = ['#7aa6d6', '#f5a55a', '#ef7f80', '#8fd0cb', '#7cc472', '#c99bbd'];
  assert.deepEqual(set(/^html \{\n([^}]*)\}/m), light);
  assert.deepEqual(set(/^html\[data-mode="dark"\] \{\n([^}]*)\}/m), dark);
  assert.deepEqual(set(/prefers-color-scheme: dark\) \{\n\s*html\[data-mode="auto"\] \{\n([^}]*)\}/m), dark);
});

test('links: a token value is checked like css (themeLinks, externalResourceWarnings)', () => {
  const { theme } = normalizeTheme('t', themeWith({
    common: { '--paper-grain': 'url(https://a.example/x.png)' },
    light: { '--bg-img': "image-set('//a.example/b.png' 1x)", '--ok-img': 'url(local.png)' },
    dark: { '--esc': 'u\\72 l(x)' },
    video: { tokens: { light: { '--v-stage': 'url( "http://a.example/c.png" )' } } },
  }));
  const found = themeLinks(theme);
  assert.deepEqual(found.map((f) => f.where).sort(), ['tokens.common --paper-grain', 'tokens.dark --esc', 'tokens.light --bg-img', 'video.tokens.light --v-stage']);
  const warnings = externalResourceWarnings(theme);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((w) => /^tokens\.common --paper-grain: url\(https:\/\/a\.example\/x\.png\) loads or embeds/.test(w)));
  assert.ok(warnings.some((w) => /^tokens\.dark --esc: escape sequence/.test(w)));
  assert.deepEqual(themeLinks(normalizeTheme('t', themeWith({ common: { '--node-width': '2px' } })).theme), []);
});

async function cli(args) {
  let out = '';
  const sink = new Writable({ write(c, _e, cb) { out += String(c); cb(); } });
  const code = await main(args, { stdout: sink, stderr: sink, stdin: Readable.from(['']), env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: home }, cwd: home });
  return { code, out };
}
const write = (name, data) => {
  mkdirSync(join(home, 'themes'), { recursive: true });
  const file = join(home, 'themes', `${name}.json`);
  writeFileSync(file, JSON.stringify(data));
  return file;
};

test('am theme check: a link in a token value is a warning on a local file; a bad shadow and a contrast failure are errors', async () => {
  const linked = await cli(['theme', 'check', write('tl', themeWith({ common: { '--grain': 'url(https://a.example/x.png)' } })), '--no-open']);
  assert.equal(linked.code, 0, linked.out);
  assert.match(linked.out, /^! tokens\.common --grain: url\(https:\/\/a\.example\/x\.png\) loads or embeds something outside the theme file/m);
  assert.match(linked.out, /tl: 0 errors, 1 warning$/m);

  const shadow = await cli(['theme', 'check', write('ts', themeWith({ common: { '--node-shadow': 'drop-shadow(url(https://a.example/s.svg))' } })), '--no-open']);
  assert.equal(shadow.code, 1);
  assert.match(shadow.out, /^✗ tokens\.common: --node-shadow must be none or one or more drop-shadow/m);

  const contrastFail = await cli(['theme', 'check', write('tc', themeWith({ light: { '--actor-fill': '#111111', '--actor-text': '#333333' } })), '--no-open']);
  assert.equal(contrastFail.code, 1);
  assert.match(contrastFail.out, /^✗ light: --actor-text on --actor-fill has contrast/m);

  const clean = await cli(['theme', 'check', write('tk', themeWith({ common: { '--node-width': '2.5px', '--node-shadow': 'drop-shadow(3px 3px 0 #111111)' }, light: { '--actor-fill': '#111111', '--actor-text': '#ffffff' }, dark: { '--actor-fill': '#f2f2f2', '--actor-text': '#111111' } })), '--no-open']);
  assert.equal(clean.code, 0, clean.out);
  assert.match(clean.out, /tk: 0 errors, 0 warnings$/m);
});

test('am help theme names every diagram token group and the no-fonts rule', async () => {
  const { out } = await cli(['help', 'theme']);
  assert.match(out, /^- Diagram tokens \(optional\)/m);
  for (const token of DIAGRAM_TOKENS) assert.ok(out.includes(token.slice(2)), `help names ${token}`);
  assert.match(out, /no token for fonts/);
});

test('docs: reference.md and reference.zh-CN.md list every diagram token', () => {
  for (const file of ['docs/reference.md', 'docs/reference.zh-CN.md']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const token of DIAGRAM_TOKENS) assert.ok(text.includes(`\`${token}\``), `${file} documents ${token}`);
  }
});
