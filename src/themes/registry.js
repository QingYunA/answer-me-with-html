// Theme registry: the only place the rest of the code learns which themes exist.
// A theme is one definition (see blueprint.js): name, summary, label per UI language, scope (page / video), an optional fixed mode,
// tokens { common, light, dark } and optional decoration css; video-only tokens and css go under video.
// In css every selector starts with &, which themes/index.js replaces with the theme's root selector.
// The built-in themes are always there; loadThemes adds the user's theme files from <AM_HOME>/themes/.
import blueprint from './blueprint.js';
import shadcn from './shadcn.js';
import b3 from './3b1b.js';
import { readUserThemes, readThemeFile } from './user.js';

const ALL = Object.freeze([blueprint, shadcn, b3]);
const BUILTIN_NAMES = ALL.map((t) => t.name);

export const themes = (scope) => ALL.filter((t) => t.scope.includes(scope));
export const themeNames = (scope) => themes(scope).map((t) => t.name);
export const getTheme = (name) => ALL.find((t) => t.name === name);

// A set of themes: the built-in ones plus user themes. broken maps a skipped file's theme name to { file, reason }.
function themeSet(user = [], broken = new Map()) {
  const all = [...ALL, ...user];
  const list = (scope) => all.filter((t) => t.scope.includes(scope));
  const names = (scope) => list(scope).map((t) => t.name);
  const unusable = [...broken].filter(([name]) => !BUILTIN_NAMES.includes(name));
  return Object.freeze({
    list,
    names,
    get: (name) => all.find((t) => t.name === name),
    // Names a draft or flag may give: usable themes plus broken ones, so the error can say what is wrong with the file.
    choices: (scope) => [...names(scope), ...unusable.map(([name]) => name)],
    // Why a name cannot be used, or null.
    problem(name, scope) {
      if (names(scope).includes(name)) return null;
      const bad = unusable.find(([n]) => n === name);
      if (bad) return `Theme "${name}" cannot be used: ${bad[1].reason} (${bad[1].file})`;
      return `Theme "${name}" is not installed. Choose one of: ${names(scope).join(' | ')}`;
    },
    // The themes a page carries: the built-in ones for its scope, plus its own theme when that is a user theme.
    embedFor: (name, scope) => [...themes(scope), ...user.filter((t) => t.name === name && t.scope.includes(scope))],
    warnings: [...broken.values()].map(({ file, reason }) => `${file} skipped: ${reason}`),
  });
}

export const BUILTIN = themeSet();

// extra: a theme file outside the home (am theme check <file>); it joins the set even when the home has a theme of that name.
export function loadThemes(home, { extra } = {}) {
  const { themes: user, broken } = home ? readUserThemes(home, BUILTIN_NAMES) : { themes: [], broken: new Map() };
  if (!extra) return themeSet(user, broken);
  const one = readThemeFile(extra, BUILTIN_NAMES);
  const rest = user.filter((t) => t.name !== one.name);
  if (one.errors.length) return themeSet(rest, new Map([...broken, [one.name, { file: extra, reason: one.errors.join('; ') }]]));
  return themeSet([...rest, one.theme], broken);
}
