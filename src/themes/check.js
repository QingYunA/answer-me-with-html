// User theme files: turn the JSON into a theme definition (normalizeTheme), and check its colors (checkColors).
// normalizeTheme reports problems that make a theme unusable; checkColors reports problems a reader would see.
// A theme file may grow new optional fields (font, requires); a CLI that does not know a field ignores it, because
// normalizeTheme reads only the fields it names. Keep it that way: never reject a field only because it is unknown.
import { parseColor, contrast } from './color.js';
import { FONT_NAMES } from './font-list.js';
import { VERSION } from '../assets.js';
import { newer } from '../version.js';
import { SANS, MONO } from './fonts.js';
import blueprint from './blueprint.js';
import { languageIds } from '../languages/registry.js';

export const NAME = /^[a-z0-9][a-z0-9-]*$/;

// Every color a component reads. Light and dark must each set all of them.
export const COLOR_TOKENS = Object.freeze([
  '--bg', '--paper', '--ink', '--ink-2', '--ink-3', '--line', '--line-2', '--fill', '--accent', '--accent-bg',
  '--ok', '--ok-bg', '--err', '--err-bg', '--warn', '--warn-bg', '--head-bg', '--head-fg',
]);

const LANGS = languageIds();
const UNSAFE_VALUE = /[;{}<]/;

// Returns { theme, errors }. theme is built even when there are errors, so am theme check can go on to check colors.
export function normalizeTheme(name, data, builtinNames = []) {
  const errors = [];
  if (!NAME.test(name)) errors.push(`the name "${name}" must use lowercase letters, digits and -`);
  if (builtinNames.includes(name)) errors.push(`"${name}" is a built-in theme; rename the file`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { theme: null, errors: [...errors, 'the file must hold a JSON object'] };

  const tokens = data.tokens ?? {};
  const group = (where, g) => {
    if (g === undefined) return {};
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      errors.push(`${where} must be an object of CSS variables`);
      return {};
    }
    for (const [k, v] of Object.entries(g)) {
      if (!k.startsWith('--')) errors.push(`${where}: "${k}" must start with --`);
      else if (typeof v !== 'string' || UNSAFE_VALUE.test(v)) errors.push(`${where}: ${k} must be a string without ; { } <`);
    }
    return g;
  };
  const common = group('tokens.common', tokens.common);
  const light = group('tokens.light', tokens.light);
  const dark = group('tokens.dark', tokens.dark);
  for (const [mode, set] of [['light', { ...common, ...light }], ['dark', { ...common, ...dark }]]) {
    const missing = COLOR_TOKENS.filter((k) => set[k] === undefined);
    if (missing.length) errors.push(`${mode} mode is missing ${missing.join(' ')}`);
  }

  const css = cssField('css', data.css, errors);
  let video;
  if (data.video !== undefined) {
    const v = data.video && typeof data.video === 'object' ? data.video : {};
    const vt = v.tokens ?? {};
    video = {
      tokens: { common: group('video.tokens.common', vt.common), light: group('video.tokens.light', vt.light), dark: group('video.tokens.dark', vt.dark) },
      css: cssField('video.css', v.css, errors),
    };
  }

  const label = labelField(data.label, name, errors);
  const font = fontField(data.font, errors);
  requiresField(data.requires, errors);
  // Missing layout tokens come from blueprint; a theme's own fonts keep the default stack as the fallback.
  const fonts = {};
  if (common['--font-sans']) fonts['--font-sans'] = `${common['--font-sans']}, ${SANS}`;
  if (common['--font-mono']) fonts['--font-mono'] = `${common['--font-mono']}, ${MONO}`;
  const theme = {
    name,
    summary: label.en,
    label,
    scope: ['page', 'video'],
    user: true,
    ownFont: Boolean(common['--font-sans']),
    font,
    tokens: { common: { ...blueprint.tokens.common, ...common, ...fonts }, light, dark },
    css,
    video,
  };
  return { theme, errors };
}

// font: the name of a font the CLI ships (font-css.js); a page rendered with the theme embeds it. An older CLI ignores the field.
function fontField(font, errors) {
  if (font === undefined) return undefined;
  if (typeof font !== 'string' || !FONT_NAMES.includes(font)) {
    errors.push(`font must be one of: ${FONT_NAMES.join(', ')}`);
    return undefined;
  }
  return font;
}

// requires: the oldest CLI version the theme supports, as x.y.z.
function requiresField(requires, errors) {
  if (requires === undefined) return;
  if (typeof requires !== 'string' || !/^\d+\.\d+\.\d+$/.test(requires)) errors.push('requires must be a version in x.y.z format');
  else if (newer(requires, VERSION)) errors.push(`needs Answer me with HTML ${requires} or newer`);
}

function labelField(label, name, errors) {
  if (label === undefined) return Object.fromEntries(LANGS.map((l) => [l, name]));
  if (typeof label === 'string') return Object.fromEntries(LANGS.map((l) => [l, label]));
  if (!label || typeof label !== 'object' || Object.values(label).some((v) => typeof v !== 'string')) {
    errors.push(`label must be a string or an object of ${LANGS.join(' / ')} strings`);
    return Object.fromEntries(LANGS.map((l) => [l, name]));
  }
  const fallback = label.en ?? Object.values(label)[0] ?? name;
  return Object.fromEntries(LANGS.map((l) => [l, label[l] ?? fallback]));
}

// Decoration CSS must start every selector with &, so it applies only under its own theme.
function cssField(where, css, errors) {
  if (css === undefined) return undefined;
  if (typeof css !== 'string') {
    errors.push(`${where} must be a string`);
    return undefined;
  }
  if (/<\/style/i.test(css)) errors.push(`${where} must not contain </style>`);
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/(?:^|[{};])\s*([^{};]+?)\s*\{/g)) {
    const prelude = m[1];
    if (prelude.startsWith('@')) continue;
    const bad = prelude.split(',').map((s) => s.trim()).find((s) => !s.startsWith('&'));
    if (bad !== undefined) errors.push(`${where}: selector "${bad}" must start with & (the theme's root)`);
  }
  return css;
}

// Links a theme must not carry: a page opens offline, and a link would send a request each time someone opens it. Returns what the
// css holds, comments stripped: url() to http:, https: or //, any @import, any @font-face (a theme names a shipped font with `font`).
// A local theme file only gets a warning from this (am theme check); the catalog and am theme add reject it.
export function externalResources(css) {
  if (typeof css !== 'string') return [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const m of text.matchAll(/url\(\s*(['"]?)\s*([^'")]*)/gi)) {
    if (/^(?:https?:|\/\/)/i.test(m[2].trim())) found.push(`url(${m[2].trim()})`);
  }
  if (/@import\b/i.test(text)) found.push('@import');
  if (/@font-face\b/i.test(text)) found.push('@font-face');
  return found;
}

// Warnings for a theme definition's css and video.css.
export function externalResourceWarnings(theme) {
  return [['css', theme?.css], ['video.css', theme?.video?.css]].flatMap(([where, css]) =>
    externalResources(css).map((r) => `${where}: ${r} loads or embeds something outside the theme file; a theme must work offline (use the font field for a shipped font)`));
}

// Pairs read as text need 4.5:1; status colors on their tint are badges and need at least 3:1 (4.5:1 gives a warning only).
const TEXT_PAIRS = [['--ink', '--paper'], ['--ink', '--bg'], ['--ink-2', '--paper'], ['--ink-2', '--bg'], ['--head-fg', '--head-bg'], ['--accent', '--paper']];
const BADGE_PAIRS = [['--accent', '--accent-bg'], ['--ok', '--ok-bg'], ['--err', '--err-bg'], ['--warn', '--warn-bg']];

// Returns { errors, warnings } for a theme definition (built-in or user).
export function checkColors(theme) {
  const errors = [];
  const warnings = [];
  const { common = {}, light = {}, dark = {} } = theme.tokens ?? {};
  for (const [mode, set] of [['light', { ...common, ...light }], ['dark', { ...common, ...light, ...dark }]]) {
    const colors = {};
    for (const k of COLOR_TOKENS) {
      if (set[k] === undefined) continue;
      const c = parseColor(set[k]);
      if (c) colors[k] = c;
      else errors.push(`${mode}: ${k} "${set[k]}" is not a color this check reads (use hex, rgb() or hsl())`);
    }
    const ratio = (fg, bg) => (colors[fg] && colors[bg] ? contrast(colors[fg], colors[bg], colors['--paper']) : null);
    const say = (fg, bg, r, need) => `${mode}: ${fg} on ${bg} has contrast ${r.toFixed(2)}:1, needs ${need}:1`;
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = ratio(fg, bg);
      if (r !== null && r < 4.5) errors.push(say(fg, bg, r, 4.5));
    }
    for (const [fg, bg] of BADGE_PAIRS) {
      const r = ratio(fg, bg);
      if (r !== null && r < 3) errors.push(say(fg, bg, r, 3));
      else if (r !== null && r < 4.5) warnings.push(say(fg, bg, r, 4.5));
    }
  }
  return { errors, warnings };
}
