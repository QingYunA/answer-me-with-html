// The parts of the theme editor (/themes/new/) that need no page: starting points, the file the form edits, the check, the submit link
// and the issue loader. No DOM access, so node can test them (test/theme-editor.test.js). site/src/engine.js re-exports everything here,
// and site/src/editor.js (the page) calls it through the engine bundle.
import { BUILTIN, BUILTIN_NAMES } from '../../src/themes/registry.js';
import { COLOR_TOKENS, NAME, normalizeTheme } from '../../src/themes/check.js';
import { parseColor } from '../../src/themes/color.js';
import { catalogProblems, MAX_NAME } from '../../src/themes/catalog-rules.js';
import { parseIssue } from '../../src/themes/submission-issue.js';

export const REPO = 'QingYunA/answer-me-with-html';
// A browser or GitHub refuses a very long address, so the theme goes into the link only when the whole link is at most this long.
export const MAX_URL = 8000;
// The editor reads at most this much of a file. The catalog takes 16 KB (catalogProblems says so for a file between the two).
export const MAX_READ = 64 * 1024;

// The tokens the form edits. Light and dark each set every color; the layout tokens are shared.
export const LAYOUT_TOKENS = Object.freeze(['--radius', '--bw', '--shadow']);
export const COLOR_GROUPS = Object.freeze([
  { id: 'surface', tokens: ['--bg', '--paper', '--fill', '--head-bg', '--head-fg'] },
  { id: 'text', tokens: ['--ink', '--ink-2', '--ink-3', '--line', '--line-2'] },
  { id: 'accent', tokens: ['--accent', '--accent-bg'] },
  { id: 'status', tokens: ['--ok', '--ok-bg', '--err', '--err-bg', '--warn', '--warn-bg'] },
]);
export { COLOR_TOKENS };

// Fields of the file the form has a control for. A problem on any other field (css, version, size, ...) shows by the JSON view.
export const FORM_FIELDS = Object.freeze(['name', 'label.en', 'label.zh', 'description.en', 'description.zh', 'author', 'license', 'font', 'tokens.common', 'tokens.light', 'tokens.dark']);

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ── The theme file ──

// The bytes the Action commits and the check reads: 2-space JSON and a final newline.
export const formatThemeFile = (data) => `${JSON.stringify(data, null, 2)}\n`;

export function getIn(data, path) {
  return path.reduce((value, key) => (isPlain(value) ? value[key] : undefined), data);
}

// A copy of data with the value at path set; undefined removes the key. The key keeps its place, so the JSON view does not jump around.
export function setIn(data, path, value) {
  const [key, ...rest] = path;
  const base = isPlain(data) ? data : {};
  const next = rest.length ? setIn(base[key], rest, value) : value;
  if (next === undefined) {
    const { [key]: removed, ...others } = base;
    return others;
  }
  return { ...base, [key]: next };
}

// { data } when the text is a JSON object, else { error }.
export function parseThemeText(text) {
  try {
    const data = JSON.parse(text);
    return isPlain(data) ? { data } : { error: 'The theme must be a JSON object.' };
  } catch (err) {
    return { error: `The theme is not valid JSON: ${err.message}` };
  }
}

// A theme name from a file name ("my-theme.json" → "my-theme"), or '' when it would not be a valid name.
export function nameFromFile(fileName) {
  const name = String(fileName ?? '').replace(/\.json$/i, '');
  return NAME.test(name) && name.length <= MAX_NAME ? name : '';
}

// A name the person may start with: valid, not a built-in theme, not in the catalog, not the editor's own page.
export const isFreeName = (name, existing = []) => name !== '' && catalogProblems(name, '{}', { existing }).every((p) => p.field !== 'name');

// ── Starting points ──

// What a page uses for each diagram part when a theme sets nothing (docs/reference.md, "Diagram tokens"), written as tokens so that light and
// dark follow the colors of the theme. A theme file needs at least 8 diagram tokens in each mode; one started from a built-in theme carries these.
// --node-width, --node-radius, --node-shadow, --note-radius and the actor tokens are left out: their defaults come from other tokens (--bw, --radius)
// and already follow them.
export const DIAGRAM_DEFAULTS = Object.freeze({
  '--node-fill': 'var(--paper)',
  '--node-stroke': 'var(--line)',
  '--node-text': 'var(--ink)',
  '--hi-fill': 'var(--accent-bg)',
  '--hi-stroke': 'var(--accent)',
  '--hi-text': 'var(--accent)',
  '--edge-color': 'var(--ink-2)',
  '--edge-width': '1.3',
  '--edge-label': 'var(--accent)',
  '--note-fill': 'var(--warn-bg)',
  '--note-stroke': 'var(--warn)',
  '--note-width': '1',
  '--cluster-fill': 'var(--fill)',
  '--cluster-stroke': 'var(--line-2)',
  '--lifeline-color': 'var(--ink-3)',
});

// A built-in page theme has a definition, not a file. This is its definition as a theme file: label, the catalog fields to fill in, the tokens
// (without the font stacks, which every theme inherits from blueprint) with the diagram tokens, css and video. null for a name that is not a page theme.
export function builtinThemeFile(name) {
  const def = BUILTIN.get(name);
  if (!def || !def.scope.includes('page')) return null;
  const { '--font-sans': sans, '--font-mono': mono, ...common } = def.tokens.common;
  const file = {
    label: { en: def.label.en, zh: def.label.zh },
    version: '1.0.0',
    author: '',
    license: 'MIT',
    description: { en: '', zh: '' },
    tokens: { common: { ...common, ...DIAGRAM_DEFAULTS }, light: { ...def.tokens.light }, dark: { ...def.tokens.dark } },
  };
  if (def.css) file.css = def.css;
  if (def.video) {
    const modes = Object.fromEntries(['common', 'light', 'dark'].filter((m) => def.video.tokens?.[m]).map((m) => [m, { ...def.video.tokens[m] }]));
    file.video = { ...(Object.keys(modes).length && { tokens: modes }), ...(def.video.css && { css: def.video.css }) };
  }
  return file;
}

// A theme file as the start of a new theme: a copy with version 1.0.0 and the MIT license, and the author left for the person to fill in.
export function startFrom(file) {
  const copy = structuredClone(file);
  return { ...copy, version: '1.0.0', author: '', license: 'MIT' };
}

// The page themes and the catalog themes the picker offers: [{ value, kind: 'builtin' | 'catalog', label }]. index: the parsed themes/index.json.
export function startChoices(index, lang = 'en') {
  const builtin = [...BUILTIN.names('page')].map((value) => ({ value, kind: 'builtin', label: BUILTIN.get(value).label[lang] ?? BUILTIN.get(value).label.en }));
  const catalog = (index?.themes ?? []).map((t) => ({ value: t.name, kind: 'catalog', label: t.label?.[lang] ?? t.label?.en ?? t.name }));
  return [...builtin, ...catalog];
}

// ── The check ──

// { text, problems } for the editor's state. text is what the check reads: the formatted file, or the raw JSON view when that does not parse.
export function checkTheme({ name, data, rawText, jsonError = false, existing = [] }) {
  const text = jsonError ? rawText : formatThemeFile(data);
  return { text, problems: catalogProblems(name, text, { existing }) };
}

// problems → Map(field → messages).
export function problemsByField(problems) {
  const map = new Map();
  for (const { field, message } of problems) map.set(field, [...(map.get(field) ?? []), message]);
  return map;
}

// The CSS variables a message names ("In light mode, --ink on --paper ..." → ["--ink", "--paper"]), to mark their inputs.
export const tokensNamed = (message) => [...new Set(String(message).match(/--[a-z0-9-]+/g) ?? [])];

// The preview needs a theme definition the renderer takes: { theme, errors }. errors is empty when the file is usable.
export const previewTheme = (data) => normalizeTheme('preview', data, BUILTIN_NAMES);

// "#rrggbb" for a color value the page can show in a color input, else null (var(...), a name, a broken value). Opacity is dropped.
export function colorHex(value) {
  const color = parseColor(value);
  if (!color) return null;
  return `#${color.slice(0, 3).map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('')}`;
}

// ── Submit ──

// encodeURIComponent, but : and , stay as they are (both are fine in a query), which keeps the link shorter.
const q = (s) => encodeURIComponent(s).replace(/%3A/g, ':').replace(/%2C/g, ',');

// How to hand a theme to the issue form. The link carries the name and the compact JSON. When that is longer than MAX_URL the link carries
// only the name, and { paste: true, text } says the theme has to be pasted by hand (the page copies text to the clipboard).
export function submitPlan(name, data) {
  const base = `https://github.com/${REPO}/issues/new?template=theme.yml&title=${q(`Theme: ${name}`)}&name=${q(name)}`;
  const full = `${base}&theme=${q(JSON.stringify(data))}`;
  return full.length <= MAX_URL ? { url: full, paste: false } : { url: base, paste: true, text: formatThemeFile(data) };
}

// ── ?issue=<n> ──

// The issue number in a query string (digits only), or null.
export function issueNumber(search) {
  const value = new URLSearchParams(search).get('issue');
  return value !== null && /^[1-9]\d{0,8}$/.test(value) ? value : null;
}

export const issueApiUrl = (number) => `https://api.github.com/repos/${REPO}/issues/${number}`;

// Load the theme of a submission issue through the public GitHub API, with the same parser as the Action.
// → { ok: true, name, text, title, url } or { ok: false, reason: 'rate' | 'missing' | 'http' | 'network' | 'empty', status? }.
// rate: the 60 requests an hour that GitHub gives a visitor with no token are used. empty: the issue holds no theme.
export async function fetchIssue(number, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(issueApiUrl(number), { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!res.ok) {
    // A 403 on a public issue is the rate limit, unless the response says there are requests left.
    const left = res.headers?.get?.('x-ratelimit-remaining') ?? null;
    if (res.status === 429 || (res.status === 403 && (left === null || left === '0'))) return { ok: false, reason: 'rate', status: res.status };
    return { ok: false, reason: res.status === 404 ? 'missing' : 'http', status: res.status };
  }
  let issue;
  try {
    issue = await res.json();
  } catch {
    return { ok: false, reason: 'http', status: res.status };
  }
  const { name, text } = parseIssue(issue?.body);
  if (!name && !text) return { ok: false, reason: 'empty' };
  return { ok: true, name, text, title: String(issue?.title ?? ''), url: String(issue?.html_url ?? '') };
}
