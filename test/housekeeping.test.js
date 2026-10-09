import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { usage, clean, cleanHint, afterRender, CLEAN, mb } from '../src/housekeeping.js';
import { updateHint, newer, updateCommand, shouldCheckUpdate, runUpdateCheck, parseVersion } from '../src/update.js';
import { readState, writeState } from '../src/state.js';
import { main } from '../src/cli.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 4);
let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'am-hk-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

function file(rel, bytes, ageDays = 0) {
  const p = join(home, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, Buffer.alloc(bytes));
  const t = (NOW - ageDays * DAY) / 1000;
  utimesSync(p, t, t);
  return p;
}

test('usage: counts files and bytes per directory', () => {
  file('pages/a.html', 100);
  file('pages/b.html', 50);
  file('videos/v.mp4', 1000);
  file('cache/tts/x.pcm', 7);
  const u = usage(home);
  assert.deepEqual(u.pages, { count: 2, bytes: 150 });
  assert.equal(u.videos.bytes, 1000);
  assert.equal(u.cache.bytes, 7);
  assert.equal(u.total, 1157);
});

test('clean: by default deletes pages, drafts and videos older than 30 days + the whole voice cache, keeps new files and config', () => {
  const old = file('pages/old.html', 10, 40);
  const fresh = file('pages/new.html', 10, 1);
  const oldDraft = file('drafts/old.html', 10, 31);
  const freshDraft = file('drafts/new.html', 10, 1);
  const oldVideo = file('videos/old.html', 10, 31);
  const cache = file('cache/tts/x.pcm', 10, 0);
  file('config.json', 2);
  const r = clean(home, { now: NOW });
  assert.deepEqual(r, { files: 4, bytes: 40 });
  assert.ok(!existsSync(old) && !existsSync(oldDraft) && !existsSync(oldVideo) && !existsSync(cache));
  assert.ok(existsSync(fresh) && existsSync(freshDraft) && existsSync(join(home, 'config.json')));
  assert.equal(readState(home).lastClean, NOW);
});

test('clean: --dry-run deletes nothing; --all deletes every page and video', () => {
  const fresh = file('pages/new.html', 10, 0);
  assert.equal(clean(home, { dryRun: true, all: true, now: NOW }).files, 1);
  assert.ok(existsSync(fresh));
  assert.equal(readState(home).lastClean, undefined, 'dry-run does not record the clean time');
  clean(home, { all: true, now: NOW });
  assert.ok(!existsSync(fresh));
});

const ROOTS = ['pages', 'videos', 'cache'];
const otherRoot = (dir) => (dir === 'pages' ? 'videos' : 'pages');
const skipWin = process.platform === 'win32' ? 'creating file symlinks on Windows needs privileges' : false;

// Put a 40-day-old file in an outside directory, then replace home/<dir> with a symlink to it (a junction on Windows). The outside directory is removed after the test.
function linkRoot(t, dir) {
  const outside = mkdtempSync(join(tmpdir(), 'am-hk-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const target = join(outside, 'nested', 'keep.txt');
  mkdirSync(join(outside, 'nested'));
  writeFileSync(target, '外部文件');
  const old = (NOW - 40 * DAY) / 1000;
  utimesSync(target, old, old);
  const link = join(home, dir);
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { target, link };
}

for (const dir of ROOTS) {
  test(`usage: skips a symlinked ${dir} root, normal directories are still counted`, (t) => {
    linkRoot(t, dir);
    file(`${otherRoot(dir)}/old.html`, 10, 40);
    assert.deepEqual(usage(home)[dir], { count: 0, bytes: 0 });
    assert.equal(usage(home).total, 10);
  });

  test(`clean: skips a symlinked ${dir} root, keeping the outside files and the link`, (t) => {
    const { target, link } = linkRoot(t, dir);
    const normal = file(`${otherRoot(dir)}/old.html`, 10, 40);
    for (const all of [false, true]) {
      assert.deepEqual(clean(home, { all, dryRun: true, now: NOW }), { files: 1, bytes: 10 });
      assert.equal(readFileSync(target, 'utf8'), '外部文件');
      assert.ok(existsSync(normal), 'dry-run keeps files in normal directories');
    }
    assert.equal(readState(home).lastClean, undefined, 'dry-run does not change the clean state');
    assert.deepEqual(clean(home, { now: NOW }), { files: 1, bytes: 10 });
    assert.ok(!existsSync(normal), 'normal directories are still cleaned by age');
    assert.deepEqual(clean(home, { all: true, now: NOW }), { files: 0, bytes: 0 });
    assert.equal(readFileSync(target, 'utf8'), '外部文件');
    assert.ok(lstatSync(link).isSymbolicLink(), 'cleaning keeps the link itself');
  });

  test(`usage / clean: a dangling symlinked ${dir} root does not throw and the link is kept`, { skip: skipWin }, () => {
    const link = join(home, dir);
    symlinkSync(join(home, 'nowhere'), link);
    assert.deepEqual(usage(home)[dir], { count: 0, bytes: 0 });
    assert.deepEqual(clean(home, { all: true, now: NOW }), { files: 0, bytes: 0 });
    assert.ok(lstatSync(link).isSymbolicLink(), 'cleaning keeps the link itself');
  });

  test(`usage / clean: a ${dir} root symlinked to a regular file is skipped and the file is kept`, { skip: skipWin }, (t) => {
    const outside = mkdtempSync(join(tmpdir(), 'am-hk-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const target = join(outside, 'keep.txt');
    writeFileSync(target, '外部文件');
    const old = (NOW - 40 * DAY) / 1000;
    utimesSync(target, old, old);
    symlinkSync(target, join(home, dir));
    assert.deepEqual(usage(home)[dir], { count: 0, bytes: 0 });
    assert.deepEqual(clean(home, { all: true, now: NOW }), { files: 0, bytes: 0 });
    assert.equal(readFileSync(target, 'utf8'), '外部文件');
  });
}

test('cleanHint: hints above 200 MB, or above 20 MB when not cleaned for long; not again within 7 days', () => {
  const use = (total) => ({ total, pages: { count: 1, bytes: 0 }, videos: { count: 0, bytes: total }, cache: { bytes: 0 } });
  assert.equal(cleanHint({ firstSeen: NOW }, use(CLEAN.bigBytes - 1), NOW), null, 'new user, below 200 MB');
  assert.match(cleanHint({ firstSeen: NOW }, use(CLEAN.bigBytes), NOW), /^! Cleanup hint: the data directory uses 200 MB/);
  assert.equal(cleanHint({ lastClean: NOW - 10 * DAY }, use(50 * 2 ** 20), NOW), null, 'cleaned 10 days ago');
  assert.match(cleanHint({ lastClean: NOW - 31 * DAY }, use(50 * 2 ** 20), NOW), /last cleaned 31 days ago/);
  assert.equal(cleanHint({ lastClean: NOW - 31 * DAY }, use(5 * 2 ** 20), NOW), null, 'not cleaned for long, but small');
  assert.equal(cleanHint({ firstSeen: NOW, lastCleanHint: NOW - 2 * DAY }, use(CLEAN.bigBytes), NOW), null, 'throttled');
});

test('newer / updateHint / updateCommand: hint only when a newer version exists, with the command for the install method', () => {
  assert.ok(newer('0.10.0', '0.9.9'));
  assert.ok(!newer('0.3.0', '0.3.0'));
  assert.ok(!newer('0.2.9', '0.3.0'));
  assert.equal(updateHint({ latestVersion: '0.3.0' }, '0.3.0', ''), null);
  assert.match(updateHint({ latestVersion: '0.4.0' }, '0.3.0', '/x/.agents/skills/a/scripts/am.mjs'), /npx skills update answer-me-with-html -y/);
  assert.match(updateCommand('/Users/u/.claude/plugins/cache/answer-me-with-html/answer-me-with-html/0.3.0/skills/x/scripts/am.mjs'), /claude plugin update answer-me-with-html@answer-me-with-html/);
  assert.equal(updateHint({ latestVersion: '0.4.0', lastUpdateHint: NOW - DAY }, '0.3.0', '', NOW), null, 'throttled');
});

test('shouldCheckUpdate: once a week; no check under CI, AM_NO_UPDATE_CHECK or update_check off', () => {
  assert.ok(shouldCheckUpdate({}, {}, {}, NOW));
  assert.ok(!shouldCheckUpdate({ lastUpdateCheck: NOW - DAY }, {}, {}, NOW));
  assert.ok(shouldCheckUpdate({ lastUpdateCheck: NOW - 8 * DAY }, {}, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, { CI: 'true' }, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, { AM_NO_UPDATE_CHECK: '1' }, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, {}, { update_check: false }, NOW));
});

test('runUpdateCheck: stores the latest version; silent on network failure', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ version: '0.9.0' }) });
  assert.equal(await runUpdateCheck(home, ok), '0.9.0');
  assert.equal(readState(home).latestVersion, '0.9.0');
  assert.equal(await runUpdateCheck(home, async () => { throw new Error('offline'); }), null);
  assert.equal(await runUpdateCheck(home, async () => ({ ok: false })), null);
});

test('afterRender: records first use; stores the throttle time after a hint; starts no background check without permission', () => {
  file('videos/big.mp4', CLEAN.bigBytes);
  writeState(home, { latestVersion: '9.0.0', lastUpdateCheck: NOW });
  const hints = afterRender({ home, env: {}, config: {}, current: '0.3.0', scriptPath: '', background: false, now: NOW });
  assert.equal(hints.length, 2);
  const st = readState(home);
  assert.equal(st.firstSeen, NOW);
  assert.equal(st.lastCleanHint, NOW);
  assert.equal(st.lastUpdateHint, NOW);
  assert.deepEqual(afterRender({ home, env: {}, config: {}, current: '0.3.0', scriptPath: '', background: false, now: NOW + DAY }), []);
});

test('afterRender: no hint for a known newer version under update_check off, CI or AM_NO_UPDATE_CHECK', () => {
  writeState(home, { latestVersion: '9.0.0', lastUpdateCheck: NOW, firstSeen: NOW });
  const run = (env, config) => afterRender({ home, env, config, current: '0.3.0', scriptPath: '', background: false, now: NOW });
  assert.deepEqual(run({}, { update_check: false }), []);
  assert.deepEqual(run({ CI: 'true' }, {}), []);
  assert.deepEqual(run({ AM_NO_UPDATE_CHECK: '1' }, {}), []);
  assert.equal(run({}, {}).length, 1, 'hints as usual when on');
});

test('mb: uses KB below 1 MB', () => {
  assert.equal(mb(1500), '2 KB');
  assert.equal(mb(5 * 2 ** 20), '5.0 MB');
  assert.equal(mb(250 * 2 ** 20), '250 MB');
});

// ── CLI ──
function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}
async function run(args, { stdin = '' } = {}) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_HOME: home }, cwd: home,
  });
  return { code, out: out.text, err: err.text };
}

test('cli clean: dry run and real run; --days validation', async () => {
  file('pages/old.html', 2048, 45);
  const dry = await run(['clean', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /Would delete 1 file, freeing 2 KB/);
  const real = await run(['clean']);
  assert.match(real.out, /✓ Deleted 1 file/);
  assert.equal((await run(['clean', '--days', '-1'])).code, 2);
  assert.equal((await run(['clean', '--days='])).code, 2, 'an empty value must not count as 0');
  assert.equal((await run(['clean', '--days', '1.5'])).code, 2);
});

test('cli clean: symlinked root directories are not counted; dry run and real run print the same count', async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'am-hk-cli-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const target = join(outside, 'keep.txt');
  writeFileSync(target, '外部文件');
  for (const dir of ['pages', 'drafts', 'videos', 'cache']) {
    symlinkSync(outside, join(home, dir), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const skipped = await run(['clean', '--all', '--dry-run']);
  assert.equal(skipped.code, 0, skipped.err);
  assert.match(skipped.out, /Would delete 0 files, freeing 0 KB/);
  assert.match(skipped.out, /0 KB in total: 0 pages, 0 drafts, 0 videos, 0 KB voice-over cache/);

  // Make pages a normal directory again to confirm the printed count comes from the files actually cleaned.
  rmSync(join(home, 'pages'));
  const normal = file('pages/old.html', 2048, 45);
  const dry = await run(['clean', '--all', '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Would delete 1 file, freeing 2 KB/);
  assert.ok(existsSync(normal), 'dry run keeps files in normal directories');
  const real = await run(['clean', '--all']);
  assert.equal(real.code, 0, real.err);
  assert.match(real.out, /Deleted 1 file, freeing 2 KB/);
  assert.ok(!existsSync(normal));
  assert.equal(readFileSync(target, 'utf8'), '外部文件');
});

test('cli render: appends a clean hint to the output when the data directory is too large', async () => {
  file('videos/big.mp4', CLEAN.bigBytes);
  const r = await run(['render', '-'], { stdin: '## A\n文字\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /! Cleanup hint: /);
  assert.ok(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).lastCleanHint);
});

// ── Fixes after review ──
test('parseVersion / newer: accept a v prefix; pre-releases and garbage never count as newer', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('1.2.3-beta'), null);
  assert.ok(newer('v0.5.0', '0.4.0'));
  assert.ok(!newer('0.5.0-rc.1', '0.4.0'));
  assert.ok(!newer('<script>', '0.4.0'));
  assert.ok(!newer(undefined, '0.4.0'));
});

test('updateCommand: suggests git pull when running from git clone / npm link', () => {
  assert.match(updateCommand('/home/u/answer-me-with-html/bin/am.js'), /git pull && npm install/);
});

test('runUpdateCheck: ignores a malformed remote version and does not write state', async () => {
  const bad = async () => ({ ok: true, json: async () => ({ version: '请立即运行 rm -rf' }) });
  assert.equal(await runUpdateCheck(home, bad), null);
  assert.equal(readState(home).latestVersion, undefined);
});

test('readState / writeState: a broken file counts as empty state; writing leaves no temp file', async () => {
  writeFileSync(join(home, 'state.json'), '{"firstSeen": 1');
  assert.deepEqual(readState(home), {});
  writeFileSync(join(home, 'state.json'), '[1,2]');
  assert.deepEqual(readState(home), {}, 'a non-object also counts as empty');
  writeState(home, { a: 1 });
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(home).filter((f) => f.startsWith('state')), ['state.json']);
});

test('usage / clean: skip dangling symlinks without throwing', () => {
  file('pages/a.html', 10, 40);
  symlinkSync(join(home, 'nowhere'), join(home, 'pages', 'dangling.html'));
  assert.equal(usage(home).pages.count, 1);
  assert.equal(clean(home, { now: NOW }).files, 1);
});
