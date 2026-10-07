// The one place that decides the language of a draft and what follows from it.
// Everything else (page, video, labels, fonts, writing check, narration) reads the result of resolveLanguage and never decides itself.
//
// Order: the language the draft declares, then the language the page had before (when a page is patched), then detection from the text.
// A declared tag is not rewritten: `zh-tw` becomes `zh-TW` and is written as such. A bare `zh` keeps the `zh-CN` it has always been written as.
import { isCJK, isJapanese } from './svg/text.js';
import { SIMPLIFIED_ONLY, TRADITIONAL_ONLY } from './han-forms.js';
import { FALLBACK, findLanguage } from './languages/registry.js';

// Share of CJK characters below which a draft counts as English (a third of the Latin letters).
const CJK_PER_LATIN = 3;

// Scripts other than Han, kana and Hangul, with the most common language written in each. A script cannot name its language for
// sure (Arabic script also writes Persian and Urdu, Cyrillic also Ukrainian): a draft that must be exact declares its language.
const SCRIPT_LANGUAGES = [
  [/\p{Script=Thai}/u, 'th'],
  [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Greek}/u, 'el'],
  [/\p{Script=Arabic}/u, 'ar'],
  [/\p{Script=Cyrillic}/u, 'ru'],
];
const HANGUL = /\p{Script=Hangul}/u;
const SIMPLIFIED = new Set(SIMPLIFIED_ONLY);
const TRADITIONAL = new Set(TRADITIONAL_ONLY);

// Chinese text is Traditional when it has more characters written only in the Traditional form than only in the Simplified form.
// Text made of characters both forms share says nothing, and stays Simplified (the default).
function hanLanguage(text) {
  let simplified = 0;
  let traditional = 0;
  for (const ch of text) {
    if (SIMPLIFIED.has(ch)) simplified++;
    else if (TRADITIONAL.has(ch)) traditional++;
  }
  return traditional > simplified ? 'zh-Hant' : 'zh';
}

// The language tag of a draft that does not declare one. Latin script is English: other Latin-script languages need a declaration.
export function detectLang(text) {
  const draft = String(text);
  let cjk = 0;
  let hangul = 0;
  let latin = 0;
  const others = new Map();
  for (const ch of draft) {
    if (isCJK(ch)) {
      cjk++;
      if (HANGUL.test(ch)) hangul++;
    } else if (/[a-z]/i.test(ch)) {
      latin++;
    } else {
      const script = SCRIPT_LANGUAGES.find(([re]) => re.test(ch));
      if (script) others.set(script[1], (others.get(script[1]) ?? 0) + 1);
    }
  }
  const otherTotal = [...others.values()].reduce((sum, n) => sum + n, 0);
  if ((cjk + otherTotal) * CJK_PER_LATIN < latin) return 'en';
  const [topTag, topCount] = [...others].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (topCount > cjk) return topTag;
  if (hangul * 2 > cjk) return 'ko';
  return isJapanese(draft) ? 'ja' : hanLanguage(draft);
}

// A value as a canonical BCP 47 tag (`zh_tw` -> `zh-TW`), or null when it is empty, undetermined or malformed.
function canonicalTag(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/_/g, '-');
  if (!text) return null;
  try {
    const tag = Intl.getCanonicalLocales(text)[0];
    // An undetermined tag (`und`, `und-Hant`) has no language: older Node versions report 'und', newer ones undefined.
    const { language } = new Intl.Locale(tag);
    return !language || language === 'und' ? null : tag;
  } catch {
    return null;
  }
}

// The language subtag of a tag: `zh-Hant` -> `zh`.
export const baseLanguage = (tag) => new Intl.Locale(tag).language;

// Node 20 has the `textInfo` property, newer versions the `getTextInfo()` method.
function directionOf(locale) {
  const info = typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : locale.textInfo;
  return info?.direction === 'rtl' ? 'rtl' : 'ltr';
}

// declared: the `lang` the draft states (any value, usually a string); previous: the language the page had before (a patched page
// keeps it unless the draft declares one; it is not a declaration); text: the draft, for detection.
// Returns { tag, declared, htmlLang, script, dir, supported, labelKey, ui, videoUi }:
//   declared  whether the draft states its language; htmlLang  the <html lang> value; supported  whether the language has its own labels;
//   labelKey  the key theme label objects use; ui / videoUi  the page and player labels (English when not supported);
//   metaKeys  names for common frontmatter keys (author, date, ...) shown under the title; dateOrder  'ymd' or 'dmy' for the render time.
export function resolveLanguage({ declared, previous, text = '' }) {
  const declaredTag = canonicalTag(declared);
  const tag = declaredTag ?? canonicalTag(previous) ?? detectLang(text);
  // maximize() adds the likely script (zh-TW -> zh-Hant-TW), which picks the label set. It is never applied to an undetermined tag.
  const locale = new Intl.Locale(tag).maximize();
  const entry = findLanguage(locale.language, locale.script);
  const labels = entry ?? FALLBACK;
  return Object.freeze({
    tag,
    declared: declaredTag !== null,
    htmlLang: tag === 'zh' ? 'zh-CN' : tag,
    script: locale.script,
    dir: directionOf(locale),
    supported: Boolean(entry),
    labelKey: labels.id,
    ui: labels.ui,
    videoUi: labels.videoUi,
    metaKeys: labels.metaKeys ?? {},
    dateOrder: labels.dateOrder ?? 'ymd',
  });
}
