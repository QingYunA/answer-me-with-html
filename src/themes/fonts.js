// Font stacks shared by the built-in themes, and the per-language font rules built from the language directory.
import { LANGUAGES } from '../languages/registry.js';

export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';

// The languages that set their own fonts.
export const fontLanguages = () => LANGUAGES.filter((l) => l.fonts);

// A selector list with one :lang() range per tag the language covers, with `base` before each range and `rest` after it.
// A :lang() range matches the tag and every tag that starts with it, so `ja` covers `ja-JP` and `zh-Hant` covers `zh-Hant-TW`.
export const langSelector = (language, base, rest) => language.langs.map((tag) => `${base}:lang(${tag})${rest}`).join(', ');

// For a theme's decoration css (where `&` is the theme's root): one rule per language that has fonts, setting `variable` to
// the theme's Latin fonts (`head`) followed by that language's serif fonts.
export const serifByLanguage = (variable, head) =>
  fontLanguages().map((l) => `${langSelector(l, '&', '[data-mode]')} { ${variable}: ${head}, ${l.fonts.serif}, serif; }`).join('\n');
