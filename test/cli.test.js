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

test('cli: --version and --help', async () => {
  assert.match((await run(['--version'])).out, /^\d+\.\d+\.\d+/);
  assert.match((await run([])).out, /Usage:/);
});

test('cli render: reads stdin, writes to AM_HOME/pages, prints the path and stats', async () => {
  const r = await run(['render', '-'], { stdin: GOOD });
  assert.equal(r.code, 0, r.err);
  const file = r.out.match(/✓ (.+\.html)/)[1];
  assert.ok(file.startsWith(join(dir, 'pages', 'CLI-测试-')));
  assert.match(readFileSync(file, 'utf8'), /<h1>CLI 测试<\/h1>/);
  assert.match(r.out, /sheet · blueprint · 1 panel · flow×1/);
  assert.match(r.out, /STE ✓ 0 warnings/);
});

test('cli render: the injected clock sets the default file name; the injected open runs as configured', async () => {
  const opened = [];
  const now = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const call = (args) => main(args, {
    stdout: sink().stream, stderr: sink().stream, stdin: Readable.from([GOOD]),
    env: { AM_HOME: dir, AM_NO_UPDATE_CHECK: '1' }, cwd: dir, now: () => now, open: (f) => opened.push(f),
  });
  assert.equal(await call(['render', '-']), 0);
  assert.deepEqual(opened, [join(dir, 'pages', 'CLI-测试-20260102-030405.html')]);
  assert.equal(await call(['render', '-', '--no-open']), 0);
  assert.equal(opened.length, 1, '--no-open does not open');
});

test('cli video: the summary line names the theme', async () => {
  const r = await run(['video', '-', '--voice', 'off', '--theme', 'shadcn'], { stdin: '---\ntitle: V\n---\n## A\n> 一句。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video · shadcn · 1 scene · 1 beat/);
});

test('cli render: file argument + -o + theme override', async () => {
  writeFileSync(join(dir, 'in.md'), GOOD);
  const r = await run(['render', 'in.md', '-o', 'out/x.html', '--theme', 'shadcn']);
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'out/x.html'), 'utf8'), /data-theme="shadcn"/);
});

test('cli render: limits 0 / 0 renders a page and does not hang', { timeout: 5000 }, async () => {
  const r = await run(['render', '-', '-o', 'zero.html'], { stdin: '## A\n```limits\nx | 0 / 0\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'zero.html'), 'utf8'), /am-lim/);
});

test('cli render: a component syntax error gives the absolute line, component name and a correct example, exit code 1', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n文本\n```flow\nA -> B\n(未闭合 -> C\n```' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L5 \[flow\] flow: unclosed shape bracket/);
  assert.match(r.err, /Correct example:\n {4}```flow/);
  assert.match(r.err, /am help flow/);
});

test('cli render: a callout body that starts with "type: <kind>" fails and shows the type on the fence line', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n文本\n```callout\ntype: info\nBody\n```\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L4 \[callout\] callout: put the type on the fence line, not in the body: ```callout info/);
  assert.match(r.err, /Correct example:\n {4}```callout warn Caution/);
  assert.match(r.err, /am help callout/);
});

test('cli render: a first body line "type: warning|error|note", with or without a # comment, fails and names the right fence type', async () => {
  for (const [line, fix] of [['type: warning', 'warn'], ['type: error', 'err'], ['type: note # the kind', 'info'], ['type: ok  # fine', 'ok']]) {
    const r = await run(['render', '-'], { stdin: `## A\n文本\n\`\`\`callout\n${line}\nBody\n\`\`\`\n` });
    assert.equal(r.code, 1, line);
    assert.match(r.err, new RegExp(`✗ L4 \\[callout\\] callout: put the type on the fence line, not in the body: \`\`\`callout ${fix} \\[title\\]`), line);
  }
});

test('cli render: a first body line "type: " followed by several words stays body text', async () => {
  const r = await run(['render', '-', '-o', 'callout-words.html'], { stdin: '## A\n```callout info\ntype: of the valve is shown below\nBody\n```\n' });
  assert.equal(r.code, 0, r.err);
});

test('cli render: a "type: <kind>" line that is not the first body line stays body text', async () => {
  const r = await run(['render', '-', '-o', 'callout-ok.html'], { stdin: '## A\n```callout info\nBody\ntype: warn\n```\n' });
  assert.equal(r.code, 0, r.err);
});

test('cli render: a parse error gives the line number', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n```flow\nA -> B' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L2 Cannot parse the draft: fenced block/);
});

test('cli render: style 80 prints warnings and still renders; strict refuses to render', async () => {
  const bad = '## A\nUtilize the tool.';
  const soft = await run(['render', '-'], { stdin: bad });
  assert.equal(soft.code, 0);
  assert.match(soft.out, /STE 1 warning[\s\S]*L2 \[word\] not recommended: "Utilize" → use/);

  const before = readdirSync(join(dir, 'pages')).length;
  const strict = await run(['render', '-', '--style', 'strict'], { stdin: bad });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /STE check failed/);
  assert.equal(readdirSync(join(dir, 'pages')).length, before, 'a strict failure writes no file');
});

test('cli lint: checks only; warnings under strict return 1; off skips the check', async () => {
  const bad = '## A\nUtilize the tool.';
  assert.equal((await run(['lint', '-'], { stdin: bad })).code, 0);
  assert.equal((await run(['lint', '-', '--style', 'strict'], { stdin: bad })).code, 1);
  assert.match((await run(['lint', '-', '--style', 'off'], { stdin: bad })).out, /STE check is off/);
  assert.equal((await run(['lint', '-', '--style', 'x'], { stdin: bad })).code, 2);
});

test('cli list / help', async () => {
  assert.match((await run(['list'])).out, /flow\s+Flowchart/);
  const h = await run(['help', 'sequence']);
  assert.match(h.out, /sequence — Sequence diagram[\s\S]*Example:\n```sequence/);
  assert.match((await run(['help', 'format'])).out, /template: sheet/);
  assert.match((await run(['help', 'patch'])).out, /#am-source/);
  assert.equal((await run(['help', 'nope'])).code, 2);
});

test('cli: usage, list, config and every help topic print English only', async () => {
  const { COMPONENTS } = await import('../src/components/index.js');
  const topics = [...COMPONENTS.keys(), 'html', 'svg', 'format', 'video', 'patch'];
  const runs = [[], ['list'], ['config'], ...topics.map((t) => ['help', t])];
  for (const args of runs) {
    const r = await run(args, { env: { AM_NO_OPEN: '1' } });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out + r.err, /[\p{Script=Han}，。：；（）]/u, `am ${args.join(' ')}`);
  }
});

test('cli: invalid and missing arguments', async () => {
  assert.equal((await run(['bogus'])).code, 2);
  assert.equal((await run(['render'])).code, 2);
  assert.equal((await run(['render', 'missing.md'])).code, 2);
  assert.equal((await run(['render', '-'], { stdin: '   ' })).code, 2);
  assert.equal((await run(['render', '--wat'])).code, 2);
});

test('cli config: shows every setting, its current value and the config file path', async () => {
  const r = await run(['config']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /config\.json/);
  for (const key of ['open', 'theme', 'mode', 'style']) assert.match(r.out, new RegExp(`\\b${key}\\b`));
});

test('cli config: set / get / reset, changed values are marked with *', async () => {
  assert.equal((await run(['config', 'set', 'theme', 'shadcn'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'shadcn');
  assert.match((await run(['config'])).out, /\* theme\s+shadcn/);
  const rendered = await run(['render', '-', '-o', 'cfg.html'], { stdin: '## A\nx' });
  assert.match(readFileSync(join(dir, 'cfg.html'), 'utf8'), /data-theme="shadcn"/, 'render reads the default theme from config');
  assert.equal(rendered.code, 0);
  assert.equal((await run(['config', 'reset', 'theme'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'auto');
});

test('cli config: booleans print as on/off; an unknown key or invalid value returns 2', async () => {
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

test('cli patch: changing one panel after render keeps the other panels and writes back to the same file', async () => {
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
  assert.equal(outFile, file, 'must overwrite the original HTML, not write a new timestamped file');

  const after = readFileSync(file, 'utf8');
  assert.match(after, /甲新文/);
  assert.doesNotMatch(after, /甲旧文/);
  assert.equal(panelSection(after, 'B'), beforeB, 'panel B, not named, stays unchanged');
  assert.equal(panelSection(after, 'C'), beforeC, 'panel C, not named, stays unchanged');
});

test('cli patch: --from reads a file; a missing panel or missing #am-source leaves the file unchanged', async () => {
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
  assert.match(missingPanel.err, /No panel titled/);
  assert.equal(readFileSync(file, 'utf8'), afterFrom, 'a missing panel must not change the file');

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

test('shouldOpen: --no-open > AM_NO_OPEN > config open; --open forces opening', async () => {
  const { shouldOpen } = await import('../src/cli.js');
  assert.equal(shouldOpen({}, {}, { open: true }), true);
  assert.equal(shouldOpen({}, {}, { open: false }), false);
  assert.equal(shouldOpen({ 'no-open': true }, {}, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '1' }, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '0' }, { open: true }), true, 'AM_NO_OPEN=0 does not count as off');
  assert.equal(shouldOpen({}, { CI: 'true' }, { open: true }), false);
  assert.equal(shouldOpen({ open: true }, { AM_NO_OPEN: '1' }, { open: false }), true);
});

test('cli patch: a fake #am-source in the body must not overwrite the page', async () => {
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

test('cli patch: keeps the theme and template of the page; --theme on this run wins', async () => {
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

test('cli patch: keeps the data-style of the page instead of falling back to config strict', async (t) => {
  assert.equal((await run(['render', '-', '-o', 'style-off.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'style-off.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'style-off.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'style-off.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新文/);
  assert.match(html, /Utilize the tool/);
});

test('cli patch: --style on this run wins over the style stored in the page', async () => {
  assert.equal((await run(['render', '-', '-o', 'style-cli.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'style-cli.html'), 'utf8');
  const r = await run(['patch', 'style-cli.html', '--panel', '乙', '--style', 'strict'], { stdin: '新文。\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE check failed/);
  assert.equal(readFileSync(join(dir, 'style-cli.html'), 'utf8'), before, 'a strict failure must not change the file');
});

test('cli patch: on an old page without data-style, the frontmatter style still wins over config', async (t) => {
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
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'old-style.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'old-style.html'), 'utf8');
  assert.match(html, /新文/);
  assert.match(html, /data-style="off"/);
});

test('cli patch: a fake data-video in the body must not turn a sheet page into a video', async () => {
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

test('cli patch: a fake am-doc in the body must not re-render a sheet page as doc', async () => {
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

test('cli patch: a video page made with --voice off stays silent and is not re-voiced from config', async () => {
  const src = '## 场景\n- 画面\n> 旁白。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '-o', 'silent.html'], { stdin: src })).code, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'silent.html'), 'utf8'), /<audio id="amv-audio"/);
  assert.equal((await run(['config', 'set', 'voice', 'system'])).code, 0);
  const r = await run(['patch', 'silent.html', '--panel', '场景'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /system TTS|Voice-over failed/);
  assert.match(r.out, /voice: none/);
  const html = readFileSync(join(dir, 'silent.html'), 'utf8');
  assert.doesNotMatch(html, /<audio id="amv-audio"/);
  assert.match(html, /新旁白|新画面/);
  assert.equal((await run(['config', 'reset', 'voice'])).code, 0);
});

test('cli patch: a video page keeps its theme (3b1b) and prints the video summary', async () => {
  const src = '## 场景\n```flow\nA -> B\n```\n> [A] 连到 B。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '--theme', '3b1b', '-o', 'v3b.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'v3b.html', '--panel', '场景', '--voice', 'off'], { stdin: '> 新旁白。\n```flow\nA -> C\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video · 3b1b · 1 scene · 1 beat/);
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

test('cli patch: a video page also keeps data-style instead of falling back to config strict', async (t) => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'vstyle.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'vstyle.html', '--panel', '乙', '--voice', 'off'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'vstyle.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新旁白|新画面/);
});

test('cli patch: on a video page, --style on this run wins over the style stored in the page', async () => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle-cli.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'vstyle-cli.html'), 'utf8');
  const r = await run(['patch', 'vstyle-cli.html', '--panel', '乙', '--voice', 'off', '--style', 'strict'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE check failed/);
  assert.equal(readFileSync(join(dir, 'vstyle-cli.html'), 'utf8'), before, 'a strict failure must not change the file');
});
