// Theme CSS: each theme's tokens become CSS variables under html[data-theme="<name>"], so switching themes only switches data-theme.
// Component styles (base.css, video.css) reference only variables; a theme's decoration css is scoped to its own root selector.
// Each theme provides light / dark values; auto mode follows the system prefers-color-scheme.

import { BASE_CSS, VIDEO_CSS } from '../assets.js';
import { themes } from './registry.js';

// Japanese pages: Japanese fonts come before Chinese fonts. A named Chinese font overrides lang="ja", and Han characters would use Chinese glyphs (`直`, `込`).
const JA_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif';

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

// [data-theme][data-mode] makes the selector more specific than every theme's tokens, so it works wherever it is placed.
const JA_FONT_CSS = block('html[lang="ja"][data-theme][data-mode]', { '--font-sans': JA_SANS });

export function pageCss() {
  const list = themes('page');
  const decorations = list.filter((t) => t.css).map((t) => scoped(t.css, pageSel(t)));
  return [list.map((t) => tokenCss(pageSel(t), t.tokens)).join('\n\n'), JA_FONT_CSS, BASE_CSS, ...decorations].join('\n\n');
}

export function videoCss() {
  const parts = themes('video').filter((t) => t.video).flatMap((t) => [
    t.video.tokens ? tokenCss(videoSel(t), t.video.tokens) : '',
    t.video.css ? scoped(t.video.css, videoSel(t)) : '',
  ]).filter(Boolean);
  return [pageCss(), VIDEO_CSS, ...parts].join('\n\n');
}
