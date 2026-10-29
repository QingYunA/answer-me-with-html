// Headless Chrome for the export commands. Video export and page export both start one Chrome with a throwaway profile,
// open a page and talk to it over the DevTools Protocol, with no npm dependency. This module holds what they share:
// discovery, the minimal CDP client, the start/wait/close of the browser, and the open-one-page dance.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from './sys.js';

export class ExportError extends Error {}

const CDP_TIMEOUT_MS = 30000;
const CHROME_START_TIMEOUT_MS = 20000;

const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
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

// Start Chrome with a throwaway profile and open one page in it. Every caller exports one page, so this owns the target,
// the session and the cleanup: `finally { await close() }`. width and height set the window and the emulated viewport;
// deviceScaleFactor is what makes the captured pixels larger than the CSS pixels. flags adds Chrome switches.
export async function openPage(url, {
  env = process.env,
  chromePath = findChrome(env),
  startTimeoutMs = CHROME_START_TIMEOUT_MS,
  width,
  height = 900,
  deviceScaleFactor = 1,
  media,
  flags = [],
  scriptError = 'Page script error',
} = {}) {
  if (!chromePath) throw new ExportError('No Chrome / Chromium / Edge found. Set the browser path with the AM_CHROME environment variable');

  const tmp = mkdtempSync(join(tmpdir(), 'am-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    ...(width ? [`--force-device-scale-factor=${deviceScaleFactor}`, `--window-size=${width},${height}`] : []),
    ...flags, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let cdp = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
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
      // Chrome's child processes can still write to the profile after the main process exits; a leftover temp
      // directory does not change what the caller did.
    }
  };

  try {
    cdp = await connect(await devtoolsUrl(chrome, startTimeoutMs));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    if (width) await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    if (media) await page('Emulation.setEmulatedMedia', { media });
    await page('Page.enable');
    const loaded = cdp.once('Page.loadEventFired');
    await page('Page.navigate', { url });
    await loaded;
    const evaluate = async (expression) => {
      const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new ExportError(`${scriptError}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    return { page, evaluate, close, tmp, chrome };
  } catch (e) {
    await close();
    throw e;
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
