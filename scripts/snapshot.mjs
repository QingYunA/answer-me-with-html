// 重构前后对比：固定时钟，跑 render / video / patch 组合矩阵，比较当前工作区与另一个 git ref 生成的 HTML。
// 用法：node scripts/snapshot.mjs [ref]（默认 origin/main）
// 输出每种组合的 HTML 是否逐字节相同。只比较，不在仓库里留下任何文件。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXED = new Date('2026-01-02T03:04:05Z').getTime();

// 子进程模式：在给定源码目录里跑矩阵，结果写到 out/result.json。
if (process.argv[2] === '--run') {
  const [, , , repo, out] = process.argv;
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  };
  writeFileSync(join(out, 'result.json'), JSON.stringify(await runMatrix(repo, out)));
  process.exit(0);
}

async function runMatrix(repo, out) {
  const { main } = await import(pathToFileURL(join(repo, 'src/cli.js')));
  const { Readable, Writable } = await import('node:stream');
  const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });
  const run = (args, home, stdin = '') => main(args, {
    stdout: sink(), stderr: sink(), stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: home }, cwd: out,
  });
  const homes = { none: null, cfg: { theme: 'shadcn', mode: 'dark', style: 'off' } };
  const result = {};
  for (const [hk, cfg] of Object.entries(homes)) {
    const home = join(out, `home-${hk}`);
    mkdirSync(home, { recursive: true });
    if (cfg) writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
    for (const c of cases()) {
      const name = `${hk} ${c.cmd} ${c.f} ${c.args.join(' ') || '(default)'}`;
      const file = join(out, `${Object.keys(result).length}.html`);
      const src = join(repo, 'examples', c.f);
      const code = await run([c.cmd, src, '-o', file, '--no-open', ...c.args], home);
      if (code !== 0) { result[name] = `exit ${code}`; continue; }
      const html = readFileSync(file, 'utf8');
      // 用第一个面板自己的原文 patch，页面应不变。
      const { title, text } = firstPanel(readFileSync(src, 'utf8'));
      const patched = await run(['patch', file, '--panel', title, '--no-open'], home, text);
      const same = patched === 0 && readFileSync(file, 'utf8') === html;
      result[name] = same ? html : `${html}\n<!-- patch changed the page -->`;
    }
  }
  return result;
}

function cases() {
  const opt = (flag, v) => (v ? [flag, v] : []);
  const out = [];
  for (const f of ['architecture.md', 'ste100.md', 'tcp.md', 'tcp.en.md']) {
    for (const theme of [null, 'blueprint', 'shadcn']) {
      for (const mode of [null, 'light', 'dark', 'auto']) {
        for (const template of [null, 'sheet', 'doc']) {
          out.push({ cmd: 'render', f, args: [...opt('--theme', theme), ...opt('--mode', mode), ...opt('--template', template)] });
        }
      }
    }
  }
  for (const f of ['video-tcp.md', 'video-tcp.en.md']) {
    for (const theme of [null, 'blueprint', 'shadcn', '3b1b']) {
      for (const mode of [null, 'light', 'dark']) {
        out.push({ cmd: 'video', f, args: ['--voice', 'off', ...opt('--theme', theme), ...opt('--mode', mode)] });
      }
    }
  }
  return out;
}

function firstPanel(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l));
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return {
    title: lines[start].replace(/^##\s+/, '').replace(/\s*\{.*\}\s*$/, ''),
    text: `${lines.slice(start, next < 0 ? undefined : next).join('\n')}\n`,
  };
}

function snapshot(repo, work) {
  const out = join(work, repo === ROOT ? 'current' : 'ref');
  mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--run', repo, out], { stdio: 'inherit' });
  return JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
}

const ref = process.argv[2] ?? 'origin/main';
const work = mkdtempSync(join(tmpdir(), 'am-snapshot-'));
const refDir = join(work, 'src-ref');
try {
  execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', refDir, ref], { stdio: 'ignore' });
  symlinkSync(join(ROOT, 'node_modules'), join(refDir, 'node_modules'));
  const before = snapshot(refDir, work);
  const after = snapshot(ROOT, work);
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  const patchBroken = Object.keys(after).filter((k) => after[k].endsWith('patch changed the page -->'));
  console.log(`${Object.keys(after).length} 种组合，与 ${ref} 不同：${changed.length}，patch 后页面变化：${patchBroken.length}`);
  changed.slice(0, 20).forEach((k) => console.log(`  ≠ ${k}`));
  process.exitCode = changed.length || patchBroken.length ? 1 : 0;
} finally {
  execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', refDir], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
}
