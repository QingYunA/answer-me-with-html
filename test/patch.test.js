import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { parseDoc } from '../src/parse.js';
import { replacePanel, findPanel, PatchError } from '../src/patch.js';
import { readPage } from '../src/page.js';

const extractSource = (html) => readPage(html).source;
const isVideoPage = (html) => readPage(html).video;
const pageSettings = (html) => {
  const { template, theme, mode, style } = readPage(html);
  return { template, theme, mode, style };
};

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

test('extractSource: restores the escaped source from #am-source', () => {
  const src = '## A\n```html\n<script>x</script></textarea>\n```';
  const { html } = renderDoc(src);
  assert.equal(extractSource(html), src);
});

test('extractSource: returns null without #am-source', () => {
  assert.equal(extractSource('<html><body>no source</body></html>'), null);
});

test('extractSource: a fake #am-source in the body does not override the real source at the end', () => {
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

test('extractSource: a textarea in markdown body is shown as text and does not override the real source', () => {
  const src = `## A 说明
<textarea id="am-source">FAKE</textarea>
`;
  const { html } = renderDoc(src);
  assert.ok(!html.includes('<textarea id="am-source">FAKE'));
  assert.match(html, /&lt;textarea id=&quot;am-source&quot;&gt;FAKE&lt;\/textarea&gt;/);
  assert.equal(extractSource(html), src);
});

test('extractSource: a fake textarea in an html fence does not override the real source at the end', () => {
  const src = `## A 说明
\`\`\`html
<textarea id="am-source">FAKE</textarea>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<textarea id="am-source">FAKE<\/textarea>/);
  assert.equal(extractSource(html), src);
});

test('copy-source control: a fake #am-source in the body does not override the real source at the end', async () => {
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

test('isVideoPage / pageSettings: a video page carries data-video', async () => {
  const { html } = await renderVideo('## 第一幕\n- 画面\n> 旁白。\n');
  assert.equal(isVideoPage(html), true);
  const settings = pageSettings(html);
  assert.equal(settings.template, 'video');
  assert.match(settings.theme, /blueprint|shadcn|3b1b/);
  assert.equal(isVideoPage('<html><body>no</body></html>'), false);
});

test('isVideoPage: <html data-video> in the body does not make a video page', async () => {
  const src = `---
title: 图纸
---
## A 说明
\`\`\`html
<html lang="zh-CN" data-theme="blueprint" data-mode="light" data-video>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<html\b[^>]*\sdata-video\b/, 'the body keeps this markup');
  assert.equal(isVideoPage(html), false);
  assert.equal(pageSettings(html).template, 'sheet');
});

test('pageSettings: <main class="am-doc"> in the body does not make a doc', async () => {
  const src = `---
title: 图纸
---
## A 说明
\`\`\`html
<main class="am-doc">假目录</main>
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /<main class="am-doc"/, 'the body keeps this markup');
  assert.match(html, /<main class="am-sheet"/);
  assert.equal(pageSettings(html).template, 'sheet');
});

test('replacePanel: replaces only the matching ## panel, other sections keep their source', () => {
  const next = replacePanel(SRC, '流程', '## A 流程\n新的流程说明。\n');
  assert.match(next, /新的流程说明/);
  assert.doesNotMatch(next, /旧的流程说明/);
  assert.equal(sectionOf(next, '对照'), sectionOf(SRC, '对照'));
  assert.equal(sectionOf(next, '结论'), sectionOf(SRC, '结论'));
  assert.match(next, /导语保留/);
  assert.match(next, /title: Patch 测试/);
});

test('replacePanel: --panel matches a title, an ID or "ID title"', () => {
  for (const q of ['流程', 'A', 'A 流程', '## A 流程']) {
    const next = replacePanel(SRC, q, '只写正文。\n');
    assert.match(next, /## A 流程\n只写正文。/);
  }
});

test('replacePanel: keeps the original heading line when the new body has no ##', () => {
  const next = replacePanel(SRC, '对照', '对照已更新。\n');
  assert.match(next, /## B 对照\n对照已更新。/);
});

test('replacePanel: throws when the panel is missing or the draft is empty', () => {
  assert.throws(() => replacePanel(SRC, '没有这个', 'x'), PatchError);
  assert.throws(() => replacePanel(SRC, '流程', '   '), PatchError);
  assert.throws(() => replacePanel(SRC, '流程', '## A 一\na\n## B 二\nb\n'), /exactly one/);
});

test('pageSettings: reads template, theme, mode and STE style back from the page', async () => {
  const { html } = renderDoc('---\ntemplate: doc\ntheme: shadcn\nmode: dark\n---\n## A 一\n文字\n');
  assert.deepEqual(pageSettings(html), { template: 'doc', theme: 'shadcn', mode: 'dark', style: '80' });
  assert.deepEqual(pageSettings('<p>no</p>'), { template: undefined, theme: undefined, mode: undefined, style: undefined });

  const off = renderDoc('---\ntitle: 关检查\n---\n## A 一\n文字\n', { style: 'off' });
  assert.equal(pageSettings(off.html).style, 'off');
  const video = await renderVideo('## 第一幕\n- 画面\n> 旁白。\n', { overrides: { style: 'strict' } });
  assert.equal(pageSettings(video.html).style, 'strict');
});

test('readPage: reads back the written envelope unchanged (pages and videos, with and without voice)', async () => {
  const source = '---\ntitle: 信封 <&"\'>\n---\n## A 面板\n> 一句。\n';
  const doc = renderDoc(source, { theme: 'shadcn', mode: 'dark', template: 'doc' });
  assert.deepEqual(readPage(doc.html), { source, video: false, template: 'doc', theme: 'shadcn', mode: 'dark', style: '80', lang: 'zh-CN', voice: undefined, voiced: false });
  const silent = await renderVideo(source, { overrides: { theme: '3b1b' } });
  assert.deepEqual(readPage(silent.html), { source, video: true, template: 'video', theme: '3b1b', mode: 'dark', style: '80', lang: 'zh-CN', voice: undefined, voiced: false });
  const provider = { name: 'fake', voice: 'local', id: 'fake', concurrency: 1, synth: async () => new Int16Array(1600).fill(1000) };
  const voiced = await renderVideo(source, { provider });
  assert.equal(readPage(voiced.html).voiced, true);
  assert.equal(readPage(voiced.html).voice, 'local');
});

test('readPage: a fake <audio id="amv-audio"> in the body does not count as voice', async () => {
  const source = '## A\n```html\n<audio id="amv-audio"></audio>\n```\n> 一句。\n';
  const { html } = await renderVideo(source, {});
  assert.ok(html.includes('<audio id="amv-audio"'));
  assert.equal(readPage(html).voiced, false);
});
