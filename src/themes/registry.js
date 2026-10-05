// Theme registry: the only place the rest of the code learns which themes exist.
// A theme is one definition (see blueprint.js): name, summary, label per UI language, scope (page / video), an optional fixed mode,
// tokens { common, light, dark } and optional decoration css; video-only tokens and css go under video.
// In css every selector starts with &, which themes/index.js replaces with the theme's root selector.
import blueprint from './blueprint.js';
import shadcn from './shadcn.js';
import b3 from './3b1b.js';

const ALL = Object.freeze([blueprint, shadcn, b3]);

export const themes = (scope) => ALL.filter((t) => t.scope.includes(scope));
export const themeNames = (scope) => themes(scope).map((t) => t.name);
export const getTheme = (name) => ALL.find((t) => t.name === name);
