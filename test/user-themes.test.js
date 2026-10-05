// User themes (#64): theme files in AM_HOME/themes/, picked like built-in themes, checked with am theme check.
// Seam: the CLI with a temporary AM_HOME.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { themeNames, getTheme } from '../src/themes/registry.js';

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'am-user-themes-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function run(args, stdin = '') {
  let out = '';
  let err = '';
  const sink = (fn) => new Writable({ write(c, _e, cb) { fn(String(c)); cb(); } });
  const code = await main(args, {
    stdout: sink((s) => { out += s; }), stderr: sink((s) => { err += s; }), stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: home }, cwd: home,
  });
  return { code, out, err };
}

// A complete theme: blueprint's tokens with a warmer paper, a label and one decoration rule.
function notesTheme(change = (t) => t) {
  const { common, light, dark } = getTheme('blueprint').tokens;
  const plain = Object.fromEntries(Object.entries(common).filter(([k]) => !k.startsWith('--font')));
  return change({
    label: { zh: '笔记', en: 'Notes', ja: 'ノート' }, // lang-ok: fixture labels
    tokens: { common: { ...plain, '--font-sans': '"IBM Plex Sans", "Noto Sans CJK SC"' }, light: { ...light, '--paper': '#fdfcf8' }, dark: { ...dark } },
    css: '& .am-panel-head { letter-spacing: 0.01em; }',
  });
}
const install = (name, theme) => {
  mkdirSync(join(home, 'themes'), { recursive: true });
  writeFileSync(join(home, 'themes', `${name}.json`), typeof theme === 'string' ? theme : JSON.stringify(theme));
};
const pageOf = (r) => readFileSync(r.out.match(/✓ (.+\.html)/)[1], 'utf8');
// The options of the toolbar's theme list: { value: text }.
const labels = (html) => Object.fromEntries([...html.match(/<select[^>]*data-am="theme"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]));
const DRAFT = '## A 流程\n客户端先发送请求，服务端再返回结果。\n';
const VIDEO = '## A\n- 画面\n> 客户端先发送请求。\n';

test('user theme: picked by --theme, theme: and config; the page embeds it next to the built-in themes', async () => {
  install('notes', notesTheme());
  for (const [args, stdin] of [[['--theme', 'notes'], DRAFT], [[], `---\ntheme: notes\n---\n${DRAFT}`]]) {
    const r = await run(['render', '-', '--no-open', ...args], stdin);
    assert.equal(r.code, 0, r.err);
    const html = pageOf(r);
    assert.match(html, /data-theme="notes"/);
    assert.match(html, /html\[data-theme="notes"\], html\[data-theme="notes"\]\[data-mode="light"\] \{[^}]*--paper: #fdfcf8;/);
    assert.match(html, /html\[data-theme="notes"\] \.am-panel-head \{ letter-spacing/);
    assert.deepEqual(Object.keys(labels(html)), [...themeNames('page'), 'notes']);
    assert.equal(labels(html).notes, '笔记'); // lang-ok: expected Chinese UI label
  }
  assert.equal((await run(['config', 'set', 'theme', 'notes'])).code, 0);
  const html = pageOf(await run(['render', '-', '--no-open'], DRAFT));
  assert.match(html, /data-theme="notes"/);
});

test('user theme: pages with a built-in theme do not carry user themes', async () => {
  install('notes', notesTheme());
  const html = pageOf(await run(['render', '-', '--no-open'], DRAFT));
  assert.doesNotMatch(html, /"notes"/);
  assert.deepEqual(Object.keys(labels(html)), themeNames('page'));
});

test('user theme: fonts get the default fallback stack', async () => {
  install('notes', notesTheme());
  const html = pageOf(await run(['render', '-', '--no-open', '--theme', 'notes'], DRAFT));
  assert.match(html, /--font-sans: "IBM Plex Sans", "Noto Sans CJK SC", -apple-system, [^;]*sans-serif;/);
  // On Japanese pages a theme that sets its own font keeps it.
  const ja = pageOf(await run(['render', '-', '--no-open', '--theme', 'notes'], '## A 概要\n接続は3回のやりとりで行う。\n'));
  assert.match(ja, /html\[lang="ja"\]\[data-theme="notes"\]\[data-mode\] \{\n {2}--font-sans: "IBM Plex Sans"/);
});

test('user theme: video and patch keep it', async () => {
  install('notes', notesTheme());
  const video = await run(['video', '-', '--no-open', '--voice', 'off', '--theme', 'notes'], VIDEO);
  assert.equal(video.code, 0, video.err);
  assert.match(pageOf(video), /data-theme="notes"/);
  const page = await run(['render', '-', '--no-open', '--theme', 'notes'], DRAFT);
  const file = page.out.match(/✓ (.+\.html)/)[1];
  const patched = await run(['patch', file, '--panel', 'A', '--no-open'], '## A 流程\n新的内容在这里。\n');
  assert.equal(patched.code, 0, patched.err);
  assert.match(readFileSync(file, 'utf8'), /data-theme="notes"[\s\S]*新的内容/);
});

test('user theme: patching a page whose theme was removed fails and names the theme', async () => {
  install('notes', notesTheme());
  const file = (await run(['render', '-', '--no-open', '--theme', 'notes'], DRAFT)).out.match(/✓ (.+\.html)/)[1];
  rmSync(join(home, 'themes', 'notes.json'));
  const before = readFileSync(file, 'utf8');
  const r = await run(['patch', file, '--panel', 'A', '--no-open'], '## A 流程\n新的内容。\n');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /theme "notes".*not installed.*--theme/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal((await run(['patch', file, '--panel', 'A', '--no-open', '--theme', 'shadcn'], '## A 流程\n新的内容。\n')).code, 0);
});

test('user theme: a broken file is skipped with a warning and does not block other themes', async () => {
  install('broken', '{ not json');
  install('notes', notesTheme());
  const r = await run(['render', '-', '--no-open', '--theme', 'notes'], DRAFT);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /themes\/broken\.json skipped/);
  const explicit = await run(['render', '-', '--no-open', '--theme', 'broken'], DRAFT);
  assert.notEqual(explicit.code, 0);
  assert.match(explicit.err, /Theme "broken" cannot be used: .*JSON/);
});

test('user theme: rejected when it shadows a built-in theme, misses a dark token or leaks CSS', async () => {
  install('blueprint', notesTheme());
  install('nodark', notesTheme((t) => ({ ...t, tokens: { ...t.tokens, dark: { ...t.tokens.dark, '--ink': undefined } } })));
  install('leaky', notesTheme((t) => ({ ...t, css: '.am-panel-head { color: red; }' })));
  install('Bad_Name', notesTheme());
  const { err } = await run(['list']);
  assert.match(err, /themes\/blueprint\.json skipped: .*built-in/);
  assert.match(err, /themes\/nodark\.json skipped: .*dark mode is missing --ink/);
  assert.match(err, /themes\/leaky\.json skipped: .*&/);
  assert.match(err, /themes\/Bad_Name\.json skipped: .*name/);
});

test('user theme: a missing default theme in config falls back to blueprint with a warning', async () => {
  install('notes', notesTheme());
  assert.equal((await run(['config', 'set', 'theme', 'notes'])).code, 0);
  rmSync(join(home, 'themes', 'notes.json'));
  const r = await run(['render', '-', '--no-open'], DRAFT);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /default theme "notes".*blueprint/);
  assert.match(pageOf(r), /data-theme="blueprint"/);
  assert.notEqual((await run(['config', 'set', 'theme', 'nope'])).code, 0);
});

test('am list marks user themes', async () => {
  install('notes', notesTheme());
  assert.match((await run(['list'])).out, /^ {2}notes\s+Notes \(yours\)$/m);
});

test('am theme check: a complete theme passes and gets a specimen page per mode', async () => {
  install('notes', notesTheme());
  const r = await run(['theme', 'check', 'notes', '--no-open']);
  assert.equal(r.code, 0, r.err);
  const files = [...r.out.matchAll(/✓ (.+\.html)/g)].map((m) => m[1]);
  assert.equal(files.length, 2);
  const [light, dark] = files.map((f) => readFileSync(f, 'utf8'));
  assert.match(light, /data-theme="notes" data-mode="light"/);
  assert.match(dark, /data-theme="notes" data-mode="dark"/);
  for (const cls of ['am-annot', 'am-callout', 'am-node-shape', 'am-kv', 'am-lim', 'am-actor', 'am-timeline', 'am-tree', '<table']) {
    assert.ok(light.includes(cls), `the specimen shows ${cls}`);
  }
});

test('am theme check: reports invalid colors, missing tokens and low contrast; checks a file path', async () => {
  const file = join(home, 'draft-theme.json');
  writeFileSync(file, JSON.stringify(notesTheme((t) => ({
    ...t,
    tokens: { ...t.tokens, light: { ...t.tokens.light, '--ink': '#d0d0d0', '--accent-bg': 'bluish' }, dark: { ...t.tokens.dark, '--warn-bg': undefined } },
  }))));
  const r = await run(['theme', 'check', file, '--no-open']);
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /--accent-bg.*bluish.*color/);
  assert.match(r.out + r.err, /dark.*--warn-bg/);
  assert.match(r.out + r.err, /light.*--ink on --paper.*contrast/);
  assert.doesNotMatch(r.out, /✓ .+\.html/);
});

test('am theme check: every built-in page theme passes', async () => {
  for (const name of themeNames('page')) {
    const r = await run(['theme', 'check', name, '--no-open']);
    assert.equal(r.code, 0, `${name}: ${r.out}${r.err}`);
  }
});
