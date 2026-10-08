// Text direction inside a right-to-left page. A run of text with no right-to-left letter (a path, a key, an English phrase) still takes the
// page direction, so its neutral characters land on the wrong side: `src/` shows as `/src` and `1234-abcd.example.com` splits into
// `abcd.example.com-1234`. Such a run is isolated as left to right. A run that holds any Hebrew or
// Arabic letter keeps the page direction: there the neutrals belong to the right-to-left sentence.

import { RTL_LETTER } from './runtime/rtl-letter.js';

const LETTER = /\p{L}/u;

// True for text with a letter of a left-to-right script and no right-to-left letter. Digits and punctuation alone are not a run:
// numbers keep their order in right-to-left text by themselves.
export function isLtrOnly(text) {
  const s = decode(text);
  return !RTL_LETTER.test(s) && [...s].some((ch) => LETTER.test(ch));
}

// True for text with a right-to-left letter.
export const hasRtl = (text) => RTL_LETTER.test(decode(text));

const decode = (text) => String(text ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]).replace(/&[#\w]+;/g, ' ');
// Punctuation or a symbol: a character whose place depends on the direction around it. A run without one (a word, a name) shows the
// same in either direction and needs no isolate.
const NEUTRAL = /[\p{P}\p{S}]/u;
// A Hebrew prefix joined to a foreign word with a hyphen (the prefix "l-" in front of "staging"): a browser may break the line after
// the hyphen and leave the prefix alone at the end of a line. A word joiner (U+2060, invisible) after the hyphen keeps the two together.
const WJ = String.fromCharCode(0x2060);
const PREFIX = /((?:^|[\s(])\p{Script=Hebrew}{1,3}-)(?=[^\s-])/gu;
// A number with a sign in front ("-5", "+2", "~11", the sign of a change count) at the start of a word. In right-to-left text the sign
// would show on the right of the digits; isolated, it stays on their left the way numbers are always written.
const SIGNED = /(^|[\s(])([+\-−±~]\d[\d.,]*%?)/g;

// One line of svg text. A left-to-right-only line is wrapped in a left-to-right isolate (U+2066 … U+2069), so a wrapped label such as
// `src/` on its own line reads `src/`. The marks take no space and are not drawn. A line with a Hebrew letter keeps the page direction:
// in "lint: בדיקה" the colon belongs to the Hebrew sentence and shows on the left of "lint", read right after it.
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

export function svgLine(line, dir) {
  if (dir !== 'rtl') return line;
  return isLtrOnly(line) ? `${LRI}${line}${PDI}` : line;
}

// Tags that stay inside a run of text: a run with one of them is still one piece of a sentence.
const INLINE = new Set(['a', 'abbr', 'b', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'strong', 'sub', 'sup', 'u', 'var']);
// Elements whose content is not page text: skipped whole.
const SKIP = new Set(['svg', 'pre', 'script', 'style', 'textarea', 'select', 'option', 'title']);
// A tag ends at the first `>` outside a quoted attribute value, so `<span title="a > b">` is one tag, not a tag followed by the text ` b">`.
const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;

// Every run of text in a right-to-left page's html that has no right-to-left letter and holds punctuation gets <bdi dir="ltr">…</bdi>
// (a bdi, so no style written for a span applies to it). A run is the text
// and inline tags between two other tags (a table cell, a list item, a tree label, a meta value). Inline formatting inside the run
// must open and close within it, or the run is left as it is.
export function isolateLtrRuns(html) {
  const out = [];
  let run = [];
  let skip = null;
  let depth = 0;
  const flush = () => {
    if (!run.length) return;
    const text = run.filter((t) => !t.startsWith('<')).join('');
    const tags = run.filter((t) => t.startsWith('<') && !t.startsWith('<!--'));
    const balanced = tags.filter((t) => !t.startsWith('</')).length === tags.filter((t) => t.startsWith('</')).length;
    const first = run.findIndex((t) => t.trim());
    const last = run.length - 1 - [...run].reverse().findIndex((t) => t.trim());
    if (balanced && isLtrOnly(text) && NEUTRAL.test(decode(text).trim())) {
      out.push(...run.slice(0, first), '<bdi dir="ltr">', ...run.slice(first, last + 1), '</bdi>', ...run.slice(last + 1));
    } else {
      let code = 0;
      const fixed = run.map((t) => {
        if (/^<code(?=[ >])/i.test(t)) code++;
        else if (/^<\/code>/i.test(t)) code--;
        return t.startsWith('<') || code > 0 ? t : t.replace(SIGNED, '$1<bdi dir="ltr">$2</bdi>').replace(PREFIX, `$1${WJ}`);
      });
      out.push(...fixed);
    }
    run = [];
  };
  for (const m of String(html).matchAll(TOKEN)) {
    const tok = m[0];
    const name = m[1]?.toLowerCase();
    if (skip) {
      out.push(tok);
      if (name === skip) depth += tok.startsWith('</') ? -1 : (tok.endsWith('/>') ? 0 : 1);
      if (depth === 0) skip = null;
      continue;
    }
    if (name && SKIP.has(name) && !tok.startsWith('</')) {
      flush();
      out.push(tok);
      if (!tok.endsWith('/>')) {
        skip = name;
        depth = 1;
      }
      continue;
    }
    if (!name || INLINE.has(name)) {
      run.push(tok);
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();
  return out.join('');
}
