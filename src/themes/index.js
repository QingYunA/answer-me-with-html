// Theme CSS: each theme's tokens become CSS variables under html[data-theme="<name>"], so switching themes only switches data-theme.
// Component styles (base.css, video.css) reference only variables; a theme's decoration css is scoped to its own root selector.
// Each theme provides light / dark values; auto mode follows the system prefers-color-scheme.

import { BASE_CSS, DIFF_CSS, DELTA_CSS, RTL_CSS, CHART_CSS, MATH_CSS, FONT_CSS, VIDEO_CSS, UPDATE_CSS, CLOSE_AFTER_CSS } from '../assets.js';
import { themes } from './registry.js';
import { fontLanguages, langSelector } from './fonts.js';
import { typeScaleCss } from './type-scale.js';

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

// list: the page themes the page carries (default: the built-in ones). diff: the page has a diff block, delta: a diagram with change markers;
// their styles come with the base ones. rtl: the page language is written right to left. base.css already uses logical properties;
// rtl.css holds only what they cannot express (code stays left to right, label fonts, mirrored offsets). math: the page has a formula (src/math.js);
// it carries the Temml styles with their font, about 20 KB, so a page without math does not. chart: the page has a chart (src/components/chart.js); it carries chart.css. update: the page has the new-version button;
// closeAfter: the page closes its tab after the reply is copied (the close_after_reply setting). theme: the name of the theme the page is rendered with;
// when that theme has its own font (the `font` field), the page carries the font face, and a page of another theme does not.
// scale: the reader's text size. It sets --am-scale after the type scale (src/themes/type-scale.js), which every page size multiplies; 1 adds nothing.
export function pageCss(list = themes('page'), { diff = false, delta = false, rtl = false, math = false, chart = false, update = false, closeAfter = false, theme, scale = 1 } = {}) {
  const decorations = list.filter((t) => t.css).map((t) => scoped(t.css, pageSel(t)));
  const fontFace = FONT_CSS[list.find((t) => t.name === theme)?.font];
  const ownFonts = list.filter((t) => t.ownFont).flatMap(ownLanguageFont);
  return [list.map((t) => tokenCss(pageSel(t), t.tokens)).join('\n\n'), ...languageFontCss(), ...ownFonts, typeScaleCss(), ...(scale === 1 ? [] : [`html { --am-scale: ${scale}; }`]), BASE_CSS, ...(math ? [MATH_CSS] : []), ...(chart ? [CHART_CSS] : []), ...(diff ? [DIFF_CSS] : []), ...(delta ? [DELTA_CSS] : []), ...(update ? [UPDATE_CSS] : []), ...(closeAfter ? [CLOSE_AFTER_CSS] : []), ...(rtl ? [RTL_CSS] : []), ...(fontFace ? [fontFace] : []), ...decorations].join('\n\n');
}

// list: the video themes the player carries (default: the built-in ones). rtl: the video language is written right to left; the page
// styles bring rtl.css (its html[dir="rtl"][data-video] block mirrors the player), and a theme's video.rtlCss mirrors what its own css places.
export function videoCss(list = themes('video'), { diff = false, delta = false, rtl = false, chart = false } = {}) {
  const parts = list.filter((t) => t.video).flatMap((t) => [
    t.video.tokens ? tokenCss(videoSel(t), t.video.tokens) : '',
    t.video.css ? scoped(t.video.css, videoSel(t)) : '',
    rtl && t.video.rtlCss ? scoped(t.video.rtlCss, videoSel(t)) : '',
  ]).filter(Boolean);
  return [pageCss(list.filter((t) => t.scope.includes('page')), { diff, delta, rtl, chart }), VIDEO_CSS, ...parts].join('\n\n');
}
