// Math in prose: $…$ inline and $$ display, typeset at render time by Temml (LaTeX → MathML Core). The page needs no script, font service or network.
// This file holds the Markdown syntax (a marked extension, registered in markdown.js), the rule that tells a formula from a price, and the markup.
//
// Inline $…$ follows Pandoc's rule: the opening $ has a non-space after it; the closing $ has a non-space before it and no digit after it, so
// `$5 and $10` and `$5-$10` stay text. Two more rules of ours: the content is on one line, and a closing $ with a letter (A-Z, a-z) or _ after it
// does not close, so the shell variables in `$PATH:$HOME` stay text (`$n$-th` closes; `$n$th` does not). A non-ASCII letter after the $ closes,
// so a formula between two Chinese characters works. The first unescaped $ ends the search, closing or not, and a backtick ends it too, so a code span is never part of a
// formula. \$ is a dollar sign in text and inside a formula.
// Display: a line with only $$, the TeX, then a line that ends with $$; or one line `$$ … $$`. No blank line inside. Inline `$$…$$` in a
// sentence is display math too, as in Pandoc.

import { esc } from './svg/text.js';

let temml = null;

// Gives the Temml module to the renderer (src/math-load.js loads it only for a draft with a $). Without it `$` stays plain text.
export function useTemml(lib) {
  temml = lib;
}

const SPACE = /\s/;
const NO_CLOSE_BEFORE = /[0-9A-Za-z_]/;

// The index of the closing delimiter of the formula whose n opening dollar signs start at src[at], or -1.
function closing(src, at, n) {
  if (src.length <= at + n || SPACE.test(src[at + n])) return -1;
  for (let i = at + n; i < src.length; i++) {
    const c = src[i];
    if (c === '\n' || c === '`') return -1;
    if (c === '\\') {
      i++;
      continue;
    }
    if (c !== '$') continue;
    if (i === at + n || SPACE.test(src[i - 1])) return -1;
    if (n === 2) return src[i + 1] === '$' ? i : -1;
    return NO_CLOSE_BEFORE.test(src[i + 1] ?? '') ? -1 : i;
  }
  return -1;
}

// text with its inline formulas removed (the STE check reads the words around a formula, not the TeX).
export function stripMath(text) {
  let out = '';
  let from = 0;
  for (let i = text.indexOf('$'); i !== -1; i = text.indexOf('$', i)) {
    if (i > 0 && text[i - 1] === '\\') {
      i++;
      continue;
    }
    const n = text[i + 1] === '$' ? 2 : 1;
    const end = closing(text, i, n);
    if (end < 0) {
      i++;
      continue;
    }
    out += text.slice(from, i);
    from = end + n;
    i = from;
  }
  return out + text.slice(from);
}

// True when the draft may hold a formula (code blocks are not told apart): `costs $5 and $10` does not, so such a draft never loads Temml.
export const mayHaveMath = (source) => source.includes('$') && (stripMath(source) !== source || /^ {0,3}\$\$/m.test(source));

// A line of a draft that opens a multi-line display block, and one that closes it.
export const opensDisplay = (line) => /^ {0,3}\$\$[ \t]*$/.test(line);
export const closesDisplay = (line) => /\$\$[ \t]*$/.test(line);
const ONE_LINE = /^ {0,3}\$\$((?:[^$\\\n]|\\.)+)\$\$[ \t]*(?:\n|$)/;
const OPEN = /^ {0,3}\$\$[ \t]*(?:\n|$)/;
export const isDisplayLine = (line) => ONE_LINE.test(`${line}\n`);

function displayBlock(src) {
  const one = ONE_LINE.exec(src);
  if (one) return one[1].trim() ? { raw: one[0], tex: one[1].trim() } : null;
  const open = OPEN.exec(src);
  if (!open) return null;
  const lines = [];
  let pos = open[0].length;
  while (pos < src.length) {
    const nl = src.indexOf('\n', pos);
    const end = nl < 0 ? src.length : nl;
    const line = src.slice(pos, end);
    pos = nl < 0 ? end : end + 1;
    if (!line.trim()) return null;
    if (closesDisplay(line)) {
      const last = line.replace(/\$\$[ \t]*$/, '');
      if (last.trim()) lines.push(last);
      return lines.length ? { raw: src.slice(0, pos), tex: lines.join('\n') } : null;
    }
    lines.push(line);
  }
  return null;
}

// The start of a line that holds $$ (spaces before it allowed), or undefined.
function displayStart(src) {
  for (let i = src.indexOf('$$'); i !== -1; i = src.indexOf('$$', i + 1)) {
    const from = src.lastIndexOf('\n', i - 1) + 1;
    if (i - from <= 3 && !src.slice(from, i).trim()) return from;
  }
  return undefined;
}

// Why a formula is not typeset: the Temml message without its quote of the source, which has combining marks.
const reason = (err) => String(err?.message ?? err)
  .replace(/\u0332/g, '')
  .replace(/( at position \d+): [\s\S]*$/, '$1')
  .replace(/( at end of input): [\s\S]*$/, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const preview = (raw) => {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

// \ref and \eqref link to a number that Temml's script fills in, and \label only marks the place. A page has no such script.
const NEEDS_SCRIPT = /\\(?:ref|eqref|label)(?![A-Za-z])/;

// The markup of one formula, or the raw TeX in an error style when Temml cannot read it. note(raw, message) reports a draft problem.
function typeset({ raw: padded, tex, display }, block, note) {
  const raw = padded.trim();
  const wrap = (inner) => (display ? `<${block ? 'div' : 'span'} class="am-math-block" dir="ltr">${inner}</${block ? 'div' : 'span'}>` : inner);
  try {
    const html = temml.renderToString(tex, { displayMode: display, throwOnError: true, ...(display ? {} : { wrap: 'tex' }) });
    if (NEEDS_SCRIPT.test(tex)) note(raw, `${preview(raw)} uses \\ref, \\eqref or \\label; a page has no script to resolve them, so they show nothing. Write a number with \\tag{1} in a $$ block`);
    // dir="ltr" keeps a formula left to right on a right-to-left page. data-am-tex is the formula as the draft wrote it, delimiters included:
    // MathML has no plain text, so a Remark or a Reply quotes this instead (src/runtime/math-text.js). A function, because the TeX holds `$`.
    return wrap(html.replace('<math', () => `<math dir="ltr" data-am-tex="${esc(raw)}"`));
  } catch (err) {
    const message = reason(err);
    note(raw, `${preview(raw)} is shown as raw TeX: ${message}`);
    return wrap(`<span class="am-math-error" title="${esc(message)}">${esc(raw.trim())}</span>`);
  }
}

// True when the page html holds a formula or the error style of one: the page then carries the math styles and the font.
export const hasMath = (html) => html.includes('<math dir="ltr"') || html.includes('class="am-math-error"');

// A marked extension. enabled(): false leaves $ as text (a video draft); note(raw, message): where draft problems go.
export function mathExtension({ enabled, note }) {
  const ready = () => temml !== null && enabled();
  return {
    extensions: [
      {
        name: 'mathInline',
        level: 'inline',
        start: (src) => {
          const i = src.indexOf('$');
          return i < 0 ? undefined : i;
        },
        tokenizer(src) {
          if (src[0] !== '$' || !ready()) return undefined;
          const n = src[1] === '$' ? 2 : 1;
          const end = closing(src, 0, n);
          return end < 0 ? undefined : { type: 'mathInline', raw: src.slice(0, end + n), tex: src.slice(n, end), display: n === 2 };
        },
        renderer: (token) => typeset(token, false, note),
      },
      {
        name: 'mathBlock',
        level: 'block',
        start: displayStart,
        tokenizer(src) {
          if (!/^ {0,3}\$\$/.test(src) || !ready()) return undefined;
          const found = displayBlock(src);
          return found && { type: 'mathBlock', raw: found.raw, tex: found.tex, display: true };
        },
        renderer: (token) => `${typeset(token, true, note)}\n`,
      },
    ],
  };
}
