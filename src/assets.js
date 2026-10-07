// Static assets needed at run time, in one place. In development they are read from disk; when bundling (scripts/build.mjs) the whole module is replaced by inline strings,
// so the bundle skills/answer-me-with-html/scripts/am.mjs depends on no external files.
import { readFileSync } from 'node:fs';
import { composeRuntime, composeRtlRuntime } from './runtime/compose.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

export const VERSION = JSON.parse(read('../package.json')).version;
export const BASE_CSS = read('./themes/base.css');
export const RUNTIME_JS = composeRuntime((file) => read(`./runtime/${file}`));
export const RTL_JS = composeRtlRuntime((file) => read(`./runtime/${file}`));
export const DIFF_CSS = read('./themes/diff.css');
export const DELTA_CSS = read('./themes/delta.css');
export const RTL_CSS = read('./themes/rtl.css');
export const DELTA_JS = read('./runtime/delta.js');
export const VIDEO_CSS = read('./themes/video.css');
export const VIDEO_JS = read('./runtime/video.js');
