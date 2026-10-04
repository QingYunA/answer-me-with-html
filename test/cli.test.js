import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-test-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function run(args, { stdin = '', env = {} } = {}) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_HOME: dir, ...env }, cwd: dir,
  });
  return { code, out: out.text, err: err.text };
}

const GOOD = '---\ntitle: CLI 测试\n---\n## A 流程\n```flow\nA -> B\n```\n';

test('cli: --version 与 --help', async () => {
  assert.match((await run(['--version'])).out, /^\d+\.\d+\.\d+/);
  assert.match((await run([])).out, /用法/);
});

test('cli render: 从 stdin 读取，写入 AM_HOME/pages，打印路径与统计', async () => {
  const r = await run(['render', '-'], { stdin: GOOD });
  assert.equal(r.code, 0, r.err);
  const file = r.out.match(/✓ (.+\.html)/)[1];
  assert.ok(file.startsWith(join(dir, 'pages', 'CLI-测试-')));
  assert.match(readFileSync(file, 'utf8'), /<h1>CLI 测试<\/h1>/);
  assert.match(r.out, /sheet · blueprint · 1 面板 · flow×1/);
  assert.match(r.out, /STE ✓ 0 条警告/);
});

test('cli render: 文件参数 + -o + 主题覆盖', async () => {
  writeFileSync(join(dir, 'in.md'), GOOD);
  const r = await run(['render', 'in.md', '-o', 'out/x.html', '--theme', 'shadcn']);
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'out/x.html'), 'utf8'), /data-theme="shadcn"/);
});

test('cli render: limits 0 / 0 能出页，不挂起', { timeout: 5000 }, async () => {
  const r = await run(['render', '-', '-o', 'zero.html'], { stdin: '## A\n```limits\nx | 0 / 0\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'zero.html'), 'utf8'), /am-lim/);
});

test('cli render: 组件语法错误 → 绝对行号 + 组件名 + 正确示例，退出码 1', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n文本\n```flow\nA -> B\n(未闭合 -> C\n```' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L5 \[flow\] flow 形状括号未闭合/);
  assert.match(r.err, /正确示例：\n {4}```flow/);
  assert.match(r.err, /am help flow/);
});

test('cli render: 解析错误给出行号', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n```flow\nA -> B' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L2 稿件解析失败：围栏块/);
});

test('cli render: style 80 打印警告但仍生成；strict 拒绝生成', async () => {
  const bad = '## A\nUtilize the tool.';
  const soft = await run(['render', '-'], { stdin: bad });
  assert.equal(soft.code, 0);
  assert.match(soft.out, /STE 1 条警告[\s\S]*L2 \[word\] 不推荐 "Utilize" → use/);

  const before = readdirSync(join(dir, 'pages')).length;
  const strict = await run(['render', '-', '--style', 'strict'], { stdin: bad });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /STE 检查未通过/);
  assert.equal(readdirSync(join(dir, 'pages')).length, before, 'strict 失败时不写文件');
});

test('cli lint: 仅检查；strict 下有警告返回 1；off 跳过', async () => {
  const bad = '## A\nUtilize the tool.';
  assert.equal((await run(['lint', '-'], { stdin: bad })).code, 0);
  assert.equal((await run(['lint', '-', '--style', 'strict'], { stdin: bad })).code, 1);
  assert.match((await run(['lint', '-', '--style', 'off'], { stdin: bad })).out, /已关闭/);
  assert.equal((await run(['lint', '-', '--style', 'x'], { stdin: bad })).code, 2);
});

test('cli list / help', async () => {
  assert.match((await run(['list'])).out, /flow\s+流程图/);
  const h = await run(['help', 'sequence']);
  assert.match(h.out, /sequence — 时序图[\s\S]*示例：\n```sequence/);
  assert.match((await run(['help', 'format'])).out, /template: sheet/);
  assert.match((await run(['help', 'patch'])).out, /#am-source/);
  assert.equal((await run(['help', 'nope'])).code, 2);
});

test('cli: 参数错误与缺失', async () => {
  assert.equal((await run(['bogus'])).code, 2);
  assert.equal((await run(['render'])).code, 2);
  assert.equal((await run(['render', 'missing.md'])).code, 2);
  assert.equal((await run(['render', '-'], { stdin: '   ' })).code, 2);
  assert.equal((await run(['render', '--wat'])).code, 2);
});

test('cli config: 显示全部配置项、当前值与配置文件路径', async () => {
  const r = await run(['config']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /config\.json/);
  for (const key of ['open', 'always', 'theme', 'mode', 'style']) assert.match(r.out, new RegExp(`\\b${key}\\b`));
});

test('cli config: set / get / reset，改过的值带 * 标记', async () => {
  assert.equal((await run(['config', 'set', 'theme', 'shadcn'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'shadcn');
  assert.match((await run(['config'])).out, /\* theme\s+shadcn/);
  const rendered = await run(['render', '-', '-o', 'cfg.html'], { stdin: '## A\nx' });
  assert.match(readFileSync(join(dir, 'cfg.html'), 'utf8'), /data-theme="shadcn"/, 'render 读取配置里的默认主题');
  assert.equal(rendered.code, 0);
  assert.equal((await run(['config', 'reset', 'theme'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'blueprint');
});

test('cli config: 布尔值输出 on/off；非法键或值返回 2', async () => {
  await run(['config', 'set', 'open', 'off']);
  assert.equal((await run(['config', 'get', 'open'])).out.trim(), 'off');
  await run(['config', 'reset']);
  const bad = await run(['config', 'set', 'theme', 'neon']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /blueprint \| shadcn/);
  assert.equal((await run(['config', 'set', 'nope', '1'])).code, 2);
  assert.equal((await run(['config', 'frob'])).code, 2);
});

function panelSection(html, id) {
  const m = html.match(new RegExp(`<section class="am-panel[^"]*" id="panel-${id}"[\\s\\S]*?</section>`));
  return m && m[0];
}

const THREE = `---
title: 三面板
---
## A 甲
甲旧文。
## B 乙
乙旧文。
## C 丙
丙旧文。
`;

test('cli patch: 渲染后改一个面板，其余面板不变，仍写回原文件', async () => {
  const rendered = await run(['render', '-', '-o', 'page.html'], { stdin: THREE });
  assert.equal(rendered.code, 0, rendered.err);
  const file = rendered.out.match(/✓ (.+\.html)/)[1];
  assert.equal(file, join(dir, 'page.html'));
  const before = readFileSync(file, 'utf8');
  const beforeB = panelSection(before, 'B');
  const beforeC = panelSection(before, 'C');
  assert.match(before, /甲旧文/);
  assert.match(before, /乙旧文/);

  const patched = await run(['patch', 'page.html', '--panel', '甲'], { stdin: '## A 甲\n甲新文。\n' });
  assert.equal(patched.code, 0, patched.err);
  const outFile = patched.out.match(/✓ (.+\.html)/)[1];
  assert.equal(outFile, file, '必须覆盖原 HTML，不能另写时间戳文件');

  const after = readFileSync(file, 'utf8');
  assert.match(after, /甲新文/);
  assert.doesNotMatch(after, /甲旧文/);
  assert.equal(panelSection(after, 'B'), beforeB, '未点名的面板 B 应保持不变');
  assert.equal(panelSection(after, 'C'), beforeC, '未点名的面板 C 应保持不变');
});

test('cli patch: --from 读文件；缺面板或缺 #am-source 不改文件', async () => {
  const rendered = await run(['render', '-', '-o', 'keep.html'], { stdin: THREE });
  const file = rendered.out.match(/✓ (.+\.html)/)[1];
  const original = readFileSync(file, 'utf8');
  writeFileSync(join(dir, 'panel.md'), '## B 乙\n乙新文。\n');

  const fromFile = await run(['patch', 'keep.html', '--panel', '乙', '--from', 'panel.md']);
  assert.equal(fromFile.code, 0, fromFile.err);
  const afterFrom = readFileSync(file, 'utf8');
  assert.match(afterFrom, /乙新文/);

  const missingPanel = await run(['patch', 'keep.html', '--panel', '不存在'], { stdin: 'x\n' });
  assert.equal(missingPanel.code, 1);
  assert.match(missingPanel.err, /没有找到/);
  assert.equal(readFileSync(file, 'utf8'), afterFrom, '找不到面板时不得改文件');

  writeFileSync(join(dir, 'plain.html'), '<html><body>no source</body></html>');
  const beforePlain = readFileSync(join(dir, 'plain.html'), 'utf8');
  const noSource = await run(['patch', 'plain.html', '--panel', '甲'], { stdin: 'x\n' });
  assert.equal(noSource.code, 1);
  assert.match(noSource.err, /#am-source/);
  assert.equal(readFileSync(join(dir, 'plain.html'), 'utf8'), beforePlain);

  const noPanelFlag = await run(['patch', 'keep.html'], { stdin: 'x\n' });
  assert.equal(noPanelFlag.code, 2);

  assert.notEqual(original, readFileSync(file, 'utf8'));
});

test('shouldOpen: --no-open > AM_NO_OPEN > 配置 open；--open 强制打开', async () => {
  const { shouldOpen } = await import('../src/cli.js');
  assert.equal(shouldOpen({}, {}, { open: true }), true);
  assert.equal(shouldOpen({}, {}, { open: false }), false);
  assert.equal(shouldOpen({ 'no-open': true }, {}, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '1' }, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '0' }, { open: true }), true, 'AM_NO_OPEN=0 不算关闭');
  assert.equal(shouldOpen({}, { CI: 'true' }, { open: true }), false);
  assert.equal(shouldOpen({ open: true }, { AM_NO_OPEN: '1' }, { open: false }), true);
});

test('cli patch: 正文假 #am-source 不得覆盖页面', async () => {
  const src = `---
title: 假源
---
## A 真面板
真内容。
\`\`\`html
<textarea id="am-source">FAKE</textarea>
\`\`\`
## B 另一格
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-src.html'], { stdin: src })).code, 0);
  const patched = await run(['patch', 'fake-src.html', '--panel', '真面板'], {
    stdin: '## A 真面板\n已更新。\n```html\n<textarea id="am-source">FAKE</textarea>\n```\n',
  });
  assert.equal(patched.code, 0, patched.err);
  const after = readFileSync(join(dir, 'fake-src.html'), 'utf8');
  assert.match(after, /已更新/);
  assert.doesNotMatch(after, /真内容/);
  assert.match(after, /保留/);
});

test('cli patch: 沿用原页面的主题与模板；本次 --theme 优先', async () => {
  const src = '---\ntitle: 保留主题\n---\n## A 一\n旧\n\n## B 二\n旧\n';
  assert.equal((await run(['render', '-', '-o', 'keep.html', '--theme', 'shadcn', '--template', 'doc'], { stdin: src })).code, 0);
  const r = await run(['patch', 'keep.html', '--panel', 'B'], { stdin: '新内容\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'keep.html'), 'utf8');
  assert.match(html, /data-theme="shadcn"/);
  assert.match(html, /<main class="am-doc/);
  assert.match(html, /新内容/);
  await run(['patch', 'keep.html', '--panel', 'A', '--theme', 'blueprint'], { stdin: '改主题\n' });
  assert.match(readFileSync(join(dir, 'keep.html'), 'utf8'), /data-theme="blueprint"/);
});

const STE_BAD = `---
title: 关检查
---
## A 甲
Utilize the tool.

## B 乙
保留。
`;

test('cli patch: 沿用页面 data-style，不回落到配置 strict', async () => {
  assert.equal((await run(['render', '-', '-o', 'style-off.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'style-off.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  const r = await run(['patch', 'style-off.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'style-off.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新文/);
  assert.match(html, /Utilize the tool/);
  assert.equal((await run(['config', 'reset', 'style'])).code, 0);
});

test('cli patch: 本次 --style 优先于页面记录的 style', async () => {
  assert.equal((await run(['render', '-', '-o', 'style-cli.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'style-cli.html'), 'utf8');
  const r = await run(['patch', 'style-cli.html', '--panel', '乙', '--style', 'strict'], { stdin: '新文。\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE 检查未通过/);
  assert.equal(readFileSync(join(dir, 'style-cli.html'), 'utf8'), before, 'strict 失败时不得改文件');
});

test('cli patch: 旧页没有 data-style 时，frontmatter style 仍优先于配置', async () => {
  const src = `---
title: 旧页
style: off
---
## A 甲
Utilize the tool.

## B 乙
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'old-style.html'], { stdin: src })).code, 0);
  const stripped = readFileSync(join(dir, 'old-style.html'), 'utf8')
    .replace(/<html\b[^>]*>/, (tag) => tag.replace(/\sdata-style="[^"]*"/, ''));
  writeFileSync(join(dir, 'old-style.html'), stripped);
  assert.doesNotMatch(stripped.match(/<html\b[^>]*>/)[0], /data-style/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  const r = await run(['patch', 'old-style.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'old-style.html'), 'utf8');
  assert.match(html, /新文/);
  assert.match(html, /data-style="off"/);
  assert.equal((await run(['config', 'reset', 'style'])).code, 0);
});

test('cli patch: 正文假 data-video 不得把图纸页当成视频', async () => {
  const src = `---
title: 假视频
---
## A 说明
旧文。
\`\`\`html
<html lang="zh-CN" data-theme="blueprint" data-mode="light" data-video>
\`\`\`
## B 保留
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-video.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'fake-video.html', '--panel', '说明'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sheet ·/);
  assert.doesNotMatch(r.out, /\bvideo ·/);
  const html = readFileSync(join(dir, 'fake-video.html'), 'utf8');
  const root = html.match(/<html\b[^>]*>/)[0];
  assert.doesNotMatch(root, /data-video/);
  assert.match(html, /<main class="am-sheet/);
  assert.match(html, /新文/);
});

test('cli patch: 正文假 am-doc 不得把图纸页重渲成 doc', async () => {
  const src = `---
title: 假文档
---
## A 说明
旧文。
\`\`\`html
<main class="am-doc">假目录</main>
\`\`\`
## B 保留
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-doc.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'fake-doc.html', '--panel', '说明'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sheet ·/);
  assert.doesNotMatch(r.out, /doc ·/);
  const html = readFileSync(join(dir, 'fake-doc.html'), 'utf8');
  assert.equal(html.match(/<main class="am-(doc|sheet)\b/)[1], 'sheet');
  assert.match(html, /新文/);
});

test('cli patch: --voice off 的视频页默认保持无声，不按配置重配音', async () => {
  const src = '## 场景\n- 画面\n> 旁白。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '-o', 'silent.html'], { stdin: src })).code, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'silent.html'), 'utf8'), /<audio id="amv-audio"/);
  assert.equal((await run(['config', 'set', 'voice', 'system'])).code, 0);
  const r = await run(['patch', 'silent.html', '--panel', '场景'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /系统 TTS|配音失败/);
  assert.match(r.out, /配音：无/);
  const html = readFileSync(join(dir, 'silent.html'), 'utf8');
  assert.doesNotMatch(html, /<audio id="amv-audio"/);
  assert.match(html, /新旁白|新画面/);
  assert.equal((await run(['config', 'reset', 'voice'])).code, 0);
});

test('cli patch: 视频页沿用原主题（3b1b），输出视频摘要', async () => {
  const src = '## 场景\n```flow\nA -> B\n```\n> [A] 连到 B。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '--theme', '3b1b', '-o', 'v3b.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'v3b.html', '--panel', '场景', '--voice', 'off'], { stdin: '> 新旁白。\n```flow\nA -> C\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video · 3b1b · 1 场景 · 1 句旁白/);
  const html = readFileSync(join(dir, 'v3b.html'), 'utf8');
  assert.match(html, /data-theme="3b1b" data-mode="dark" data-style="80" data-video/);
  assert.match(html, /新旁白/);
});

const VIDEO_STE_BAD = `## 甲
- 画面
> 我们对系统进行优化。

## 乙
- 另一画面
> 第二句旁白。
`;

test('cli patch: 视频页同样沿用 data-style，不回落到配置 strict', async () => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'vstyle.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  const r = await run(['patch', 'vstyle.html', '--panel', '乙', '--voice', 'off'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'vstyle.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新旁白|新画面/);
  assert.equal((await run(['config', 'reset', 'style'])).code, 0);
});

test('cli patch: 视频页本次 --style 优先于页面记录的 style', async () => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle-cli.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'vstyle-cli.html'), 'utf8');
  const r = await run(['patch', 'vstyle-cli.html', '--panel', '乙', '--voice', 'off', '--style', 'strict'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE 检查未通过/);
  assert.equal(readFileSync(join(dir, 'vstyle-cli.html'), 'utf8'), before, 'strict 失败时不得改文件');
});
