// Diff blocks: ```diff file=src/code.js holds a unified diff the model pastes; the CLI draws it with red and green lines and two gutters.
// parseDiff reads the text into rows, diffRowsHtml draws them. Rows keep the text as written, so Copy gives the diff back.

import { esc } from './svg/text.js';

// line: the line in the block, from 1. src/code.js turns it into a CodeError with DIFF_EXAMPLE.
export class DiffError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'DiffError';
    this.line = line;
  }
}

export const DIFF_EXAMPLE = '```diff file=src/code.js\n@@ -60,3 +60,3 @@\n export function parseCodeArgs(args) {\n-  const attrs = parseAttrs(args);\n+  const attrs = parseAttrs(args, { diff: true });\n   const opts = {};\n```';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
// Lines of a git header that are not drawn. "---" / "+++" need the pair test below, because "--- x" can also be a removed line.
const GIT_HEAD = /^(?:diff --git |index |new file mode |deleted file mode |old mode |new mode |similarity index |rename (?:from|to) )/;
const ELLIPSIS = /^ ?(?:…|\.\.\.)\s*$/;
const KIND = { '+': 'add', '-': 'del', ' ': 'ctx' };

// "+++ b/src/code.js\t2024-01-01" → "src/code.js"; /dev/null names no file.
const headPath = (line) => {
  const path = line.slice(4).split('\t')[0].trim().replace(/^[ab]\//, '');
  return path === '/dev/null' ? '' : path;
};

// text: the block body; start: the number the first line gets when there is no @@ header (or undefined).
// Returns { rows: [{ kind, text, o, n }], title, add, del, numbered, newLines, warnings }. kind is add, del, ctx, hunk or meta (not drawn).
export function parseDiff(text, start) {
  const lines = text.split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const numbered = start !== undefined || lines.some((l) => HUNK.test(l));
  const rows = [];
  const warnings = [];
  const newLines = new Set();
  let title = '';
  let from = '';
  let o = start ?? 1;
  let n = start ?? 1;
  let hunk = null;
  let started = false;
  const closeHunk = () => {
    if (hunk && (hunk.got.o !== hunk.want.o || hunk.got.n !== hunk.want.n)) {
      warnings.push({ rule: 'diff-counts', message: `the hunk "${hunk.header}" has ${hunk.got.o} old and ${hunk.got.n} new lines, but its header says ${hunk.want.o} and ${hunk.want.n}. Fix the numbers in the @@ line, or add the missing lines` });
    }
    hunk = null;
  };
  // Between files, or before the first line of a hunk, "---" and "+++" are the file header; inside a hunk they are removed and added lines.
  const preamble = () => (!hunk && !started) || (hunk && hunk.got.o >= hunk.want.o && hunk.got.n >= hunk.want.n);
  lines.forEach((line, i) => {
    const fail = (message) => { throw new DiffError(message, i + 1); };
    const meta = () => rows.push({ kind: 'meta', text: line });
    if (line.startsWith('diff --git ')) { closeHunk(); started = false; from = ''; return meta(); }
    if (GIT_HEAD.test(line) || line.startsWith('\\')) return meta();
    if (preamble() && line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) { from = headPath(line); return meta(); }
    if (preamble() && line.startsWith('+++ ') && rows[rows.length - 1]?.text.startsWith('--- ')) {
      title ||= headPath(line) || from;
      return meta();
    }
    const m = line.match(HUNK);
    if (m) {
      closeHunk();
      o = Number(m[1]);
      n = Number(m[3]);
      hunk = { header: m[0], want: { o: m[2] === undefined ? 1 : Number(m[2]), n: m[4] === undefined ? 1 : Number(m[4]) }, got: { o: 0, n: 0 } };
      return rows.push({ kind: 'hunk', text: line });
    }
    if (line.startsWith('@@')) fail(`line ${i + 1} is not a hunk header; write it as @@ -60,4 +60,5 @@ (old start and count, new start and count)`);
    if (ELLIPSIS.test(line)) fail(`line ${i + 1} stands for cut lines: the gutter cannot know how many lines were skipped. Split the diff into two hunks, each with its own @@ header`);
    if (!rows.length && line === '') return;
    const kind = line === '' ? 'ctx' : KIND[line[0]];
    if (!kind) fail(`line ${i + 1} is not a diff line ("${line.length > 40 ? `${line.slice(0, 40)}…` : line}"); start it with +, -, a space or @@. A line of code that did not change starts with a space`);
    started = true;
    const row = { kind, text: line };
    if (kind !== 'add') { row.o = o++; if (hunk) hunk.got.o++; }
    if (kind !== 'del') { row.n = n; newLines.add(n++); if (hunk) hunk.got.n++; }
    rows.push(row);
  });
  closeHunk();
  const count = (kind) => rows.filter((r) => r.kind === kind).length;
  return { rows, title, add: count('add'), del: count('del'), numbered, newLines, warnings };
}

// One span per row; data-o / data-n hold the old and new number (the gutters are drawn by CSS), hl: the new-side numbers to mark.
export function diffRowsHtml({ rows, numbered }, hl) {
  return rows.map((r) => {
    const marked = r.n !== undefined && hl.has(r.n) ? ' am-ln--hl' : '';
    const nums = numbered ? `${r.o === undefined ? '' : ` data-o="${r.o}"`}${r.n === undefined ? '' : ` data-n="${r.n}"`}` : '';
    return `<span class="am-ln am-ln--${r.kind}${marked}"${nums}>${esc(r.text)}</span>`;
  }).join('');
}
