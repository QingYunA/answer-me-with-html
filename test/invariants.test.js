// 不变量：用面板自己的原文 patch 页面，页面必须不变（时间戳除外）。
// 覆盖 render / video 两类页面、主题 × 明暗 × 模板全组合、有无配置文件，以及"换一份配置再 patch"。
// 这条不变量同时验证：页面把设置写全了、patch 能读回、读回的设置优先于配置文件。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const EXAMPLES = new URL('../examples/', import.meta.url);
const HOMES = { none: null, cfg: { theme: 'shadcn', mode: 'dark', style: 'off' } };

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-inv-'));
  for (const [name, config] of Object.entries(HOMES)) {
    mkdirSync(join(dir, name));
    if (config) writeFileSync(join(dir, name, 'config.json'), JSON.stringify(config));
  }
});
after(() => rmSync(dir, { recursive: true, force: true }));

const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

async function run(args, home, stdin = '') {
  let err = '';
  const stderr = new Writable({ write(c, _e, cb) { err += c; cb(); } });
  const code = await main(args, {
    stdout: sink(), stderr, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: join(dir, home) }, cwd: dir,
  });
  return { code, err };
}

// 生成时间精确到分钟，跨分钟时会变；比较前只抹掉页脚 / 播放条的生成时间和视频片头的 DATE 格。
const stable = (html) => html
  .replace(/(Answer me with HTML [\d.]+ · )\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '$1<time>')
  .replace(/(<b>DATE<\/b><span>)\d{4}-\d{2}-\d{2}/, '$1<time>');

// 第一个 ## 面板的标题与原文。
function firstPanel(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l));
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const text = `${lines.slice(start, next < 0 ? undefined : next).join('\n')}\n`;
  return { title: lines[start].replace(/^##\s+/, '').replace(/\s*\{.*\}\s*$/, ''), text };
}

function cases() {
  const out = [];
  const opt = (flag, v) => (v ? [flag, v] : []);
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

for (const [renderHome, patchHome] of [['none', 'none'], ['cfg', 'cfg'], ['none', 'cfg'], ['cfg', 'none']]) {
  test(`不变量：原文 patch 页面不变（渲染配置 ${renderHome}，patch 配置 ${patchHome}）`, async () => {
    const failures = [];
    for (const [i, c] of cases().entries()) {
      const label = `${c.cmd} ${c.f} ${c.args.join(' ') || '(默认)'}`;
      const file = join(dir, `${renderHome}-${patchHome}-${i}.html`);
      const made = await run([c.cmd, fileURLToPath(new URL(c.f, EXAMPLES)), '-o', file, '--no-open', ...c.args], renderHome);
      assert.equal(made.code, 0, `${label}: ${made.err}`);
      const before = readFileSync(file, 'utf8');
      const { title, text } = firstPanel(readFileSync(new URL(c.f, EXAMPLES), 'utf8'));
      const patched = await run(['patch', file, '--panel', title, '--no-open'], patchHome, text);
      if (patched.code !== 0) failures.push(`${label}: patch 退出码 ${patched.code} ${patched.err}`);
      else if (stable(readFileSync(file, 'utf8')) !== stable(before)) failures.push(`${label}: patch 后页面变了`);
    }
    assert.deepEqual(failures, []);
  });
}
