// Draft → single-file HTML. Pipeline: parse → STE lint → render panels (markdown / components / raw) → apply template → inline CSS and runtime.

import { parseDoc, ParseError, applyOverrides, CHOICES } from './parse.js';
import { md, collectHtmlNotes } from './markdown.js';
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { TEMPLATES } from './templates/index.js';
import { pageCss } from './themes/index.js';
import { BUILTIN, AUTO, pickTheme } from './themes/registry.js';
import { lintDoc } from './lint/ste.js';
import { esc } from './svg/text.js';
import { VERSION, RUNTIME_JS, RTL_JS, DELTA_JS } from './assets.js';
import { rootTag, rootCarrierAttrs, sourceTag } from './page.js';
import { resolveLanguage } from './language.js';
import { inlineImages, ImageError, IMAGE_EXAMPLE } from './images.js';
import { renderCode, CodeError } from './code.js';
import { isolateLtrRuns } from './bidi.js';


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

  const stats = { panels: doc.panels.length, components: {}, code: [], codeWarnings: [], componentWarnings: [], htmlWarnings: [] };
  const ui = language.ui;
  const ctx = { seq: 0, stats, ui, dir: language.dir, images: { baseDir, known: knownImages }, code: { baseDir: codeDir, known: knownCode } };
  const loose = doc.intro.find((b) => b.type === 'fence' && COMPONENTS.get(b.lang)?.panelOnly);
  if (loose) throw new RenderError(`${loose.lang} belongs in a panel: put it under the ## heading of the panel the answer changes`, { line: loose.line, component: loose.lang, example: COMPONENTS.get(loose.lang).example });
  const introHtml = renderBlocks(doc.intro, ctx);
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  const page = TEMPLATES[doc.meta.template]({ meta: doc.meta, introHtml, panels, ui, language });
  // A right-to-left page isolates each run of text with no right-to-left letter as left to right (src/bidi.js).
  const body = language.dir === 'rtl' ? isolateLtrRuns(page) : page;
  const html = shell({ meta: doc.meta, language, body, source, embedded: themes.embedFor(doc.meta.theme, 'page') });
  return { html, warnings, stats, meta: doc.meta, language };
}

// A diagram, another component or a raw html / svg block anywhere in the draft.
function hasVisuals({ intro, panels }) {
  return [...intro, ...panels.flatMap((p) => p.blocks)].some((b) => b.type === 'fence' && (COMPONENTS.has(b.lang) || RAW_LANGS.has(b.lang)));
}

export function renderBlocks(blocks, ctx) {
  return blocks.map((b) => {
    const { result, notes } = collectHtmlNotes(() => (b.type === 'md' ? `<div class="am-md">${md(b.text)}</div>` : renderFence(b, ctx)));
    noteHtml(b, notes, ctx);
    return embedImages(b, result, ctx);
  }).join('\n');
}

// The raw-HTML notes of one block, each with the draft line of its tag. The nth note about the same tag points at its nth place in the block.
function noteHtml(block, notes, ctx) {
  if (!notes.length || !ctx.stats.htmlWarnings) return;
  const lines = block.text.split('\n');
  const first = block.type === 'md' ? block.line : block.line + 1;
  const used = new Map();
  for (const { at, message } of notes) {
    const tag = at.split('\n')[0];
    const places = lines.flatMap((l, i) => Array(l.split(tag).length - 1).fill(i));
    const n = used.get(tag) ?? 0;
    used.set(tag, n + 1);
    ctx.stats.htmlWarnings.push({ line: first + (places[Math.min(n, places.length - 1)] ?? 0), message });
  }
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
  if (comp.pageOnly && ctx.video) throw new RenderError(`${lang} works on a page only; a video cannot take answers`, { line, component: lang, example: comp.example });
  ctx.stats.components[lang] = (ctx.stats.components[lang] ?? 0) + 1;
  try {
    const warn = ({ line: at = 0, message }) => ctx.stats.componentWarnings?.push({ line: line + at, component: lang, message });
    return comp.render(text, { args, uid: () => `am${++ctx.seq}`, ui: ctx.ui, dir: ctx.dir ?? 'ltr', video: ctx.video, warn });
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    throw new RenderError(err.message, {
      line: line + (err.line || 0),
      component: lang,
      example: comp.example,
    });
  }
}

// A fence that is not a component is code. In a video the block has no copy button.
function codeBlock(block, ctx) {
  try {
    const { html, file, warnings } = renderCode(block, { ...ctx.code, ui: ctx.ui, copy: !ctx.video });
    if (file && ctx.stats.code) ctx.stats.code.push(file);
    if (ctx.stats.codeWarnings) ctx.stats.codeWarnings.push(...warnings.map((w) => ({ line: block.line, ...w })));
    return html;
  } catch (err) {
    if (!(err instanceof CodeError)) throw err;
    throw new RenderError(err.message, { line: block.line + err.line, component: 'code', example: err.example });
  }
}

// order: 'ymd' (2026-10-07 22:44) or 'dmy' (7.10.2026 22:44, the way Hebrew readers write a date).
export function timestamp(d = new Date(), order = 'ymd') {
  const p = (n) => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (order === 'dmy') return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${time}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}

// The line under the page. On a right-to-left page the product name with its version and the time are each isolated, so the
// Latin name, the version and the date do not merge into one left-to-right run.
function colophon(language) {
  const link = '<a href="https://github.com/QingYunA/answer-me-with-html" target="_blank" rel="noopener">Answer me with HTML</a>';
  const label = esc(language.ui.generated ?? 'Generated by');
  const time = esc(timestamp(new Date(), language.dateOrder));
  if (language.dir === 'rtl') return `<footer class="am-colophon">${label} <bdi>${link} ${VERSION}</bdi> · <bdi>${time}</bdi></footer>`;
  return `<footer class="am-colophon">${label} ${link} ${VERSION} · ${time}</footer>`;
}

// A diagram with change markers carries a count row; only then the page needs the delta styles and script.
export const hasDelta = (html) => html.includes('class="am-delta-bar"');

function lightboxShell(ui, hasDiagrams) {
  if (!hasDiagrams) return '';
  return `<div class="am-lightbox" hidden aria-modal="true" role="dialog" aria-label="${esc(ui.diagram)}" data-expand="${esc(ui.expand)}">
<div class="am-lightbox-backdrop"></div>
<div class="am-lightbox-header">
<div class="am-lightbox-title">
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
<span class="am-lightbox-title-text"></span>
</div>
<div class="am-lightbox-actions">
<button class="am-lightbox-close" data-action="close" title="${esc(ui.close)}" aria-label="${esc(ui.close)}">✕</button>
</div>
</div>
<div class="am-lightbox-stage">
<div class="am-lightbox-canvas am-diagram"></div>
</div>
</div>
`;
}

function shell({ meta, language, body, source, embedded }) {
  const { ui, labelKey } = language;
  const pick = (name, label, values, current) => `<label class="am-pick">${esc(label)}<select data-am="${name}">${values
    .map(([value, text]) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const root = { lang: language.htmlLang, dir: language.dir, theme: meta.theme, mode: meta.mode, style: meta.style };
  return `<!doctype html>
${rootTag(root)}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss(embedded, { diff: body.includes('class="am-codeblock am-codeblock--diff"'), delta: hasDelta(body), rtl: language.dir === 'rtl' })}
</style>
</head>
<body>
<div class="am-toolbar"${rootCarrierAttrs(root)}>
${pick('theme', ui.theme, embedded.map((t) => [t.name, t.label[labelKey]]), meta.theme)}
${pick('mode', ui.modeLabel, Object.entries(ui.mode), meta.mode)}
<button class="am-btn am-btn--reply" type="button" data-am="reply" data-ui="${esc(JSON.stringify({ ...ui.reply, done: ui.done }))}">${esc(ui.reply.button)}</button>
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${body}
${lightboxShell(ui, body.includes('class="am-diagram'))}${colophon(language)}
${sourceTag(source)}
<script>
${RUNTIME_JS}${language.dir === 'rtl' ? RTL_JS : ''}${hasDelta(body) ? DELTA_JS : ''}</script>
</body>
</html>
`;
}
