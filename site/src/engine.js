// Browser entry of the renderer: the real src/ pipeline, bundled by site/build.mjs into assets/engine.js for the
// website's playground. The page has no file system: code blocks with src= and local images fail with the renderer's
// usual messages (see node-stub.js).
import { renderDoc, RenderError, LintError } from '../../src/render.js';
import { ParseError } from '../../src/parse.js';
import { ComponentError } from '../../src/components/index.js';
import { BUILTIN, BUILTIN_NAMES, withThemes } from '../../src/themes/registry.js';
import { normalizeTheme } from '../../src/themes/check.js';
import { catalogProblems } from '../../src/themes/catalog-rules.js';
import { CONFIG_KEYS } from '../../src/config.js';
import { lintDoc } from '../../src/lint/ste.js';
import { resolveLanguage } from '../../src/language.js';
import { VERSION as PACKAGE_VERSION } from '../../src/assets.js';
import { loadMath } from '../../src/math-load.js';
import { pinScript } from '../../src/csp.js';

// A page the engine rendered carries a Content-Security-Policy; a preview frame that adds a script to it allows that script too (framed in live.js).
export { pinScript };

export const VERSION = PACKAGE_VERSION;

// Page themes a draft or the theme picker can name ('auto' not included).
export const THEMES = Object.freeze([...BUILTIN.names('page')]);

// A theme file (the parsed JSON of themes/<name>.json) as a theme definition render() accepts in `extra`, read the way the CLI reads it
// from the themes folder. Returns { theme, errors }; use the theme only when errors is empty.
export const themeFromFile = (name, data) => normalizeTheme(name, data, BUILTIN_NAMES);

// The catalog rules for a theme file: catalogProblems(name, text, { existing }) returns [{ field, message }], empty when the catalog would take it.
// The same function checks marketplace/themes/ in the tests and the issues submitted on GitHub.
export { catalogProblems };

// What the theme editor page (site/src/editor.js) needs besides the renderer: starting points, the check, the submit link, the issue loader.
export * from './editor-model.js';

// The settings a fresh install renders with, as the CLI reads them from an empty config.
const DEFAULTS = Object.freeze(Object.fromEntries(['theme', 'mode', 'style'].map((k) => [k, CONFIG_KEYS[k].default])));

// The settings the CLI flags set (--theme, --mode, --template, --style) plus lang. They win over the draft's frontmatter.
const OVERRIDE_KEYS = ['theme', 'mode', 'template', 'style', 'lang'];

// Local files are looked up from the root of the (empty) browser file system.
const ROOT = '/';

const EXPECTED = [RenderError, ParseError, LintError, ComponentError];

const now = () => (globalThis.performance ?? Date).now();

// render() is synchronous, so a caller awaits this first: it loads Temml (the separate temml.js, fetched once) when the draft may hold math.
export const prepare = (source) => loadMath(source);

// extra: theme definitions from themeFromFile, added to the built-in ones for this render (the CLI adds the themes folder the same way).
// Returns { ok: true, html, warnings, stats, meta, ms } or { ok: false, error: { name, message, line, component, example }, ms }.
// Draft errors are returned; anything else (a bug) is thrown.
export function render(source, overrides = {}, { extra = [] } = {}) {
  const started = now();
  const picked = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, overrides?.[k] === '' ? undefined : overrides?.[k]]));
  try {
    const { html, warnings, stats, meta } = renderDoc(String(source), picked, DEFAULTS, { baseDir: ROOT, codeDir: ROOT, ...(extra.length && { themes: withThemes(extra) }) });
    return { ok: true, html, warnings, stats, meta, ms: now() - started };
  } catch (err) {
    if (!EXPECTED.some((E) => err instanceof E)) throw err;
    return { ok: false, error: describe(err), ms: now() - started };
  }
}

function describe(err) {
  const error = { name: err.name, message: err.message, line: err.line, component: err.component, example: err.example };
  return err instanceof LintError ? { ...error, warnings: err.warnings } : error;
}

// The STE writing check of plain prose. lang: 'en' | 'zh' | undefined (detect from the text).
// Returns [{ line, rule, message, suggestion? }] with lines counted from 1 in text.
export function lint(text, lang) {
  const prose = String(text);
  const language = resolveLanguage({ declared: lang, text: prose });
  return lintDoc({ intro: [{ type: 'md', text: prose, line: 1 }], panels: [] }, language);
}
