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

// Optional tokens for what is inside a diagram (docs/reference.md, "Diagram tokens"). Each has a default, so none is ever required.
export const DIAGRAM_TOKENS = Object.freeze([
  '--node-fill', '--node-stroke', '--node-width', '--node-radius', '--node-shadow', '--node-text',
  '--hi-fill', '--hi-stroke', '--hi-text',
  '--edge-color', '--edge-width', '--edge-label',
  '--actor-fill', '--actor-stroke', '--actor-text',
  '--note-fill', '--note-stroke', '--note-width', '--note-radius',
  '--cluster-fill', '--cluster-stroke', '--lifeline-color',
]);
// A length is a plain number or a px / em value; a bare number means px, so it also works as a CSS border width.
const LENGTH_TOKENS = Object.freeze(['--node-width', '--edge-width', '--node-radius', '--note-width', '--note-radius']);
const LENGTH = /^(?:\d+|\d*\.\d+)(?:px|em)?$/;

const LANGS = languageIds();
const UNSAFE_VALUE = /[;{}<]/;

// none, or one or more drop-shadow(...) filters: a shadow is the only filter a theme needs, and a filter can load a file through url().
function shadowOk(value) {
  const v = value.trim();
  if (v === 'none') return true;
  let rest = v;
  while (rest) {
    if (!/^drop-shadow\(/i.test(rest)) return false;
    let depth = 0;
    let end = -1;
    for (let i = 'drop-shadow'.length; i < rest.length && end < 0; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')' && --depth === 0) end = i;
    }
    if (end < 0 || /url\(/i.test(rest.slice(0, end))) return false;
    rest = rest.slice(end + 1).trimStart();
  }
  return true;
}

// An error for a diagram token whose value is not plain, or '' when it is fine.
function diagramTokenProblem(key, value) {
  if (LENGTH_TOKENS.includes(key) && !LENGTH.test(value.trim())) return 'must be a number or a px / em value, like 2 or 2.5px';
  if (key === '--node-shadow' && !shadowOk(value)) return 'must be none or one or more drop-shadow(...), with no url()';
  return '';
}

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
    const out = {};
    for (const [k, v] of Object.entries(g)) {
      out[k] = v;
      if (!k.startsWith('--')) errors.push(`${where}: "${k}" must start with --`);
      else if (typeof v !== 'string' || UNSAFE_VALUE.test(v)) errors.push(`${where}: ${k} must be a string without ; { } <`);
      else if (diagramTokenProblem(k, v)) errors.push(`${where}: ${k} ${diagramTokenProblem(k, v)}`);
      else if (LENGTH_TOKENS.includes(k) && /^[\d.]+$/.test(v.trim())) out[k] = `${v.trim()}px`;
    }
    return out;
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

const ESCAPE = 'escape sequence (\\)';

// Links a theme must not carry: a page opens offline, and a link would send a request each time someone opens it. Returns what the
// css holds, comments stripped: url() or image-set() to http:, https: or //, any @import, any @font-face (a theme names a shipped font with
// `font`), and any backslash (an escape could hide the others).
// A local theme file only gets a warning from this (am theme check); the catalog and am theme add reject it.
export function externalResources(css) {
  if (typeof css !== 'string') return [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const m of text.matchAll(/url\(\s*(['"]?)\s*([^'")]*)/gi)) {
    if (/^(?:https?:|\/\/)/i.test(m[2].trim())) found.push(`url(${m[2].trim()})`);
  }
  // image-set() takes a bare quoted string, with no url() around it.
  for (const m of text.matchAll(/(?:-webkit-)?image-set\(([^;{}]*)/gi)) {
    for (const s of m[1].matchAll(/(['"])\s*((?:https?:|\/\/)[^'"]*)\1/gi)) found.push(`image-set(${s[2].trim()})`);
  }
  if (/@import\b/i.test(text)) found.push('@import');
  if (/@font-face\b/i.test(text)) found.push('@font-face');
  // A CSS escape can spell url( or @import in a way the checks above do not read (u\72 l(...)), and a theme has no need for one.
  if (text.includes('\\')) found.push(ESCAPE);
  return found;
}

// What a theme definition carries that it must not, as { where, found } pairs: its css, its video.css, and the value of every token
// (a token such as --node-shadow can hold a url() as well as css can).
export function themeLinks(theme) {
  const groups = (where, tokens) => ['common', 'light', 'dark'].flatMap((mode) =>
    Object.entries(tokens?.[mode] ?? {}).map(([k, v]) => ({ where: `${where}.${mode} ${k}`, text: v })));
  const sources = [
    { where: 'css', text: theme?.css }, { where: 'video.css', text: theme?.video?.css },
    ...groups('tokens', theme?.tokens), ...groups('video.tokens', theme?.video?.tokens),
  ];
  return sources.flatMap(({ where, text }) => externalResources(text).map((found) => ({ where, found })));
}

// Warnings for a theme definition's css, video.css and token values.
export function externalResourceWarnings(theme) {
  return themeLinks(theme).map(({ where, found }) => (found === ESCAPE
    ? `${where}: ${found} can hide a link from this check; a theme has no need for one (write the value plainly)`
    : `${where}: ${found} loads or embeds something outside the theme file; a theme must work offline (use the font field for a shipped font)`));
}

// Pairs read as text need 4.5:1; status colors on their tint are badges and need at least 3:1 (4.5:1 gives a warning only).
const TEXT_PAIRS = [['--ink', '--paper'], ['--ink', '--bg'], ['--ink-2', '--paper'], ['--ink-2', '--bg'], ['--head-fg', '--head-bg'], ['--accent', '--paper']];
const BADGE_PAIRS = [['--accent', '--accent-bg'], ['--ok', '--ok-bg'], ['--err', '--err-bg'], ['--warn', '--warn-bg']];
// Diagram text on the fill it is drawn on. Each side lists the tokens that can supply it, first one set wins (the same chain as base.css).
// A pair is checked only when the theme sets one of its diagram tokens (`when`); a theme that sets none draws what it always did.
const DIAGRAM_PAIRS = [
  { fg: ['--node-text', '--ink'], bg: ['--node-fill', '--paper'], when: ['--node-text', '--node-fill'] },
  { fg: ['--hi-text', '--accent'], bg: ['--hi-fill', '--accent-bg'], when: ['--hi-text', '--hi-fill'] },
  { fg: ['--actor-text', '--node-text', '--ink'], bg: ['--actor-fill', '--node-fill', '--paper'], when: ['--actor-text', '--actor-fill', '--node-text', '--node-fill'] },
  { fg: ['--ink'], bg: ['--note-fill', '--warn-bg'], when: ['--note-fill'] },
  { fg: ['--edge-label', '--accent'], bg: ['--paper'], when: ['--edge-label'] },
];
const VAR_REF = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)$/;

// A token's color: a value that is var(--other) follows that token (a few steps at most); null when it is not a color this check reads.
function colorOf(set, key, depth = 0) {
  const value = set[key]?.trim();
  if (value === undefined || depth > 4) return null;
  const ref = value.match(VAR_REF);
  if (ref) return set[ref[1]] === undefined ? (ref[2] ? parseColor(ref[2].trim()) : null) : colorOf(set, ref[1], depth + 1);
  return parseColor(value);
}

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
    const seen = new Set();
    for (const { fg, bg, when } of DIAGRAM_PAIRS) {
      if (!when.some((k) => set[k] !== undefined)) continue;
      const [fgKey, bgKey] = [fg, bg].map((chain) => chain.find((k) => set[k] !== undefined));
      // An actor that takes its colors from the node tokens reads the same pair as the node: say it once.
      if (!fgKey || !bgKey || seen.has(`${fgKey} ${bgKey}`)) continue;
      seen.add(`${fgKey} ${bgKey}`);
      const [fgColor, bgColor] = [colorOf(set, fgKey), colorOf(set, bgKey)];
      if (!fgColor || !bgColor) {
        warnings.push(`${mode}: ${fgKey} on ${bgKey} was not checked, because a value is not a color this check reads (use hex, rgb() or hsl())`);
        continue;
      }
      const r = contrast(fgColor, bgColor, colorOf(set, '--paper') ?? undefined);
      if (r < 4.5) errors.push(say(fgKey, bgKey, r, 4.5));
    }
  }
  return { errors, warnings };
}
