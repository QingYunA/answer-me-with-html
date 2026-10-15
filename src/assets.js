// Static assets needed at run time, in one place. In development they are read from disk; when bundling (scripts/build.mjs) the whole module is replaced by inline strings,
// so the bundle skills/answer-me-with-html/scripts/am.mjs depends on no external files.
import { readFileSync } from 'node:fs';
import { composeRuntime, unexport } from './runtime/compose.js';
import { composeMathCss } from './themes/math-css.js';
import { composeFontCss, FONT_NAMES } from './themes/font-css.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

export const VERSION = JSON.parse(read('../package.json')).version;
export const BASE_CSS = read('./themes/base.css');
export const RUNTIME_JS = composeRuntime((file) => read(`./runtime/${file}`));
export const DIFF_CSS = read('./themes/diff.css');
export const DELTA_CSS = read('./themes/delta.css');
export const RTL_CSS = read('./themes/rtl.css');
export const MATH_CSS = composeMathCss(read('./themes/math.css'));
// A theme's own font face, by the name its `font` field gives (src/themes/font-css.js).
export const FONT_CSS = Object.fromEntries(FONT_NAMES.map((name) => [name, composeFontCss(name)]));
export const DELTA_JS = read('./runtime/delta.js');
export const UPDATE_CSS = read('./themes/update.css');
export const UPDATE_JS = read('./runtime/update.js');
export const LIVE_JS = read('./runtime/live.js');
export const CLOSE_AFTER_CSS = read('./themes/close-after-reply.css');
export const CLOSE_AFTER_JS = read('./runtime/close-after-reply.js');
export const VIDEO_CSS = read('./themes/video.css');
export const VIDEO_JS = read('./runtime/video.js');
export const VIDEO_EXPORT_JS = read('./runtime/video-export.js');
// The WebM writer is shared with the page: the same source runs in Node (the CLI writes the file) and inside the
// player (the export button). scripts/inline-assets.mjs builds the identical string for the bundle.
export const VIDEO_MUX_JS = `${unexport(read('./video/webm.js'))}\nwindow.__amvWebm = { WebmWriter };\n`;
