// am theme add / list / update / remove: the commands around the theme catalog (src/themes/catalog.js does the work).
// Output follows am theme check and am config: ✓ done, ✗ failed (stderr), ! a note. Exit 0 = ok, 1 = a step failed, 2 = bad usage.
// Remote text never reaches the output: only theme names (a-z, 0-9, -) and x.y.z versions from the catalog are printed.
import { join } from 'node:path';
import { VERSION } from './assets.js';
import { amHome, readConfig, setConfig, resetConfig, ConfigError } from './config.js';
import { newer } from './version.js';
import { NAME } from './themes/check.js';
import { BUILTIN, BUILTIN_NAMES, loadThemes } from './themes/registry.js';
import { readUserThemes } from './themes/user.js';
import {
  CatalogError, fetchIndex, fetchTheme, install, needsNewer, readInstalled, readInstalledFile, isUnchanged, remove, themeFile, themesDir,
} from './themes/catalog.js';

export const THEME_MARKET_USAGE = 'am theme add <name> [--use] [--force] | list [--remote] | update [name] | remove <name>';

export async function cmdThemeMarket(action, target, opts, ctx) {
  const net = { timeoutMs: ctx.io?.catalogTimeoutMs };
  if (net.timeoutMs === undefined) delete net.timeoutMs;
  if (action === 'add') return add(target, opts, ctx, net);
  if (action === 'list') return list(opts, ctx, net);
  if (action === 'update') return update(target, ctx, net);
  return removeTheme(target, ctx);
}

const usage = (fail, text) => (fail(`✗ Usage: ${text}`), 2);
const names = (index) => index.themes.map((t) => t.name).join(' | ') || '(none)';

async function add(name, opts, { print, fail, env }, net) {
  if (!name) return usage(fail, 'am theme add <name> [--use] [--force]');
  if (!NAME.test(name)) {
    fail(`✗ "${name}" is not a catalog theme name (lowercase letters, digits and -). am theme add takes names from the catalog only, not URLs or paths`);
    return 2;
  }
  const home = amHome(env);
  let index;
  try {
    index = await fetchIndex(env, net);
  } catch (e) {
    return netFail(e, fail);
  }
  const entry = index.themes.find((t) => t.name === name);
  if (!entry) {
    fail(`✗ No catalog theme named "${name}". Available: ${names(index)}`);
    return 2;
  }
  if (needsNewer(entry)) {
    fail(`✗ ${name} ${entry.version} needs Answer me with HTML ${entry.requires} or newer (this is ${VERSION})`);
    return 1;
  }
  let bytes;
  try {
    bytes = await fetchTheme(index, entry, net);
  } catch (e) {
    return netFail(e, fail, `${name}: `);
  }
  const path = themeFile(home, name);
  const { status, previous } = install(home, entry, bytes, { force: opts.force });
  if (status === 'conflict') {
    fail(`✗ ${path} already exists and differs from the catalog version of ${name}; it may be your own theme. Nothing was changed. To replace it: am theme add ${name} --force`);
    return 1;
  }
  const done = {
    installed: `✓ Installed ${name} ${entry.version}: ${path}`,
    same: `✓ ${name} ${entry.version} is already installed: ${path}`,
    updated: `✓ Updated ${name} ${previous ?? '?'} → ${entry.version}: ${path}`,
    replaced: `✓ Replaced ${name} with the catalog version ${entry.version}: ${path}`,
  }[status];
  print(done);
  if (opts.use) {
    try {
      print(`✓ theme = ${setConfig('theme', name, env, loadThemes(home))}`);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      fail(`✗ ${e.message}`);
      return 1;
    }
  } else if (status !== 'same') {
    print(`  Use it: theme: ${name} in a draft, --theme ${name}, or am config set theme ${name}`);
  }
  return 0;
}

// A catalog problem as one ✗ line (stderr), exit 1. Anything else is a bug and goes up.
function netFail(e, fail, prefix = '') {
  if (!(e instanceof CatalogError)) throw e;
  fail(`✗ ${prefix}${e.message}`);
  return 1;
}

// Where an installed theme file came from.
function sourceOf(home, name, installed) {
  if (!installed[name]) return { source: 'local', version: '-' };
  return { source: isUnchanged(home, name, installed) ? 'catalog' : 'catalog, edited', version: installed[name].version };
}

async function list(opts, { print, fail, env }, net) {
  const home = amHome(env);
  print('Built-in themes:');
  for (const t of BUILTIN.list('page')) print(`  ${t.name.padEnd(11)}${t.summary}`);

  const { themes: usable, broken } = readUserThemes(home, BUILTIN_NAMES);
  const installed = readInstalled(home);
  const rows = [...usable.map((t) => t.name), ...broken.keys()].sort();
  print(`\nInstalled themes (${themesDir(home)}):`);
  if (!rows.length) print('  none. Install one with: am theme add <name>   (list the catalog: am theme list --remote)');
  for (const name of rows) {
    const { source, version } = sourceOf(home, name, installed);
    const bad = broken.get(name);
    print(`  ${name.padEnd(11)}${version.padEnd(8)}${source}${bad ? `  ✗ skipped: ${bad.reason}` : ''}`);
  }
  if (!opts.remote) return 0;

  let index;
  try {
    index = await fetchIndex(env, net);
  } catch (e) {
    return netFail(e, fail);
  }
  print(`\nCatalog (${index.url}):`);
  for (const t of index.themes) {
    const mine = installed[t.name];
    const here = readInstalledFile(home, t.name) !== null;
    let state;
    if (needsNewer(t)) state = `needs Answer me with HTML ${t.requires} or newer`;
    else if (!here) state = `not installed: am theme add ${t.name}`;
    else if (!mine) state = `a file of this name is installed that is not from the catalog; to replace it: am theme add ${t.name} --force`;
    else if (mine.sha256 !== t.sha256 && !newer(mine.version, t.version)) state = `update available (installed ${mine.version}): am theme update ${t.name}`;
    else state = 'installed';
    print(`  ${t.name.padEnd(11)}${t.version.padEnd(8)}${state}`);
  }
  return 0;
}

async function update(target, { print, fail, env }, net) {
  const home = amHome(env);
  const installed = readInstalled(home);
  if (target !== undefined && !NAME.test(target)) return usage(fail, 'am theme update [name]');
  if (target !== undefined && !installed[target]) {
    if (readInstalledFile(home, target)) fail(`✗ ${target} was not installed from the catalog. To replace it with the catalog version: am theme add ${target} --force`);
    else fail(`✗ No theme named "${target}" is installed from the catalog`);
    return 2;
  }
  const todo = Object.keys(installed).filter((n) => target === undefined || n === target).sort();
  if (!todo.length) {
    print('No themes installed from the catalog. Install one with: am theme add <name>');
    return 0;
  }
  let index;
  try {
    index = await fetchIndex(env, net);
  } catch (e) {
    return netFail(e, fail);
  }
  let failed = false;
  for (const name of todo) {
    const mine = installed[name];
    if (readInstalledFile(home, name) === null) {
      print(`! ${name}: the file is gone from ${themesDir(home)}; reinstall it with: am theme add ${name}`);
    } else if (!isUnchanged(home, name, installed)) {
      print(`! ${name} skipped: the file changed since it was installed. To replace it with the catalog version: am theme add ${name} --force`);
    } else {
      const entry = index.themes.find((t) => t.name === name);
      if (!entry) print(`! ${name}: no longer in the catalog; kept ${mine.version}`);
      else if (entry.sha256 === mine.sha256 || newer(mine.version, entry.version)) print(`✓ ${name} is up to date (${mine.version})`);
      else if (needsNewer(entry)) print(`! ${name} ${entry.version} needs Answer me with HTML ${entry.requires} or newer (this is ${VERSION}); kept ${mine.version}`);
      else {
        try {
          const bytes = await fetchTheme(index, entry, net);
          install(home, entry, bytes);
          print(`✓ Updated ${name} ${mine.version} → ${entry.version}`);
        } catch (e) {
          failed = true;
          netFail(e, fail, `${name}: `);
        }
      }
    }
  }
  return failed ? 1 : 0;
}

function removeTheme(name, { print, fail, env }) {
  if (!name) return usage(fail, 'am theme remove <name>');
  if (BUILTIN_NAMES.includes(name)) {
    fail(`✗ "${name}" is a built-in theme and cannot be removed`);
    return 2;
  }
  const home = amHome(env);
  if (!NAME.test(name) || readInstalledFile(home, name) === null) {
    fail(`✗ No theme named "${name}" in ${themesDir(home)}`);
    return 2;
  }
  const wasDefault = readConfig(env, loadThemes(home)).stored.theme === name;
  remove(home, name);
  print(`✓ Removed ${join(themesDir(home), `${name}.json`)}`);
  if (wasDefault) {
    resetConfig('theme', env);
    print(`! ${name} was the default theme; the default is auto again`);
  }
  print('  Pages already made keep their look: a page carries its own theme.');
  return 0;
}
