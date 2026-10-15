// Build the project website into site/dist/ (npm run site).
// - assets/engine.js: the real renderer (src/) bundled for the browser, for the live playground, plus assets/temml.js, which only a draft with math loads.
// - assets/: the page's own scripts and styles, copied as they are, plus the logo.
// - presets/: the playground's sample drafts, and presets/index.json with all of them for one fetch.
// - prerender/: example pages and videos rendered by the bundled CLI.
// - themes/<name>/preview.html and zh/themes/<name>/preview.html: the TCP sample page in each catalog theme, rendered by the bundled CLI, so the theme wall loads no engine.
// - index.html (English) and zh/index.html (Chinese): site/template.html filled from site/i18n/en.js and site/i18n/zh.js.
// - themes/ (English) and zh/themes/ (Chinese): the theme wall, site/template-themes.html filled the same way, with a card for each theme of the catalog.
// - themes/<name>/ and zh/themes/<name>/: one page for each theme, site/template-theme.html.
// - themes/new/ and zh/themes/new/: the theme editor, site/template-editor.html, made interactive by assets/editor.js.
// - themes/<name>.json and themes/index.json: marketplace/themes/ published as it is, and the list of it (site/catalog.mjs).
// - themes/make.md: site/make.md, the steps an agent follows to make and submit a theme (the wall's prompt points at it).
// - llms.txt: site/llms.txt, a short index of the Markdown an agent can read.
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { inlineAssets } from '../scripts/inline-assets.mjs';
import { PREVIEW_CSS } from './src/chrome.js';
import { catalogIndex, detailValues, readCatalog, wallHtml } from './catalog.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');
const SRC = join(SITE, 'src');
const REPO = 'QingYunA/answer-me-with-html';
// Where the site is published (GitHub Pages with a custom domain). Absolute URLs in the pages (canonical, hreflang, share images) start here.
const SITE_URL = 'https://answer-me-with-html.com/';
// The visit counter is served from a subdomain of the site, so the analytics server behind it stays private.
// Cloudflare proxies the subdomain and only lets the tracker and its event endpoint through.
// data-domains in the tag (see site/template.html) keeps local previews from counting.
export const STATS_SCRIPT = 'https://stats.answer-me-with-html.com/script.js';
export const STATS_WEBSITE_ID = '6cfdb29e-3e32-432f-8371-a2aee22393ad';

// The page's own browser files, copied to assets/ without changes.
const FRONT_FILES = ['main.js', 'live.js', 'chrome.js', 'playground.js', 'catalog.js', 'theme.js', 'editor.js', 'style.css'];
const IMAGES = ['text-vs-page.png', 'text-vs-page-zh.png', 'tcp-en.png', 'tcp.png', 'tcp-en-dark.png', 'ste100.png', 'video-en.png', 'video-zh.png', 'plain-vs-skill.png'];
const PRERENDER = [
  ['video', 'examples/video-tcp.en.md', 'video-en.html'],
  ['video', 'examples/video-tcp.md', 'video-zh.html'],
  ['render', 'examples/tcp.en.md', 'tcp-en.html'],
  ['render', 'examples/tcp.md', 'tcp-zh.html'],
];
// The pages of the site, in groups: a group is one page in each language, from one template. alt is the other language's page, relative to this one.
const PAGES = [
  { lang: 'en', htmlLang: 'en', out: 'index.html', alt: 'zh/', path: '' },
  { lang: 'zh', htmlLang: 'zh-CN', out: 'zh/index.html', alt: '../', path: 'zh/' },
];
const THEME_PAGES = [
  { lang: 'en', htmlLang: 'en', out: 'themes/index.html', alt: '../zh/themes/', path: 'themes/' },
  { lang: 'zh', htmlLang: 'zh-CN', out: 'zh/themes/index.html', alt: '../../themes/', path: 'zh/themes/' },
];
// The theme editor (site/template-editor.html). A catalog theme cannot be named "new" (src/themes/catalog-rules.js), so the folder is free.
const EDITOR_PAGES = [
  { lang: 'en', htmlLang: 'en', out: 'themes/new/index.html', alt: '../../zh/themes/new/', path: 'themes/new/' },
  { lang: 'zh', htmlLang: 'zh-CN', out: 'zh/themes/new/index.html', alt: '../../../themes/new/', path: 'zh/themes/new/' },
];
// The pages of one catalog theme: its own folder in each language.
const themePages = (name) => [
  { lang: 'en', htmlLang: 'en', out: `themes/${name}/index.html`, alt: `../../zh/themes/${name}/`, path: `themes/${name}/` },
  { lang: 'zh', htmlLang: 'zh-CN', out: `zh/themes/${name}/index.html`, alt: `../../../themes/${name}/`, path: `zh/themes/${name}/` },
];
export const pageGroups = (catalog) => [PAGES, THEME_PAGES, EDITOR_PAGES, ...catalog.map((e) => themePages(e.name))];
// The sample page of the theme previews: the playground's TCP draft in each language, drawn light (the page flips to dark by data-mode).
const THEME_SAMPLES = [['en', 'site/presets/tcp.md', 'themes'], ['zh', 'site/presets/tcp.zh.md', 'zh/themes']];
// Markup the templates share, in site/partials/<name>.html, used in a template as {{PARTIAL_<NAME>}}.
const PARTIALS = ['boot', 'brand', 'tools', 'footer'];
const CATALOG_DIR = join(ROOT, 'marketplace/themes');

// Node built-ins the render path imports, answered in the browser by node-stub.js.
const nodeStub = {
  name: 'node-stub',
  setup(b) {
    b.onResolve({ filter: /^(node:)?(fs|path|os|url)$/ }, () => ({ path: join(SRC, 'node-stub.js') }));
  },
};

// Temml's minified browser build, wrapped as an ES module. The engine imports it as './temml.js' on demand (src/math-load.js),
// so a draft without math never downloads it. The CLI does the same with a string, see scripts/build.mjs.
const TEMML_FILE = 'temml.js';
const temmlSource = {
  name: 'temml-source',
  setup(b) {
    b.onResolve({ filter: /^temml$/ }, (args) => (args.kind === 'dynamic-import' ? { path: `./${TEMML_FILE}`, external: true } : { path: 'temml', namespace: 'temml-min' }));
    b.onLoad({ filter: /.*/, namespace: 'temml-min' }, () => {
      const min = readFileSync(createRequire(import.meta.url).resolve('temml/dist/temml.min.js'), 'utf8');
      return { loader: 'js', contents: `export default (function () {\n${min}\nreturn temml;\n})();\n` };
    });
  },
};

const sized = (file) => {
  const code = readFileSync(file);
  return { file, bytes: code.length, gzip: gzipSync(code).length };
};

// Bundle site/src/engine.js for the browser, and Temml as temml.js next to it. Returns { file, bytes, gzip, temml: { file, bytes, gzip } }.
export async function bundleEngine(outfile) {
  const shared = {
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    inject: [join(SRC, 'process-shim.js')],
    plugins: [inlineAssets, nodeStub, temmlSource],
    logLevel: 'warning',
  };
  const temmlFile = join(dirname(outfile), TEMML_FILE);
  await build({ ...shared, entryPoints: [join(SRC, 'engine.js')], outfile });
  await build({ ...shared, entryPoints: ['temml'], outfile: temmlFile });
  for (const file of [outfile, temmlFile]) {
    const leaks = [/\brequire\(/, /\bprocess\./, /\bBuffer\b/, /["']node:/].filter((re) => re.test(readFileSync(file, 'utf8')));
    if (leaks.length) throw new Error(`${basename(file)} still names Node-only code: ${leaks.join(', ')}`);
  }
  return { ...sized(outfile), temml: sized(temmlFile) };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function warn(message) {
  console.warn(`! ${message}`);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

function copyFrontFiles(dist) {
  for (const name of FRONT_FILES) {
    const from = join(SRC, name);
    if (existsSync(from)) copyFileSync(from, join(dist, 'assets', name));
    else warn(`site/src/${name} is missing; skipped`);
  }
}

// presets/index.json: { "<path under presets/ without .md>": "<draft>" }.
function copyPresets(dist) {
  const from = join(SITE, 'presets');
  const to = join(dist, 'presets');
  mkdirSync(to, { recursive: true });
  if (!existsSync(from)) {
    warn('site/presets/ is missing; presets/index.json is empty');
    writeFileSync(join(to, 'index.json'), '{}\n');
    return 0;
  }
  cpSync(from, to, { recursive: true });
  const drafts = listFiles(from).filter((f) => f.endsWith('.md')).sort();
  const index = Object.fromEntries(drafts.map((f) => [relative(from, f).split('\\').join('/').replace(/\.md$/, ''), readFileSync(f, 'utf8')]));
  writeFileSync(join(to, 'index.json'), `${JSON.stringify(index)}\n`);
  return drafts.length;
}

// Pages drawn by the bundled CLI, the way a visitor's agent would draw them. The catalog themes are installed in a throwaway AM_HOME, never in the real one.
function prerender(dist, catalog) {
  const home = mkdtempSync(join(tmpdir(), 'am-site-'));
  const am = join(ROOT, 'skills/answer-me-with-html/scripts/am.mjs');
  const jobs = PRERENDER.map(([cmd, draft, name]) => [cmd, join(ROOT, draft), join(dist, 'prerender', name), ...(cmd === 'video' ? ['--voice', 'off'] : [])]);
  for (const { name } of catalog) {
    for (const [, draft, dir] of THEME_SAMPLES) jobs.push(['render', join(ROOT, draft), join(dist, dir, name, 'preview.html'), '--theme', name, '--mode', 'light']);
  }
  try {
    mkdirSync(join(home, 'themes'));
    for (const { file } of catalog) copyFileSync(join(CATALOG_DIR, file), join(home, 'themes', file));
    for (const [cmd, draft, out, ...flags] of jobs) {
      const run = spawnSync(process.execPath, [am, cmd, draft, '--no-open', '-o', out, ...flags], { encoding: 'utf8', env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: home } });
      if (run.status !== 0) throw new Error(`am ${cmd} ${relative(ROOT, draft)} ${flags.join(' ')} failed:\n${run.stderr || run.stdout}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  // The previews are for frames: they carry the CSS that hides the page's toolbar and colophon, the one change to what the CLI wrote.
  for (const [, , out] of jobs.filter((j) => j[2].endsWith('preview.html'))) {
    writeFileSync(out, readFileSync(out, 'utf8').replace('</head>', `<style id="site-frame-css">${PREVIEW_CSS}</style></head>`));
  }
  return jobs.length;
}

function copyImages(dist) {
  copyFileSync(join(ROOT, 'docs/logo.svg'), join(dist, 'assets/logo.svg'));
  copyFileSync(join(ROOT, 'docs/logo.svg'), join(dist, 'favicon.svg'));
  copyFileSync(join(SITE, 'llms.txt'), join(dist, 'llms.txt'));
  mkdirSync(join(dist, 'images'), { recursive: true });
  for (const name of IMAGES) copyFileSync(join(ROOT, 'docs/images', name), join(dist, 'images', name));
}

// sitemap.xml lists every page in both languages, each with the same alternates as the hreflang links in <head>: both languages and x-default (the English page).
// robots.txt points at it and keeps the prerendered examples and theme previews, which only appear inside the page's frames, out of search.
function writeSearchFiles(dist, groups) {
  const urls = groups.flatMap((group) => {
    const variants = [...group.map((p) => [p.htmlLang, p.path]), ['x-default', group[0].path]];
    const alternates = variants.map(([hreflang, path]) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${SITE_URL}${path}"/>`).join('\n');
    return group.map((p) => `  <url>\n    <loc>${SITE_URL}${p.path}</loc>\n${alternates}\n  </url>`);
  }).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nDisallow: /prerender/\nDisallow: /themes/*/preview.html\nDisallow: /zh/themes/*/preview.html\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
}

// themes/<name>.json is a byte-for-byte copy of marketplace/themes/<name>.json, so the sha256 in themes/index.json matches the download.
function writeCatalog(dist, entries) {
  const to = join(dist, 'themes');
  mkdirSync(to, { recursive: true });
  for (const { file } of entries) copyFileSync(join(CATALOG_DIR, file), join(to, file));
  writeFileSync(join(to, 'index.json'), catalogIndex(entries, SITE_URL));
  copyFileSync(join(SITE, 'make.md'), join(to, 'make.md'));
}

// The stargazer count, or '' when it cannot be read (offline, rate-limited); the build never fails on it.
async function stars() {
  try {
    const out = execFileSync('gh', ['api', `repos/${REPO}`, '--jq', '.stargazers_count'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
    if (/^\d+$/.test(out)) return out;
  } catch {
    // No gh, or not signed in: try the public API.
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    const count = res.ok ? (await res.json()).stargazers_count : undefined;
    return Number.isInteger(count) ? String(count) : '';
  } catch {
    return '';
  }
}

async function loadDictionary(lang) {
  const file = join(SITE, 'i18n', `${lang}.js`);
  if (!existsSync(file)) throw new Error(`site/i18n/${lang}.js is missing`);
  const dict = (await import(pathToFileURL(file).href)).default;
  if (!dict || typeof dict !== 'object') throw new Error(`site/i18n/${lang}.js must export default { key: 'string', ... }`);
  return dict;
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

// Fill {{key}} from the built-in values first, then from the dictionary. Returns { html, missing }.
export function fillTemplate(template, dict, builtins) {
  const missing = new Set();
  const html = template.replace(PLACEHOLDER, (whole, key) => {
    if (Object.hasOwn(builtins, key)) return builtins[key];
    if (Object.hasOwn(dict, key)) return String(dict[key]);
    missing.add(key);
    return whole;
  });
  return { html, missing: [...missing] };
}

// Keys one dictionary has and the other lacks, as messages.
function dictionaryGaps(dicts) {
  const gaps = [];
  for (const [lang, dict] of Object.entries(dicts)) {
    for (const [other, otherDict] of Object.entries(dicts)) {
      if (other === lang) continue;
      const lacking = Object.keys(dict).filter((k) => !Object.hasOwn(otherDict, k));
      if (lacking.length) gaps.push(`site/i18n/${other}.js lacks keys that ${lang}.js has: ${lacking.join(', ')}`);
    }
  }
  return gaps;
}

// Fill one template for every page of a group. extra(page, base) adds values only that template uses.
function fillGroup(template, partials, group, shared, extra, problems) {
  return group.map((p) => {
    const base = '../'.repeat(p.out.split('/').length - 1);
    const builtins = { LANG: p.htmlLang, VERSION: shared.version, BASE: base, ALT_HREF: p.alt, STARS: shared.stars, SITE_URL, CANONICAL: SITE_URL + p.path, STATS_SCRIPT, STATS_WEBSITE_ID, ...extra(p, base) };
    const dict = shared.dicts[p.lang];
    const own = {};
    for (const [name, text] of Object.entries(partials)) {
      const { html, missing } = fillTemplate(text, dict, builtins);
      if (missing.length) problems.push(`site/partials/${name}.html uses keys site/i18n/${p.lang}.js does not define: ${missing.join(', ')}`);
      own[`PARTIAL_${name.toUpperCase()}`] = html;
    }
    const { html, missing } = fillTemplate(template.text, dict, { ...builtins, ...own });
    if (missing.length) problems.push(`site/${template.name} uses keys site/i18n/${p.lang}.js does not define: ${missing.join(', ')}`);
    return { ...p, html };
  });
}

async function writePages(dist, version, catalog, groups) {
  const read = (name) => {
    const file = join(SITE, name);
    if (!existsSync(file)) throw new Error(`site/${name} is missing`);
    return { name, text: readFileSync(file, 'utf8') };
  };
  const home = read('template.html');
  const themes = read('template-themes.html');
  const detail = read('template-theme.html');
  const editor = read('template-editor.html');
  const partials = Object.fromEntries(PARTIALS.map((n) => [n, read(`partials/${n}.html`).text.trimEnd()]));
  const langs = [...new Set(groups.flat().map((p) => p.lang))];
  const dicts = Object.fromEntries(await Promise.all(langs.map(async (l) => [l, await loadDictionary(l)])));
  const problems = dictionaryGaps(dicts);
  const starCount = await stars();
  if (!starCount) warn('could not read the GitHub star count; {{STARS}} is empty');
  const shared = { dicts, version, stars: starCount };
  const pages = [
    ...fillGroup(home, partials, PAGES, shared, () => ({ BRAND_HREF: '#top' }), problems),
    ...fillGroup(themes, partials, THEME_PAGES, shared, (p, base) => ({ BRAND_HREF: base, THEME_WALL: wallHtml(catalog, dicts[p.lang], p.lang) }), problems),
    ...fillGroup(editor, partials, EDITOR_PAGES, shared, (p, base) => ({ BRAND_HREF: base, BACK_HREF: '../' }), problems),
    ...catalog.flatMap((entry) => {
      const group = themePages(entry.name);
      return fillGroup(detail, partials, group, shared, (p, base) => ({ BRAND_HREF: base, BACK_HREF: '../', PATH_EN: group[0].path, PATH_ZH: group[1].path, ...detailValues(entry, dicts[p.lang], p.lang, SITE_URL) }), problems);
    }),
  ];
  if (problems.length) throw new Error(`Cannot build the pages:\n- ${problems.join('\n- ')}`);
  for (const p of pages) {
    const file = join(dist, p.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, p.html);
  }
}

async function main() {
  const dist = join(SITE, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

  const engine = await bundleEngine(join(dist, 'assets/engine.js'));
  console.log(`✓ assets/engine.js ${kb(engine.bytes)} (gzip ${kb(engine.gzip)})`);
  console.log(`✓ assets/temml.js ${kb(engine.temml.bytes)} (gzip ${kb(engine.temml.gzip)}), loaded only for a draft with math`);
  copyFrontFiles(dist);
  console.log(`✓ presets/index.json (${copyPresets(dist)} drafts)`);
  const catalog = readCatalog(CATALOG_DIR);
  console.log(`✓ prerender/ and the theme previews (${prerender(dist, catalog)} pages)`);
  copyImages(dist);
  writeCatalog(dist, catalog);
  console.log(`✓ themes/index.json (${catalog.length} themes: ${catalog.map((t) => t.name).join(', ')})`);
  const groups = pageGroups(catalog);
  await writePages(dist, version, catalog, groups);
  console.log(`✓ ${groups.flat().length} pages (${groups.flat().slice(0, 4).map((p) => p.out).join(', ')}, …) → ${relative(ROOT, dist)}/`);
  writeSearchFiles(dist, groups);
  console.log('✓ sitemap.xml, robots.txt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}
