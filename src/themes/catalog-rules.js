// The rules for a file of the theme catalog (marketplace/themes/<name>.json), in one place. test/marketplace.test.js,
// the catalog build (site/catalog.mjs), the website editor and the submission Action all call catalogProblems,
// so they cannot disagree about what the catalog accepts. Pure and browser-safe: no node: imports, no file access.
// The rules are described in CONTRIBUTING.md, "Theme catalog".
import { normalizeTheme, checkColors, themeLinks, DIAGRAM_TOKENS, NAME } from './check.js';
import { BUILTIN_NAMES } from './registry.js';
import { THEME_SELECTORS } from './selectors.js';

export const MAX_BYTES = 16 * 1024;
// The name is a file name, a branch name and a word people type: keep it short.
export const MAX_NAME = 40;
const MIN_DIAGRAM_TOKENS = 8;
const KNOWN_CLASSES = new Set(THEME_SELECTORS.flatMap((s) => s.match(/\.[a-z][a-z0-9_-]*/gi)));
// Diagrams are styled with tokens only: a catalog theme does not reach into the SVG.
const DIAGRAM_SELECTORS = /\.am-(diagram|node|edge|arrow|cluster|lifeline|actor|note|step)|\bsvg\b|data-key/;
const VERSION = /^\d+\.\d+\.\d+$/;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
// A message from normalizeTheme or checkColors as a sentence. "light: --ink on ..." reads "In light mode, --ink on ...";
// one that starts with a field name ("css: ...", "tokens.dark: ...") keeps it as it is.
const sentence = (text) => {
  const plain = text.replace(/^(light|dark): /, 'In $1 mode, ');
  const s = /^[\w.]+: /.test(plain) ? plain : plain.charAt(0).toUpperCase() + plain.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

// The field a normalizeTheme or checkColors message belongs to, so a form can show it next to that field.
function fieldOf(message) {
  const mode = message.match(/^(?:tokens\.(common|light|dark)\b|(light|dark)(?::| mode))/);
  if (mode) return `tokens.${mode[1] ?? mode[2]}`;
  const head = message.match(/^(video\.css|video|css|label|font|requires)\b/);
  if (head) return head[1];
  return message.startsWith('needs Answer me') ? 'requires' : 'json';
}

// Where a themeLinks hit lives, as a field: "css", "video.css", or "tokens.light --node-shadow" -> "tokens.light".
const linkField = (where) => where.split(' ')[0].replace(/^video\.tokens/, 'video');

function linkMessage({ where, found }) {
  return found.startsWith('escape sequence')
    ? `${where} has a backslash escape, which can hide a link from the check; write the value plainly.`
    : `${where} has ${found}, which loads something from outside the theme file; a theme must work offline (use the font field for a shipped font).`;
}

// The identity rules: the name is the file name, so it must be safe to use in a path and must not take another theme's name.
function nameProblems(name, existing) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    return [{ field: 'name', message: 'The name must use lowercase letters, digits and -, and start with a letter or a digit.' }];
  }
  if (name.length > MAX_NAME) return [{ field: 'name', message: `The name has ${name.length} characters; use at most ${MAX_NAME}.` }];
  if (BUILTIN_NAMES.includes(name)) return [{ field: 'name', message: `"${name}" is the name of a built-in theme. Pick another name.` }];
  if (name === 'index') return [{ field: 'name', message: 'The name "index" is taken by the catalog list. Pick another name.' }];
  if (name === 'new') return [{ field: 'name', message: 'The name "new" is taken by the theme editor page. Pick another name.' }];
  if (existing.some((e) => String(e).toLowerCase() === name.toLowerCase())) return [{ field: 'name', message: `The catalog already has a theme named "${name}". Pick another name.` }];
  return [];
}

function metadataProblems(data) {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  if (typeof data.version !== 'string' || !VERSION.test(data.version)) add('version', 'The version must be x.y.z, like 1.0.0.');
  if (!filled(data.author)) add('author', 'The author is missing.');
  if (!filled(data.license)) add('license', 'The license is missing.');
  if (!isObject(data.description) || !filled(data.description.en)) add('description.en', 'The English description is missing.');
  if (isObject(data.description)) {
    for (const [lang, text] of Object.entries(data.description)) {
      if (typeof text !== 'string') add(`description.${lang}`, `The "${lang}" description must be a string.`);
    }
  }
  if (!isObject(data.label)) add('label', 'The label must be an object with an en and a zh name.');
  else for (const lang of ['en', 'zh']) if (!filled(data.label[lang])) add(`label.${lang}`, `The label needs a "${lang}" name.`);
  return out;
}

function cssProblems(data) {
  if (typeof data.css !== 'string') return [];
  const css = data.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const unknown = [...new Set(css.match(/\.[a-z][a-z0-9_-]*/gi) ?? [])].filter((cls) => !KNOWN_CLASSES.has(cls));
  return unknown.map((cls) => ({ field: 'css', message: `css targets ${cls}, which is not in the list of classes a theme may style (src/themes/selectors.js).` }));
}

// A theme draws its diagrams with tokens, in light and dark, and never with selectors.
function diagramProblems(data) {
  const tokens = isObject(data.tokens) ? data.tokens : {};
  const group = (mode) => (isObject(tokens[mode]) ? tokens[mode] : {});
  const out = [];
  for (const mode of ['light', 'dark']) {
    const set = { ...group('common'), ...group(mode) };
    const count = DIAGRAM_TOKENS.filter((k) => set[k] !== undefined).length;
    if (count < MIN_DIAGRAM_TOKENS) {
      out.push({ field: `tokens.${mode}`, message: `The ${mode} mode sets ${count} diagram tokens; set at least ${MIN_DIAGRAM_TOKENS} (--node-fill, --edge-color and so on).` });
    }
  }
  if (typeof data.css === 'string' && DIAGRAM_SELECTORS.test(data.css)) {
    out.push({ field: 'css', message: 'css must not style a diagram (.am-node, svg, data-key and so on); use the diagram tokens instead.' });
  }
  return out;
}

// text: the raw text of the file. existing: the names already in the catalog.
// Returns [{ field, message }]; an empty list means the file may go into marketplace/themes/. Messages are plain English sentences.
export function catalogProblems(name, text, { existing = [] } = {}) {
  const problems = nameProblems(name, existing);
  const bytes = new TextEncoder().encode(String(text ?? '')).length;
  if (bytes > MAX_BYTES) problems.push({ field: 'size', message: `The file is ${(bytes / 1024).toFixed(1)} KB; the most the catalog takes is ${MAX_BYTES / 1024} KB.` });

  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch (err) {
    return [...problems, { field: 'json', message: `The theme is not valid JSON: ${err.message}` }];
  }
  if (!isObject(data)) return [...problems, { field: 'json', message: 'The theme must be a JSON object.' }];

  // The name rules above are ours (they also check the catalog); normalizeTheme would only repeat them.
  const { theme, errors } = normalizeTheme(name, data, []);
  for (const e of errors.filter((m) => !m.startsWith('the name "'))) problems.push({ field: fieldOf(e), message: sentence(e) });
  for (const e of checkColors(theme).errors) problems.push({ field: fieldOf(e), message: sentence(e) });
  for (const hit of themeLinks(theme)) problems.push({ field: linkField(hit.where), message: linkMessage(hit) });
  problems.push(...metadataProblems(data), ...cssProblems(data), ...diagramProblems(data));
  return problems;
}
