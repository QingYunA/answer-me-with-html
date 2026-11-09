// Browser seam for the page color scheme (#395): every mode block tells the browser which native UI (scrollbar, form controls)
// to draw. The check is the one from the issue: getComputedStyle(document.documentElement).colorScheme in each mode, and under an
// emulated dark system auto keeps "light dark" and takes the dark palette. Slow and needs Chrome, so it runs only with AM_E2E=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser color-scheme tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
title: Color scheme
lang: en
---
## A Page

The scrollbar and the native controls follow the page mode (#395).
`;

let tmp;
let chrome;
let cdp;
let session;
let file;

const page = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
// The toolbar's Mode list is how a reader changes the mode; the runtime writes it to the root.
const setMode = (mode) => evaluate(`(() => {
  const select = document.querySelector('select[data-am="mode"]');
  select.value = ${JSON.stringify(mode)};
  select.dispatchEvent(new Event('change'));
  return select.value;
})()`);
const scheme = () => evaluate('getComputedStyle(document.documentElement).colorScheme');
const paper = () => evaluate('getComputedStyle(document.documentElement).getPropertyValue("--paper").trim()');
const systemScheme = (value) => page('Emulation.setEmulatedMedia', { media: '', features: value ? [{ name: 'prefers-color-scheme', value }] : [] });

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-scheme-'));
  file = join(tmp, 'scheme.html');
  writeFileSync(file, renderDoc(DRAFT).html);
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=1440,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable');
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
});

after(async () => {
  cdp?.close();
  if (chrome) {
    await new Promise((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    // Chrome helper processes can still write to the profile after the main process exits (#74).
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

test('e2e color-scheme: light, dark and auto set the computed color-scheme of the page root', { skip: SKIP, timeout: 180000 }, async () => {
  assert.equal(await setMode('light'), 'light');
  assert.equal(await scheme(), 'light');
  assert.equal(await setMode('dark'), 'dark');
  assert.equal(await scheme(), 'dark');
  assert.equal(await setMode('auto'), 'auto');
  assert.equal(await scheme(), 'light dark');
});

test('e2e color-scheme: auto on a dark system keeps "light dark" and takes the dark palette', { skip: SKIP, timeout: 180000 }, async () => {
  await setMode('auto');
  await systemScheme('light');
  const lightPaper = await paper();
  await systemScheme('dark');
  assert.equal(await scheme(), 'light dark', 'auto keeps offering both schemes');
  assert.notEqual(await paper(), lightPaper, 'the page palette follows the system');
  await systemScheme('light');
  assert.equal(await paper(), lightPaper);
  await systemScheme(null);
});

test('e2e color-scheme: a fixed-dark video theme computes to dark without dark tokens', { skip: SKIP, timeout: 180000 }, async () => {
  const source = '---\ntitle: Fixed dark\n---\n## A\n```flow\nA -> B\n```\n> A goes to B.\n';
  const { html } = await renderVideo(source, { overrides: { theme: '3b1b', mode: 'light' } });
  const video = join(tmp, 'fixed-dark.html');
  writeFileSync(video, html);
  const loaded = cdp.once('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(video).href });
  await loaded;
  assert.equal(await scheme(), 'dark');
});
