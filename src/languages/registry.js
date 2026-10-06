// The fully supported languages. A language is one file in this directory, listed here (themes work the same way).
// A file names its language subtag and, when the language has several scripts, the script it covers
// (Simplified Chinese covers Hans; Traditional Chinese will cover Hant). The label sets in the file are the ones the
// page and the video player show.
import zh from './zh.js';
import en from './en.js';
import ja from './ja.js';

// The order is the key order of the label objects that theme files carry.
export const LANGUAGES = Object.freeze([zh, en, ja]);

// What a language without its own file shows: English labels.
export const FALLBACK = en;

export const languageIds = () => LANGUAGES.map((l) => l.id);

// The entry covering a language and script (script omitted by an entry means any script), or undefined.
export function findLanguage(language, script) {
  return LANGUAGES.find((l) => l.language === language && (!l.script || l.script === script));
}
