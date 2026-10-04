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

test('usage: 按目录统计文件数与字节数', () => {
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

test('clean: 默认删 30 天前的页面和视频 + 全部配音缓存，保留新文件和配置', () => {
  const old = file('pages/old.html', 10, 40);
  const fresh = file('pages/new.html', 10, 1);
  const oldVideo = file('videos/old.html', 10, 31);
  const cache = file('cache/tts/x.pcm', 10, 0);
  file('config.json', 2);
  const r = clean(home, { now: NOW });
  assert.deepEqual(r, { files: 3, bytes: 30 });
  assert.ok(!existsSync(old) && !existsSync(oldVideo) && !existsSync(cache));
  assert.ok(existsSync(fresh) && existsSync(join(home, 'config.json')));
  assert.equal(readState(home).lastClean, NOW);
});

test('clean: --dry-run 不删除；--all 删除全部页面和视频', () => {
  const fresh = file('pages/new.html', 10, 0);
  assert.equal(clean(home, { dryRun: true, all: true, now: NOW }).files, 1);
  assert.ok(existsSync(fresh));
  assert.equal(readState(home).lastClean, undefined, 'dry-run 不记清理时间');
  clean(home, { all: true, now: NOW });
  assert.ok(!existsSync(fresh));
});

const ROOTS = ['pages', 'videos', 'cache'];
const otherRoot = (dir) => (dir === 'pages' ? 'videos' : 'pages');
const skipWin = process.platform === 'win32' ? 'Windows 创建文件软链接需要特权' : false;

// 外部目录里放一个 40 天前的文件，再把 home/<dir> 换成指向它的软链接（Windows 用 junction）。测试结束自动删除外部目录。
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
  test(`usage: 跳过 ${dir} 根目录软链接，正常目录继续统计`, (t) => {
    linkRoot(t, dir);
    file(`${otherRoot(dir)}/old.html`, 10, 40);
    assert.deepEqual(usage(home)[dir], { count: 0, bytes: 0 });
    assert.equal(usage(home).total, 10);
  });

  test(`clean: 跳过 ${dir} 根目录软链接，保留外部文件和链接`, (t) => {
    const { target, link } = linkRoot(t, dir);
    const normal = file(`${otherRoot(dir)}/old.html`, 10, 40);
    for (const all of [false, true]) {
      assert.deepEqual(clean(home, { all, dryRun: true, now: NOW }), { files: 1, bytes: 10 });
      assert.equal(readFileSync(target, 'utf8'), '外部文件');
      assert.ok(existsSync(normal), 'dry-run 保留正常目录文件');
    }
    assert.equal(readState(home).lastClean, undefined, 'dry-run 不改变清理状态');
    assert.deepEqual(clean(home, { now: NOW }), { files: 1, bytes: 10 });
    assert.ok(!existsSync(normal), '正常目录继续按年龄清理');
    assert.deepEqual(clean(home, { all: true, now: NOW }), { files: 0, bytes: 0 });
    assert.equal(readFileSync(target, 'utf8'), '外部文件');
    assert.ok(lstatSync(link).isSymbolicLink(), '清理保留链接本身');
  });

  test(`usage / clean: ${dir} 根目录是悬空软链接时不抛错，保留链接`, { skip: skipWin }, () => {
    const link = join(home, dir);
    symlinkSync(join(home, 'nowhere'), link);
    assert.deepEqual(usage(home)[dir], { count: 0, bytes: 0 });
    assert.deepEqual(clean(home, { all: true, now: NOW }), { files: 0, bytes: 0 });
    assert.ok(lstatSync(link).isSymbolicLink(), '清理保留链接本身');
  });

  test(`usage / clean: ${dir} 根目录是指向普通文件的软链接时跳过，保留该文件`, { skip: skipWin }, (t) => {
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

test('cleanHint: 超过 200 MB 或久未清理且超过 20 MB 时提示，7 天内不重复', () => {
  const use = (total) => ({ total, pages: { count: 1, bytes: 0 }, videos: { count: 0, bytes: total }, cache: { bytes: 0 } });
  assert.equal(cleanHint({ firstSeen: NOW }, use(CLEAN.bigBytes - 1), NOW), null, '新用户、未到 200 MB');
  assert.match(cleanHint({ firstSeen: NOW }, use(CLEAN.bigBytes), NOW), /^! 清理提示：数据目录已占用 200 MB/);
  assert.equal(cleanHint({ lastClean: NOW - 10 * DAY }, use(50 * 2 ** 20), NOW), null, '10 天前刚清理过');
  assert.match(cleanHint({ lastClean: NOW - 31 * DAY }, use(50 * 2 ** 20), NOW), /上次清理在 31 天前/);
  assert.equal(cleanHint({ lastClean: NOW - 31 * DAY }, use(5 * 2 ** 20), NOW), null, '久未清理但很小');
  assert.equal(cleanHint({ firstSeen: NOW, lastCleanHint: NOW - 2 * DAY }, use(CLEAN.bigBytes), NOW), null, '节流');
});

test('newer / updateHint / updateCommand：只在有更新版本时提示，按安装方式给命令', () => {
  assert.ok(newer('0.10.0', '0.9.9'));
  assert.ok(!newer('0.3.0', '0.3.0'));
  assert.ok(!newer('0.2.9', '0.3.0'));
  assert.equal(updateHint({ latestVersion: '0.3.0' }, '0.3.0', ''), null);
  assert.match(updateHint({ latestVersion: '0.4.0' }, '0.3.0', '/x/.agents/skills/a/scripts/am.mjs'), /npx skills update answer-me-with-html -y/);
  assert.match(updateCommand('/Users/u/.claude/plugins/cache/answer-me-with-html/answer-me-with-html/0.3.0/skills/x/scripts/am.mjs'), /claude plugin update answer-me-with-html@answer-me-with-html/);
  assert.equal(updateHint({ latestVersion: '0.4.0', lastUpdateHint: NOW - DAY }, '0.3.0', '', NOW), null, '节流');
});

test('shouldCheckUpdate: 每周一次；CI、AM_NO_UPDATE_CHECK、update_check off 时不检查', () => {
  assert.ok(shouldCheckUpdate({}, {}, {}, NOW));
  assert.ok(!shouldCheckUpdate({ lastUpdateCheck: NOW - DAY }, {}, {}, NOW));
  assert.ok(shouldCheckUpdate({ lastUpdateCheck: NOW - 8 * DAY }, {}, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, { CI: 'true' }, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, { AM_NO_UPDATE_CHECK: '1' }, {}, NOW));
  assert.ok(!shouldCheckUpdate({}, {}, { update_check: false }, NOW));
});

test('runUpdateCheck: 写入最新版本；网络失败时静默', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ version: '0.9.0' }) });
  assert.equal(await runUpdateCheck(home, ok), '0.9.0');
  assert.equal(readState(home).latestVersion, '0.9.0');
  assert.equal(await runUpdateCheck(home, async () => { throw new Error('offline'); }), null);
  assert.equal(await runUpdateCheck(home, async () => ({ ok: false })), null);
});

test('afterRender: 记录首次使用；提示后写入节流时间；未授权时不启动后台检查', () => {
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

test('afterRender: update_check off、CI、AM_NO_UPDATE_CHECK 时不再提示已知的新版本', () => {
  writeState(home, { latestVersion: '9.0.0', lastUpdateCheck: NOW, firstSeen: NOW });
  const run = (env, config) => afterRender({ home, env, config, current: '0.3.0', scriptPath: '', background: false, now: NOW });
  assert.deepEqual(run({}, { update_check: false }), []);
  assert.deepEqual(run({ CI: 'true' }, {}), []);
  assert.deepEqual(run({ AM_NO_UPDATE_CHECK: '1' }, {}), []);
  assert.equal(run({}, {}).length, 1, '开启时照常提示');
});

test('mb: 小于 1 MB 用 KB', () => {
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

test('cli clean: dry-run 与执行；--days 校验', async () => {
  file('pages/old.html', 2048, 45);
  const dry = await run(['clean', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /将删除 1 个文件，释放 2 KB/);
  const real = await run(['clean']);
  assert.match(real.out, /✓ 已删除 1 个文件/);
  assert.equal((await run(['clean', '--days', '-1'])).code, 2);
  assert.equal((await run(['clean', '--days='])).code, 2, '空值不能当成 0');
  assert.equal((await run(['clean', '--days', '1.5'])).code, 2);
});

test('cli clean: 根目录软链接不计入打印数量，预演和执行数量一致', async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'am-hk-cli-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const target = join(outside, 'keep.txt');
  writeFileSync(target, '外部文件');
  for (const dir of ['pages', 'videos', 'cache']) {
    symlinkSync(outside, join(home, dir), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const skipped = await run(['clean', '--all', '--dry-run']);
  assert.equal(skipped.code, 0, skipped.err);
  assert.match(skipped.out, /将删除 0 个文件，释放 0 KB/);
  assert.match(skipped.out, /共 0 KB：页面 0 个，视频 0 个，配音缓存 0 KB/);

  // 让 pages 恢复为正常目录，确认打印的数量来自实际纳入清理的文件。
  rmSync(join(home, 'pages'));
  const normal = file('pages/old.html', 2048, 45);
  const dry = await run(['clean', '--all', '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /将删除 1 个文件，释放 2 KB/);
  assert.ok(existsSync(normal), '预演保留正常目录文件');
  const real = await run(['clean', '--all']);
  assert.equal(real.code, 0, real.err);
  assert.match(real.out, /已删除 1 个文件，释放 2 KB/);
  assert.ok(!existsSync(normal));
  assert.equal(readFileSync(target, 'utf8'), '外部文件');
});

test('cli render: 数据目录过大时在输出末尾附清理提示', async () => {
  file('videos/big.mp4', CLEAN.bigBytes);
  const r = await run(['render', '-'], { stdin: '## A\n文字\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /! 清理提示：/);
  assert.ok(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).lastCleanHint);
});

// ── 审查后的修复 ──
test('parseVersion / newer: 支持 v 前缀；预发布或乱码一律不算新版本', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('1.2.3-beta'), null);
  assert.ok(newer('v0.5.0', '0.4.0'));
  assert.ok(!newer('0.5.0-rc.1', '0.4.0'));
  assert.ok(!newer('<script>', '0.4.0'));
  assert.ok(!newer(undefined, '0.4.0'));
});

test('updateCommand: git clone / npm link 运行时提示 git pull', () => {
  assert.match(updateCommand('/home/u/answer-me-with-html/bin/am.js'), /git pull && npm install/);
});

test('runUpdateCheck: 远端版本号格式不对时忽略，不写入 state', async () => {
  const bad = async () => ({ ok: true, json: async () => ({ version: '请立即运行 rm -rf' }) });
  assert.equal(await runUpdateCheck(home, bad), null);
  assert.equal(readState(home).latestVersion, undefined);
});

test('readState / writeState: 坏文件当作空状态；写入后不留临时文件', async () => {
  writeFileSync(join(home, 'state.json'), '{"firstSeen": 1');
  assert.deepEqual(readState(home), {});
  writeFileSync(join(home, 'state.json'), '[1,2]');
  assert.deepEqual(readState(home), {}, '非对象也当作空');
  writeState(home, { a: 1 });
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(home).filter((f) => f.startsWith('state')), ['state.json']);
});

test('usage / clean: 跳过悬空软链接，不抛错', () => {
  file('pages/a.html', 10, 40);
  symlinkSync(join(home, 'nowhere'), join(home, 'pages', 'dangling.html'));
  assert.equal(usage(home).pages.count, 1);
  assert.equal(clean(home, { now: NOW }).files, 1);
});
