// Theme CSS: each theme's tokens become CSS variables under html[data-theme="<name>"], so switching themes only switches data-theme.
// Component styles (base.css, video.css) reference only variables; a theme's decoration css is scoped to its own root selector.
// Each theme provides light / dark values; auto mode follows the system prefers-color-scheme.

import { BASE_CSS, DIFF_CSS, VIDEO_CSS } from '../assets.js';
import { themes } from './registry.js';
import { fontLanguages, langSelector } from './fonts.js';

const block = (selector, vars) =>
  `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

function tokenCss(sel, { common = {}, light = {}, dark = {} }) {
  const parts = [block(`${sel}, ${sel}[data-mode="light"]`, { ...common, ...light })];
  if (Object.keys(dark).length) {
    parts.push(block(`${sel}[data-mode="dark"]`, dark), `@media (prefers-color-scheme: dark) {\n${block(`${sel}[data-mode="auto"]`, dark)}\n}`);
  }
  return parts.join('\n');
}

const pageSel = (t) => `html[data-theme="${t.name}"]`;
const videoSel = (t) => `html[data-video][data-theme="${t.name}"]`;
const scoped = (css, sel) => css.replace(/&/g, sel);

// Languages with their own fonts (src/languages): their fonts come before the Chinese ones, because a named Chinese font overrides the language.
// [data-theme][data-mode] makes the selector more specific than every theme's tokens, so it works wherever it is placed.
const languageFontCss = () => fontLanguages().map((l) => block(langSelector(l, 'html', '[data-theme][data-mode]'), { '--font-sans': l.fonts.sans }));

// A theme that sets its own sans font keeps it on those pages: same selector shape as languageFontCss plus the theme name, so it wins.
const ownLanguageFont = (t) => fontLanguages().map((l) => block(langSelector(l, 'html', `[data-theme="${t.name}"][data-mode]`), { '--font-sans': t.tokens.common['--font-sans'] }));

// list: the page themes the page carries (default: the built-in ones). diff: the page has a diff block, so its styles come with the base ones.
export function pageCss(list = themes('page'), { diff = false } = {}) {
  const decorations = list.filter((t) => t.css).map((t) => scoped(t.css, pageSel(t)));
  const ownFonts = list.filter((t) => t.ownFont).flatMap(ownLanguageFont);
  return [list.map((t) => tokenCss(pageSel(t), t.tokens)).join('\n\n'), ...languageFontCss(), ...ownFonts, BASE_CSS, ...(diff ? [DIFF_CSS] : []), ...decorations].join('\n\n');
}

// list: the video themes the player carries (default: the built-in ones).
export function videoCss(list = themes('video'), { diff = false } = {}) {
  const parts = list.filter((t) => t.video).flatMap((t) => [
    t.video.tokens ? tokenCss(videoSel(t), t.video.tokens) : '',
    t.video.css ? scoped(t.video.css, videoSel(t)) : '',
  ]).filter(Boolean);
  return [pageCss(list.filter((t) => t.scope.includes('page')), { diff }), VIDEO_CSS, ...parts].join('\n\n');
}
