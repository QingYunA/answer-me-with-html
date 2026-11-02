// Markdown → HTML (GFM). Extras: $…$ and $$ math (math.js); tables get a horizontally scrolling wrapper and opt in to sort / filter
// with a following {table ...} line; status words in cells render as badges; an image on its own line becomes a captioned figure;
// raw HTML is filtered (see raw-html.js): a placeholder such as <host> shows as text, tags that break the page are escaped, event handlers and javascript: links are removed.

import { Marked } from 'marked';
import { filterBlocks, filterInline } from './raw-html.js';
import { mathExtension } from './math.js';
import { parseAttrs } from './attrs.js';
import { esc } from './svg/text.js';

// What the raw-HTML filter changed while collectHtmlNotes is running. Rendering is synchronous, so nothing leaks between calls.
let sink = null;
const note = (at, message) => sink?.push({ at, message });

// Whether $ starts a formula (src/math.js). A video draft turns it off: scenes have no math styles.
let mathOn = true;

// Runs render() and returns its result with the notes about the raw HTML it changed: [{ at, message }], at being the tag as the draft wrote it.
// A formula that Temml cannot read adds a note too, { at, message, math: true }, at being the formula as the draft wrote it.
export function collectHtmlNotes(render, { math = true } = {}) {
  const outer = sink;
  const outerMath = mathOn;
  const notes = [];
  sink = notes;
  mathOn = math;
  try {
    return { result: render(), notes };
  } finally {
    sink = outer;
    mathOn = outerMath;
  }
}

const marked = new Marked({ gfm: true });
// parseInline reads one run of inline text and hands the hook inline tokens, so it gets its own parser.
const inline = new Marked({ gfm: true });

const TABLE_ATTR = /^\{table\s+([^{}]*)\}$/;
let tableUi;
let tableInteractive = true;

// A {table ...} line immediately after a table configures that table. Marked reads an unseparated line as a final row;
// a line after a blank is a paragraph. parseAttrs keeps bare flags and key=value options in one syntax, so later options
// such as widths= do not need a second parser.
function tableOptions(tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.type === 'table') {
      const row = token.rows.at(-1);
      const rowMatch = row?.[0] && row.slice(1).every((cell) => !cell.text.trim()) && row[0].text.trim().match(TABLE_ATTR);
      const nextIndex = tokens.findIndex((candidate, index) => index > k && candidate.type !== 'space');
      const next = tokens[nextIndex];
      const paragraphMatch = next?.type === 'paragraph' && next.text.trim().match(TABLE_ATTR);
      const match = rowMatch || paragraphMatch;
      if (match) {
        token.amTable = parseAttrs(match[1]);
        if (rowMatch) token.rows.pop();
        else tokens.splice(nextIndex, 1);
      }
    } else if (token.type === 'list') {
      token.items.forEach((item) => tableOptions(item.tokens));
    } else if (token.type === 'blockquote') {
      tableOptions(token.tokens);
    }
  }
  return tokens;
}

marked.use({ hooks: { processAllTokens: (tokens) => filterBlocks(tableOptions(tokens), { lex: (source) => marked.lexer(source), note }) } });
inline.use({ hooks: { processAllTokens: (tokens) => filterInline(tokens, note) } });
marked.use({ extensions: [{
  name: 'table',
  renderer(token) {
    if (!tableInteractive || !token.amTable) return false;
    const flags = ['sort', 'filter'].filter((flag) => token.amTable[flag] === true);
    if (!flags.length) return false;
    const table = this.parser.renderer.table(token).replace('<table>', `<table data-am-table="${flags.join(' ')}">`);
    if (!token.amTable.filter) return table;
    const label = esc(tableUi?.filter ?? 'Filter table');
    return `<div class="am-table-controls" hidden><label class="am-table-filter"><span>${label}</span><input type="search" data-am-table-filter aria-label="${label}"></label></div>${table}`;
  },
}] });
const math = mathExtension({ enabled: () => mathOn, note: (at, message) => sink?.push({ at, message, math: true }) });
marked.use(math);
inline.use(math);

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
    .replace(/<table data-am-table=/g, '<div class="am-table-wrap"><table data-am-table=')
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

export function md(text, { ui, interactive = true } = {}) {
  const outerUi = tableUi;
  const outerInteractive = tableInteractive;
  tableUi = ui?.table;
  tableInteractive = interactive;
  try {
    return decorate(marked.parse(wrapSpacedImages(String(text ?? ''))));
  } finally {
    tableUi = outerUi;
    tableInteractive = outerInteractive;
  }
}

export function mdInline(text) {
  return inline.parseInline(wrapSpacedImages(String(text ?? '')));
}
