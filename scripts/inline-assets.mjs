// esbuild plugin shared by the CLI bundle (scripts/build.mjs) and the website's browser engine (site/build.mjs).
// It replaces src/assets.js with inline strings, removing the runtime dependency on files on disk.
import { readFileSync } from 'node:fs';
import { composeRuntime, unexport } from '../src/runtime/compose.js';
import { composeMathCss } from '../src/themes/math-css.js';
import { composeFontCss, FONT_NAMES } from '../src/themes/font-css.js';

// Normalize to LF so the bundle does not depend on the checkout's line-ending settings.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

export const inlineAssets = {
  name: 'inline-assets',
  setup(b) {
    b.onLoad({ filter: /src[\\/]assets\.js$/ }, () => ({
      loader: 'js',
      contents: [
        `export const VERSION = ${JSON.stringify(JSON.parse(read('../package.json')).version)};`,
        `export const BASE_CSS = ${JSON.stringify(read('../src/themes/base.css'))};`,
        `export const RUNTIME_JS = ${JSON.stringify(composeRuntime((file) => read(`../src/runtime/${file}`)))};`,
        `export const DIFF_CSS = ${JSON.stringify(read('../src/themes/diff.css'))};`,
        `export const DELTA_CSS = ${JSON.stringify(read('../src/themes/delta.css'))};`,
        `export const RTL_CSS = ${JSON.stringify(read('../src/themes/rtl.css'))};`,
        `export const MATH_CSS = ${JSON.stringify(composeMathCss(read('../src/themes/math.css')))};`,
        `export const FONT_CSS = ${JSON.stringify(Object.fromEntries(FONT_NAMES.map((name) => [name, composeFontCss(name)])))};`,
        `export const DELTA_JS = ${JSON.stringify(read('../src/runtime/delta.js'))};`,
        `export const UPDATE_CSS = ${JSON.stringify(read('../src/themes/update.css'))};`,
        `export const UPDATE_JS = ${JSON.stringify(read('../src/runtime/update.js'))};`,
        `export const LIVE_JS = ${JSON.stringify(read('../src/runtime/live.js'))};`,
        `export const CLOSE_AFTER_CSS = ${JSON.stringify(read('../src/themes/close-after-reply.css'))};`,
        `export const CLOSE_AFTER_JS = ${JSON.stringify(read('../src/runtime/close-after-reply.js'))};`,
        `export const VIDEO_CSS = ${JSON.stringify(read('../src/themes/video.css'))};`,
        `export const VIDEO_JS = ${JSON.stringify(read('../src/runtime/video.js'))};`,
        `export const VIDEO_EXPORT_JS = ${JSON.stringify(read('../src/runtime/video-export.js'))};`,
        `export const VIDEO_MUX_JS = ${JSON.stringify(`${unexport(read('../src/video/webm.js'))}\nwindow.__amvWebm = { WebmWriter };\n`)};`,
      ].join('\n'),
    }));
  },
};
