// Data-directory maintenance: usage stats, am clean, cleanup notice; after a render, collects the cleanup and update notices.
// Notices are printed only for the Agent (one line starting with "! "), which asks the user whether to act; the CLI never deletes automatically.
import { readdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DAY, readState, writeState } from './state.js';
import { updateEnabled, updateHint, shouldCheckUpdate, spawnUpdateCheck } from './update.js';

export const CLEAN = Object.freeze({
  days: 30,                 // am clean deletes pages, drafts and videos older than 30 days by default
  bigBytes: 200 * 2 ** 20,  // notify at once above 200 MB
  staleDays: 30,            // more than 30 days since the last cleanup…
  staleBytes: 20 * 2 ** 20, // …and above 20 MB: notify
  hintEveryDays: 7,         // the same notice at most once every 7 days
});
const DIRS = ['pages', 'drafts', 'videos', 'cache'];

// List regular files in a directory. Symlinks and unreadable entries are skipped, so stats never fail on a single file.
function walk(dir) {
  let entries;
  try {
    // The root entry may also be a symlink; lstat does not follow links, so cleanup never touches external files in the target directory.
    if (!lstatSync(dir).isDirectory()) return [];
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    try {
      const s = lstatSync(p);
      return s.isFile() ? [{ path: p, bytes: s.size, mtime: s.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
}

const sum = (files) => files.reduce((n, f) => n + f.bytes, 0);

export function usage(home) {
  const parts = Object.fromEntries(DIRS.map((d) => {
    const files = walk(join(home, d));
    return [d, { count: files.length, bytes: sum(files) }];
  }));
  return { ...parts, total: DIRS.reduce((n, d) => n + parts[d].bytes, 0) };
}

// Delete pages, drafts and videos older than days, plus the whole voice cache (it can be regenerated). all: delete everything (config is kept).
export function clean(home, { days = CLEAN.days, all = false, dryRun = false, now = Date.now() } = {}) {
  const cutoff = now - days * DAY;
  const victims = [
    ...['pages', 'drafts', 'videos'].flatMap((d) => walk(join(home, d)).filter((f) => all || f.mtime < cutoff)),
    ...walk(join(home, 'cache')),
  ];
  if (!dryRun) {
    for (const f of victims) rmSync(f.path, { force: true });
    writeState(home, { lastClean: now, lastCleanHint: null });
  }
  return { files: victims.length, bytes: sum(victims) };
}

export const mb = (bytes) => (bytes < 2 ** 20 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 2 ** 20).toFixed(bytes < 10 * 2 ** 20 ? 1 : 0)} MB`);

// Return the notice text when a cleanup notice is due, otherwise null.
export function cleanHint(state, use, now = Date.now()) {
  if (state.lastCleanHint && now - state.lastCleanHint < CLEAN.hintEveryDays * DAY) return null;
  const since = state.lastClean ?? state.firstSeen ?? now;
  const days = Math.floor((now - since) / DAY);
  const big = use.total >= CLEAN.bigBytes;
  const stale = days >= CLEAN.staleDays && use.total >= CLEAN.staleBytes;
  if (!big && !stale) return null;
  const pages = `${use.pages.count} page${use.pages.count === 1 ? '' : 's'}`;
  const parts = `${pages} ${mb(use.pages.bytes)}, videos ${mb(use.videos.bytes)}, voice-over cache ${mb(use.cache.bytes)}`;
  const when = state.lastClean ? `last cleaned ${days} days ago` : 'never cleaned';
  return `! Cleanup hint: the data directory uses ${mb(use.total)} (${parts}), ${when}. Ask the user whether to run am clean (deletes pages, drafts and videos older than ${CLEAN.days} days and empties the voice-over cache; am clean --all deletes everything).`;
}

// Called after every render: record the first-use time, return the notices to print, and schedule the background version check when needed.
export function afterRender({ home, env, config, current, scriptPath, background, now = Date.now() }) {
  let state = readState(home);
  if (!state.firstSeen) state = writeState(home, { firstSeen: now });
  const hints = [];
  const c = cleanHint(state, usage(home), now);
  if (c) {
    hints.push(c);
    state = writeState(home, { lastCleanHint: now });
  }
  const u = updateEnabled(env, config) ? updateHint(state, current, scriptPath, now) : null;
  if (u) {
    hints.push(u);
    writeState(home, { lastUpdateHint: now });
  }
  if (background && scriptPath && shouldCheckUpdate(state, env, config, now)) spawnUpdateCheck(home, scriptPath);
  return hints;
}
