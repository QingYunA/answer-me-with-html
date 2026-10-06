// The one place that decides the language of a draft and what follows from it.
// Everything else (page, video, labels, fonts, writing check, narration) reads the result of resolveLanguage and never decides itself.
//
// Order: the language the draft declares, then detection from the text. A declared tag is not rewritten:
// `zh-tw` becomes `zh-TW` and is written as such. A bare `zh` keeps the `zh-CN` it has always been written as.
import { isCJK, isJapanese } from './svg/text.js';
import { FALLBACK, findLanguage } from './languages/registry.js';

// Share of CJK characters below which a draft counts as English (a third of the Latin letters).
const CJK_PER_LATIN = 3;

// The language of a draft that does not declare one: 'en', 'ja' or 'zh'.
export function detectLang(text) {
  let cjk = 0;
  let latin = 0;
  for (const ch of String(text)) {
    if (isCJK(ch)) cjk++;
    else if (/[a-z]/i.test(ch)) latin++;
  }
  if (cjk * CJK_PER_LATIN < latin) return 'en';
  return isJapanese(text) ? 'ja' : 'zh';
}

// A declared value as a canonical BCP 47 tag (`zh_tw` -> `zh-TW`), or null when it is empty, undetermined or malformed.
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

// Node 20 has the `textInfo` property, newer versions the `getTextInfo()` method.
function directionOf(locale) {
  const info = typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : locale.textInfo;
  return info?.direction === 'rtl' ? 'rtl' : 'ltr';
}

// declared: the `lang` the draft states (any value, usually a string); text: the draft, for detection.
// Returns { tag, htmlLang, script, dir, supported, labelKey, ui, videoUi }:
//   htmlLang  the <html lang> value; supported  whether the language has its own labels;
//   labelKey  the key theme label objects use; ui / videoUi  the page and player labels (English when not supported).
export function resolveLanguage({ declared, text = '' }) {
  const tag = canonicalTag(declared) ?? detectLang(text);
  // maximize() adds the likely script (zh-TW -> zh-Hant-TW), which picks the label set. It is never applied to an undetermined tag.
  const locale = new Intl.Locale(tag).maximize();
  const entry = findLanguage(locale.language, locale.script);
  const labels = entry ?? FALLBACK;
  return Object.freeze({
    tag,
    htmlLang: tag === 'zh' ? 'zh-CN' : tag,
    script: locale.script,
    dir: directionOf(locale),
    supported: Boolean(entry),
    labelKey: labels.id,
    ui: labels.ui,
    videoUi: labels.videoUi,
  });
}
