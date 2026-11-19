// Browser check for the "Copy as image" toolbar button (src/runtime/copy-image.js): the button shows on any page with a sheet or doc,
// a browser that cannot copy (no rasterizer, a feature policy that forbids clipboard-write, or no async Clipboard API / secure
// context) disables it with the matching label, and a click writes a real PNG blob to the clipboard. Safari and unknown browsers keep
// the button but carry an "effect not guaranteed" note, and a refused clipboard reports a failure without downloading anything. It
// needs a Chromium-family browser, so it runs only with AM_E2E=1 (and AM_CHROME when the binary is not auto-detected, e.g. Edge).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';
import { loadMath } from '../src/math-load.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser copy-image test'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

let tmp;
let file;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const load = async (url) => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};

before(async () => {
  if (SKIP) return;
  await loadMath('$x$');
  tmp = mkdtempSync(join(tmpdir(), 'am-copy-image-'));
  file = join(tmp, 'page.html');
  const preLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const src = `---\nlang: en\n---\n## A\nThe value is 42.\n\n## B\nA paragraph with **bold** and a table.\n\n| k | v |\n|---|---|\n| a | 1 |\n\n\`\`\`flow\n[A] -> [B]\n\`\`\`\n\n$$\nx = 1\n$$\n\n## C\n\`\`\`html\n<pre id="constrained-pre" style="max-height: 40px; overflow: auto">${preLines}</pre>\n\`\`\`\n\nA paragraph following constrained pre.\n`;
  writeFileSync(file, renderDoc(src, {}, {}, {}).html);
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
});

after(async () => {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((r) => {
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

// The button's state after the runtime has read it: whether it is shown, whether it is disabled, its label and title/aria-label, and
// the data-* texts the page carries so the assertions compare against the page's own labels, not a hard-coded string.
const BUTTON_STATE = `(() => {
  const btn = document.querySelector('[data-am="copy-image"]');
  if (!btn) return { error: 'button not in the page' };
  return {
    hidden: btn.hidden,
    disabled: btn.disabled,
    text: btn.textContent,
    title: btn.getAttribute('title'),
    ariaLabel: btn.getAttribute('aria-label'),
    unavailableBrowser: btn.dataset.unavailableBrowser,
    unavailableClipboard: btn.dataset.unavailableClipboard,
    unavailablePolicy: btn.dataset.unavailablePolicy,
    unverifiedEffect: btn.dataset.unverifiedEffect,
  };
})()`;

// Capture what the button writes to the clipboard (a real file:// page is a secure context, so the button enables itself), then read
// the PNG out of the ClipboardItem it passed.
const CLICK_AND_CAPTURE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('[data-am="copy-image"]');
  if (!btn) return { error: 'button not in the page' };
  const revealed = !btn.hidden;
  let captured = null;
  try {
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items) => { captured = items; } });
  } catch (e) {
    navigator.clipboard.write = async (items) => { captured = items; };
  }
  btn.click();
  for (let i = 0; i < 200 && !captured; i++) await sleep(50);
  if (!captured) return { revealed, error: 'no clipboard write', label: btn.textContent };
  const item = captured[0];
  const blob = await item.getType('image/png');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return { revealed, types: item.types, size: blob.size, png, label: btn.textContent };
})()`;

test('copy-image: the button appears and a click writes a real PNG to the clipboard', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_AND_CAPTURE);
  assert.equal(r.revealed, true, 'the button is revealed in a Chromium secure context');
  assert.ok(r.types && r.types.includes('image/png'), `the ClipboardItem holds image/png (${JSON.stringify(r)})`);
  assert.ok(r.png, `the blob starts with the PNG signature (${JSON.stringify(r)})`);
  assert.ok(r.size > 1000, `the PNG has real pixels, not an empty canvas (${r.size} bytes)`);
  assert.equal(r.label, 'Copied ✓', 'the button reports the copy');
});

// Run the page with these overrides in place before its scripts, then remove them.
const withOverrides = async (source, fn) => {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
  try {
    await load(pathToFileURL(file).href);
    return await fn();
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
};
const NO_UA_DATA = "Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });";
const userAgent = (ua) => `Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ${JSON.stringify(ua)}, configurable: true });`;
const HIDDEN = 'document.querySelector(\'[data-am="copy-image"]\').hidden';

test('copy-image: Safari keeps the button enabled but says the effect is not guaranteed', { skip: SKIP }, async () => {
  // Safari exposes ClipboardItem and clipboard.write but no navigator.userAgentData, and no Chrome/ or Firefox/ in its user agent.
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  await withOverrides(NO_UA_DATA + userAgent(safari), async () => {
    assert.equal(await evaluate('typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function"'), true, 'the Clipboard API is there');
    const s = await evaluate(BUTTON_STATE);
    assert.equal(s.hidden, false, 'the button is shown');
    assert.equal(s.disabled, false, 'the button stays enabled');
    assert.ok(s.unverifiedEffect && s.title.includes(s.unverifiedEffect), `the title carries the unverified-effect note (${JSON.stringify(s)})`);
    assert.ok(s.ariaLabel.includes(s.unverifiedEffect), `the accessible name carries the unverified-effect note (${JSON.stringify(s)})`);
  });
});

test('copy-image: Firefox keeps the button enabled (it rasterizes the page since 160)', { skip: SKIP }, async () => {
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0';
  await withOverrides(NO_UA_DATA + userAgent(firefox), async () => {
    const s = await evaluate(BUTTON_STATE);
    assert.equal(s.hidden, false, 'the button is shown');
    assert.equal(s.disabled, false, 'the button stays enabled');
  });
});

test('copy-image: a Chromium host without navigator.userAgentData (Electron, WebView2) shows the button', { skip: SKIP }, async () => {
  const electron = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SomeApp/1.2.3 Chrome/128.0.6613.36 Electron/32.0.1 Safari/537.36';
  await withOverrides(NO_UA_DATA + userAgent(electron), async () => {
    assert.equal(await evaluate(HIDDEN), false, 'the button is shown');
  });
});

test('copy-image: a preview whose feature policy forbids clipboard-write disables the button with the policy note', { skip: SKIP }, async () => {
  const policy = "Object.defineProperty(document, 'featurePolicy', { configurable: true, value: { allowsFeature: (name) => name !== 'clipboard-write' } });";
  await withOverrides(policy, async () => {
    const s = await evaluate(BUTTON_STATE);
    assert.equal(s.hidden, false, 'the button is still shown');
    assert.equal(s.disabled, true, 'the button is disabled');
    assert.equal(s.text, s.unavailablePolicy, `the button explains the policy (${JSON.stringify(s)})`);
  });
});

for (const [what, source] of [
  ['no ClipboardItem', 'delete window.ClipboardItem;'],
  ['a page that is not a secure context', "Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });"],
]) {
  test(`copy-image: with ${what}, the button is disabled with the clipboard note`, { skip: SKIP }, async () => {
    await withOverrides(source, async () => {
      const s = await evaluate(BUTTON_STATE);
      assert.equal(s.hidden, false, 'the button is still shown');
      assert.equal(s.disabled, true, 'the button is disabled');
      assert.equal(s.text, s.unavailableClipboard, `the button explains the missing clipboard (${JSON.stringify(s)})`);
    });
  });
}

// A refused clipboard reports a failure; it must not download a PNG.
const CLICK_FAILURE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('[data-am="copy-image"]');
  const revealed = !btn.hidden;
  let wrote = false;
  try { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { wrote = true; throw new Error('refused'); } }); }
  catch (e) { navigator.clipboard.write = async () => { wrote = true; throw new Error('refused'); }; }
  let clicked = 0;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicked += 1; };
  btn.click();
  for (let i = 0; i < 200 && !wrote; i++) await sleep(50);
  await sleep(100);
  HTMLAnchorElement.prototype.click = orig;
  return { revealed, wrote, clicked, label: btn.textContent, failed: btn.dataset.failed, status: document.querySelector('[data-am="copy-image-status"]')?.textContent ?? null };
})()`;

test('copy-image: a refused clipboard reports the failure and downloads nothing', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_FAILURE);
  assert.equal(r.revealed, true, 'the button is revealed');
  assert.equal(r.wrote, true, 'the clipboard write was attempted');
  assert.equal(r.clicked, 0, `no download is triggered (${JSON.stringify(r)})`);
  assert.equal(r.label, r.failed, `the button reports a failed copy (${JSON.stringify(r)})`);
  assert.equal(r.status, r.failed, 'a screen reader hears the failure through the status region');
});

// A custom theme can give the body a multi-layer background. The PNG must keep its background (the wrapper is opaque), which
// breaks if the colour and image are combined in one background shorthand.
const CLICK_MULTI_BG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.body.style.backgroundColor = 'rgb(10, 20, 30)';
  document.body.style.backgroundImage = 'linear-gradient(45deg, #123456, #654321), radial-gradient(circle, #222, #444)';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const btn = document.querySelector('[data-am="copy-image"]');
  let captured = null;
  Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async (items) => { captured = items; } });
  btn.click();
  for (let i = 0; i < 200 && !captured; i++) await sleep(50);
  if (!captured) return { error: 'no clipboard write' };
  const blob = await captured[0].getType('image/png');
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(1, 1, 1, 1).data;
  return { alpha: px[3], rgb: [px[0], px[1], px[2]] };
})()`;

test('copy-image: a multi-layer body background stays opaque in the PNG', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CLICK_MULTI_BG);
  assert.equal(r.error, undefined, `the capture succeeded (${JSON.stringify(r)})`);
  assert.equal(r.alpha, 255, `the corner is opaque, so the background was drawn (${JSON.stringify(r)})`);
});

const CAPTURE_SVG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let svgSrc = null;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) {
      if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) {
        svgSrc = decodeURIComponent(val.split(',')[1]);
      }
      origSrc.set.call(this, val);
    },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  const btn = document.querySelector('[data-am="copy-image"]');
  btn.click();
  for (let i = 0; i < 200 && !svgSrc; i++) await sleep(50);
  Object.defineProperty(Image.prototype, 'src', origSrc);
  if (!svgSrc) return { error: 'svg not captured' };
  const doc = new DOMParser().parseFromString(svgSrc, 'image/svg+xml');
  const tableWrap = doc.querySelector('.am-table-wrap');
  const diagram = doc.querySelector('.am-diagram');
  const mathBlock = doc.querySelector('.am-math-block');
  return {
    found: !!tableWrap && !!diagram && !!mathBlock,
    tableWrap: {
      overflow: tableWrap?.style?.overflow ?? null,
      height: tableWrap?.style?.height ?? null,
      maxHeight: tableWrap?.style?.maxHeight ?? null,
    },
    diagram: {
      overflow: diagram?.style?.overflow ?? null,
      height: diagram?.style?.height ?? null,
      maxHeight: diagram?.style?.maxHeight ?? null,
    },
    mathBlock: {
      overflow: mathBlock?.style?.overflow ?? null,
      height: mathBlock?.style?.height ?? null,
      maxHeight: mathBlock?.style?.maxHeight ?? null,
    },
  };
})()`;

test('copy-image: scrolling containers reset overflow to visible, height to auto, and max-height to none in rasterized SVG', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CAPTURE_SVG);
  assert.equal(r.found, true, 'table wrap, diagram, and math block exist in the rendered SVG');
  assert.equal(r.tableWrap.overflow, 'visible', 'table wrap overflow is reset to visible');
  assert.equal(r.tableWrap.height, 'auto', 'table wrap height is reset to auto');
  assert.equal(r.tableWrap.maxHeight, 'none', 'table wrap max-height is reset to none');
  assert.equal(r.diagram.overflow, 'visible', 'diagram overflow is reset to visible');
  assert.equal(r.diagram.height, 'auto', 'diagram height is reset to auto');
  assert.equal(r.diagram.maxHeight, 'none', 'diagram max-height is reset to none');
  assert.equal(r.mathBlock.overflow, 'visible', 'math block overflow is reset to visible');
  assert.equal(r.mathBlock.height, 'auto', 'math block height is reset to auto');
  assert.equal(r.mathBlock.maxHeight, 'none', 'math block max-height is reset to none');
});

const CAPTURE_CONSTRAINED = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let svgSrc = null;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) {
      if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) {
        svgSrc = decodeURIComponent(val.split(',')[1]);
      }
      origSrc.set.call(this, val);
    },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  const btn = document.querySelector('[data-am="copy-image"]');
  btn.click();
  for (let i = 0; i < 200 && !svgSrc; i++) await sleep(50);
  Object.defineProperty(Image.prototype, 'src', origSrc);
  if (!svgSrc) return { error: 'svg not captured' };

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = svgSrc;
  document.body.appendChild(container);

  const pre = container.querySelector('#constrained-pre');
  const panel = pre ? pre.closest('.am-panel') : null;
  const p = panel ? panel.querySelector('p') : null;
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  const pRect = p ? p.getBoundingClientRect() : null;
  const preStyle = pre ? {
    overflow: pre.style.overflow,
    height: pre.style.height,
    maxHeight: pre.style.maxHeight,
  } : null;

  const res = {
    found: !!panel && !!pre && !!p,
    preStyle,
    panelRect: panelRect ? { top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height } : null,
    pRect: pRect ? { top: pRect.top, bottom: pRect.bottom, height: pRect.height } : null,
    withinBounds: panelRect && pRect ? pRect.bottom <= panelRect.bottom : false,
  };
  container.remove();
  return res;
})()`;

test('copy-image: constrained code block keeps max-height and hides overflow without clipping following content in panel', { skip: SKIP }, async () => {
  await load(pathToFileURL(file).href);
  const r = await evaluate(CAPTURE_CONSTRAINED);
  assert.equal(r.found, true, `panel, constrained pre, and following paragraph exist in the rendered SVG (${JSON.stringify(r)})`);
  assert.equal(r.preStyle.overflow, 'hidden', 'constrained pre overflow is set to hidden');
  assert.equal(r.preStyle.maxHeight, '40px', 'constrained pre max-height is preserved');
  assert.ok(r.preStyle.height && r.preStyle.height !== 'auto', 'constrained pre height is preserved and not reset to auto');
  assert.equal(r.withinBounds, true, `paragraph bottom (${r.pRect?.bottom}) is within panel bottom (${r.panelRect?.bottom})`);
});
