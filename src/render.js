// Draft → single-file HTML. Pipeline: parse → STE lint → render panels (markdown / components / raw) → apply template → inline CSS and runtime.

import { parseDoc, ParseError, applyOverrides, CHOICES } from './parse.js';
import { md } from './markdown.js';
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { TEMPLATES } from './templates/index.js';
import { pageCss } from './themes/index.js';
import { BUILTIN, AUTO, pickTheme } from './themes/registry.js';
import { lintDoc } from './lint/ste.js';
import { esc } from './svg/text.js';
import { VERSION, RUNTIME_JS } from './assets.js';
import { rootTag, rootCarrierAttrs, sourceTag } from './page.js';
import { resolveLanguage } from './language.js';
import { inlineImages, ImageError, IMAGE_EXAMPLE } from './images.js';
import { renderCode, CodeError, CODE_EXAMPLE } from './code.js';


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

// themes: the theme set to pick from (the CLI passes the built-in themes plus the user's theme files).
// previousLanguage: the language the page had before (a patched page keeps it unless the draft declares one).
// baseDir: where relative image paths are read from; codeDir: where relative code paths are read from (the folder the agent works in).
// knownImages / knownCode: what the page already embeds, the fallback when a file is gone.
export function renderDoc(source, overrides = {}, defaults = {}, { themes = BUILTIN, previousLanguage, baseDir, codeDir, knownImages, knownCode } = {}) {
  const choices = { theme: themes.choices('page') };
  const parsed = parseDoc(source, { defaults, choices });
  const meta = applyOverrides(parsed.meta, overrides, { ...CHOICES, ...choices });
  if (meta.template === 'video') throw new ParseError('template: video is a video draft; render it with am video', 0);
  const problem = themes.problem(meta.theme, 'page');
  if (problem) throw new ParseError(problem, 0);
  // theme: auto becomes a real theme here, so the page, the summary and later patches name the theme that was used.
  const doc = { ...parsed, meta: meta.theme === AUTO ? { ...meta, theme: pickTheme({ scope: 'page', template: meta.template, visuals: hasVisuals(parsed) }) } : meta };

  const language = resolveLanguage({ declared: doc.meta.lang, previous: previousLanguage, text: source });
  const warnings = doc.meta.style === 'off' ? [] : lintDoc(doc, language);
  if (doc.meta.style === 'strict' && warnings.length) throw new LintError(warnings);

  const stats = { panels: doc.panels.length, components: {}, code: [], codeWarnings: [] };
  const ui = language.ui;
  const ctx = { seq: 0, stats, ui, images: { baseDir, known: knownImages }, code: { baseDir: codeDir, known: knownCode } };
  const introHtml = renderBlocks(doc.intro, ctx);
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  const body = TEMPLATES[doc.meta.template]({ meta: doc.meta, introHtml, panels, ui });
  const html = shell({ meta: doc.meta, language, body, source, embedded: themes.embedFor(doc.meta.theme, 'page') });
  return { html, warnings, stats, meta: doc.meta, language };
}

// A diagram, another component or a raw html / svg block anywhere in the draft.
function hasVisuals({ intro, panels }) {
  return [...intro, ...panels.flatMap((p) => p.blocks)].some((b) => b.type === 'fence' && (COMPONENTS.has(b.lang) || RAW_LANGS.has(b.lang)));
}

export function renderBlocks(blocks, ctx) {
  return blocks.map((b) => embedImages(b, b.type === 'md' ? `<div class="am-md">${md(b.text)}</div>` : renderFence(b, ctx), ctx)).join('\n');
}

// Components that read their text as Markdown. Only there is ![a](b) an image the author meant; in raw html and in diagram text it is literal.
const MARKDOWN_FENCES = new Set(['callout', 'kv', 'tree', 'timeline']);

// Local images in a block's html become data URIs; a missing or oversize file is reported at the line that names it.
function embedImages(block, html, ctx) {
  try {
    return inlineImages(html, { ...ctx.images, checkText: block.type === 'md' || MARKDOWN_FENCES.has(block.lang) });
  } catch (err) {
    if (!(err instanceof ImageError)) throw err;
    // The draft may write the path as decoded (a b.png) or percent-encoded (a%20b.png).
    const idx = block.text.split('\n').findIndex((l) => l.includes(err.ref) || l.includes(encodeURI(err.ref)));
    const first = block.type === 'md' ? block.line : block.line + 1;
    throw new RenderError(err.message, { line: first + Math.max(idx, 0), component: 'image', example: IMAGE_EXAMPLE });
  }
}

function renderFence(block, ctx) {
  const { lang, args, text, line } = block;
  if (RAW_LANGS.has(lang)) return text;
  const comp = COMPONENTS.get(lang);
  if (!comp) return codeBlock(block, ctx);
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

// A fence that is not a component is code. ctx.code is absent in a video, where the block has no copy button.
function codeBlock(block, ctx) {
  try {
    const { html, file, warning } = renderCode(block, { ...ctx.code, ui: ctx.ui, copy: Boolean(ctx.code) });
    if (file && ctx.stats.code) ctx.stats.code.push(file);
    if (warning && ctx.stats.codeWarnings) ctx.stats.codeWarnings.push({ line: block.line, message: warning });
    return html;
  } catch (err) {
    if (!(err instanceof CodeError)) throw err;
    throw new RenderError(err.message, { line: block.line + err.line, component: 'code', example: CODE_EXAMPLE });
  }
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shell({ meta, language, body, source, embedded }) {
  const { ui, labelKey } = language;
  const pick = (name, label, values, current) => `<label class="am-pick">${esc(label)}<select data-am="${name}">${values
    .map(([value, text]) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const root = { lang: language.htmlLang, theme: meta.theme, mode: meta.mode, style: meta.style };
  return `<!doctype html>
${rootTag(root)}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss(embedded)}
</style>
</head>
<body>
<div class="am-toolbar"${rootCarrierAttrs(root)}>
${pick('theme', ui.theme, embedded.map((t) => [t.name, t.label[labelKey]]), meta.theme)}
${pick('mode', ui.modeLabel, Object.entries(ui.mode), meta.mode)}
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${body}
<footer class="am-colophon">Generated by <a href="https://github.com/QingYunA/answer-me-with-html" target="_blank" rel="noopener">Answer me with HTML</a> ${VERSION} · ${esc(timestamp())}</footer>
${sourceTag(source)}
<script>
${RUNTIME_JS}</script>
</body>
</html>
`;
}
