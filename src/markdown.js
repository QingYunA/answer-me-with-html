// Markdown → HTML (GFM). Four extras: tables get a horizontally scrolling wrapper; status words in cells render as badges; an image on its own line becomes a captioned figure; an inline tag that is not a text-level element reads as text.

import { Marked } from 'marked';
import { esc } from './svg/text.js';

const marked = new Marked({ gfm: true });

// A draft is prose, so an inline tag stays raw only when it is a text-level element: those cannot change the page's
// structure, its styling or its one-file, offline promise. Every other inline tag becomes text.
// A draft writes placeholders inside a sentence ("ssh user@<host>", "grep <pid>"). Emitted raw, the browser reads them
// as unknown empty elements, so the words the author wrote disappear from the page; a raw <script> or <style> would
// break the page itself. Raw markup belongs in an html / svg fence, which this never touches. A tag alone on its line
// stays raw too: that is deliberate markup, in the same spirit as the fence.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark',
  'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
const TAG_NAME = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/;

// Comments and declarations do not name a tag, so they pass through: they show nothing either way.
function inlineTag(text) {
  const name = text.match(TAG_NAME)?.[2].toLowerCase();
  return name && !INLINE_TAGS.has(name) ? esc(text) : text;
}

marked.use({ renderer: { html: (token) => (token.block ? token.text : inlineTag(token.text)) } });

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
  return marked.parseInline(String(text ?? ''));
}
