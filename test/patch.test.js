import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { parseDoc } from '../src/parse.js';
import { extractSource, replacePanel, findPanel, isVideoPage, PatchError } from '../src/patch.js';

const SRC = `---
title: Patch 测试
---
导语保留。

## A 流程
旧的流程说明。

## B 对照
对照文字不要动。

## C 结论
结论也不要动。
`;

function sectionOf(source, title) {
  const doc = parseDoc(source);
  const panel = findPanel(doc, title);
  const idx = doc.panels.indexOf(panel);
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const start = panel.line - 1;
  const end = doc.panels[idx + 1] ? doc.panels[idx + 1].line - 1 : lines.length;
  return lines.slice(start, end).join('\n');
}

test('extractSource: 从 #am-source 还原转义后的源稿', () => {
  const src = '## A\n```html\n<script>x</script></textarea>\n```';
  const { html } = renderDoc(src);
  assert.equal(extractSource(html), src);
});

test('extractSource: 没有 #am-source 时返回 null', () => {
  assert.equal(extractSource('<html><body>no source</body></html>'), null);
});

test('extractSource: 正文假 #am-source 不能盖过文末真实源稿', () => {
  const html = `<html><body>
<p>说明</p>
<textarea id="am-source">FAKE</textarea>
<textarea id="am-source" hidden readonly aria-hidden="true">## A 真源稿
正文
</textarea>
</body></html>`;
  assert.equal(extractSource(html), '## A 真源稿\n正文\n');
  assert.notEqual(extractSource(html), 'FAKE');
});

test('extractSource: markdown 正文里的假 textarea 不能盖过文末真实源稿', () => {
  const src = `## A 说明
<textarea id="am-source">FAKE</textarea>
`;
  const { html } = renderDoc(src);
  assert.match(html, /<textarea id="am-source">FAKE<\/textarea>/);
  assert.equal(extractSource(html), src);
});

test('extractSource: html 围栏里的假 textarea 不能盖过文末真实源稿', () => {
  const src = `## A 说明
\`\`\`html
<textarea id="am-source">FAKE</textarea>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<textarea id="am-source">FAKE<\/textarea>/);
  assert.equal(extractSource(html), src);
});

test('copy-source control: 正文假 #am-source 不能盖过文末真实源稿', async () => {
  const real = { value: '## A 真源稿\n正文\n' };
  const fake = { value: 'FAKE' };
  const copyBtn = {
    dataset: { done: '已复制' },
    textContent: '复制源稿',
    handler: null,
    addEventListener(_ev, fn) { this.handler = fn; },
  };
  let copied = null;
  const document = {
    documentElement: { getAttribute: () => 'blueprint', setAttribute() {} },
    querySelector(sel) { return sel === '[data-am="copy"]' ? copyBtn : null; },
    getElementById(id) { return id === 'am-source' ? fake : null; },
    querySelectorAll(sel) {
      return String(sel).includes('am-source') ? [fake, real] : [];
    },
  };
  const navigator = { clipboard: { writeText: async (t) => { copied = t; } } };
  const js = readFileSync(new URL('../src/runtime/page.js', import.meta.url), 'utf8');
  runInContext(js, createContext({ document, navigator, setTimeout() {} }));
  assert.ok(copyBtn.handler);
  await copyBtn.handler();
  assert.equal(copied, real.value);
});

test('isVideoPage / pageSettings: 视频页带 data-video', async () => {
  const { html } = await renderVideo('## 第一幕\n- 画面\n> 旁白。\n');
  assert.equal(isVideoPage(html), true);
  const { pageSettings } = await import('../src/patch.js');
  const settings = pageSettings(html);
  assert.equal(settings.template, 'video');
  assert.match(settings.theme, /blueprint|shadcn|3b1b/);
  assert.equal(isVideoPage('<html><body>no</body></html>'), false);
});

test('isVideoPage: 正文里的 <html data-video> 不算视频页', async () => {
  const { pageSettings } = await import('../src/patch.js');
  const src = `---
title: 图纸
---
## A 说明
\`\`\`html
<html lang="zh-CN" data-theme="blueprint" data-mode="light" data-video>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<html\b[^>]*\sdata-video\b/, '正文应保留这段标记');
  assert.equal(isVideoPage(html), false);
  assert.equal(pageSettings(html).template, 'sheet');
});

test('pageSettings: 正文里的 <main class="am-doc"> 不算 doc', async () => {
  const { pageSettings } = await import('../src/patch.js');
  const src = `---
title: 图纸
---
## A 说明
\`\`\`html
<main class="am-doc">假目录</main>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<main class="am-doc"/, '正文应保留这段标记');
  assert.match(html, /<main class="am-sheet"/);
  assert.equal(pageSettings(html).template, 'sheet');
});

test('replacePanel: 只替换匹配的 ## 面板，其余小节原文不变', () => {
  const next = replacePanel(SRC, '流程', '## A 流程\n新的流程说明。\n');
  assert.match(next, /新的流程说明/);
  assert.doesNotMatch(next, /旧的流程说明/);
  assert.equal(sectionOf(next, '对照'), sectionOf(SRC, '对照'));
  assert.equal(sectionOf(next, '结论'), sectionOf(SRC, '结论'));
  assert.match(next, /导语保留/);
  assert.match(next, /title: Patch 测试/);
});

test('replacePanel: --panel 可匹配标题、ID 或 "ID 标题"', () => {
  for (const q of ['流程', 'A', 'A 流程', '## A 流程']) {
    const next = replacePanel(SRC, q, '只写正文。\n');
    assert.match(next, /## A 流程\n只写正文。/);
  }
});

test('replacePanel: 正文不含 ## 时保留原标题行', () => {
  const next = replacePanel(SRC, '对照', '对照已更新。\n');
  assert.match(next, /## B 对照\n对照已更新。/);
});

test('replacePanel: 找不到面板或稿件为空时抛错', () => {
  assert.throws(() => replacePanel(SRC, '没有这个', 'x'), PatchError);
  assert.throws(() => replacePanel(SRC, '流程', '   '), PatchError);
  assert.throws(() => replacePanel(SRC, '流程', '## A 一\na\n## B 二\nb\n'), /只包含一个/);
});

test('pageSettings: 从页面读回模板、主题、明暗与 STE style', async () => {
  const { pageSettings } = await import('../src/patch.js');
  const { html } = renderDoc('---\ntemplate: doc\ntheme: shadcn\nmode: dark\n---\n## A 一\n文字\n');
  assert.deepEqual(pageSettings(html), { template: 'doc', theme: 'shadcn', mode: 'dark', style: '80' });
  assert.deepEqual(pageSettings('<p>no</p>'), { template: undefined, theme: undefined, mode: undefined, style: undefined });

  const off = renderDoc('---\ntitle: 关检查\n---\n## A 一\n文字\n', { style: 'off' });
  assert.equal(pageSettings(off.html).style, 'off');
  const video = await renderVideo('## 第一幕\n- 画面\n> 旁白。\n', { overrides: { style: 'strict' } });
  assert.equal(pageSettings(video.html).style, 'strict');
});
