// The fully supported languages. A language is one file in this directory, listed here (themes work the same way).
// A file names its language subtag and, when the language has several scripts, the script it covers
// (Simplified Chinese covers Hans, Traditional Chinese covers Hant). The label sets in the file are the ones the
// page and the video player show. A language that needs its own fonts also lists the :lang() ranges they apply to (`langs`) and the
// fonts (`fonts.sans`; `fonts.serif` is the CJK part of a serif stack).
// `voice` names the narration voices of the language, for the system voices whose names do not follow from the tag:
// `say` is the macOS locale to look for (`zh_TW`, so Traditional Chinese is read by a Taiwan voice), `espeak` the
// espeak-ng voice (`cmn` for Chinese, which espeak-ng lists instead of `zh`). A language without a file has no hint.
import zh from './zh.js';
import zhHant from './zh-Hant.js';
import en from './en.js';
import ja from './ja.js';
import he from './he.js';

// The order is the key order of the label objects that theme files carry.
export const LANGUAGES = Object.freeze([zh, zhHant, en, ja, he]);

// What a language without its own file shows: English labels.
export const FALLBACK = en;

export const languageIds = () => LANGUAGES.map((l) => l.id);

// The entry covering a language and script (script omitted by an entry means any script), or undefined.
export function findLanguage(language, script) {
  return LANGUAGES.find((l) => l.language === language && (!l.script || l.script === script));
}
