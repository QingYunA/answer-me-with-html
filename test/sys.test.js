// renameOver: a rename that Windows refuses while another process holds a file is tried again; anything else fails at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameOver } from '../src/sys.js';

const failing = (codes) => {
  const calls = [];
  const rename = (from, to) => {
    calls.push([from, to]);
    const code = codes.shift();
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, rename };
};

test('renameOver: on Windows a busy file is tried again until the rename works', () => {
  const { calls, rename } = failing(['EPERM', 'EBUSY', 'EACCES']);
  const waits = [];
  renameOver('a', 'b', { platform: 'win32', rename, wait: (ms) => waits.push(ms) });
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [20, 40, 60]);
});

test('renameOver: on Windows it gives up after five more tries and throws the last error', () => {
  const { calls, rename } = failing(Array(10).fill('EBUSY'));
  const waits = [];
  assert.throws(() => renameOver('a', 'b', { platform: 'win32', rename, wait: (ms) => waits.push(ms) }), { code: 'EBUSY' });
  assert.equal(calls.length, 6);
  assert.equal(waits.reduce((sum, ms) => sum + ms, 0), 300);
});

test('renameOver: other errors, and any error off Windows, are thrown at once', () => {
  for (const [platform, code] of [['win32', 'ENOENT'], ['linux', 'EBUSY'], ['darwin', 'EPERM']]) {
    const { calls, rename } = failing([code]);
    assert.throws(() => renameOver('a', 'b', { platform, rename, wait: () => assert.fail('no wait') }), { code });
    assert.equal(calls.length, 1, `${platform} ${code}`);
  }
});

test('renameOver: with the real file system it replaces the target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-sys-'));
  try {
    writeFileSync(join(dir, 'new'), 'new');
    writeFileSync(join(dir, 'old'), 'old');
    renameOver(join(dir, 'new'), join(dir, 'old'));
    assert.equal(readFileSync(join(dir, 'old'), 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
