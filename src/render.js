// Draft → single-file HTML. Pipeline: parse → STE lint → render panels (markdown / components / raw) → apply template → inline CSS and runtime.

import { parseDocLoose, ParseError, raiseAll, applyOverrides, CHOICES } from './parse.js';
import { md, collectHtmlNotes } from './markdown.js';
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { TEMPLATES } from './templates/index.js';
import { pageCss } from './themes/index.js';
import { BUILTIN, AUTO, pickTheme } from './themes/registry.js';
import { lintDoc } from './lint/ste.js';
import { esc } from './svg/text.js';
import { scaleSvgBoxes } from './svg/shapes.js';
import { SCALE } from './themes/type-scale.js';
import { VERSION, RUNTIME_JS, DELTA_JS, UPDATE_JS, CLOSE_AFTER_JS } from './assets.js';
import { rootTag, rootCarrierAttrs, sourceTag } from './page.js';
import { resolveLanguage } from './language.js';
import { inlineImages, remoteImages, ImageError, IMAGE_EXAMPLE } from './images.js';
import { renderCode, CodeError } from './code.js';
import { isolateLtrRuns } from './bidi.js';
import { hasMath } from './math.js';
import { cspMeta } from './csp.js';


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
// update: { latest, current, command, highlights } from pageUpdate in src/update.js when a newer version is known; the page then has a new-version button.
// closeAfter: the close_after_reply setting; the page then closes its tab a few seconds after the reply is copied (src/runtime/close-after-reply.js).
// scale: the reader's text size (src/themes/type-scale.js); 1 is the default, so it adds nothing to the page.
export function renderDoc(source, overrides = {}, defaults = {}, { themes = BUILTIN, previousLanguage, baseDir, codeDir, knownImages, knownCode, update, closeAfter = false, scale = 1 } = {}) {
  const choices = { theme: themes.choices('page') };
  const { doc: parsed, errors } = parseDocLoose(source, { defaults, choices });
  const meta = applyOverrides(parsed.meta, overrides, { ...CHOICES, ...choices });
  if (meta.template === 'video') throw new ParseError('template: video is a video draft; render it with am video', 0);
  const problem = themes.problem(meta.theme, 'page');
  if (problem) throw new ParseError(problem, 0);
  // theme: auto becomes a real theme here, so the page, the summary and later patches name the theme that was used.
  const doc = { ...parsed, meta: meta.theme === AUTO ? { ...meta, theme: pickTheme({ scope: 'page', template: meta.template, visuals: hasVisuals(parsed) }) } : meta };

  const language = resolveLanguage({ declared: doc.meta.lang, previous: previousLanguage, text: source });
  const warnings = doc.meta.style === 'off' ? [] : lintDoc(doc, language);
  if (doc.meta.style === 'strict' && warnings.length) {
    raiseAll(errors); // the draft errors come first: they have to be fixed anyway
    throw new LintError(warnings);
  }

  const stats = { panels: doc.panels.length, components: {}, code: [], codeWarnings: [], componentWarnings: [], htmlWarnings: [], mathWarnings: [] };
  const ui = language.ui;
  const ctx = { seq: 0, stats, errors, ui, dir: language.dir, scale, images: { baseDir, known: knownImages }, code: { baseDir: codeDir, known: knownCode } };
  // A panel-only component in the intro is an error of its own, and the block renders nothing.
  const loose = doc.intro.filter((b) => b.type === 'fence' && COMPONENTS.get(b.lang)?.panelOnly);
  for (const b of loose) {
    errors.push(new RenderError(`${b.lang} belongs in a panel: put it under the ## heading of the panel the answer changes`, { line: b.line, component: b.lang, example: COMPONENTS.get(b.lang).example }));
  }
  const introHtml = renderBlocks(doc.intro.filter((b) => !loose.includes(b)), ctx);
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  raiseAll(errors);
  const page = TEMPLATES[doc.meta.template]({ meta: doc.meta, introHtml, panels, ui, language });
  // A right-to-left page isolates each run of text with no right-to-left letter as left to right (src/bidi.js).
  const body = language.dir === 'rtl' ? isolateLtrRuns(page) : page;
  const html = shell({ meta: doc.meta, language, body, source, embedded: themes.embedFor(doc.meta.theme, 'page'), update, closeAfter, scale });
  return { html, warnings, stats, meta: doc.meta, language };
}

// A diagram, another component or a raw html / svg block anywhere in the draft.
function hasVisuals({ intro, panels }) {
  return [...intro, ...panels.flatMap((p) => p.blocks)].some((b) => b.type === 'fence' && (COMPONENTS.has(b.lang) || RAW_LANGS.has(b.lang)));
}

// ctx.errors: an array that collects the RenderError of each block, so one run finds every broken block; a failing block renders
// nothing and the next one goes on. Without it the first error throws. The caller throws what was collected (raiseAll in src/parse.js).
export function renderBlocks(blocks, ctx) {
  return blocks.map((b) => {
    if (!ctx.errors) return renderBlock(b, ctx);
    try {
      return renderBlock(b, ctx);
    } catch (err) {
      if (!(err instanceof RenderError)) throw err;
      ctx.errors.push(err);
      return '';
    }
  }).join('\n');
}

function renderBlock(b, ctx) {
  const { result, notes } = collectHtmlNotes(() => (b.type === 'md' ? `<div class="am-md">${md(b.text)}</div>` : renderFence(b, ctx)), { math: !ctx.video });
  noteHtml(b, notes.filter((n) => !n.math), ctx);
  noteMath(b, notes.filter((n) => n.math), ctx);
  const out = embedImages(b, result, ctx);
  noteRemoteImages(b, out, ctx);
  return out;
}

// Each remote image of one block, with the draft line that names it. The page blocks remote content (src/csp.js), so the image would be blank.
function noteRemoteImages(block, html, ctx) {
  if (!ctx.stats.htmlWarnings) return;
  const lines = block.text.split('\n');
  const first = block.type === 'md' ? block.line : block.line + 1;
  const used = new Map();
  for (const ref of remoteImages(html)) {
    const places = lines.flatMap((l, i) => (l.includes(ref) || l.includes(encodeURI(ref)) ? [i] : []));
    const n = used.get(ref) ?? 0;
    used.set(ref, n + 1);
    const shown = ref.length > 80 ? `${ref.slice(0, 77)}...` : ref;
    ctx.stats.htmlWarnings.push({ line: first + (places[Math.min(n, places.length - 1)] ?? 0), message: `remote image ${shown} does not load in the page; save the image and use its local path` });
  }
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

// The math notes of one block, each with the draft line of its formula. The nth note about the same formula points at its nth place in the block.
function noteMath(block, notes, ctx) {
  if (!notes.length || !ctx.stats.mathWarnings) return;
  const first = block.type === 'md' ? block.line : block.line + 1;
  const next = new Map();
  for (const { at, message } of notes) {
    const index = block.text.indexOf(at, next.get(at) ?? 0);
    next.set(at, index + 1);
    ctx.stats.mathWarnings.push({ line: first + (index < 0 ? 0 : block.text.slice(0, index).split('\n').length - 1), message });
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
    const html = comp.render(text, { args, uid: () => `am${++ctx.seq}`, ui: ctx.ui, dir: ctx.dir ?? 'ltr', video: ctx.video, warn });
    // A component's own svg is measured in viewBox units at fixed text sizes, so the whole box takes the factor. Raw svg / html blocks
    // bypass this function, and a video never scales.
    return ctx.video ? html : scaleSvgBoxes(html, ctx.scale ?? 1);
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

// The line at the top of the page, above the title. On a right-to-left page the product name with its version, the time and the star link are each
// isolated, so the Latin name, the version and the date do not merge into one left-to-right run. The star link is English in
// every language, like the product name.
function colophon(language) {
  const repo = 'https://github.com/QingYunA/answer-me-with-html';
  const link = `<a href="${repo}" target="_blank" rel="noopener">Answer me with HTML</a>`;
  const star = `<a href="${repo}" target="_blank" rel="noopener">★ Star on GitHub</a>`;
  const label = esc(language.ui.generated ?? 'Generated by');
  const time = esc(timestamp(new Date(), language.dateOrder));
  if (language.dir === 'rtl') return `<p class="am-colophon">${label} <bdi>${link} ${VERSION}</bdi> · <bdi>${time}</bdi> · <bdi>${star}</bdi></p>`;
  return `<p class="am-colophon">${label} ${link} ${VERSION} · ${time} · ${star}</p>`;
}

// The colophon opens the page header. It goes in after src/bidi.js has run over the body, since it isolates its own runs. The
// template's header is the first one in the body: the intro and the panels come after it.
const withColophon = (body, language) => body.replace('<header class="am-head">', (head) => `${head}${colophon(language)}`);

// The new-version button and its popover (a native popover, so it opens, closes on Esc and on a click outside with no script). The
// button starts hidden; src/runtime/update.js shows it where the browser has popovers. withoutUpdateNotice takes both out again.
function updateNotice(ui, update, labelKey) {
  if (!update) return { button: '', popover: '' };
  const t = ui.update;
  // The highlights in the page language, else in English (the labels fall back the same way). `code` spans become <code>.
  const lines = update.highlights?.[labelKey] ?? update.highlights?.en;
  const notes = lines
    ? `<p class="am-update-label">${esc(t.whatsNew)}</p>\n<ul class="am-update-notes">${lines.map((l) => `<li>${esc(l).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>\n`
    : '';
  const plain = t.button.replace('{version}', update.latest);
  const fill = (s) => esc(s).replace('{version}', `<bdi>${esc(update.latest)}</bdi>`).replace('{current}', `<bdi>${esc(update.current)}</bdi>`);
  // The command is code and reads left to right; the line for the agent is a sentence in the page language.
  const row = (text, code) => `<div class="am-update-row">${code ? `<code dir="ltr">${esc(text)}</code>` : `<span>${esc(text)}</span>`}<button class="am-btn" type="button" data-am="copy-text" data-text="${esc(text)}" data-done="${esc(ui.done)}">${esc(ui.copyCode)}</button></div>`;
  return {
    button: `<button class="am-btn am-btn--update" type="button" data-am="update" popovertarget="am-update" aria-label="${esc(plain)}" hidden>● <span class="am-update-text">${fill(t.button)}</span></button>\n`,
    popover: `<div class="am-update" id="am-update" popover>
<p class="am-update-title">${fill(t.button)}</p>
<p>${fill(t.current)}</p>
${notes}<p class="am-update-label">${esc(t.run)}</p>
${row(update.command, true)}
<p class="am-update-label">${esc(t.agent)}</p>
${row(t.agentText, false)}
<a href="https://github.com/QingYunA/answer-me-with-html/releases" target="_blank" rel="noopener">${esc(t.notes)}</a>
</div>
`,
  };
}

// The page without its new-version button and popover, for a reader on another device (src/serve.js): the notice is for the person
// who made the page. Both come before the body, so the first match is the one updateNotice wrote.
export function withoutUpdateNotice(html) {
  return html
    .replace(/<button class="am-btn am-btn--update"[^]*?<\/button>\n/, '')
    .replace(/<div class="am-update" id="am-update" popover>[^]*?\n<\/div>\n/, '');
}

// A diagram with change markers carries a count row; only then the page needs the delta styles and script.
export const hasDelta = (html) => html.includes('class="am-delta-bar"');

// A chart (src/components/chart.js) needs its own styles, as a formula needs the math ones.
export const hasChart = (html) => html.includes('class="am-diagram am-chart"');

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

// Seconds the page waits before it closes its tab; the page shows the countdown (src/runtime/close-after-reply.js).
const CLOSE_AFTER_SECONDS = 3;

// The toolbar's text-size buttons. They carry the range from SCALE and start hidden: the runtime reads the numbers off them and
// reveals them, so a reader without JavaScript gets no button that cannot do anything.
function scaleButtons(ui) {
  const range = `data-min="${SCALE.min}" data-max="${SCALE.max}" data-step="${SCALE.step}"`;
  const button = (action, label, text) =>
    `<button class="am-btn" type="button" data-am="${action}" ${range} aria-label="${esc(label)}" title="${esc(label)}" hidden>${text}</button>`;
  return `${button('scale-down', ui.scale.down, 'A−')}${button('scale-up', ui.scale.up, 'A+')}`;
}

function shell({ meta, language, body, source, embedded, update, closeAfter, scale }) {
  const { ui, labelKey } = language;
  const notice = updateNotice(ui, update, labelKey);
  const pick = (name, label, values, current) => `<label class="am-pick">${esc(label)}<select data-am="${name}">${values
    .map(([value, text]) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const root = { lang: language.htmlLang, dir: language.dir, theme: meta.theme, mode: meta.mode, style: meta.style, scale };
  // The one inline script, as the browser reads it: the policy pins a hash of exactly this text.
  const script = `\n${RUNTIME_JS}${hasDelta(body) ? DELTA_JS : ''}${update ? UPDATE_JS : ''}${closeAfter ? CLOSE_AFTER_JS : ''}`;
  return `<!doctype html>
${rootTag(root)}
<head>
<meta charset="utf-8">
${cspMeta([script], { live: true })}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss(embedded, { diff: body.includes('class="am-codeblock am-codeblock--diff"'), delta: hasDelta(body), rtl: language.dir === 'rtl', math: hasMath(body), chart: hasChart(body), update: Boolean(update), closeAfter, theme: meta.theme, scale })}
</style>
</head>
<body>
<div class="am-toolbar"${rootCarrierAttrs(root)}>
${notice.button}${pick('theme', ui.theme, embedded.map((t) => [t.name, t.label[labelKey]]), meta.theme)}
${pick('mode', ui.modeLabel, Object.entries(ui.mode), meta.mode)}
${scaleButtons(ui)}
<button class="am-btn am-btn--reply" type="button" data-am="reply" data-ui="${esc(JSON.stringify({ ...ui.reply, done: ui.done, remarks: ui.remark.section, kinds: ui.remark.kinds, ...(closeAfter ? { closeAfter: { seconds: CLOSE_AFTER_SECONDS, ...ui.closeAfter } } : {}) }))}">${esc(ui.reply.button)}</button>
<button class="am-btn am-btn--remark" type="button" data-am="remark" data-ui="${esc(JSON.stringify(ui.remark))}">${esc(ui.remark.button)}</button>
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${notice.popover}${withColophon(body, language)}
${lightboxShell(ui, body.includes('class="am-diagram'))}${sourceTag(source)}
<script>${script}</script>
</body>
</html>
`;
}
