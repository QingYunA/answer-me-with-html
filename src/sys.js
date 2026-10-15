// Small helpers that deal with the operating system.
import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';

export function hasCommand(cmd) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
}

// Rename a file over another one. On Windows a rename fails while another process holds either file, typically a virus scanner
// reading the file that was just written, so it is tried again a few times, about 300 ms in all. Other errors are thrown at once.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function renameOver(from, to, { platform = process.platform, rename = renameSync, wait = sleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return rename(from, to);
    } catch (e) {
      if (platform !== 'win32' || attempt > 5 || !BUSY.has(e.code)) throw e;
      wait(20 * attempt);
    }
  }
}
