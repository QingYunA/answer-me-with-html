/*!
 * Bangers: Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers).
 * This Font Software is licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org),
 * the full text of which is in skills/answer-me-with-html/licenses/OFL-Bangers.txt (a copy of node_modules/@fontsource/bangers/LICENSE;
 * `npx skills add` copies only the skill folder, and the bundle there carries the font). The font is embedded unchanged, as a Latin subset in WOFF2.
 */
// The page styles for a theme's own font: an @font-face with the font file inlined (the page needs no network).
// A theme file names its font with `"font": "<name>"` (see check.js and font-list.js); pageCss adds the face only to a page rendered with
// that theme, so every other page stays as small as before. src/assets.js (development) and scripts/inline-assets.mjs (bundle) both call
// composeFontCss, so the two cannot drift apart.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FONTS } from './font-list.js';

export { FONT_NAMES } from './font-list.js';

const need = createRequire(import.meta.url);

// The weight range 400 900 keeps the browser from drawing a fake bold when a theme asks for a bold heading: this face has one weight.
export function composeFontCss(name) {
  const { family, file, notice } = FONTS[name];
  const data = readFileSync(need.resolve(file)).toString('base64');
  return `/* ${notice} */\n@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: 400 900;\n  src: url(data:font/woff2;base64,${data}) format("woff2");\n}`;
}
