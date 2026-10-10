// The data directory: ~/.answer-me-with-html, or AM_HOME (amHome in config.js picks one).
import { mkdirSync, existsSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultHome = () => join(homedir(), '.answer-me-with-html');

// Create the data directory private to the user (0700): pages can hold private drafts and code, and nobody else can enter the
// folder that holds them. A folder that already exists keeps its mode, except the default location, which is tightened (it has
// been 0755 since the first release); a custom AM_HOME may be shared or served on purpose. No POSIX modes on Windows.
export function ensureHome(home) {
  const fresh = !existsSync(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32' || !(fresh || home === defaultHome())) return;
  // The umask can mask the mode of a new folder, so check instead of trusting mkdir.
  if ((statSync(home).mode & 0o777) !== 0o700) chmodSync(home, 0o700);
}
