// Draft parsing: frontmatter → meta; `## ` headings → panels (slots); panel bodies → markdown blocks and fenced blocks.
// Structure splitting only, no rendering. All line numbers are 1-based source-file lines, for error messages and the STE lint.

import { themeNames, AUTO } from './themes/registry.js';

export class ParseError extends Error {
  constructor(message, line, example) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
    this.example = example;
  }
}

// Several problems of one draft, found in one run and sorted by line. Each item is a ParseError or a RenderError, printed one by one
// (reportError in src/cli.js). A draft with a single problem throws that problem itself (raiseAll).
export class DraftErrors extends Error {
  constructor(errors) {
    super(`${errors.length} errors in the draft`);
    this.name = 'DraftErrors';
    this.errors = [...errors].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
}

// Throw nothing for no errors, the error itself for one, and DraftErrors for several.
export function raiseAll(errors) {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new DraftErrors(errors);
}

export const CHOICES = Object.freeze({
  template: ['sheet', 'doc', 'video'],
  theme: [AUTO, ...themeNames('page')],
  style: ['off', '80', 'strict'],
  mode: ['auto', 'light', 'dark'],
  outline: ['left', 'right'],
});

// Command-line arguments override draft and config settings: validates values, returns a new meta without changing the original. Keys with undefined values are ignored.
export function applyOverrides(meta, overrides, choices = CHOICES) {
  const set = Object.entries(overrides).filter(([, v]) => v !== undefined);
  for (const [key, value] of set) {
    if (choices[key] && !choices[key].includes(String(value))) {
      throw new ParseError(`Invalid ${key} value "${value}". Choose one of: ${choices[key].join(' | ')}`, 0);
    }
  }
  return { ...meta, ...Object.fromEntries(set) };
}

// Allowed voice-over values for video narration (shared by config voice and am video --voice).
export const VOICES = Object.freeze(['auto', 'elevenlabs', 'local', 'system', 'off']);

const DEFAULT_META = Object.freeze({
  template: 'sheet',
  theme: AUTO,
  style: '80',
  mode: 'auto',
  outline: 'right',
  cols: 3,
  title: '',
});

const NUMERIC_KEYS = new Set(['cols', 'span']);
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/;
const PANEL_HEADING = /^##\s+(.+?)\s*$/;
const ATTR_BLOCK = /\s*\{([^{}]*)\}\s*$/;
// A leading capital is an ID only when the title after it does not start with a lowercase letter: "## A miss goes…" and
// "## I think…" are sentences, not ID + title (#208). The lookahead also rejects a space, so \s+ cannot backtrack past it.
// The ID is one capital and up to two digits: A to Z for the first 26 panels, then P27, P28 … for the ones after (#292).
const PANEL_ID = /^([A-Z][0-9]{0,2})\s+(?![\s\p{Ll}])(.+)$/u;
const ATTR_TOKEN = /([\w-]+)(?:=("[^"]*"|'[^']*'|\S+))?/g;

// defaults: default values from the user config (e.g. theme / mode / style); values set explicitly in the draft frontmatter win.
// choices can widen the allowed values of individual keys (video drafts also allow theme: 3b1b).
export function parseDoc(source, options) {
  const { doc, errors } = parseDocLoose(source, options);
  raiseAll(errors);
  return doc;
}

// Like parseDoc, but a broken table does not stop the parse: every table error comes back in errors next to the document, so the
// caller can add what it finds later (renderDoc adds the component errors). Other errors still throw at once, since nothing
// sensible follows them (frontmatter, an unclosed fence, a duplicate panel ID).
export function parseDocLoose(source, { defaults = {}, choices = {} } = {}) {
  const lines = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const { meta, bodyStart } = parseFrontmatter(lines, { ...DEFAULT_META, ...defaults }, { ...CHOICES, ...choices });
  const errors = [];
  const sections = splitSections(lines, bodyStart, errors);
  const intro = extractTitle(sections.intro, meta);
  const panels = assignIds(sections.panels);
  return { doc: { meta, intro, panels }, errors };
}

function parseFrontmatter(lines, base, allowed) {
  if (lines[0]?.trim() !== '---') return { meta: { ...base }, bodyStart: 0 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) throw new ParseError('frontmatter is not closed: missing the closing --- line', 1);

  const entries = {};
  for (let i = 1; i < end; i++) {
    const raw = stripLineComment(lines[i]).trim();
    if (!raw || raw.startsWith('#')) continue;
    // A key is letters of any script (a Hebrew or Chinese key such as `עודכן` shows in the meta row as written), digits, _ and -,
    // and may hold single spaces between words.
    const m = raw.match(/^([\p{L}\p{M}\p{N}_-]+(?: [\p{L}\p{M}\p{N}_-]+)*)\s*:\s*(.*)$/u);
    if (!m) throw new ParseError(`Cannot parse frontmatter line "${lines[i]}"; expected key: value`, i + 1);
    entries[m[1]] = { value: coerce(m[1], unquote(m[2])), line: i + 1 };
  }

  const meta = { ...base };
  for (const [key, { value, line }] of Object.entries(entries)) {
    const fraction = fractionalCount(key, value, line, META_COUNTS);
    if (fraction) throw fraction;
    if (allowed[key] && !allowed[key].includes(String(value))) {
      throw new ParseError(`Invalid ${key} value "${value}". Choose one of: ${allowed[key].join(' | ')}`, line);
    }
    meta[key] = allowed[key] ? String(value) : value;
  }
  return { meta, bodyStart: end + 1 };
}

function splitSections(lines, start, errors) {
  const intro = [];
  const panels = [];
  let current = { blocks: intro };
  let mdBuf = null;
  const flushMd = () => {
    if (mdBuf && mdBuf.lines.some((l) => l.trim())) {
      errors.push(...checkTables(mdBuf.lines, mdBuf.line));
      current.blocks.push({ type: 'md', text: mdBuf.lines.join('\n'), line: mdBuf.line });
    }
    mdBuf = null;
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      flushMd();
      const close = findFenceClose(lines, i, fence[1]);
      if (close === -1) throw new ParseError(`fenced block ${fence[1]}${fence[2]} is not closed`, i + 1);
      // A fence with settings but no language (```src=a.ts) has no language; its first word is a setting.
      const bare = fence[2].includes('=');
      current.blocks.push({
        type: 'fence',
        lang: bare ? '' : fence[2].toLowerCase(),
        args: (bare ? `${fence[2]} ${fence[3]}` : fence[3]).trim(),
        text: lines.slice(i + 1, close).join('\n'),
        line: i + 1,
      });
      i = close;
      continue;
    }
    const heading = line.match(PANEL_HEADING);
    if (heading) {
      flushMd();
      current = { ...parseHeading(heading[1]), heading: line.trim(), line: i + 1, blocks: [] };
      errors.push(...Object.entries(current.attrs).map(([key, value]) => fractionalCount(key, value, i + 1, PANEL_COUNTS)).filter(Boolean));
      panels.push(current);
      continue;
    }
    if (!mdBuf) mdBuf = { line: i + 1, lines: [] };
    mdBuf.lines.push(line);
  }
  flushMd();
  return { intro, panels };
}

// A pipe table needs a delimiter row (|---|---|) under its header, with as many cells as the header. Without one, GFM renders
// every row as a line of text with the pipes in it, so the page shows no table. A | splits a cell unless an odd number of
// backslashes comes before it, also inside a code span, as in GFM. A row indented four spaces or a tab is code, not a table.
const TABLE_ROW = /^(?! {4}|\t)\s*\|.*\|\s*$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cellCount(row) {
  const text = row.trim();
  const pipes = [];
  let slashes = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && slashes % 2 === 0) pipes.push(i);
    slashes = text[i] === '\\' ? slashes + 1 : 0;
  }
  // The pipes at the start and end of a row close the outer cells; they do not start new ones.
  return pipes.length + 1 - (pipes[0] === 0 ? 1 : 0) - (pipes.at(-1) === text.length - 1 ? 1 : 0);
}

// Lines inside an HTML block are raw HTML, not Markdown, as CommonMark reads them: a <pre>, <script>, <style> or <textarea>
// block runs to its closing tag; any other tag at the start of a line runs to the next blank line.
const RAW_HTML_BLOCK = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i;
const HTML_BLOCK = /^ {0,3}<\/?[A-Za-z][\w-]*(?=[\s/>]|$)/;

function htmlLines(lines) {
  let close = null;
  return lines.map((line) => {
    if (close) {
      if (close.test(line)) close = null;
      return true;
    }
    const raw = line.match(RAW_HTML_BLOCK);
    if (raw) close = new RegExp(`</${raw[1]}>`, 'i').test(line.slice(raw[0].length)) ? null : new RegExp(`</${raw[1]}>`, 'i');
    else if (HTML_BLOCK.test(line)) close = /^\s*$/;
    return Boolean(raw) || close !== null;
  });
}

// Every table problem of one Markdown block, as ParseErrors.
function checkTables(lines, first) {
  const html = htmlLines(lines);
  return lines.flatMap((header, k) => {
    const next = lines[k + 1];
    if (html[k] || !TABLE_ROW.test(header) || TABLE_ROW.test(lines[k - 1] ?? '') || next === undefined || !TABLE_ROW.test(next)) return [];
    const cells = cellCount(header);
    const delimiter = `|${'---|'.repeat(cells)}`;
    if (!DELIMITER_ROW.test(next)) {
      return [new ParseError(
        `table has no delimiter row: put ${delimiter} on the line under the header row`,
        first + k,
        [header.trim(), delimiter, next.trim()].join('\n'),
      )];
    }
    if (cellCount(next) !== cells) {
      const row = lines[k + 2];
      return [new ParseError(
        `the table header has ${cells} cells but its delimiter row has ${cellCount(next)}: write one --- per header cell`,
        first + k,
        [header.trim(), delimiter, ...(row !== undefined && TABLE_ROW.test(row) ? [row.trim()] : [])].join('\n'),
      )];
    }
    return [];
  });
}

function findFenceClose(lines, openIdx, marker) {
  const closeRe = new RegExp(`^${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
  for (let j = openIdx + 1; j < lines.length; j++) {
    if (closeRe.test(lines[j])) return j;
  }
  return -1;
}

function parseHeading(text) {
  let rest = text;
  let attrs = {};
  const attrMatch = rest.match(ATTR_BLOCK);
  if (attrMatch) {
    attrs = parseAttrs(attrMatch[1]);
    rest = rest.slice(0, attrMatch.index);
  }
  const idMatch = rest.match(PANEL_ID);
  return idMatch
    ? { id: idMatch[1], title: idMatch[2].trim(), attrs }
    : { id: null, title: rest.trim(), attrs };
}

export function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(ATTR_TOKEN)) {
    attrs[m[1]] = m[2] === undefined ? true : coerce(m[1], unquote(m[2]));
  }
  return attrs;
}

function extractTitle(intro, meta) {
  if (meta.title || intro[0]?.type !== 'md') return intro;
  const [first, ...rest] = intro;
  const lines = first.text.split('\n');
  const idx = lines.findIndex((l) => l.trim());
  const m = lines[idx]?.match(/^#\s+(.+)$/);
  if (!m) return intro;
  meta.title = m[1].trim();
  const remaining = lines.slice(idx + 1);
  if (!remaining.some((l) => l.trim())) return rest;
  return [{ ...first, text: remaining.join('\n'), line: first.line + idx + 1 }, ...rest];
}

function assignIds(panels) {
  // Explicit IDs are the DOM id of a panel, its table-of-contents anchor and its comment key, so two panels cannot share one.
  // Auto-assigned IDs skip them below; an explicit ID always wins.
  const used = new Set();
  const firstById = new Map();
  for (const panel of panels) {
    if (!panel.id) continue;
    const first = firstById.get(panel.id);
    if (first) {
      throw new ParseError(
        `Duplicate panel ID "${panel.id}": "${first.heading}" (L${first.line}) and "${panel.heading}" (L${panel.line}) both declare it. Give each panel a different explicit ID, or remove one explicit ID so the panel gets an automatic ID.`,
        panel.line,
      );
    }
    firstById.set(panel.id, panel);
    used.add(panel.id);
  }
  let code = 'A'.charCodeAt(0);
  // Past Z the ID is "P27", "P28" …, not the character the code points at, so build the ID first and test that:
  // an explicit P27 and an automatic P27 are the same ID and must collide here, not on the page (#292).
  const idAt = (c) => (c <= 90 ? String.fromCharCode(c) : `P${c - 64}`);
  const nextFree = () => {
    let id = idAt(code);
    while (used.has(id)) id = idAt(++code);
    used.add(id);
    code++;
    return id;
  };
  return panels.map((p) => (p.id ? p : { ...p, id: nextFree() }));
}

function unquote(v) {
  const s = v.trim();
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

// Strip an unquoted trailing # comment; a # inside quotes is kept (title: "Issue #123").
function stripLineComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

// A count the page writes into CSS (cols, span, rows) must be whole: repeat(2.5, …) and span 2.5 are invalid, so the browser drops
// the declaration and the layout falls apart (#308). Text, 0 and whole numbers out of range keep the fallback and clamping of the
// templates. Each count is checked only where the page reads it: cols in the frontmatter, span and rows in a panel heading (any other
// frontmatter key is shown as written in the meta line). Returns the ParseError for a fractional count, or null.
const META_COUNTS = new Set(['cols']);
const PANEL_COUNTS = new Set(['span', 'rows']);

function fractionalCount(key, value, line, keys) {
  if (!keys.has(key) || typeof value !== 'string' || !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && !Number.isInteger(n) ? new ParseError(`${key} must be a whole number, not "${value}"`, line) : null;
}

function coerce(key, value) {
  if (NUMERIC_KEYS.has(key) && /^\d+$/.test(value)) return Number(value);
  return value;
}
