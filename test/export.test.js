// MP4 export failure path: when ffmpeg exits midway, report an ExportError instead of crashing or hanging.
// A fake ffmpeg (exits with code 1 after reading a few input chunks) replaces the one on PATH; needs a local Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { devtoolsUrl, exportMp4, findChrome, ExportError } from '../src/video/export.js';
import { renderVideo } from '../src/video/render.js';

const chrome = findChrome();
const canRun = Boolean(chrome) && typeof WebSocket !== 'undefined' && process.platform !== 'win32';

test('exportMp4: throws ExportError when ffmpeg exits midway, without crashing or hanging', { skip: !canRun && 'needs Chrome and Node 22+', timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-export-fail-'));
  try {
    const fake = join(dir, 'ffmpeg');
    writeFileSync(fake, '#!/bin/sh\nhead -c 200000 >/dev/null\necho "fake ffmpeg: boom" >&2\nexit 1\n');
    chmodSync(fake, 0o755);
    const { html } = await renderVideo('## 场景\n```flow\nA -> B\n```\n> A 连到 B。\n');
    const page = join(dir, 'v.html');
    writeFileSync(page, html);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    const prevPath = process.env.PATH;
    process.env.PATH = env.PATH; // hasCommand and spawn both look up ffmpeg on PATH
    try {
      await assert.rejects(exportMp4(page, join(dir, 'v.mp4'), { env }), (e) => e instanceof ExportError && /ffmpeg failed \(1\)/.test(e.message));
    } finally {
      process.env.PATH = prevPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A stand-in for Chrome: writes to stderr, then exits or keeps running.
const fakeChrome = (script) => spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });

test('devtoolsUrl: rejects at once when Chrome exits before it listens, and shows its stderr', async () => {
  const started = Date.now();
  await assert.rejects(devtoolsUrl(fakeChrome('process.stderr.write("no usable sandbox\\n"); process.exit(3)')),
    (e) => e instanceof ExportError && /exited \(3\)/.test(e.message) && /no usable sandbox/.test(e.message));
  assert.ok(Date.now() - started < 5000, 'must not wait for the start timeout');
});

test('devtoolsUrl: the start timeout shows the stderr Chrome printed so far', async () => {
  const chrome = fakeChrome('process.stderr.write("still loading\\n"); setTimeout(() => {}, 60000)');
  try {
    await assert.rejects(devtoolsUrl(chrome, 300),
      (e) => e instanceof ExportError && /did not start in time/.test(e.message) && /still loading/.test(e.message));
  } finally {
    chrome.kill();
  }
});
