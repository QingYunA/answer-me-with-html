// A host sandbox may stop the CLI from writing to, or reading, the data directory (issue #269). A default-location page then goes to a
// private folder in the system temporary folder; every other failure is one line instead of an internal error. Seam: the CLI with a
// temporary AM_HOME whose folders lose their permissions through chmod, and TMPDIR (os.tmpdir() reads it on POSIX) in the test folder.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, chmodSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.js';

// chmod does not take read or write away on Windows, nor from root.
const SKIP = process.platform === 'win32' || process.getuid?.() === 0 ? 'chmod does not deny access here' : false;

const DRAFT = '---\ntitle: Locked\n---\n## A one\nText\n';
let tmp;
let home;
let sysTmp;
let savedTmpdir;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'am-perm-'));
  home = join(tmp, 'home');
  mkdirSync(join(home, 'themes'), { recursive: true });
  sysTmp = join(tmp, 'systmp');
  mkdirSync(sysTmp);
  savedTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = sysTmp;
});
afterEach(() => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmpdir;
  for (const dir of [home, join(home, 'themes'), join(home, 'pages'), join(tmp, 'locked'), sysTmp, fallback()]) if (existsSync(dir)) chmodSync(dir, 0o700);
  rmSync(tmp, { recursive: true, force: true });
});

// The private folder the CLI falls back to when it cannot write to the data directory.
const fallback = () => join(sysTmp, `answer-me-with-html-${process.getuid?.()}`);

function sink() {
  let text = '';
  return { stream: new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } }), get text() { return text; } };
}

async function run(args, { stdin = DRAFT, now, ttsProvider = null } = {}) {
  const out = sink();
  const err = sink();
  const code = await main([...args, '--no-open'], {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_HOME: home, AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1' }, cwd: tmp, ttsProvider, now,
  });
  return { code, out: out.text, err: err.text };
}

test('permissions: a data directory the session cannot write to falls back to a private temporary folder', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const { code, out, err } = await run(['render', '-']);
  assert.equal(code, 0, err);
  const page = out.match(/✓ (.+\.html)/)[1];
  assert.equal(dirname(page), join(fallback(), 'pages'));
  assert.match(basename(page), /^Locked-\d{8}-\d{6}\.html$/);
  assert.ok(existsSync(page));
  assert.match(out, new RegExp(`^  ! ${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not writable \\(E[A-Z]+\\): saved in the temporary folder, which the system may clear$`, 'm'));
  assert.equal(statSync(fallback()).mode & 0o777, 0o700);
  assert.ok(!existsSync(join(home, 'pages')));
});

test('permissions: no fallback when the data directory is writable', { skip: SKIP }, async () => {
  const { code, out } = await run(['render', '-']);
  assert.equal(code, 0);
  assert.equal(dirname(out.match(/✓ (.+\.html)/)[1]), join(home, 'pages'));
  assert.ok(!existsSync(fallback()));
});

test('permissions: the data directory and the temporary folder both unwritable give a one-line error that names -o', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  chmodSync(sysTmp, 0o500);
  const { code, err } = await run(['render', '-']);
  assert.equal(code, 1, err);
  assert.match(err, /^✗ Cannot write the page: permission denied \(E[A-Z]+\) .+Locked-\d{8}-\d{6}\.html/m);
  assert.match(err, /-o "<workspace>\/\.tmp\/answers\/Locked-\d{8}-\d{6}\.html"/);
  assert.equal(err.trim().split('\n').length, 1, err);
  assert.ok(!/Internal error/.test(err));
  assert.ok(!existsSync(join(home, 'pages')));
});

test('permissions: a temporary folder that is a symlink is refused and nothing is written through it', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const elsewhere = join(tmp, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, fallback());
  const { code, err } = await run(['render', '-']);
  assert.equal(code, 1, err);
  assert.match(err, /^✗ Cannot write the page: .*is not a private folder of this user.* -o /m);
  assert.equal(err.trim().split('\n').length, 1, err);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test('permissions: a temporary folder other users can enter is refused', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  mkdirSync(fallback());
  chmodSync(fallback(), 0o755);
  const { code, err } = await run(['render', '-']);
  assert.equal(code, 1, err);
  assert.match(err, /^✗ Cannot write the page: .*is not a private folder of this user/m);
  assert.deepEqual(readdirSync(fallback()), []);
  assert.equal(statSync(fallback()).mode & 0o777, 0o755, 'the mode is not changed');
});

test('permissions: --replace takes a fallback page and deletes it once the new one is written', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const first = await run(['render', '-'], { now: () => Date.UTC(2026, 0, 1, 10, 0, 0) });
  const old = first.out.match(/✓ (.+\.html)/)[1];
  assert.ok(existsSync(old));
  const second = await run(['render', '-', '--replace', old], { now: () => Date.UTC(2026, 0, 1, 10, 5, 0) });
  assert.equal(second.code, 0, second.err);
  const fresh = second.out.match(/✓ (.+\.html)/)[1];
  assert.notEqual(fresh, old);
  assert.ok(existsSync(fresh));
  assert.ok(!existsSync(old));
});

test('permissions: --replace keeps the old page when the new one cannot be written anywhere', { skip: SKIP }, async () => {
  const first = await run(['render', '-']);
  const old = first.out.match(/✓ (.+\.html)/)[1];
  chmodSync(join(home, 'pages'), 0o500);
  chmodSync(sysTmp, 0o500);
  const { code } = await run(['render', '-', '--replace', old]);
  chmodSync(join(home, 'pages'), 0o700);
  assert.equal(code, 1);
  assert.ok(existsSync(old));
});

test('permissions: --replace keeps an old page it may not delete and says so', { skip: SKIP }, async () => {
  const first = await run(['render', '-'], { now: () => Date.UTC(2026, 0, 1, 10, 0, 0) });
  const old = first.out.match(/✓ (.+\.html)/)[1];
  chmodSync(join(home, 'pages'), 0o500);
  const { code, out, err } = await run(['render', '-', '--replace', old], { now: () => Date.UTC(2026, 0, 1, 10, 5, 0) });
  chmodSync(join(home, 'pages'), 0o700);
  assert.equal(code, 0, err);
  assert.equal(dirname(out.match(/✓ (.+\.html)/)[1]), join(fallback(), 'pages'));
  assert.ok(existsSync(old));
  assert.match(err, /^! Kept the earlier page .+ \(permission denied, E[A-Z]+\)$/m);
});

test('permissions: --replace still refuses a page outside the two page folders and names both', { skip: SKIP }, async () => {
  const stray = join(tmp, 'stray.html');
  writeFileSync(stray, '<html></html>');
  const { code, err } = await run(['render', '-', '--replace', stray]);
  assert.equal(code, 2, err);
  assert.ok(err.includes(join(home, 'pages')) && err.includes(join(fallback(), 'pages')), err);
});

test('permissions: am clean covers the fallback pages and videos, and --dry-run deletes nothing', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const page = (await run(['render', '-'])).out.match(/✓ (.+\.html)/)[1];
  const video = (await run(['video', '-', '--voice', 'off'], { stdin: '---\ntitle: V\n---\n## A one\n> One line.\n' })).out.match(/✓ (.+\.html)/)[1];
  chmodSync(home, 0o700);
  const dry = await run(['clean', '--all', '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^Temporary folder: .+answer-me-with-html-\d+ \(.+ in total: 1 page, 1 video\)$/m);
  assert.match(dry.out, /Would delete 2 files/);
  assert.ok(existsSync(page) && existsSync(video));
  const real = await run(['clean', '--all']);
  assert.match(real.out, /✓ Deleted 2 files/);
  assert.ok(!existsSync(page) && !existsSync(video));
});

test('permissions: am clean without --all keeps recent fallback pages and deletes old ones', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const recent = (await run(['render', '-'], { now: () => Date.UTC(2026, 0, 1, 10, 0, 0) })).out.match(/✓ (.+\.html)/)[1];
  const old = (await run(['render', '-'], { now: () => Date.UTC(2026, 0, 1, 10, 5, 0) })).out.match(/✓ (.+\.html)/)[1];
  chmodSync(home, 0o700);
  const longAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  utimesSync(old, longAgo, longAgo);
  const { code, out } = await run(['clean']);
  assert.equal(code, 0);
  assert.match(out, /✓ Deleted 1 file,/);
  assert.ok(existsSync(recent) && !existsSync(old));
});

test('permissions: am clean never creates or follows an unsafe temporary folder', { skip: SKIP }, async () => {
  assert.equal((await run(['clean', '--all'])).code, 0);
  assert.ok(!existsSync(fallback()), 'not created');
  const elsewhere = join(tmp, 'elsewhere');
  mkdirSync(join(elsewhere, 'pages'), { recursive: true });
  writeFileSync(join(elsewhere, 'pages', 'keep.html'), 'x');
  symlinkSync(elsewhere, fallback());
  const { code, out } = await run(['clean', '--all']);
  assert.equal(code, 0);
  assert.ok(!/Temporary folder/.test(out));
  assert.ok(existsSync(join(elsewhere, 'pages', 'keep.html')));
});

test('permissions: am video without -o falls back into the temporary videos folder', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  const { code, out, err } = await run(['video', '-', '--voice', 'off'], { stdin: '---\ntitle: V\n---\n## A one\n> One line.\n' });
  assert.equal(code, 0, err);
  assert.equal(dirname(out.match(/✓ (.+\.html)/)[1]), join(fallback(), 'videos'));
  assert.match(out, /is not writable \(E[A-Z]+\): saved in the temporary folder/);
});

test('permissions: am patch never falls back; a page it may not overwrite gives the one-line error', { skip: SKIP }, async () => {
  const page = join(tmp, 'page.html');
  assert.equal((await run(['render', '-', '-o', page])).code, 0);
  chmodSync(page, 0o400);
  const { code, err } = await run(['patch', page, '--panel', 'A', '-'], { stdin: '## A one\nNew text\n' });
  chmodSync(page, 0o600);
  assert.equal(code, 1, err);
  assert.match(err, /^✗ Cannot write the page: permission denied \(E[A-Z]+\) .+page\.html\. Copy the page to a folder this session can write to and patch the copy$/m);
  assert.ok(!err.includes('-o'), err);
  assert.ok(!existsSync(fallback()));
  assert.ok(!readFileSync(page, 'utf8').includes('New text'));
});

test('permissions: an -o folder the session cannot write to asks for another folder', { skip: SKIP }, async () => {
  const locked = join(tmp, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  const { code, err } = await run(['render', '-', '-o', join(locked, 'page.html')]);
  assert.equal(code, 1, err);
  assert.match(err, /^✗ Cannot write the page: permission denied \(E[A-Z]+\) .+page\.html\. Give -o a file in a folder this session can write to$/m);
  assert.deepEqual(readdirSync(locked), []);
});

test('permissions: an unreadable themes folder falls back to the built-in themes with one warning', { skip: SKIP }, async () => {
  chmodSync(join(home, 'themes'), 0o000);
  const out = join(tmp, 'page.html');
  const { code, err } = await run(['render', '-', '-o', out]);
  assert.equal(code, 0, err);
  assert.ok(existsSync(out));
  assert.match(err, /^! Cannot read the themes folder .+ \(E[A-Z]+\); using the built-in themes only$/m);
});

test('permissions: am theme list reports an unreadable themes folder instead of failing', { skip: SKIP }, async () => {
  chmodSync(join(home, 'themes'), 0o000);
  const { code, out, err } = await run(['theme', 'list']);
  assert.equal(code, 0, err);
  assert.match(out, /Built-in themes:/);
  assert.match(err, /Cannot read the themes folder/);
});

test('permissions: a voiced video with an unwritable data directory is synthesized without the narration cache', { skip: SKIP }, async () => {
  chmodSync(home, 0o500);
  let calls = 0;
  const voice = { name: 'fake', id: 'fake', concurrency: 1, synth: async () => (calls += 1, new Int16Array(800)) };
  const { code, out, err } = await run(['video', '-'], { stdin: '---\ntitle: V\n---\n## A one\n> One line.\n', ttsProvider: voice });
  assert.equal(code, 0, err);
  assert.equal(dirname(out.match(/✓ (.+\.html)/)[1]), join(fallback(), 'videos'));
  assert.equal(calls, 1);
  assert.ok(!existsSync(join(home, 'cache')));
});

test('permissions: a narration cache folder the session may not write to is skipped, not fatal', { skip: SKIP }, async () => {
  mkdirSync(join(home, 'cache', 'tts'), { recursive: true });
  chmodSync(join(home, 'cache', 'tts'), 0o500);
  const voice = { name: 'fake', id: 'fake', concurrency: 1, synth: async () => new Int16Array(800) };
  const { code, err } = await run(['video', '-'], { stdin: '---\ntitle: V\n---\n## A one\n> One line.\n', ttsProvider: voice });
  chmodSync(join(home, 'cache', 'tts'), 0o700);
  assert.equal(code, 0, err);
  assert.deepEqual(readdirSync(join(home, 'cache', 'tts')), []);
});

test('permissions: a narration cache folder the session may neither read nor write is skipped too', { skip: SKIP }, async () => {
  mkdirSync(join(home, 'cache', 'tts'), { recursive: true });
  chmodSync(join(home, 'cache', 'tts'), 0o000);
  const voice = { name: 'fake', id: 'fake', concurrency: 1, synth: async () => new Int16Array(800) };
  const { code, err } = await run(['video', '-'], { stdin: '---\ntitle: V\n---\n## A one\n> One line.\n', ttsProvider: voice });
  chmodSync(join(home, 'cache', 'tts'), 0o700);
  assert.equal(code, 0, err);
  assert.deepEqual(readdirSync(join(home, 'cache', 'tts')), []);
});
