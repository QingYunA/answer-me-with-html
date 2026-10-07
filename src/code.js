// Code blocks: any fence that is not a component. ```ts src=path lines=a-b reads real code from a file, so the model does not type it.
// The page shows a header (title, or path:lines, and the language), optional line numbers, highlighted lines and a copy button.
// The page keeps the path and lines in data-am-src / data-am-lines; `am patch` reads the code back when the file has moved.

import { readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseAttrs } from './parse.js';
import { esc } from './svg/text.js';
import { unescapeHtml } from './page.js';

export const MAX_CODE_LINES = 200;
// Longer than this, readers skim past the block; the render warns but still writes the page.
export const LONG_CODE_LINES = 40;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const KEYS = new Set(['src', 'lines', 'hl', 'title', 'start']);

export const CODE_EXAMPLE = '```ts src=server/routes.ts lines=18-30 hl=22\n```';

// The secret rules follow html-plan's pack.mjs (anthropics/claude-plugins-community), so both tools refuse the same files.
// Files that hold keys, passwords or private data by convention. Example and template env files are fine.
const SECRET_FILE = new RegExp([
  '^\\.env(?!\\.(?:example|sample|template)$)(?:\\..*)?$',
  '^(?:\\.netrc|\\.npmrc|\\.yarnrc(?:\\.yml)?|\\.pypirc|\\.pgpass|\\.my\\.cnf|\\.git-credentials|\\.htpasswd)$',
  '^(?:id_(?:rsa|dsa|ecdsa|ed25519).*|credentials.*|secrets?(?:\\..*)?|.*_history|.*\\.local\\.json)$',
  '\\.(?:pem|key|p12|pfx|keystore|jks|tfvars|tfstate(?:\\.backup)?|sqlite3?|db|kdbx|ovpn)$',
].join('|'), 'i');
// Folders that hold keys, logins or a repository's internals; nothing inside them is quoted.
const SECRET_DIR = new Set(['.git', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.password-store']);
// Text that looks like a private key, a token or a password. A file with one anywhere is not quoted at all.
const SECRET_TEXT = /sk-ant-|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][^"'\s$<{]{12,}["']/i;

export class CodeError extends Error {
  constructor(message, line = 0) {
    super(message);
    this.name = 'CodeError';
    this.line = line;
  }
}

// "18-30" → { from: 18, to: 30 }, "18" → { from: 18, to: 18 }.
function parseRange(value, name) {
  const m = String(value).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) throw new CodeError(`${name}="${value}" is not a line range; write ${name}=18-30 or ${name}=18`);
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (from < 1 || to < from) throw new CodeError(`${name}="${value}": the first line must be 1 or more and not after the last line`);
  return { from, to };
}

// "4-5,9" → Set {4, 5, 9}.
function parseHighlight(value) {
  const set = new Set();
  for (const part of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
    const { from, to } = parseRange(part, 'hl');
    for (let n = from; n <= to; n++) set.add(n);
  }
  return set;
}

export function parseCodeArgs(args) {
  const attrs = parseAttrs(args);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== true && !KEYS.has(key)) throw new CodeError(`unknown code block setting "${key}"; use ${[...KEYS].join(', ')}`);
  }
  const text = (key) => (typeof attrs[key] === 'string' || typeof attrs[key] === 'number' ? String(attrs[key]) : undefined);
  return { src: text('src'), lines: text('lines'), hl: text('hl'), title: text('title'), start: text('start') };
}

// The file under baseDir, or null when the path leaves it. Only the folder the agent works in is quoted, so a draft
// (or a page someone sent, rendered again by am patch) cannot pull other files from the machine into a page.
function localPath(ref, baseDir) {
  const path = resolve(baseDir, ref);
  const rel = relative(baseDir, path);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : path;
}

// The lines the block quotes, from the file. null when the file does not exist or is outside baseDir.
function readSlice(ref, range, baseDir) {
  const path = localPath(ref, baseDir);
  if (!path) return null;
  if (SECRET_FILE.test(basename(path)) || relative(baseDir, path).split(sep).some((part) => SECRET_DIR.has(part))) {
    throw new CodeError(`"${ref}" is a file that holds keys or passwords by convention; it is not embedded. Write a sketch instead`);
  }
  let size;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new CodeError(`"${ref}" is not a file`);
    size = stat.size;
  } catch (err) {
    if (err instanceof CodeError) throw err;
    return null;
  }
  if (size > MAX_FILE_BYTES) throw new CodeError(`"${ref}" is ${(size / 1048576).toFixed(1)} MB; code files up to ${MAX_FILE_BYTES / 1048576} MB are read`);
  const buf = readFileSync(path);
  if (buf.includes(0)) throw new CodeError(`"${ref}" is a binary file, not code`);
  if (SECRET_TEXT.test(buf.toString('utf8'))) throw new CodeError(`"${ref}" looks like it holds a key or a token somewhere in the file; no part of it is embedded. Write a sketch instead`);
  const all = buf.toString('utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const from = range?.from ?? 1;
  const to = range?.to ?? all.length;
  if (to > all.length) throw new CodeError(`"${ref}" has ${all.length} lines; lines=${range.from}-${range.to} goes past the end`);
  return all.slice(from - 1, to);
}

// The code a page already embeds, for am patch: "path#lines" → lines of code.
const EMBEDDED_BLOCK = /<figure class="am-codeblock"[^>]*?\sdata-am-src="([^"]*)"(?:\sdata-am-lines="([^"]*)")?[^>]*>([\s\S]*?)<\/figure>/g;
const LINE_SPAN = /<span class="am-ln[^"]*"[^>]*>([\s\S]*?)<\/span>/g;

export function readEmbeddedCode(html) {
  return new Map([...String(html).matchAll(EMBEDDED_BLOCK)].map(([, src, lines = '', inner]) => [
    `${unescapeHtml(src)}#${lines}`,
    [...inner.matchAll(LINE_SPAN)].map((m) => unescapeHtml(m[1])),
  ]));
}

// block: { lang, args, text }. code: { baseDir, known } where relative src paths are read and the fallback for moved files.
// Returns { html, file, warning } where file names the embedded slice ("path:18-30"), or is null, and warning is a
// message for a long block (the page is still written).
export function renderCode({ lang, args, text }, { baseDir = process.cwd(), known = new Map(), ui = {}, copy = true } = {}) {
  const opts = parseCodeArgs(args);
  const range = opts.lines ? parseRange(opts.lines, 'lines') : null;
  if (range && !opts.src) throw new CodeError('lines= needs src=; for code you type, use start= to number the lines');
  let body;
  let first = 1;
  if (opts.src) {
    if (text.trim()) throw new CodeError('a block with src= takes its code from the file; leave the block empty');
    body = readSlice(opts.src, range, baseDir) ?? known.get(`${opts.src}#${opts.lines ?? ''}`);
    if (!body) {
      const where = localPath(opts.src, baseDir) ? 'not found' : `outside the current folder ${baseDir}; only files inside it are quoted`;
      throw new CodeError(`Code file "${opts.src}" is ${where}`);
    }
    first = range?.from ?? 1;
  } else {
    body = text.split('\n');
    if (opts.start) first = parseRange(opts.start, 'start').from;
  }
  if (body.length > MAX_CODE_LINES) throw new CodeError(`the block has ${body.length} lines; quote ${MAX_CODE_LINES} lines at most, and pick the lines that make the point`);
  const slice = body.join('\n');
  if (SECRET_TEXT.test(slice)) throw new CodeError(`${opts.src ? `"${opts.src}"` : 'the block'} looks like it holds a key or a token; it is not embedded. Quote other lines or write a sketch`);

  const last = first + body.length - 1;
  const hl = opts.hl ? parseHighlight(opts.hl) : new Set();
  const outside = [...hl].find((n) => n < first || n > last);
  if (outside !== undefined) throw new CodeError(`hl=${opts.hl}: line ${outside} is not in the block (lines ${first}-${last})`);

  const shownLang = lang || (opts.src ? extname(opts.src).slice(1).toLowerCase() : '');
  const numbered = Boolean(opts.src || opts.start);
  const where = opts.src ? `${opts.src}${range ? `:${range.from === range.to ? range.from : `${range.from}-${range.to}`}` : ''}` : '';
  const title = opts.title ?? where;
  const lines = body.map((l, i) => {
    const n = first + i;
    return `<span class="am-ln${hl.has(n) ? ' am-ln--hl' : ''}"${numbered ? ` data-n="${n}"` : ''}>${esc(l)}</span>`;
  }).join('');
  const source = opts.src ? ` data-am-src="${esc(opts.src)}"${opts.lines ? ` data-am-lines="${esc(opts.lines)}"` : ''}` : '';
  const button = copy ? `<button class="am-code-copy" type="button" data-am="copy-code" data-done="${esc(ui.done ?? 'Copied ✓')}">${esc(ui.copyCode ?? 'Copy')}</button>` : '';
  const head = `<figcaption class="am-code-head"><span class="am-code-title"${opts.title && where ? ` title="${esc(where)}"` : ''}>${esc(title)}</span>${shownLang ? `<span class="am-code-lang">${esc(shownLang)}</span>` : ''}${button}</figcaption>`;
  const html = `<figure class="am-codeblock"${source}>${head}<pre class="am-code${numbered ? ' am-code--num' : ''}"><code${shownLang ? ` data-lang="${esc(shownLang)}"` : ''}>${lines}</code></pre></figure>`;
  const warning = body.length > LONG_CODE_LINES ? `the block has ${body.length} lines; readers skim past long code. Pick the 10 to ${LONG_CODE_LINES} lines that make the point` : null;
  return { html, file: where || null, warning };
}
