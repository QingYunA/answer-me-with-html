// User themes: one JSON file per theme in <AM_HOME>/themes/; the file name is the theme name.
// A file with problems is skipped and reported; it never stops a render that uses another theme.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { normalizeTheme } from './check.js';

// Read one theme file. Returns { name, theme, errors }; theme is null when the file cannot be read as JSON.
export function readThemeFile(file, builtinNames) {
  const name = basename(file).replace(/\.json$/i, '');
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { name, theme: null, errors: [`cannot read it as JSON (${e.message})`] };
  }
  return { name, ...normalizeTheme(name, data, builtinNames) };
}

// Returns { themes, broken }: usable themes, and name → reason for the files that were skipped.
export function readUserThemes(home, builtinNames) {
  const dir = join(home, 'themes');
  const themes = [];
  const broken = new Map();
  if (!existsSync(dir)) return { themes, broken };
  for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.json')).sort()) {
    const { name, theme, errors } = readThemeFile(join(dir, f), builtinNames);
    if (errors.length) broken.set(name, { file: `themes/${f}`, reason: errors.join('; ') });
    else themes.push(theme);
  }
  return { themes, broken };
}
