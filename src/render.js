// Draft → single-file HTML. Pipeline: parse → STE lint → render panels (markdown / components / raw) → apply template → inline CSS and runtime.

import { parseDoc, ParseError, applyOverrides } from './parse.js';
import { md } from './markdown.js';
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { TEMPLATES } from './templates/index.js';
import { pageCss } from './themes/index.js';
import { lintDoc } from './lint/ste.js';
import { esc, isCJK, isJapanese } from './svg/text.js';
import { VERSION, RUNTIME_JS } from './assets.js';
import { rootTag, sourceTag } from './page.js';


export class RenderError extends Error {
  constructor(message, { line, component, example } = {}) {
    super(message);
    this.name = 'RenderError';
    this.line = line;
    this.component = component;
    this.example = example;
  }
}

export class LintError extends Error {
  constructor(warnings) {
    super(`STE check failed (style: strict): ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    this.name = 'LintError';
    this.warnings = warnings;
  }
}

export const UI = {
  zh: {
    theme: { blueprint: '主题：图纸', shadcn: '主题：卡片' },
    mode: { auto: '明暗：跟随系统', light: '明暗：亮', dark: '明暗：暗' },
    copy: '复制源稿', done: '已复制 ✓',
    toc: '目录', flow: '流程图：', sequence: '时序图：', sep: '、',
  },
  en: {
    theme: { blueprint: 'Theme: Blueprint', shadcn: 'Theme: Cards' },
    mode: { auto: 'Mode: Auto', light: 'Mode: Light', dark: 'Mode: Dark' },
    copy: 'Copy source', done: 'Copied ✓',
    toc: 'Contents', flow: 'Flowchart: ', sequence: 'Sequence diagram: ', sep: ', ',
  },
  ja: {
    theme: { blueprint: 'テーマ：図面', shadcn: 'テーマ：カード' },
    mode: { auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク' },
    copy: '原稿をコピー', done: 'コピーしました ✓',
    toc: '目次', flow: 'フローチャート：', sequence: 'シーケンス図：', sep: '、',
  },
};

// The <html lang> value.
export function htmlLang(lang) {
  return lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja' : 'en';
}

export function detectLang(text) {
  let cjk = 0;
  let latin = 0;
  for (const ch of String(text)) {
    if (isCJK(ch)) cjk++;
    else if (/[a-z]/i.test(ch)) latin++;
  }
  if (cjk * 3 < latin) return 'en';
  return isJapanese(text) ? 'ja' : 'zh';
}

export function renderDoc(source, overrides = {}, defaults = {}) {
  const parsed = parseDoc(source, { defaults });
  const doc = { ...parsed, meta: applyOverrides(parsed.meta, overrides) };
  if (doc.meta.template === 'video') throw new ParseError('template: video is a video draft; render it with am video', 0);

  const warnings = doc.meta.style === 'off' ? [] : lintDoc(doc);
  if (doc.meta.style === 'strict' && warnings.length) throw new LintError(warnings);

  const stats = { panels: doc.panels.length, components: {} };
  const lang = doc.meta.lang || detectLang(source);
  const ui = UI[lang] ?? UI.zh;
  const ctx = { seq: 0, stats, ui };
  const introHtml = renderBlocks(doc.intro, ctx);
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  const body = TEMPLATES[doc.meta.template]({ meta: doc.meta, introHtml, panels, ui });
  const html = shell({ meta: doc.meta, lang, body, source });
  return { html, warnings, stats, meta: doc.meta };
}

export function renderBlocks(blocks, ctx) {
  return blocks.map((b) => (b.type === 'md' ? `<div class="am-md">${md(b.text)}</div>` : renderFence(b, ctx))).join('\n');
}

function renderFence(block, ctx) {
  const { lang, args, text, line } = block;
  if (RAW_LANGS.has(lang)) return text;
  const comp = COMPONENTS.get(lang);
  if (!comp) {
    return `<pre class="am-code"><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
  }
  ctx.stats.components[lang] = (ctx.stats.components[lang] ?? 0) + 1;
  try {
    return comp.render(text, { args, uid: () => `am${++ctx.seq}`, ui: ctx.ui });
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    throw new RenderError(err.message, {
      line: line + (err.line || 0),
      component: lang,
      example: comp.example,
    });
  }
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shell({ meta, lang, body, source }) {
  const ui = UI[lang] ?? UI.zh;
  return `<!doctype html>
${rootTag({ lang: htmlLang(lang), theme: meta.theme, mode: meta.mode, style: meta.style })}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss()}
</style>
</head>
<body>
<div class="am-toolbar">
<button class="am-btn" type="button" data-am="theme" data-labels="${esc(JSON.stringify(ui.theme))}">${esc(ui.theme[meta.theme])}</button>
<button class="am-btn" type="button" data-am="mode" data-labels="${esc(JSON.stringify(ui.mode))}">${esc(ui.mode[meta.mode])}</button>
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${body}
<footer class="am-colophon">Generated by Answer me with HTML ${VERSION} · ${esc(timestamp())}</footer>
${sourceTag(source)}
<script>
${RUNTIME_JS}</script>
</body>
</html>
`;
}
