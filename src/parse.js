// Draft parsing: frontmatter → meta; `## ` headings → panels (slots); panel bodies → markdown blocks and fenced blocks.
// Structure splitting only, no rendering. All line numbers are 1-based source-file lines, for error messages and the STE lint.

import { themeNames, AUTO } from './themes/registry.js';

export class ParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
  }
}

export const CHOICES = Object.freeze({
  template: ['sheet', 'doc', 'video'],
  theme: [AUTO, ...themeNames('page')],
  style: ['off', '80', 'strict'],
  mode: ['auto', 'light', 'dark'],
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
  cols: 3,
  title: '',
});

const NUMERIC_KEYS = new Set(['cols', 'span']);
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/;
const PANEL_HEADING = /^##\s+(.+?)\s*$/;
const ATTR_BLOCK = /\s*\{([^{}]*)\}\s*$/;
const PANEL_ID = /^([A-Z][0-9]?)\s+(.+)$/;
const ATTR_TOKEN = /([\w-]+)(?:=("[^"]*"|'[^']*'|\S+))?/g;

// defaults: default values from the user config (e.g. theme / mode / style); values set explicitly in the draft frontmatter win.
// choices can widen the allowed values of individual keys (video drafts also allow theme: 3b1b).
export function parseDoc(source, { defaults = {}, choices = {} } = {}) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const { meta, bodyStart } = parseFrontmatter(lines, { ...DEFAULT_META, ...defaults }, { ...CHOICES, ...choices });
  const sections = splitSections(lines, bodyStart);
  const intro = extractTitle(sections.intro, meta);
  const panels = assignIds(sections.panels);
  return { meta, intro, panels };
}

function parseFrontmatter(lines, base, allowed) {
  if (lines[0]?.trim() !== '---') return { meta: { ...base }, bodyStart: 0 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) throw new ParseError('frontmatter is not closed: missing the closing --- line', 1);

  const entries = {};
  for (let i = 1; i < end; i++) {
    const raw = stripLineComment(lines[i]).trim();
    if (!raw || raw.startsWith('#')) continue;
    const m = raw.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) throw new ParseError(`Cannot parse frontmatter line "${lines[i]}"; expected key: value`, i + 1);
    entries[m[1]] = { value: coerce(m[1], unquote(m[2])), line: i + 1 };
  }

  const meta = { ...base };
  for (const [key, { value, line }] of Object.entries(entries)) {
    if (allowed[key] && !allowed[key].includes(String(value))) {
      throw new ParseError(`Invalid ${key} value "${value}". Choose one of: ${allowed[key].join(' | ')}`, line);
    }
    meta[key] = allowed[key] ? String(value) : value;
  }
  return { meta, bodyStart: end + 1 };
}

function splitSections(lines, start) {
  const intro = [];
  const panels = [];
  let current = { blocks: intro };
  let mdBuf = null;
  const flushMd = () => {
    if (mdBuf && mdBuf.lines.some((l) => l.trim())) {
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
      current = { ...parseHeading(heading[1]), line: i + 1, blocks: [] };
      panels.push(current);
      continue;
    }
    if (!mdBuf) mdBuf = { line: i + 1, lines: [] };
    mdBuf.lines.push(line);
  }
  flushMd();
  return { intro, panels };
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
  const used = new Set(panels.map((p) => p.id).filter(Boolean));
  let code = 'A'.charCodeAt(0);
  const nextFree = () => {
    while (used.has(String.fromCharCode(code))) code++;
    const id = code <= 90 ? String.fromCharCode(code) : `P${code - 64}`;
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

function coerce(key, value) {
  if (NUMERIC_KEYS.has(key) && /^\d+$/.test(value)) return Number(value);
  return value;
}
