// The `home` setting moves only the output folder: pages, videos, the narration cache and state.json. config.json and themes/
// stay in the data directory (AM_HOME or ~/.answer-me-with-html). Seam: the CLI with a temporary HOME and AM_HOME.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.js';
import { writeState, readState } from '../src/state.js';

const isWin = process.platform === 'win32';
const SKIP = isWin || process.getuid?.() === 0 ? 'chmod does not deny access here' : false;
const DRAFT = '---\ntitle: Out\n---\n## A one\nText\n';
const HOME_VARS = ['HOME', 'USERPROFILE'];

let tmp;
let user;
let data;
let out;
let savedHome;
let savedTmpdir;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'am-out-'));
  user = join(tmp, 'user');
  mkdirSync(user);
  savedHome = HOME_VARS.map((k) => process.env[k]);
  for (const k of HOME_VARS) process.env[k] = user;
  savedTmpdir = process.env.TMPDIR;
  // os.homedir() reads HOME (POSIX) or USERPROFILE (Windows), so the default data directory is inside the test folder.
  data = join(user, '.answer-me-with-html');
  out = join(tmp, 'out');
});

afterEach(() => {
  HOME_VARS.forEach((k, i) => { if (savedHome[i] === undefined) delete process.env[k]; else process.env[k] = savedHome[i]; });
  if (savedTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmpdir;
  for (const dir of [out, join(tmp, 'systmp'), join(tmp, 'systmp', `answer-me-with-html-${process.getuid?.()}`)]) {
    if (existsSync(dir)) chmodSync(dir, 0o700);
  }
  rmSync(tmp, { recursive: true, force: true });
});

function sink() {
  let text = '';
  return { stream: new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } }), get text() { return text; } };
}

async function run(args, { stdin = DRAFT, env = {}, ttsProvider = null, io = {} } = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(args, {
    stdout: stdout.stream, stderr: stderr.stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', ...env }, cwd: tmp, ttsProvider, ...io,
  });
  return { code, out: stdout.text, err: stderr.text };
}

function writeConfig(home, values) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(values, null, 2)}\n`);
}

const modeOf = (p) => statSync(p).mode & 0o777;
const assertMode = (p, mode) => isWin || assert.equal(modeOf(p).toString(8), mode.toString(8), p);

test('home: a render without -o writes the page into <home>/pages, while config.json and themes/ stay in the data directory', async () => {
  writeConfig(data, { home: out, theme: 'shadcn' });
  mkdirSync(join(data, 'themes'));
  const { code, out: printed, err } = await run(['render', '-']);
  assert.equal(code, 0, err);
  const page = printed.match(/✓ (.+\.html)/)[1];
  assert.equal(dirname(page), join(out, 'pages'));
  assert.match(readFileSync(page, 'utf8'), /data-theme="shadcn"/, 'settings are read from the data directory');
  assert.ok(existsSync(join(data, 'config.json')));
  assert.ok(existsSync(join(data, 'themes')));
  assert.ok(!existsSync(join(out, 'config.json')));
  assert.ok(!existsSync(join(out, 'themes')));
  assertMode(out, 0o700);
});

test('home: a video page and the narration cache go into <home>', async () => {
  writeConfig(data, { home: out });
  const voice = { name: 'fake', id: 'fake', concurrency: 1, synth: async () => new Int16Array(800) };
  const { code, out: printed, err } = await run(['video', '-'], {
    stdin: '---\ntitle: V\n---\n## A one\n> One line.\n', ttsProvider: voice,
  });
  assert.equal(code, 0, err);
  assert.equal(dirname(printed.match(/✓ (.+\.html)/)[1]), join(out, 'videos'));
  assert.ok(existsSync(join(out, 'cache', 'tts')));
  assert.ok(!existsSync(join(data, 'cache')));
});

test('home: AM_HOME still wins; a configured home is ignored and stays untouched', async () => {
  const amHome = join(tmp, 'am-home');
  writeConfig(amHome, { home: out });
  const { code, out: printed, err } = await run(['render', '-'], { env: { AM_HOME: amHome } });
  assert.equal(code, 0, err);
  assert.equal(dirname(printed.match(/✓ (.+\.html)/)[1]), join(amHome, 'pages'));
  assert.ok(!existsSync(out));
});

test('home: an existing configured folder keeps its mode', { skip: isWin }, async () => {
  mkdirSync(out, { mode: 0o755 });
  chmodSync(out, 0o755);
  writeConfig(data, { home: out });
  const { code, out: printed, err } = await run(['render', '-']);
  assert.equal(code, 0, err);
  assert.equal(dirname(printed.match(/✓ (.+\.html)/)[1]), join(out, 'pages'));
  assertMode(out, 0o755);
});

test('home: an unwritable configured folder falls back to the temporary folder with a notice', { skip: SKIP }, async () => {
  const sysTmp = join(tmp, 'systmp');
  mkdirSync(sysTmp);
  process.env.TMPDIR = sysTmp;
  mkdirSync(out, { mode: 0o500 });
  chmodSync(out, 0o500);
  writeConfig(data, { home: out });
  const { code, out: printed, err } = await run(['render', '-']);
  assert.equal(code, 0, err);
  const page = printed.match(/✓ (.+\.html)/)[1];
  const fallback = join(sysTmp, `answer-me-with-html-${process.getuid?.()}`, 'pages');
  assert.equal(dirname(page), fallback);
  assert.ok(existsSync(page));
  const escaped = out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(printed, new RegExp(`^  ! ${escaped} is not writable \\(E[A-Z]+\\): saved in the temporary folder, which the system may clear$`, 'm'));
});

test('home: am clean counts and cleans <home>/pages and keeps the settings', async () => {
  writeConfig(data, { home: out });
  mkdirSync(join(out, 'pages'), { recursive: true });
  writeFileSync(join(out, 'pages', 'a.html'), 'a');
  writeFileSync(join(out, 'pages', 'b.html'), 'b');
  const dry = await run(['clean', '--all', '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /2 pages/);
  assert.match(dry.out, /Would delete 2 files/);
  const real = await run(['clean', '--all']);
  assert.equal(real.code, 0, real.err);
  assert.match(real.out, /✓ Deleted 2 files/);
  assert.deepEqual(existsSync(join(out, 'pages', 'a.html')) || existsSync(join(out, 'pages', 'b.html')), false);
  assert.ok(existsSync(join(data, 'config.json')));
});

test('home: a render starts the background update check in <home>', async () => {
  writeConfig(data, { home: out });
  const scriptPath = join(tmp, 'fake-update-check.mjs');
  writeFileSync(scriptPath, 'process.exit(0)\n');
  const { code, err } = await run(['render', '-'], {
    env: { AM_NO_UPDATE_CHECK: undefined },
    io: { background: true, scriptPath },
  });
  assert.equal(code, 0, err);
  assert.equal(typeof readState(out).lastUpdateCheck, 'number');
  assert.ok(!existsSync(join(data, 'state.json')), 'the data directory keeps no output state');
});

test('home: __update-check run with AM_HOME writes its result into <dir>/state.json', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => (String(url).includes('highlights') ? null : { version: '9.9.9' }) });
  try {
    const r = await run(['__update-check'], { env: { AM_HOME: out } });
    assert.equal(r.code, 0, r.err);
    assert.equal(readState(out).latestVersion, '9.9.9');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('home: the page-update state is read from <home>', async () => {
  writeConfig(data, { home: out });
  writeState(out, { latestVersion: '9.9.9', lastUpdateCheck: Date.now() });
  writeState(data, { latestVersion: '8.8.8' });
  const r = await run(['render', '-', '-o', join(tmp, 'page.html')], { env: { AM_NO_UPDATE_CHECK: undefined } });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(tmp, 'page.html'), 'utf8');
  assert.match(html, /9\.9\.9/);
  assert.doesNotMatch(html, /8\.8\.8/);
});

test('cli config: home is listed, set and reset', async () => {
  const set = await run(['config', 'set', 'home', out]);
  assert.equal(set.code, 0, set.err);
  assert.match(set.out, new RegExp(`home = ${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const list = await run(['config']);
  assert.match(list.out, /\* home\s+/);
  assert.ok(list.out.includes(out));
  const relative = await run(['config', 'set', 'home', 'pages']);
  assert.equal(relative.code, 2);
  assert.match(relative.err, /absolute path/);
  assert.equal((await run(['config', 'reset', 'home'])).code, 0);
  assert.equal((await run(['config', 'get', 'home'])).out.trim(), '(unset)');
});
