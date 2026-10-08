// SVG layout runs in Node without real font metrics, so widths are estimated by character class.
// Overestimating is safer than underestimating: better spare room in a node than text overflowing its border.

const CJK_RE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯　-〿]/;
const NARROW = new Set([...'iljtfrI.,:;|!\'`()[]{}']);
const WIDE = new Set([...'mwMWOQGD@%&']);

// Hiragana, katakana.
export const KANA_RE = /[\u3040-\u30ff]/;
// Japanese is detected by hiragana: Japanese sentences almost always contain hiragana particles and endings (`の`, `は`, `を`, `です`),
// while Chinese quoting foreign words has almost only katakana (e.g. `《ワンピース》`), so katakana cannot mark a text as Japanese.
const HIRAGANA_RE = /[\u3040-\u309f]/;
const HIRAGANA_SHARE = 0.05; // also recognizes short katakana-heavy Japanese titles (`TCP の3ウェイ…`)

export function isJapanese(text) {
  let hira = 0;
  let cjk = 0;
  for (const ch of String(text)) {
    if (HIRAGANA_RE.test(ch)) hira++;
    if (CJK_RE.test(ch)) cjk++;
  }
  return hira > 0 && hira / cjk >= HIRAGANA_SHARE;
}

export function isCJK(ch) {
  return CJK_RE.test(ch);
}

function charWidth(ch, mono) {
  if (isCJK(ch)) return 1;
  if (mono) return 0.6;
  if (ch === ' ') return 0.3;
  if (NARROW.has(ch)) return 0.32;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.56;
}

export function measure(str, size = 13, { mono = false } = {}) {
  let units = 0;
  for (const ch of String(str ?? '')) units += charWidth(ch, mono);
  return Math.round(units * size * 100) / 100;
}

// Split into unbreakable layout units. A unit is one Han, kana or fullwidth character, one word of a script that
// separates words with spaces, or one word of a script that writes no space at all (Thai and its neighbours, split with
// the dictionary of the language; Node ships the full ICU data). A word wider than the line falls back to graphemes, the
// smallest units a reader still sees as whole, so a combining mark never leaves its base character.
const HANGUL_SYLLABLE = /[가-힯]/;
// One layout unit per character: Han, kana, jamo, compatibility ideographs and the fullwidth blocks. That is the CJK
// class above without the Hangul syllables, which Korean writes apart with spaces (see runUnits). The ranges are taken
// from CJK_RE, so the two classes cannot drift apart.
const HAN_KANA = new RegExp(CJK_RE.source.replace(HANGUL_SYLLABLE.source.slice(1, -1), ''));
// Scripts that write no space between words, with the locale whose dictionary splits them. The writing check measures
// sentence length with the same list (src/lint/ste.js), so a "word" means the same thing in both places.
export const UNSPACED = [
  ['th', /\p{Script=Thai}/u],
  ['lo', /\p{Script=Lao}/u],
  ['km', /\p{Script=Khmer}/u],
  ['my', /\p{Script=Myanmar}/u],
];
const SEGMENTERS = new Map();

// Segmenters are cached: building one costs more than segmenting a sentence.
export function segmenter(locale, granularity) {
  const key = `${locale}:${granularity}`;
  if (!SEGMENTERS.has(key)) SEGMENTERS.set(key, new Intl.Segmenter(locale, { granularity }));
  return SEGMENTERS.get(key);
}

// The smallest units a reader sees as whole.
const graphemes = (text, locale) => [...segmenter(locale, 'grapheme').segment(text)].map((g) => g.segment);

// The words in a text whose characters are not counted one by one: whitespace-separated words in every script, and the
// words a script that writes no space between them is split into. A combining mark (an Indic vowel sign or virama,
// Arabic or Hebrew vowel points) belongs to the word it sits in. The writing check (src/lint/ste.js) and the video
// duration estimate (src/video/script.js) both count with this, so they cannot disagree about how much text a line holds.
export function countWords(text) {
  const unspaced = UNSPACED.find(([, re]) => re.test(text));
  return unspaced
    ? [...segmenter(unspaced[0], 'word').segment(text)].filter((s) => s.isWordLike).length
    : text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)?.length ?? 0;
}

// Words of a script that writes none of them apart. Punctuation stays with the word it follows, so a line never starts with a lone full stop.
function words(text, locale) {
  const out = [];
  for (const s of segmenter(locale, 'word').segment(text)) {
    if (out.length && !s.isWordLike) out[out.length - 1] += s.segment;
    else out.push(s.segment);
  }
  return out;
}

// One run of characters with no space in it.
function runUnits(run, maxWidth, size, opts) {
  const unspaced = UNSPACED.find(([, re]) => re.test(run));
  if (unspaced) {
    const [locale] = unspaced;
    return words(run, locale).flatMap((w) => (measure(w, size, opts) > maxWidth ? graphemes(w, locale) : [w]));
  }
  // Korean writes spaces between words, so a word stays whole unless the line cannot hold it.
  return HANGUL_SYLLABLE.test(run) && measure(run, size, opts) > maxWidth ? graphemes(run, 'ko') : [run];
}

function tokenize(str, maxWidth, size, opts) {
  const chars = [...String(str)];
  const out = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (HAN_KANA.test(ch)) {
      out.push(ch);
      i++;
    } else if (/\s/u.test(ch)) {
      let j = i;
      while (j < chars.length && /\s/u.test(chars[j])) j++;
      out.push(chars.slice(i, j).join(''));
      i = j;
    } else {
      let j = i;
      while (j < chars.length && !/\s/u.test(chars[j]) && !HAN_KANA.test(chars[j])) j++;
      out.push(...runUnits(chars.slice(i, j).join(''), maxWidth, size, opts));
      i = j;
    }
  }
  return out;
}

export function wrap(str, maxWidth, size = 13, opts = {}) {
  const lines = [];
  let line = '';
  for (const tok of tokenize(str, maxWidth, size, opts)) {
    if (/^\s+$/.test(tok)) {
      if (line) line += ' ';
      continue;
    }
    const candidate = line + tok;
    if (line.trim() && measure(candidate, size, opts) > maxWidth) {
      lines.push(line.trimEnd());
      line = tok;
    } else {
      line = candidate;
    }
  }
  lines.push(line.trimEnd());
  return lines;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}
