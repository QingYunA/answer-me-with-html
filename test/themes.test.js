// Theme registry (#63): every theme is one definition; shared CSS and the page runtime name no theme.
// Checked through the CLI and the rendered pages, so the tests do not depend on how the registry stores themes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { themeNames } from '../src/themes/registry.js';
import { RUNTIME_JS } from '../src/assets.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-themes-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

async function run(args, stdin = '') {
  let out = '';
  let err = '';
  const sink = (fn) => new Writable({ write(c, _e, cb) { fn(String(c)); cb(); } });
  const code = await main(args, {
    stdout: sink((s) => { out += s; }), stderr: sink((s) => { err += s; }), stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: dir }, cwd: dir,
  });
  return { code, out, err };
}

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DRAFT = '## A 流程\n客户端先发送请求，服务端再返回结果。\n```flow\nA -> B\n```\n';
const VIDEO = '---\ntitle: T\n---\n## A\n```flow\nA -> B\n```\n> A goes to B.\n';

test('themes: shared stylesheets and the page runtime name no theme', () => {
  for (const file of ['../src/themes/base.css', '../src/themes/video.css']) {
    assert.doesNotMatch(read(file), /data-theme="/, `${file} must not select on a theme name`);
  }
  for (const name of themeNames('video')) {
    assert.doesNotMatch(RUNTIME_JS, new RegExp(`['"]${name}['"]`), `the page runtime must not name ${name}`);
  }
});

test('themes: am list shows every theme, video-only themes marked', async () => {
  const { out } = await run(['list']);
  for (const name of themeNames('video')) assert.match(out, new RegExp(`^  ${name}\\s`, 'm'));
  assert.match(out, /^ {2}3b1b\s.*video only/m);
  assert.doesNotMatch(out, /^ {2}blueprint\s.*video only/m);
});

test('themes: an unknown theme lists the registered choices', async () => {
  const page = await run(['render', '-', '--theme', 'nope', '--no-open'], DRAFT);
  assert.notEqual(page.code, 0);
  assert.match(page.err, new RegExp(`Choose one of: ${themeNames('page').join(' \\| ')}`));
  const video = await run(['video', '-', '--theme', 'nope', '--voice', 'off', '--no-open'], VIDEO);
  assert.notEqual(video.code, 0);
  assert.match(video.err, new RegExp(`Choose one of: ${themeNames('video').join(' \\| ')}`));
});

test('themes: the theme button carries a label for each page theme, in the page language', () => {
  const labels = (html) => JSON.parse(html.match(/data-am="theme" data-labels="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  const zh = labels(renderDoc(DRAFT).html);
  assert.deepEqual(Object.keys(zh), themeNames('page'));
  assert.equal(zh.blueprint, '主题：图纸'); // lang-ok: expected Chinese UI label
  const en = labels(renderDoc('## A Flow\nPlain English text here.\n').html);
  assert.equal(en.shadcn, 'Theme: Cards');
});

test('themes: decoration rules apply only under their own theme', async () => {
  const { html } = renderDoc(DRAFT);
  const video = (await renderVideo(VIDEO)).html;
  for (const page of [html, video]) {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.doesNotMatch(css, /(^|[\s,}])&/, 'every & is replaced with the theme selector');
  }
  assert.match(html, /html\[data-theme="blueprint"\] \.am-frame \{/);
  assert.match(html, /html\[data-theme="shadcn"\] \.am-panel-id \{/);
  assert.match(video, /html\[data-video\]\[data-theme="3b1b"\] \.amv-scene-head \{/);
  assert.doesNotMatch(html, /data-theme="3b1b"/, 'video-only themes stay out of pages');
});

test('themes: a theme with a fixed mode forces it in video', async () => {
  const { html } = await renderVideo(VIDEO, { overrides: { theme: '3b1b', mode: 'light' } });
  assert.match(html, /data-theme="3b1b" data-mode="dark"/);
});
