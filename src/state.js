// state.json in the data directory: records times such as first use, last cleanup and version check.
// Writes go to a temp file then rename, so concurrency or interruption never leaves a partial file; a bad file reads as empty state.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ensureHome } from './home.js';

export const DAY = 24 * 60 * 60 * 1000;

const statePath = (home) => join(home, 'state.json');

export function readState(home) {
  try {
    const data = JSON.parse(readFileSync(statePath(home), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function writeState(home, patch) {
  const next = { ...readState(home), ...patch };
  ensureHome(home);
  const tmp = `${statePath(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, statePath(home));
  return next;
}
