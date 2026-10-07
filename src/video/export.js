// --mp4: local Chrome (headless, via the Chrome DevTools Protocol) calls the player page's render(t) frame by frame and screenshots it,
// then ffmpeg encodes H.264 and muxes the narration track. No Playwright / Puppeteer dependency.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hasCommand } from '../sys.js';

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportError';
  }
}

const CDP_TIMEOUT_MS = 30000;
const CHROME_START_TIMEOUT_MS = 20000;

const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
};

export function findChrome(env = process.env, platform = process.platform) {
  const custom = env.AM_CHROME || env.CHROME_PATH;
  if (custom) return custom;
  const list = CHROME_PATHS[platform] ?? CHROME_PATHS.linux;
  return list.find((p) => (p.includes('/') || p.includes('\\') ? existsSync(p) : hasCommand(p))) ?? null;
}

export async function exportMp4(htmlFile, mp4File, { wav, env = process.env, onProgress = () => {}, startTimeoutMs = CHROME_START_TIMEOUT_MS } = {}) {
  if (typeof WebSocket === 'undefined') throw new ExportError('MP4 export needs Node.js 22 or later (built-in WebSocket)');
  if (!hasCommand('ffmpeg')) throw new ExportError('MP4 export needs ffmpeg: on macOS run brew install ffmpeg; on Linux install it with the package manager');
  const chromePath = findChrome(env);
  if (!chromePath) throw new ExportError('No Chrome / Chromium / Edge found. Set the browser path with the AM_CHROME environment variable');

  const tmp = mkdtempSync(join(tmpdir(), 'am-export-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=1920,1080', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp = null;
  try {
    cdp = await connect(await devtoolsUrl(chrome, startTimeoutMs));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page('Page.enable');
    const loaded = cdp.once('Page.loadEventFired');
    await page('Page.navigate', { url: pathToFileURL(htmlFile).href });
    await loaded;
    const evaluate = async (expression) => {
      const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new ExportError(`Player page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const info = await evaluate('document.fonts.ready.then(() => { window.__amv.exportMode(); return { duration: window.__amv.duration, fps: window.__amv.fps }; })');

    const wavFile = wav ? join(tmp, 'voice.wav') : null;
    if (wav) writeFileSync(wavFile, wav);
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'mjpeg', '-i', '-',
      ...(wavFile ? ['-i', wavFile] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium',
      ...(wavFile ? ['-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
      '-movflags', '+faststart', mp4File,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    let exited = false;
    ffmpeg.stderr.on('data', (d) => { ffErr += d; });
    // When ffmpeg exits early, writing to stdin raises EPIPE; swallow it here and let done report the error.
    ffmpeg.stdin.on('error', () => {});
    const done = new Promise((resolve, reject) => {
      ffmpeg.on('error', (e) => { exited = true; reject(new ExportError(`Cannot run ffmpeg: ${e.message}`)); });
      ffmpeg.on('close', (code) => {
        exited = true;
        if (code === 0) resolve();
        else reject(new ExportError(`ffmpeg failed (${code}): ${ffErr.slice(0, 300)}`));
      });
    });
    done.catch(() => {}); // attach the handler first, so no unhandled rejection occurs during the frame loop

    const frames = Math.ceil(info.duration * info.fps);
    for (let i = 0; i < frames && !exited; i++) {
      await evaluate(`render(${i / info.fps})`);
      const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
      if (exited) break;
      if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
        await Promise.race([new Promise((r) => ffmpeg.stdin.once('drain', r)), done.catch(() => {})]);
      }
      if (i % 30 === 0 || i === frames - 1) onProgress(i + 1, frames);
    }
    if (!exited) ffmpeg.stdin.end();
    await done;
    return { frames, duration: info.duration };
  } finally {
    cdp?.close();
    await new Promise((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // A temp-directory cleanup failure does not affect the finished video.
    }
  }
}

// Waits for Chrome to print its DevTools URL. A failure message carries the end of Chrome's stderr,
// so a crash at start can be told apart from a slow start.
export function devtoolsUrl(chrome, timeoutMs = CHROME_START_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const fail = (msg) => {
      clearTimeout(timer);
      const tail = buf.trim().split('\n').slice(-5).join('\n');
      reject(new ExportError(tail ? `${msg}. Chrome stderr:\n${tail}` : msg));
    };
    const timer = setTimeout(() => fail(`Chrome did not start in time (${timeoutMs / 1000} s)`), timeoutMs);
    chrome.on('error', (e) => fail(`Cannot start Chrome: ${e.message}`));
    chrome.on('close', (code, signal) => fail(`Chrome exited (${code ?? signal}) before it started`));
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
}

// Minimal CDP client: requests/responses paired by id, events awaited once by method name.
export function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const waiters = new Map();
    let id = 0;
    ws.addEventListener('error', () => reject(new ExportError('Cannot connect to Chrome DevTools')));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new ExportError(`CDP ${msg.error.message}`));
        else ok(msg.result);
      } else if (msg.method && waiters.has(msg.method)) {
        waiters.get(msg.method)(msg.params);
        waiters.delete(msg.method);
      }
    });
    ws.addEventListener('open', () => resolve({
      send(method, params = {}, sessionId) {
        return new Promise((ok, fail) => {
          const msgId = ++id;
          const timer = setTimeout(() => {
            pending.delete(msgId);
            fail(new ExportError(`Chrome is not responding (${method} took more than ${CDP_TIMEOUT_MS / 1000} seconds)`));
          }, CDP_TIMEOUT_MS);
          pending.set(msgId, { ok: (v) => { clearTimeout(timer); ok(v); }, fail: (e) => { clearTimeout(timer); fail(e); } });
          ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      once: (method) => new Promise((r) => waiters.set(method, r)),
      close: () => ws.close(),
    }));
  });
}
