// Browser entry of the renderer: the real src/ pipeline, bundled by site/build.mjs into assets/engine.js for the
// website's playground. The page has no file system: code blocks with src= and local images fail with the renderer's
// usual messages (see node-stub.js).
import { renderDoc, RenderError, LintError } from '../../src/render.js';
import { ParseError } from '../../src/parse.js';
import { ComponentError } from '../../src/components/index.js';
import { BUILTIN } from '../../src/themes/registry.js';
import { CONFIG_KEYS } from '../../src/config.js';
import { lintDoc } from '../../src/lint/ste.js';
import { resolveLanguage } from '../../src/language.js';
import { VERSION as PACKAGE_VERSION } from '../../src/assets.js';

export const VERSION = PACKAGE_VERSION;

// Page themes a draft or the theme picker can name ('auto' not included).
export const THEMES = Object.freeze([...BUILTIN.names('page')]);

// The settings a fresh install renders with, as the CLI reads them from an empty config.
const DEFAULTS = Object.freeze(Object.fromEntries(['theme', 'mode', 'style'].map((k) => [k, CONFIG_KEYS[k].default])));

// The settings the CLI flags set (--theme, --mode, --template, --style) plus lang. They win over the draft's frontmatter.
const OVERRIDE_KEYS = ['theme', 'mode', 'template', 'style', 'lang'];

// Local files are looked up from the root of the (empty) browser file system.
const ROOT = '/';

const EXPECTED = [RenderError, ParseError, LintError, ComponentError];

const now = () => (globalThis.performance ?? Date).now();

// Returns { ok: true, html, warnings, stats, meta, ms } or { ok: false, error: { name, message, line, component, example }, ms }.
// Draft errors are returned; anything else (a bug) is thrown.
export function render(source, overrides = {}) {
  const started = now();
  const picked = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, overrides?.[k] === '' ? undefined : overrides?.[k]]));
  try {
    const { html, warnings, stats, meta } = renderDoc(String(source), picked, DEFAULTS, { baseDir: ROOT, codeDir: ROOT });
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
