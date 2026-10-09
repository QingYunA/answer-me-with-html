// Export tests: the MP4 failure path (when ffmpeg exits midway, report an ExportError instead of crashing or hanging;
// a fake ffmpeg replaces the one on PATH) and the WebM path that needs no ffmpeg at all — the browser encodes the
// frames, so the file is played back in Chrome here. Both need a local Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { devtoolsUrl, connect, exportMp4, exportWebm, findChrome, ExportError } from '../src/video/export.js';
import { renderVideo } from '../src/video/render.js';
import { SAMPLE_RATE } from '../src/video/tts.js';

const chrome = findChrome();
const canRun = Boolean(chrome) && typeof WebSocket !== 'undefined' && process.platform !== 'win32';
// On a busy CI runner Chrome has taken 13 s to print its DevTools URL in a passing run, and more than the
// 20 s default in failing ones (issue #74). A crash still fails at once; only a slow start gets more time.
const CHROME_START_TIMEOUT_MS = 90000;

test('exportMp4: throws ExportError when ffmpeg exits midway, without crashing or hanging', { skip: !canRun && 'needs Chrome and Node 22+', timeout: 150000 }, async () => {
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
      await assert.rejects(exportMp4(page, join(dir, 'v.mp4'), { env, startTimeoutMs: CHROME_START_TIMEOUT_MS }), (e) => e instanceof ExportError && /ffmpeg failed \(1\)/.test(e.message));
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

// Half a second of tone per narration line, so the page really carries a WAV to encode.
const speech = () => ({
  name: 'fake', voice: 'fake', id: 'fake', concurrency: 1,
  synth: async () => Int16Array.from({ length: Math.round(SAMPLE_RATE * 0.5) }, (_, i) => Math.round(8000 * Math.sin(i / 8))),
});

// A Chrome the export tests can drive. The flags are the ones the browser needs to keep a background tab's media clock
// running; `size` pins the window the way the exporter pins it, so a page laid out here lays out as it does in the
// exported frames; `filePixels` lets a page read back the pixels of a video it opened from disk. The session goes away
// with the work, so the caller never has to close anything.
async function withChrome({ size = null, filePixels = false } = {}, work) {
  const dir = mkdtempSync(join(tmpdir(), 'am-play-'));
  const instance = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`,
    '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank',
    // Without these a background tab suspends media playback, and the test would read currentTime 0.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(size ? [`--window-size=${size.width},${size.height}`, '--force-device-scale-factor=1', '--hide-scrollbars'] : []),
    ...(filePixels ? ['--allow-file-access-from-files'] : []),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp = null;
  try {
    cdp = await connect(await devtoolsUrl(instance, 90000));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    if (size) await page('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    await page('Page.enable');
    await page('Page.bringToFront');
    const evaluate = async (expression) => {
      const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const open = async (file) => {
      const loaded = cdp.once('Page.loadEventFired');
      await page('Page.navigate', { url: pathToFileURL(file).href });
      await loaded;
    };
    return await work({ open, evaluate });
  } finally {
    cdp?.close();
    await new Promise((r) => {
      if (instance.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      instance.once('exit', () => { clearTimeout(timer); r(); });
      instance.kill();
    });
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Chrome's child processes can still write to the profile after the main process exits (ENOTEMPTY on CI);
      // a leftover temp directory does not change what the test checked.
    }
  }
}

// Open the file in Chrome and let it demux, decode and seek. Chrome's own demuxer, VP9 decoder and Opus decoder are
// the last word on whether the container is valid, so nothing here parses the bytes.
// Real-time playback is not the check: a machine without a sound card stalls the media clock, and the decode
// counters plus a seek prove what matters — the file is readable and both tracks decode.
function inspectInChrome(file) {
  return withChrome({}, async ({ open, evaluate }) => {
    await open(file);
    return evaluate(`(async () => {
      const v = document.querySelector('video');
      if (!v) return { error: 'Chrome shows no video element' };
      if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
      try { await v.play(); } catch {}
      await new Promise((r) => setTimeout(r, 700));
      v.pause();
      v.currentTime = 1;
      await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 5000); });
      await new Promise((r) => setTimeout(r, 200));
      return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, seekedTo: v.currentTime, readyState: v.readyState,
        videoBytes: v.webkitVideoDecodedByteCount ?? null, audioBytes: v.webkitAudioDecodedByteCount ?? null, mediaError: v.error && v.error.message };
    })()`);
  });
}

test('exportWebm: the browser encodes a file Chrome plays back, without ffmpeg', { skip: !canRun && 'needs Chrome and Node 22+', timeout: 180000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-webm-'));
  try {
    const { html } = await renderVideo('---\ntitle: WebM 导出\n---\n## 场景\n```flow\nA -> B: 握手\n```\n> A 先连到 B。\n', { provider: speech() });
    const page = join(dir, 'v.html');
    writeFileSync(page, html);
    const file = join(dir, 'v.webm');

    const result = await exportWebm(page, file);
    assert.equal(result.audio, true, 'the narration in the page was encoded too');
    assert.ok(result.frames > 30, `frames: ${result.frames}`);

    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3', 'the file starts with the EBML header');
    for (const mark of ['webm', 'V_VP9', 'A_OPUS', 'OpusHead']) {
      assert.ok(bytes.includes(Buffer.from(mark)), `the file holds ${mark}`);
    }

    const played = await inspectInChrome(file);
    assert.ok(!played.error, played.error);
    assert.ok(!played.mediaError, played.mediaError);
    assert.ok(Math.abs(played.duration - result.duration) < 0.5, `duration ${played.duration} against ${result.duration}`);
    assert.equal(played.width, 1920);
    assert.equal(played.height, 1080);
    assert.ok(Math.abs(played.seekedTo - 1) < 0.2, `the player seeks into the file: ${played.seekedTo}`);
    assert.ok(played.videoBytes > 0, `the VP9 track decodes: ${played.videoBytes} bytes`);
    if (played.audioBytes !== null) assert.ok(played.audioBytes > 0, `the Opus track decodes: ${played.audioBytes} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A frame of the WebM is an SVG the page builds itself, and an SVG carries no stylesheet: every style is inlined on the clone. A
// pseudo-element is not a node, so a clone cannot carry it — and the connectors a tree, a timeline or an annotated sentence draws with
// ::before / ::after (plus the drawing sheet's inner frame) were missing from every exported frame. The tree root draws one connector
// under its box; the window that line sits in is read off the player page, then looked up in the decoded frame.
const CONNECTOR = `(async () => {
  await document.fonts.ready;
  window.__amv.exportMode();
  const fps = window.__amv.fps;
  const at = (Math.ceil(window.__amv.duration * fps) - 1) / fps;   // the last frame the exporter writes
  window.render(at);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const root = document.querySelector('.am-tree-root');
  const cols = document.querySelector('.am-tree-cols');
  if (!root || !cols) return { error: 'the tree is not in the scene' };
  const box = root.getBoundingClientRect();
  const line = getComputedStyle(root, '::after');
  const height = parseFloat(line.height) || 0;
  let bg = null;
  for (let el = root; el && !bg; el = el.parentElement) {
    const colour = getComputedStyle(el).backgroundColor;
    if (colour && colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') bg = colour;
  }
  return { at, x: box.left + box.width / 2, top: box.bottom - height + 2, height: Math.max(1, height - 4), line: line.borderLeftColor, bg };
})()`;

// The pixels of the frame at the measured moment: the connector's window, and the same window shifted into the empty gap beside it.
const frameAt = (probe) => `(async () => {
  const v = document.querySelector('video');
  if (!v) return { error: 'Chrome shows no video element' };
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  v.pause();
  v.currentTime = ${probe.at};
  await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 5000); });
  await new Promise((r) => setTimeout(r, 200));
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(v, 0, 0);
  // "A pixel of the line": as far from the background as at least half of what the line colour is, so a dark theme reads the same way.
  const bg = ${probe.bgLum};
  const half = Math.abs(${probe.lineLum} - bg) / 2;
  const read = (x) => {
    const d = ctx.getImageData(Math.round(x), Math.round(${probe.top}), 6, ${probe.height}).data;
    let marks = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (Math.abs(l - bg) > half) marks++;
    }
    return marks;
  };
  return { at: v.currentTime, video: [v.videoWidth, v.videoHeight], line: read(${probe.x} - 3), control: read(${probe.x} - 43) };
})()`;

const lum = (css) => {
  const [r, g, b] = css.match(/[\d.]+/g).map(Number);
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
};

async function connectorPixels(pageFile, videoFile) {
  return withChrome({ size: { width: 1920, height: 1080 }, filePixels: true }, async ({ open, evaluate }) => {
    await open(pageFile);
    const scene = await evaluate(CONNECTOR);
    if (scene.error) return { scene };
    await open(videoFile);
    return { scene, frame: await evaluate(frameAt({ ...scene, lineLum: lum(scene.line), bgLum: lum(scene.bg) })) };
  });
}

test('exportWebm: the frames keep the connectors a component draws with ::before / ::after', { skip: !canRun && 'needs Chrome and Node 22+', timeout: 180000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-webm-tree-'));
  try {
    // One root with two children: an org chart, whose box the root connector hangs under.
    const { html } = await renderVideo('---\ntitle: Tree\n---\n## 场景\n```tree\nRoot | 根\n  one\n  two\n```\n> 看图。\n');
    const page = join(dir, 'v.html');
    writeFileSync(page, html);
    const file = join(dir, 'v.webm');
    await exportWebm(page, file);

    const { scene, frame } = await connectorPixels(page, file);
    assert.equal(scene.error, undefined, scene.error);
    assert.equal(frame.error, undefined, frame.error);
    assert.deepEqual(frame.video, [1920, 1080], 'the sampled frame is the stage at 1:1');
    assert.ok(Math.abs(frame.at - scene.at) < 0.1, `the frame was sampled at ${frame.at}, the picture was measured at ${scene.at}`);
    assert.ok(frame.line >= 6, `the connector the tree draws with ::after is missing from the frame (${JSON.stringify({ scene, frame })})`);
    assert.equal(frame.control, 0, `the window beside the connector is not empty background (${JSON.stringify({ scene, frame })})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
