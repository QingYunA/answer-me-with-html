// The website's browser engine (site/build.mjs → assets/engine.js) is the real renderer: it must render what the CLI renders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleEngine, fillTemplate, STATS_SCRIPT, STATS_WEBSITE_ID } from '../site/build.mjs';
import { renderDoc } from '../src/render.js';
import { CONFIG_KEYS } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(file, 'utf8');
// The footer names the minute the page was made; two renders can fall in different minutes.
const fixClock = (html) => html.replace(/ · \d{4}-\d\d-\d\d \d\d:\d\d<\/p>/, ' · CLOCK</footer>');
const isPage = (html) => html.startsWith('<!doctype html>') && html.includes('<p class="am-colophon">') && html.includes('id="am-source"');

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

test('site engine: prepare loads Temml for a draft with math, so render typesets it', async () => {
  const draft = '# T\n\nThe area is $x^2$.\n';
  assert.equal(/<math dir=/.test(engine.render(draft).html), false);
  await engine.prepare(draft);
  const r = engine.render(draft);
  assert.equal(r.ok, true);
  assert.match(r.html, /<math dir="ltr"/);
  assert.match(r.html, /@font-face[^}]*Temml/);
});

test('site engine: lint checks plain prose with lines counted in the text', () => {
  const warnings = engine.lint('This method is utilized prior to the request.', 'en');
  assert.ok(warnings.some((w) => w.rule === 'word' && w.line === 1), JSON.stringify(warnings));
  assert.ok(engine.lint('One line.\n\n1. The file was written by the server.').some((w) => w.rule === 'passive' && w.line === 3));
});

test('site build: fills built-in keys first and reports unknown ones', () => {
  const { html, missing } = fillTemplate('<html lang="{{LANG}}">{{ title }}{{nope}}', { title: '<b>Hi</b>', LANG: 'x' }, { LANG: 'en' });
  assert.equal(html, '<html lang="en"><b>Hi</b>{{nope}}');
  assert.deepEqual(missing, ['nope']);
});

const BUILT = { skip: !existsSync(join(ROOT, 'site/dist/themes/index.json')) };
const SITE_URL = 'https://answer-me-with-html.com/';
const NAMES = readdirSync(join(ROOT, 'marketplace/themes')).map((f) => f.replace(/\.json$/, '')).sort();
const DETAIL = NAMES.flatMap((name) => [`themes/${name}/index.html`, `zh/themes/${name}/index.html`]);
const EDITOR = ['themes/new/index.html', 'zh/themes/new/index.html'];
const PAGES = ['index.html', 'zh/index.html', 'themes/index.html', 'zh/themes/index.html', ...EDITOR, ...DETAIL];

test('site build: the built pages load no script or style from another site, except the visit counter', BUILT, () => {
  for (const page of PAGES) {
    const html = read(join(ROOT, 'site/dist', page));
    // canonical and hreflang links name the site's own address and load nothing, so only links that fetch count.
    const loaders = [...html.matchAll(/<script\b[^>]*>|<link\b[^>]*\brel=["']?(?:stylesheet|modulepreload|preload|icon)\b[^>]*>/gi)].map((m) => m[0]);
    const external = loaders.filter((tag) => /\s(?:src|href)=["']?(?:https?:)?\/\//i.test(tag));
    assert.equal(external.length, 1, `${page}: ${external.join(' ')}`);
    assert.ok(external[0].startsWith('<script') && external[0].includes(`src="${STATS_SCRIPT}"`), `${page}: ${external[0]}`);
  }
});

test('site build: both pages carry the visit counter for the site domain only', BUILT, () => {
  for (const page of PAGES) {
    const html = read(join(ROOT, 'site/dist', page));
    const tags = html.match(/<script\b[^>]*\bsrc="https:\/\/stats\.[^>]*>/g) ?? [];
    assert.equal(tags.length, 1, page);
    assert.match(tags[0], /\sdefer\b/);
    assert.ok(tags[0].includes(`src="${STATS_SCRIPT}"`), page);
    assert.ok(tags[0].includes(`data-website-id="${STATS_WEBSITE_ID}"`), page);
    assert.ok(tags[0].includes('data-domains="answer-me-with-html.com"'), page);
  }
});

test('site build: sitemap.xml lists every page with the head alternates and robots.txt points at it', { skip: !existsSync(join(ROOT, 'site/dist/sitemap.xml')) }, () => {
  const sitemap = read(join(ROOT, 'site/dist/sitemap.xml'));
  const urls = sitemap.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  assert.equal(urls.length, 6 + NAMES.length * 2);
  const pairs = [['', 'zh/'], ['themes/', 'zh/themes/'], ['themes/new/', 'zh/themes/new/'], ...NAMES.map((n) => [`themes/${n}/`, `zh/themes/${n}/`])];
  for (const [en, zh] of pairs) {
    for (const page of [en, zh]) {
      const url = urls.find((u) => u.includes(`<loc>${SITE_URL}${page}</loc>`));
      assert.ok(url, page);
      assert.deepEqual(url.match(/<xhtml:link [^>]*\/>/g), [
        `<xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${en}"/>`,
        `<xhtml:link rel="alternate" hreflang="zh-CN" href="${SITE_URL}${zh}"/>`,
        `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${en}"/>`,
      ]);
    }
  }
  assert.match(read(join(ROOT, 'site/dist/robots.txt')), /^Sitemap: https:\/\/answer-me-with-html\.com\/sitemap\.xml$/m);
});

test('site engine: render accepts an extra theme from a theme file, and the page carries it with its font', () => {
  const file = JSON.parse(read(join(ROOT, 'marketplace/themes/comic.json')));
  const { theme, errors } = engine.themeFromFile('comic', file);
  assert.deepEqual(errors, []);
  const source = read(join(ROOT, 'examples/tcp.en.md'));
  const r = engine.render(source, { theme: 'comic', mode: 'dark' }, { extra: [theme] });
  assert.equal(r.ok, true, r.error?.message);
  assert.match(r.html, /html\[data-theme="comic"\]/);
  assert.equal(r.html.match(/@font-face \{\s*font-family: "Bangers"/g)?.length, 1);
  assert.equal(engine.render(source, { theme: 'comic' }).ok, false, 'without the extra theme the name is unknown');
  assert.equal(engine.render(source, { theme: 'blueprint' }, { extra: [theme] }).ok, true);
  assert.ok(engine.themeFromFile('blueprint', file).errors.length, 'a built-in name cannot be a catalog theme');
});

test('site build: themes/<name>.json are byte-identical copies, and themes/index.json describes them', BUILT, () => {
  const names = readdirSync(join(ROOT, 'marketplace/themes')).map((f) => f.replace(/\.json$/, '')).sort();
  const index = JSON.parse(read(join(ROOT, 'site/dist/themes/index.json')));
  assert.equal(index.schema, 1);
  assert.deepEqual(index.themes.map((t) => t.name), names, 'sorted by name');
  for (const t of index.themes) {
    const source = readFileSync(join(ROOT, 'marketplace/themes', `${t.name}.json`));
    const published = readFileSync(join(ROOT, 'site/dist/themes', `${t.name}.json`));
    assert.ok(source.equals(published), `${t.name}: the published file is the source file`);
    assert.equal(t.sha256, createHash('sha256').update(published).digest('hex'), t.name);
    assert.equal(t.size, published.length, t.name);
    assert.equal(t.url, `https://answer-me-with-html.com/themes/${t.name}.json`);
    const data = JSON.parse(source.toString('utf8'));
    assert.deepEqual([t.version, t.author, t.license, t.font, t.requires], [data.version, data.author, data.license, data.font, data.requires]);
    assert.deepEqual(t.label, data.label);
    assert.deepEqual(t.description, data.description);
    assert.deepEqual(Object.keys(t), ['name', 'version', 'label', 'description', 'author', 'license', ...(t.font ? ['font'] : []), ...(t.requires ? ['requires'] : []), 'size', 'sha256', 'url']);
  }
  assert.ok(!/\d{4}-\d\d-\d\dT/.test(read(join(ROOT, 'site/dist/themes/index.json'))), 'no timestamps');
});

test('site build: the wall has one link card per catalog theme, with a pre-rendered thumbnail and no renderer', BUILT, () => {
  for (const page of ['themes/index.html', 'zh/themes/index.html']) {
    const html = read(join(ROOT, 'site/dist', page));
    assert.equal(html.match(/<article class="tcard"/g)?.length, NAMES.length, `${page}: one card per theme`);
    for (const name of NAMES) {
      assert.match(html, new RegExp(`<a class="tcard-link" href="${name}/">`), `${page}: link to ${name}`);
      assert.match(html, new RegExp(`<iframe src="${name}/preview\\.html"[^>]*loading="lazy"[^>]*tabindex="-1"[^>]*aria-hidden="true"`), `${page}: thumbnail of ${name}`);
    }
    assert.ok(!html.includes('engine.js'), `${page}: the wall does not mention the renderer`);
    // The one <pre> is the prompt that hands making a theme to an agent; installing happens on each theme's page.
    assert.ok(!/role="tab(list|panel)?"|tcopy-btn|<pre(?! id="c-make")/.test(html), `${page}: no install UI on the wall`);
    assert.match(html, /Font: Bangers|字体: Bangers/);
    assert.match(html, /data-page="catalog"/);
  }
  assert.match(read(join(ROOT, 'site/dist/index.html')), /href="\.\/?themes\/"|href="themes\/"/, 'the home page links the wall');
  assert.match(read(join(ROOT, 'site/dist/zh/index.html')), /href="\.\.\/themes\/"/, 'the Chinese home page links the wall');
  assert.doesNotMatch(read(join(ROOT, 'site/dist/index.html')), /am theme add needs/, 'the home page keeps its own component notes');
});

test('site build: every theme has a page in both languages with its install actions', BUILT, () => {
  for (const name of NAMES) {
    const url = `${SITE_URL}themes/${name}.json`;
    for (const [lang, page, canonical] of [['en', `themes/${name}/index.html`, `themes/${name}/`], ['zh', `zh/themes/${name}/index.html`, `zh/themes/${name}/`]]) {
      const html = read(join(ROOT, 'site/dist', page));
      assert.ok(html.includes(`<link rel="canonical" href="${SITE_URL}${canonical}">`), `${page}: canonical`);
      assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${SITE_URL}themes/${name}/">`), `${page}: hreflang en`);
      assert.ok(html.includes(`<link rel="alternate" hreflang="zh-CN" href="${SITE_URL}zh/themes/${name}/">`), `${page}: hreflang zh-CN`);
      assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}themes/${name}/">`), `${page}: hreflang x-default`);
      assert.ok(html.includes(`<meta property="og:url" content="${SITE_URL}${canonical}">`), `${page}: og:url`);
      assert.match(html, new RegExp(`<title>[^<]*${lang === 'en' ? 'theme' : '主题'} — Answer me with HTML</title>`), `${page}: title`);
      assert.match(html, /<a class="tback mono" href="\.\.\/">/, `${page}: back link`);
      assert.match(html, /data-page="theme"/);
      assert.ok(html.includes('<iframe src="preview.html"'), `${page}: the pre-rendered preview is in the page`);
      assert.ok(!html.includes('engine.js'), `${page}: the engine loads only on request`);
      assert.equal(html.match(/class="btn btn-primary tinstall-agent"/g)?.length, 1, `${page}: one primary button`);
      assert.match(html, /data-method="agent"[^>]*>(Copy for your agent|复制给你的 agent)</);
      assert.ok(html.includes(`<pre id="t-cmd">am theme add ${name} --use</pre>`), `${page}: command`);
      assert.match(html, /Command \(0\.5\.3\+\)|命令（0\.5\.3\+）/);
      assert.ok(html.includes(`run am theme add ${name} --use. On a version before 0.5.3, save ${url} as ~/.answer-me-with-html/themes/${name}.json instead.`)
        || html.includes(`运行 am theme add ${name} --use。如果版本低于 0.5.3，改为把 ${url} 保存为 ~/.answer-me-with-html/themes/${name}.json。`), `${page}: agent text`);
      const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? [];
      assert.equal(details.length, 1, `${page}: one <details>`);
      assert.ok(!/<details\b[^>]*\bopen\b/.test(details[0]), `${page}: closed by default`);
      assert.ok(details[0].includes(`curl -fsSL ${url} -o ~/.answer-me-with-html/themes/${name}.json --create-dirs`), `${page}: curl inside`);
      assert.ok(details[0].includes(`Invoke-WebRequest ${url} -OutFile`), `${page}: PowerShell inside`);
      assert.match(details[0], /Older versions \(manual install\)|旧版本（手动安装）/);
      assert.ok(!html.slice(0, html.indexOf('<details')).includes('curl -fsSL'), `${page}: curl only in the details`);
      assert.doesNotMatch(html, /role="tab(list|panel)?"/, `${page}: no install tabs`);
      assert.match(html, /0\.4\.10/);
      assert.doesNotMatch(html, /web fonts|外部字体|网页字体/);
      assert.match(html, /data-version="[^"]+"/);
    }
    assert.match(read(join(ROOT, 'site/dist', `themes/${name}/index.html`)), /class="tool lang-switch" href="\.\.\/\.\.\/zh\/themes\/[a-z0-9-]+\/"/);
    assert.match(read(join(ROOT, 'site/dist', `zh/themes/${name}/index.html`)), /class="tool lang-switch" href="\.\.\/\.\.\/\.\.\/themes\/[a-z0-9-]+\/"/);
  }
});

test('site build: each theme has a pre-rendered preview in both languages, with its font embedded once', BUILT, () => {
  for (const name of NAMES) {
    const font = JSON.parse(read(join(ROOT, 'marketplace/themes', `${name}.json`))).font;
    for (const [page, lang] of [[`themes/${name}/preview.html`, 'en'], [`zh/themes/${name}/preview.html`, 'zh']]) {
      const html = read(join(ROOT, 'site/dist', page));
      assert.ok(isPage(html), page);
      assert.ok(html.includes(`data-theme="${name}"`), `${page}: rendered in the theme`);
      assert.match(html, /data-mode="light"/, page);
      assert.match(html, lang === 'en' ? /three-way handshake/i : /三次握手/, `${page}: the TCP sample`);
      if (font === 'bangers') assert.equal(html.match(/@font-face \{\s*font-family: "Bangers"/g)?.length, 1, `${page}: Bangers embedded once`);
    }
  }
});

test('site build: the gallery pages point at each other as the other language', BUILT, () => {
  assert.match(read(join(ROOT, 'site/dist/themes/index.html')), /class="tool lang-switch" href="\.\.\/zh\/themes\/"/);
  assert.match(read(join(ROOT, 'site/dist/zh/themes/index.html')), /class="tool lang-switch" href="\.\.\/\.\.\/themes\/"/);
});

test('site build: the wall hands making a theme to an agent, and links to the editor, in both languages', BUILT, () => {
  for (const page of ['themes/index.html', 'zh/themes/index.html']) {
    const html = read(join(ROOT, 'site/dist', page));
    assert.match(html, /<a class="btn btn-primary btn-sm" href="#make">/, `${page}: the top button jumps to the make box`);
    assert.match(html, /<pre id="c-make">[^<]*https:\/\/answer-me-with-html\.com\/themes\/make\.md[^<]*<\/pre>/, `${page}: the prompt names the guide`);
    assert.match(html, /data-copy="c-make"/, `${page}: the prompt has a copy button`);
    assert.ok(html.includes('<a href="new/" id="submit-theme">'), `${page}: the editor stays as a link`);
  }
});

test('site build: the agent guide and llms.txt are published as they are', BUILT, () => {
  const dist = join(ROOT, 'site/dist');
  assert.equal(read(join(dist, 'themes/make.md')), read(join(ROOT, 'site/make.md')));
  assert.equal(read(join(dist, 'llms.txt')), read(join(ROOT, 'site/llms.txt')));
  assert.ok(read(join(dist, 'llms.txt')).includes('https://answer-me-with-html.com/themes/make.md'));
});

test('site make.md: names every color and diagram token, every theme selector and the issue form fields', async () => {
  const { COLOR_TOKENS, DIAGRAM_TOKENS } = await import('../src/themes/check.js');
  const { THEME_SELECTORS } = await import('../src/themes/selectors.js');
  const { BUILTIN_NAMES } = await import('../src/themes/registry.js');
  const { MAX_NAME, MAX_BYTES } = await import('../src/themes/catalog-rules.js');
  const guide = read(join(ROOT, 'site/make.md'));
  for (const name of [...COLOR_TOKENS, ...DIAGRAM_TOKENS, ...THEME_SELECTORS, ...BUILTIN_NAMES]) assert.ok(guide.includes(`\`${name}\``), name);
  assert.ok(guide.includes(`at most ${MAX_NAME} characters`) && guide.includes(`at most ${MAX_BYTES / 1024} KB`));
  const form = read(join(ROOT, '.github/ISSUE_TEMPLATE/theme.yml'));
  for (const id of ['name', 'theme']) assert.match(form, new RegExp(`id: ${id}\\b`), id);
  assert.ok(guide.includes('template:"theme.yml"') && guide.includes('name:n') && guide.includes('theme:JSON.stringify'));
});

test('site build: every theme page links to the editor with that theme as the start', BUILT, () => {
  for (const name of NAMES) {
    for (const page of [`themes/${name}/index.html`, `zh/themes/${name}/index.html`]) {
      const html = read(join(ROOT, 'site/dist', page));
      assert.ok(html.includes(`href="../new/?from=${name}"`), `${page}: Start from this theme`);
    }
  }
});

test('site build: the editor page is built in both languages, loads its script and nothing from another site', BUILT, () => {
  for (const [page, lang, canonical] of [[EDITOR[0], 'en', 'themes/new/'], [EDITOR[1], 'zh', 'zh/themes/new/']]) {
    const html = read(join(ROOT, 'site/dist', page));
    assert.match(html, /data-page="editor"/, page);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE_URL}${canonical}">`), `${page}: canonical`);
    assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${SITE_URL}themes/new/">`) && html.includes(`<link rel="alternate" hreflang="zh-CN" href="${SITE_URL}zh/themes/new/">`), `${page}: hreflang`);
    for (const id of ['ed-from', 'ed-file', 'ed-form', 'ed-view', 'ed-problems', 'ed-submit', 'ed-download']) assert.ok(html.includes(`id="${id}"`), `${page}: #${id}`);
    assert.match(html, /<select id="ed-from"/);
    assert.match(html, /<div id="ed-problems"[^>]*aria-live="polite"|<div id="ed-problems" class="ed-problems" aria-live="polite"/, `${page}: problems are announced`);
    assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\{\{\s*[\w.-]+\s*\}\}/, `${page}: no unfilled placeholder`);
    assert.match(html, lang === 'en' ? /<h1 id="e-title">Make a theme<\/h1>/ : /<h1 id="e-title">制作主题<\/h1>/, page);
    assert.match(html, /class="tool lang-switch" href="\.\.\/\.\.\/(?:zh\/)?themes\/new\/"|class="tool lang-switch" href="\.\.\/\.\.\/\.\.\/themes\/new\/"/, `${page}: language switch`);
    assert.ok(html.includes('<script type="application/json" id="site-ui">'), page);
  }
  assert.ok(existsSync(join(ROOT, 'site/dist/assets/editor.js')), 'editor.js is published');
  assert.ok(read(join(ROOT, 'site/dist/assets/engine.js')).includes('theme.yml'), 'the submit link is in the engine bundle');
  assert.match(read(join(ROOT, 'site/dist/assets/main.js')), /editor: ?'\.\/editor\.js'/);
});

test('site i18n: no key is written twice in a dictionary, and both languages have every key, the editor strings of the page script too', async () => {
  const dicts = {};
  for (const lang of ['en', 'zh']) {
    // The page dictionary is the object after `export default`; the `ui` object before it is a dictionary of its own.
    const source = read(join(ROOT, 'site/i18n', `${lang}.js`)).split('export default {')[1];
    const keys = [...source.matchAll(/^  ([A-Za-z_][\w]*):/gm)].map((m) => m[1]);
    const seen = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(seen, [], `${lang}.js writes these keys twice`);
    dicts[lang] = (await import(pathToFileURL(join(ROOT, 'site/i18n', `${lang}.js`)).href)).default;
  }
  assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.zh).sort());
  const ui = Object.fromEntries(Object.entries(dicts).map(([lang, d]) => [lang, JSON.parse(d.ui_json)]));
  assert.deepEqual(Object.keys(ui.en.ed).sort(), Object.keys(ui.zh.ed).sort(), 'ui.ed');
  for (const lang of ['en', 'zh']) {
    for (const [k, v] of Object.entries(ui[lang].ed)) assert.ok(typeof v === 'string' && v.trim(), `${lang} ui.ed.${k}`);
    for (const k of ['th_submit_cta', 'th_start', 'ed_title', 'ed_submit', 'ed_download']) assert.ok(dicts[lang][k], `${lang} ${k}`);
  }
  // Every string the editor script reads exists.
  const used = [...read(join(ROOT, 'site/src/editor.js')).matchAll(/\bT\.(\w+)|T\[`(g)_\$\{/g)].map((m) => m[1]).filter(Boolean);
  for (const k of used) assert.ok(k in ui.en.ed, `editor.js reads T.${k}`);
  for (const g of ['surface', 'text', 'accent', 'status']) assert.ok(`g_${g}` in ui.en.ed, g);
});
