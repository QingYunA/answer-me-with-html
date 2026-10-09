// The data directory is private to the user: no other user on a shared host can enter it, so every page, video and cache inside is protected.
// Seam: the CLI with a temporary HOME (the default location) or a temporary AM_HOME (a custom one). Never the real home directory.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.js';
import { amHome, setConfig } from '../src/config.js';
import { ensureHome } from '../src/home.js';
import { writeState } from '../src/state.js';
import { startServer } from '../src/serve.js';

// Windows has no POSIX file modes (Node reports 0o666 or 0o777 for a directory).
const isWin = process.platform === 'win32';
const modeOf = (p) => statSync(p).mode & 0o777;
const assertMode = (p, mode) => isWin || assert.equal(modeOf(p).toString(8), mode.toString(8), p);

const DRAFT = '---\ntitle: Private\n---\n## A one\nText\n';
let tmp;
let realHome;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'am-private-'));
  realHome = process.env.HOME;
  process.env.HOME = join(tmp, 'user'); // os.homedir() reads HOME on POSIX
  mkdirSync(process.env.HOME);
});
afterEach(() => {
  process.env.HOME = realHome;
  rmSync(tmp, { recursive: true, force: true });
});

function sink() {
  let text = '';
  return { stream: new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } }), get text() { return text; } };
}

async function render(env, extra = [], { args = ['render', '-'], stdin = DRAFT, ttsProvider = null } = {}) {
  const out = sink();
  const code = await main([...args, '--no-open', ...extra], {
    stdout: out.stream, stderr: sink().stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', ...env }, cwd: tmp, ttsProvider,
  });
  assert.equal(code, 0, out.text);
  return out.text;
}

const defaultHome = () => join(process.env.HOME, '.answer-me-with-html');

test('default data directory: created 0700 on the first render', async () => {
  const text = await render({});
  assert.equal(amHome({}), defaultHome());
  assertMode(defaultHome(), 0o700);
  assert.ok(existsSync(text.match(/✓ (.+\.html)/)[1]));
});

test('default data directory: an existing 0755 folder is tightened to 0700 by the next render', async () => {
  mkdirSync(defaultHome(), { mode: 0o755 });
  if (!isWin) chmodSync(defaultHome(), 0o755);
  assertMode(defaultHome(), 0o755);
  await render({});
  assertMode(defaultHome(), 0o700);
});

test('default data directory: an empty AM_HOME counts as unset', async () => {
  mkdirSync(defaultHome(), { mode: 0o755 });
  if (!isWin) chmodSync(defaultHome(), 0o755);
  await render({ AM_HOME: '' });
  assertMode(defaultHome(), 0o700);
});

test('custom AM_HOME: a folder am creates is 0700, an existing one keeps its mode', async () => {
  const fresh = join(tmp, 'fresh', 'home');
  await render({ AM_HOME: fresh });
  assertMode(fresh, 0o700);

  const existing = join(tmp, 'shared');
  mkdirSync(existing, { mode: 0o755 });
  if (!isWin) chmodSync(existing, 0o755);
  await render({ AM_HOME: existing });
  assertMode(existing, 0o755);
});

test('a page saved with -o elsewhere leaves that folder and the data directory alone', async () => {
  const outside = join(tmp, 'outside');
  mkdirSync(outside, { mode: 0o755 });
  if (!isWin) chmodSync(outside, 0o755);
  mkdirSync(defaultHome(), { mode: 0o755 });
  if (!isWin) chmodSync(defaultHome(), 0o755);
  await render({ AM_HOME: join(tmp, 'custom') }, ['-o', join(outside, 'o.html')]);
  assertMode(outside, 0o755);
  assert.ok(existsSync(join(outside, 'o.html')));
  assert.equal(existsSync(join(tmp, 'custom', 'pages')), false, 'nothing is written to the data directory');
});

test('a video page, the narration cache and a theme check specimen go into a private data directory too', async () => {
  const video = '---\ntitle: V\n---\n## A one\n> One line.\n';
  const voice = { name: 'fake', id: 'fake', concurrency: 1, synth: async () => new Int16Array(800) };
  const home = join(tmp, 'v');
  await render({ AM_HOME: home }, [], { args: ['video', '-'], stdin: video, ttsProvider: voice });
  assertMode(home, 0o700);
  assert.ok(existsSync(join(home, 'cache', 'tts')), 'the narration was cached inside');

  const home2 = join(tmp, 'v2');
  await render({ AM_HOME: home2 }, [], { args: ['theme', 'check', 'paper'] });
  assertMode(home2, 0o700);
});

test('writers create the data directory 0700: state.json, config.json, serve.json', async () => {
  const state = join(tmp, 's');
  writeState(state, { firstSeen: 1 });
  assertMode(state, 0o700);

  const config = join(tmp, 'c');
  setConfig('open', 'off', { AM_HOME: config });
  assertMode(config, 0o700);

  const serve = join(tmp, 'sv');
  const srv = await startServer({ home: serve, port: 0 });
  try {
    assertMode(serve, 0o700);
  } finally {
    await srv.close();
  }
});

test('ensureHome: creates a new folder 0700 and leaves an existing custom one alone', () => {
  const custom = join(tmp, 'custom');
  mkdirSync(custom, { mode: 0o750 });
  if (!isWin) chmodSync(custom, 0o750);
  ensureHome(custom);
  assertMode(custom, 0o750);

  ensureHome(join(tmp, 'new'));
  assertMode(join(tmp, 'new'), 0o700);
});
