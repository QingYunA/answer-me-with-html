// The parts of the website's theme editor (site/src/editor-model.js) that need no page: starting points, the file the form edits,
// the check, the submit link and the issue loader. The page itself (site/src/editor.js) is checked by hand in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as M from '../site/src/editor-model.js';
import { catalogProblems, MAX_BYTES } from '../src/themes/catalog-rules.js';
import { COLOR_TOKENS } from '../src/themes/check.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = readdirSync(join(ROOT, 'marketplace/themes')).map((f) => f.replace(/\.json$/, ''));
const COMIC = JSON.parse(readFileSync(join(ROOT, 'marketplace/themes/comic.json'), 'utf8'));
const filled = (file) => ({ ...file, author: 'Tester', description: { en: 'A test theme.', zh: '测试主题。' } });
const fields = (name, data, existing = CATALOG) => M.checkTheme({ name, data, existing }).problems.map((p) => p.field);

test('builtinThemeFile: every page theme becomes a theme file that passes the catalog rules once a name is set', () => {
  for (const name of ['blueprint', 'shadcn', 'paper']) {
    const file = filled(M.startFrom(M.builtinThemeFile(name)));
    assert.deepEqual(fields(`my-${name}`, file), [], name);
    assert.ok(fields(name, file).includes('name'), `${name}: a built-in name is taken`);
    // The diagram tokens are set in the file itself, for light and dark.
    const common = file.tokens.common;
    assert.ok(['--node-fill', '--edge-color', '--hi-fill', '--note-fill'].every((k) => common[k]), name);
    for (const mode of ['light', 'dark']) assert.ok(COLOR_TOKENS.every((k) => typeof file.tokens[mode][k] === 'string'), `${name} ${mode}`);
  }
});

test('builtinThemeFile: keeps the css and the video part of a theme, drops the font stacks, and knows only page themes', () => {
  const blueprint = M.builtinThemeFile('blueprint');
  assert.match(blueprint.css, /am-frame/);
  assert.ok(blueprint.video.css && blueprint.video.tokens.light['--v-stage']);
  assert.ok(!('--font-sans' in blueprint.tokens.common) && !('--font-mono' in blueprint.tokens.common));
  assert.equal(M.builtinThemeFile('shadcn').video.tokens, undefined, 'a theme with no video tokens has none');
  assert.equal(M.builtinThemeFile('paper').video, undefined);
  assert.equal(M.builtinThemeFile('3b1b'), null, 'a video theme is not offered');
  assert.equal(M.builtinThemeFile('nope'), null);
  assert.equal(M.builtinThemeFile('paper').tokens.common['--font-serif'] !== undefined, true, 'paper keeps its serif stack');
});

test('startFrom: a copy with version 1.0.0, the MIT license and no author, whatever the source says', () => {
  const file = M.startFrom(COMIC);
  assert.equal(file.version, '1.0.0');
  assert.equal(file.license, 'MIT');
  assert.equal(file.author, '');
  assert.equal(COMIC.version, '1.1.0', 'the source is not changed');
  file.tokens.light['--ink'] = '#000000';
  assert.notEqual(COMIC.tokens.light['--ink'], '#000000', 'a copy, not a reference');
  assert.deepEqual(fields('my-comic', filled(file)), []);
  assert.ok(fields('comic', filled(file)).includes('name'), 'a catalog name is taken');
});

test('startChoices: the page themes first, then the catalog, with the label of the language', () => {
  const index = { themes: [{ name: 'comic', label: { en: 'Comic', zh: '漫画' } }, { name: 'plain' }] };
  assert.deepEqual(M.startChoices(index).map((c) => c.value), ['blueprint', 'shadcn', 'paper', 'comic', 'plain']);
  assert.deepEqual(M.startChoices(index).map((c) => c.kind), ['builtin', 'builtin', 'builtin', 'catalog', 'catalog']);
  const zh = M.startChoices(index, 'zh');
  assert.equal(zh.find((c) => c.value === 'comic').label, '漫画');
  assert.equal(zh.find((c) => c.value === 'plain').label, 'plain', 'no label: the name');
  assert.equal(zh.find((c) => c.value === 'paper').label, '纸张');
  assert.equal(M.startChoices(undefined).length, 3);
});

test('formatThemeFile: the bytes the Action commits, and the check reads exactly those', () => {
  const text = M.formatThemeFile(COMIC);
  assert.equal(text, `${JSON.stringify(COMIC, null, 2)}\n`);
  assert.equal(text, readFileSync(join(ROOT, 'marketplace/themes/comic.json'), 'utf8'), 'a catalog file is already laid out this way');
  const checked = M.checkTheme({ name: 'my-comic', data: COMIC, existing: CATALOG });
  assert.equal(checked.text, text);
  assert.deepEqual(checked.problems, catalogProblems('my-comic', text, { existing: CATALOG }));
});

test('checkTheme: a JSON view that does not parse is checked as the text it is', () => {
  const { text, problems } = M.checkTheme({ name: 'x', data: COMIC, rawText: '{ nope', jsonError: true });
  assert.equal(text, '{ nope');
  assert.ok(problems.some((p) => p.field === 'json'));
});

test('checkTheme: the size rule is the catalog 16 KB, so a file between 16 and 64 KB loads and is told off', () => {
  const big = { ...filled(M.startFrom(COMIC)), css: `/* ${'x'.repeat(MAX_BYTES)} */` };
  assert.ok(M.MAX_READ > MAX_BYTES);
  assert.ok(fields('my-big', big).includes('size'));
});

test('setIn and getIn: set a value without touching the original, remove with undefined, keep the key order', () => {
  const data = { a: { b: 1, c: 2 }, d: 3 };
  const next = M.setIn(data, ['a', 'b'], 9);
  assert.deepEqual(next, { a: { b: 9, c: 2 }, d: 3 });
  assert.deepEqual(Object.keys(next.a), ['b', 'c']);
  assert.equal(data.a.b, 1);
  assert.deepEqual(M.setIn(data, ['a', 'c'], undefined), { a: { b: 1 }, d: 3 });
  assert.deepEqual(M.setIn(data, ['x', 'y', 'z'], 1), { a: { b: 1, c: 2 }, d: 3, x: { y: { z: 1 } } });
  assert.deepEqual(M.setIn(undefined, ['x'], 1), { x: 1 });
  assert.equal(M.getIn(data, ['a', 'c']), 2);
  assert.equal(M.getIn(data, ['d', 'e']), undefined);
  assert.equal(M.getIn(data, ['q', 'e']), undefined);
});

test('parseThemeText: an object, or the parse problem; an array or a number is not a theme', () => {
  assert.deepEqual(M.parseThemeText('{"a":1}'), { data: { a: 1 } });
  assert.match(M.parseThemeText('{ nope').error, /not valid JSON/);
  assert.match(M.parseThemeText('[1]').error, /JSON object/);
  assert.match(M.parseThemeText('3').error, /JSON object/);
  assert.match(M.parseThemeText('').error, /not valid JSON/);
});

test('nameFromFile and isFreeName: a file name is a name only when the catalog would take it', () => {
  assert.equal(M.nameFromFile('my-theme.json'), 'my-theme');
  assert.equal(M.nameFromFile('My Theme.json'), '');
  assert.equal(M.nameFromFile(`${'a'.repeat(41)}.json`), '');
  assert.equal(M.nameFromFile(undefined), '');
  assert.equal(M.isFreeName('my-theme', CATALOG), true);
  for (const name of ['comic', 'blueprint', 'index', 'new', '', 'Bad Name']) assert.equal(M.isFreeName(name, CATALOG), false, name);
});

test('problemsByField and tokensNamed: group a list by field, find the tokens a message names', () => {
  const map = M.problemsByField([{ field: 'a', message: '1' }, { field: 'b', message: '2' }, { field: 'a', message: '3' }]);
  assert.deepEqual([...map], [['a', ['1', '3']], ['b', ['2']]]);
  assert.deepEqual(M.tokensNamed('In light mode, --ink on --paper has contrast 1:1, --ink'), ['--ink', '--paper']);
  assert.deepEqual(M.tokensNamed('nothing here'), []);
});

test('previewTheme: usable for a good theme, with the errors that stop a preview for a bad one', () => {
  assert.deepEqual(M.previewTheme(M.builtinThemeFile('blueprint')).errors, []);
  assert.ok(M.previewTheme({ tokens: { light: { '--bg': '#fff' } } }).errors.length);
});

test('colorHex: a color the page can show in a color input, null for the rest', () => {
  assert.equal(M.colorHex('#abc'), '#aabbcc');
  assert.equal(M.colorHex('rgb(255, 0, 0)'), '#ff0000');
  assert.equal(M.colorHex('hsl(0 100% 50%)'), '#ff0000');
  assert.equal(M.colorHex('rgba(0, 0, 0, 0.5)'), '#000000');
  assert.equal(M.colorHex('var(--paper)'), null);
  assert.equal(M.colorHex(''), null);
});

// ── Submit ──
test('submitPlan: the issue form link carries the name and the compact JSON', () => {
  const data = filled(M.startFrom(COMIC));
  const plan = M.submitPlan('my-comic', data);
  assert.equal(plan.paste, false);
  const url = new URL(plan.url);
  assert.equal(url.origin + url.pathname, 'https://github.com/QingYunA/answer-me-with-html/issues/new');
  assert.equal(url.searchParams.get('template'), 'theme.yml');
  assert.equal(url.searchParams.get('title'), 'Theme: my-comic');
  assert.equal(url.searchParams.get('name'), 'my-comic');
  assert.equal(url.searchParams.get('theme'), JSON.stringify(data), 'compact, not laid out');
  assert.match(plan.url, /title=Theme:%20my-comic&name=my-comic&theme=%7B/);
  assert.ok(plan.url.length <= M.MAX_URL);
});

test('submitPlan: a theme that makes the link longer than 8000 characters goes by the clipboard', () => {
  const data = { ...filled(M.startFrom(COMIC)), css: `/* ${'é'.repeat(3000)} */` };
  const plan = M.submitPlan('my-comic', data);
  assert.equal(plan.paste, true);
  assert.ok(!plan.url.includes('theme=%7B') && !plan.url.includes('&theme='), 'no theme in the link');
  assert.ok(plan.url.endsWith('&name=my-comic'));
  assert.equal(plan.text, M.formatThemeFile(data), 'the formatted file is what the person pastes');
});

test('submitPlan: the limit is on the whole link, to the character', () => {
  const at = (n) => ({ a: 'x'.repeat(n) });
  const overhead = M.submitPlan('n', at(0)).url.length;
  const room = M.MAX_URL - overhead;
  assert.equal(M.submitPlan('n', at(room)).paste, false);
  assert.equal(M.submitPlan('n', at(room + 1)).paste, true);
});

// ── ?issue=<n> ──
const body = (name, json) => `### Theme name\n\n${name}\n\n### Theme JSON\n\n\`\`\`json\n${json}\n\`\`\`\n\n### License\n\n- [X] I made this theme, and I license it under the license in the file.`;
const reply = (status, payload, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => payload });

test('issueNumber: digits only, no zero, not too long', () => {
  assert.equal(M.issueNumber('?issue=249'), '249');
  assert.equal(M.issueNumber('?from=pop&issue=7'), '7');
  for (const q of ['', '?issue=', '?issue=0', '?issue=012', '?issue=1e3', '?issue=-4', '?issue=12a', '?issue=../x', '?issue=1234567890', '?issue=%20']) assert.equal(M.issueNumber(q), null, q);
});

test('fetchIssue: reads the name and the theme of an issue with the parser the Action uses', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init]);
    return reply(200, { title: 'Theme: my-comic', html_url: 'https://github.com/QingYunA/answer-me-with-html/issues/12', body: body('my-comic', JSON.stringify(COMIC)) });
  };
  const result = await M.fetchIssue('12', fetchFn);
  assert.deepEqual(calls.map((c) => c[0]), ['https://api.github.com/repos/QingYunA/answer-me-with-html/issues/12']);
  assert.equal(calls[0][1].headers.accept, 'application/vnd.github+json');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'my-comic');
  assert.deepEqual(JSON.parse(result.text), COMIC);
  assert.equal(result.title, 'Theme: my-comic');
});

test('fetchIssue: tells apart the rate limit, a missing issue, other errors, a broken network and an issue with no theme', async () => {
  const run = (fetchFn) => M.fetchIssue('5', fetchFn);
  assert.deepEqual(await run(async () => reply(403, {}, { 'x-ratelimit-remaining': '0' })), { ok: false, reason: 'rate', status: 403 });
  assert.deepEqual(await run(async () => reply(403, {})), { ok: false, reason: 'rate', status: 403 }, 'a 403 with no rate headers is read as the limit');
  assert.deepEqual(await run(async () => reply(429, {})), { ok: false, reason: 'rate', status: 429 });
  assert.deepEqual(await run(async () => reply(403, {}, { 'x-ratelimit-remaining': '12' })), { ok: false, reason: 'http', status: 403 });
  assert.deepEqual(await run(async () => reply(404, {})), { ok: false, reason: 'missing', status: 404 });
  assert.deepEqual(await run(async () => reply(500, {})), { ok: false, reason: 'http', status: 500 });
  assert.deepEqual(await run(async () => { throw new TypeError('offline'); }), { ok: false, reason: 'network' });
  assert.deepEqual(await run(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })), { ok: false, reason: 'http', status: 200 });
  assert.deepEqual(await run(async () => reply(200, { body: 'Please add my theme!' })), { ok: false, reason: 'empty' });
  assert.deepEqual(await run(async () => reply(200, null)), { ok: false, reason: 'empty' });
});

test('fetchIssue: a theme that is not JSON still comes back, so the editor shows what the bot saw', async () => {
  const result = await M.fetchIssue('5', async () => reply(200, { body: body('x', '{ nope') }));
  assert.equal(result.ok, true);
  assert.equal(result.text, '{ nope');
  assert.equal(result.title, '');
  assert.equal(result.url, '');
});
