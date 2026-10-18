// The data directory: ~/.answer-me-with-html, or AM_HOME (amHome in config.js picks one).
import { mkdirSync, existsSync, statSync, lstatSync, chmodSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

// The private folder in the system temporary folder where a default-location page goes when the data directory is not writable
// (a host sandbox that allows writes only in the workspace and the temporary folder). One folder for each user: Linux /tmp is shared.
export const tempHome = () => join(tmpdir(), process.getuid ? `answer-me-with-html-${process.getuid()}` : 'answer-me-with-html');

export class UnsafeTempHome extends Error {
  constructor(dir) {
    super(`${dir} is not a private folder of this user`);
    this.name = 'UnsafeTempHome';
    this.dir = dir;
  }
}

// The temporary folder, ready to write into. create: make it (0700) when it is missing; without it a missing folder gives null.
// A folder that exists must be a real directory owned by this user that nobody else can enter: another user could have made the
// folder first, or a link to somewhere else. It is refused (UnsafeTempHome), never repaired. Windows has a temporary folder for each user.
export function checkedTempHome({ create = false } = {}) {
  const dir = tempHome();
  if (create) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e; // a dangling link or a file in the way: the check below refuses it
    }
  }
  let info;
  try {
    info = lstatSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT' && !create) return null;
    throw e;
  }
  const mine = process.getuid ? info.uid === process.getuid() && (info.mode & 0o077) === 0 : true;
  if (!info.isDirectory() || !mine) throw new UnsafeTempHome(dir);
  return dir;
}
