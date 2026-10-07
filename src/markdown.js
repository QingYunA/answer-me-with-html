// Markdown → HTML (GFM). Four extras: tables get a horizontally scrolling wrapper; status words in cells render as badges; an image on its own line becomes a captioned figure;
// raw HTML is filtered (see raw-html.js): a placeholder such as <host> shows as text, tags that break the page are escaped, event handlers and javascript: links are removed.

import { Marked } from 'marked';
import { filterBlocks, filterInline } from './raw-html.js';

// What the raw-HTML filter changed while collectHtmlNotes is running. Rendering is synchronous, so nothing leaks between calls.
let sink = null;
const note = (at, message) => sink?.push({ at, message });

// Runs render() and returns its result with the notes about the raw HTML it changed: [{ at, message }], at being the tag as the draft wrote it.
export function collectHtmlNotes(render) {
  const outer = sink;
  const notes = [];
  sink = notes;
  try {
    return { result: render(), notes };
  } finally {
    sink = outer;
  }
}

const marked = new Marked({ gfm: true });
// parseInline reads one run of inline text and hands the hook inline tokens, so it gets its own parser.
const inline = new Marked({ gfm: true });
marked.use({ hooks: { processAllTokens: (tokens) => filterBlocks(tokens, { lex: (source) => marked.lexer(source), note }) } });
inline.use({ hooks: { processAllTokens: (tokens) => filterInline(tokens, note) } });

const STATUS = {
  ok: { cls: 'ok', icon: '✓' },
  no: { cls: 'no', icon: '✗' },
  warn: { cls: 'warn', icon: '!' },
};
const STATUS_ALIAS = { '✓': 'ok', '✔': 'ok', '✗': 'no', '✘': 'no', '⚠': 'warn' };

export function statusHtml(word, label = '') {
  const kind = STATUS[STATUS_ALIAS[word] ?? word];
  if (!kind) return null;
  const text = label.trim();
  return `<span class="am-status am-status--${kind.cls}"><span class="am-status-icon" aria-hidden="true">${kind.icon}</span>${text}</span>`;
}

// A paragraph that holds only an image becomes a figure; the alt text is its caption.
const IMAGE_ONLY = /<p>\s*(<img\b[^>]*>)\s*<\/p>/g;

// The status word must open the cell; the label after it may hold inline HTML (code, em, strong, a) but never crosses a cell boundary.
const CELL_STATUS = /<td([^>]*)>\s*(ok|no|warn|✓|✔|✗|✘|⚠)(?:\s+((?:(?!<\/?td\b)[\s\S])*?))?\s*<\/td>/g;

function figure(img) {
  const alt = img.match(/\salt="([^"]*)"/)?.[1];
  return `<figure class="am-figure">${img}${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
}

function decorate(html) {
  return html
    .replace(/<table>/g, '<div class="am-table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(IMAGE_ONLY, (_, img) => figure(img))
    .replace(CELL_STATUS, (_, attrs, word, label = '') => `<td${attrs}>${statusHtml(word, label)}</td>`);
}

// CommonMark takes a space in a link destination only inside <…>, so marked would leave ![alt](a b.png) as text. Wrap such a destination; code spans are skipped.
// A destination may hold balanced (…) such as "Screenshot (1).png".
const SPACED_IMAGE = /(`[^`\n]*`)|(!\[[^\]\n]*\]\()\s*((?:[^()<>"\n]|\([^()<>"\n]*\))*?)(\s+"[^"\n]*")?\s*\)/g;

function wrapSpacedImages(text) {
  return text.replace(SPACED_IMAGE, (whole, code, head, dest, title = '') => (code || !/\s/.test(dest) ? whole : `${head}<${dest}>${title})`));
}

export function md(text) {
  return decorate(marked.parse(wrapSpacedImages(String(text ?? ''))));
}

export function mdInline(text) {
  return inline.parseInline(wrapSpacedImages(String(text ?? '')));
}
