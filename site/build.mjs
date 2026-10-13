// Build the project website into site/dist/ (npm run site).
// - assets/engine.js: the real renderer (src/) bundled for the browser, for the live playground, plus assets/temml.js, which only a draft with math loads.
// - assets/: the page's own scripts and styles, copied as they are, plus the logo.
// - presets/: the playground's sample drafts, and presets/index.json with all of them for one fetch.
// - prerender/: example pages and videos rendered by the bundled CLI.
// - index.html (English) and zh/index.html (Chinese): site/template.html filled from site/i18n/en.js and site/i18n/zh.js.
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { inlineAssets } from '../scripts/inline-assets.mjs';

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
const FRONT_FILES = ['main.js', 'playground.js', 'style.css'];
const IMAGES = ['text-vs-page.png', 'text-vs-page-zh.png', 'tcp-en.png', 'tcp.png', 'tcp-en-dark.png', 'ste100.png', 'video-en.png', 'video-zh.png', 'plain-vs-skill.png'];
const PRERENDER = [
  ['video', 'examples/video-tcp.en.md', 'video-en.html'],
  ['video', 'examples/video-tcp.md', 'video-zh.html'],
  ['render', 'examples/tcp.en.md', 'tcp-en.html'],
  ['render', 'examples/tcp.md', 'tcp-zh.html'],
];
const PAGES = [
  { lang: 'en', htmlLang: 'en', out: 'index.html', alt: 'zh/', path: '' },
  { lang: 'zh', htmlLang: 'zh-CN', out: 'zh/index.html', alt: '../', path: 'zh/' },
];

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

function prerender(dist) {
  const home = mkdtempSync(join(tmpdir(), 'am-site-'));
  const am = join(ROOT, 'skills/answer-me-with-html/scripts/am.mjs');
  try {
    for (const [cmd, draft, name] of PRERENDER) {
      const args = [am, cmd, join(ROOT, draft), '--no-open', '-o', join(dist, 'prerender', name), ...(cmd === 'video' ? ['--voice', 'off'] : [])];
      const run = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: home } });
      if (run.status !== 0) throw new Error(`am ${cmd} ${draft} failed:\n${run.stderr || run.stdout}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function copyImages(dist) {
  copyFileSync(join(ROOT, 'docs/logo.svg'), join(dist, 'assets/logo.svg'));
  copyFileSync(join(ROOT, 'docs/logo.svg'), join(dist, 'favicon.svg'));
  mkdirSync(join(dist, 'images'), { recursive: true });
  for (const name of IMAGES) copyFileSync(join(ROOT, 'docs/images', name), join(dist, 'images', name));
}

// sitemap.xml lists both language pages, each naming the other as its alternate (as the hreflang links in <head> do).
// robots.txt points at it and keeps the prerendered examples, which only appear inside the page's frames, out of search.
function writeSearchFiles(dist) {
  const alternates = PAGES.map((p) => `    <xhtml:link rel="alternate" hreflang="${p.htmlLang}" href="${SITE_URL}${p.path}"/>`).join('\n');
  const urls = PAGES.map((p) => `  <url>\n    <loc>${SITE_URL}${p.path}</loc>\n${alternates}\n  </url>`).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nDisallow: /prerender/\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
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

async function writePages(dist, version) {
  const templateFile = join(SITE, 'template.html');
  if (!existsSync(templateFile)) throw new Error('site/template.html is missing');
  const template = readFileSync(templateFile, 'utf8');
  const dicts = Object.fromEntries(await Promise.all(PAGES.map(async (p) => [p.lang, await loadDictionary(p.lang)])));
  const problems = dictionaryGaps(dicts);
  const starCount = await stars();
  if (!starCount) warn('could not read the GitHub star count; {{STARS}} is empty');
  const pages = PAGES.map((p) => {
    const base = '../'.repeat(p.out.split('/').length - 1);
    const builtins = { LANG: p.htmlLang, VERSION: version, BASE: base, ALT_HREF: p.alt, STARS: starCount, SITE_URL, CANONICAL: SITE_URL + p.path, STATS_SCRIPT, STATS_WEBSITE_ID };
    const { html, missing } = fillTemplate(template, dicts[p.lang], builtins);
    if (missing.length) problems.push(`site/template.html uses keys site/i18n/${p.lang}.js does not define: ${missing.join(', ')}`);
    return { ...p, html };
  });
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
  prerender(dist);
  console.log(`✓ prerender/ (${PRERENDER.length} pages)`);
  copyImages(dist);
  await writePages(dist, version);
  console.log(`✓ index.html, zh/index.html → ${relative(ROOT, dist)}/`);
  writeSearchFiles(dist);
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
