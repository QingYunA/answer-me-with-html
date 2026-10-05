// theme: auto picks a built-in theme from the draft (paper for reading, blueprint for diagrams), and the toolbar uses drop-down lists.
// Seam: the CLI with a temporary AM_HOME, and the rendered page.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { themeNames } from '../src/themes/registry.js';

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'am-auto-')); });
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
const page = async (args, stdin) => {
  const r = await run(['render', '-', '--no-open', ...args], stdin);
  assert.equal(r.code, 0, r.err);
  return { html: readFileSync(r.out.match(/✓ (.+\.html)/)[1], 'utf8'), file: r.out.match(/✓ (.+\.html)/)[1], out: r.out };
};
const theme = (html) => html.match(/<html [^>]*data-theme="([^"]+)"/)[1];
// The <option>s of a toolbar list: [value, text, selected].
const options = (html, name) => {
  const select = html.match(new RegExp(`<select[^>]*data-am="${name}"[^>]*>([\\s\\S]*?)</select>`))[1];
  return [...select.matchAll(/<option value="([^"]+)"( selected)?>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], Boolean(m[2])]);
};

const PROSE = '## A 背景\n这个项目从去年开始，团队先整理了需求，再确定了范围。\n\n## B 结论\n先做最小版本，再逐步补齐。\n';
const DIAGRAM = '## A 流程\n客户端先发送请求。\n```flow\nA -> B\n```\n';

test('auto: by default, a doc page and a prose-only sheet use paper; a sheet with components uses blueprint', async () => {
  assert.equal(theme((await page([], `---\ntemplate: doc\n---\n${DIAGRAM}`)).html), 'paper');
  assert.equal(theme((await page([], PROSE)).html), 'paper');
  assert.equal(theme((await page([], DIAGRAM)).html), 'blueprint');
});

test('auto: the page and the summary name the theme that was picked, and patch keeps it', async () => {
  const { html, file, out } = await page([], PROSE);
  assert.doesNotMatch(html, /data-theme="auto"/);
  assert.match(out, /sheet · paper ·/);
  const r = await run(['patch', file, '--panel', 'B', '--no-open'], '## B 结论\n```flow\nA -> B\n```\n');
  assert.equal(r.code, 0, r.err);
  assert.equal(theme(readFileSync(file, 'utf8')), 'paper');
});

test('auto: a theme set in config wins; --theme auto overrides it', async () => {
  assert.equal((await run(['config', 'set', 'theme', 'shadcn'])).code, 0);
  assert.equal(theme((await page([], PROSE)).html), 'shadcn');
  assert.equal(theme((await page(['--theme', 'auto'], PROSE)).html), 'paper');
  assert.equal((await run(['config', 'set', 'theme', 'auto'])).code, 0);
});

test('auto: video picks blueprint; paper is a page-only theme', async () => {
  const VIDEO = '## A\n- 画面\n> 客户端先发送请求。\n';
  const r = await run(['video', '-', '--no-open', '--voice', 'off'], VIDEO);
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(r.out.match(/✓ (.+\.html)/)[1], 'utf8'), /data-theme="blueprint"/);
  assert.ok(themeNames('page').includes('paper'));
  assert.ok(!themeNames('video').includes('paper'));
});

test('toolbar: theme and mode are drop-down lists with the current value selected', async () => {
  const { html } = await page([], PROSE);
  assert.deepEqual(options(html, 'theme').map(([v]) => v), themeNames('page'));
  assert.deepEqual(options(html, 'theme').find(([, , s]) => s), ['paper', '纸张', true]); // lang-ok: expected Chinese UI label
  assert.deepEqual(options(html, 'mode').map(([v, , s]) => [v, s]), [['auto', true], ['light', false], ['dark', false]]);
  assert.match(html, /<label class="am-pick">主题<select/); // lang-ok: expected Chinese UI label
  assert.doesNotMatch(html, /data-labels=/);
});
