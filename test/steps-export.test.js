// Export seam for the steps block (#440). Image export (`am export --png`, the toolbar's Copy / Download as image) and PDF show
// the static look: no bar and no boxes, every step numbered on its item and its first line, and the numbered list under the pair,
// even when the reader had a step selected. Needs Chrome, so it runs only with AM_E2E=1 like test/export-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPage } from '../src/chrome.js';
import { writePngSlices } from '../src/export.js';
import { renderDoc } from '../src/render.js';
import { findChrome } from '../src/video/export.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser steps export test'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
lang: en
style: off
---
## Copy

\`\`\`js start=10
const a = 1;
const b = 2;
const c = 3;
\`\`\`

\`\`\`flow TB
Start -> Middle
Middle -> End
\`\`\`

\`\`\`steps
Start 10: Begin here.
Middle 11: The middle part.
End 12: Finish.
\`\`\`
`;

let tmp;
let file;
before(() => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-steps-export-'));
  file = join(tmp, 'page.html');
  writeFileSync(file, renderDoc(DRAFT, {}, {}).html);
});
after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

// What a picture of the page would show: computed display of the live parts and the static parts.
const LOOK = `(() => {
  const root = document.querySelector('.am-steps');
  const shown = (sel) => { const el = root.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
  return {
    live: root.classList.contains('am-steps--live'),
    bar: root.querySelector('.am-steps-bar') ? shown('.am-steps-bar') : false,
    note: root.querySelector('.am-steps-note') ? shown('.am-steps-note') : false,
    badge: shown('.am-step-badge'),
    list: shown('.am-steps-list'),
    boxed: [...root.querySelectorAll('.am-ln')].filter((l) => getComputedStyle(l).boxShadow !== 'none').length,
  };
})()`;

test('PNG export: a selected step is cleared from the picture, and the numbers and the list show', { skip: SKIP, timeout: 120000 }, async () => {
  const chrome = await openPage(pathToFileURL(file).href, { width: 1000, height: 900 });
  try {
    await chrome.evaluate("document.querySelector('[data-link=\"1\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    assert.equal(await chrome.evaluate("document.querySelectorAll('.am-ln.am-step-on').length"), 1, 'the step is selected before the export');
    assert.equal((await chrome.evaluate(LOOK)).boxed, 1, 'and its line is boxed');
    const out = join(tmp, 'png');
    const written = await writePngSlices(chrome, file, out);
    assert.ok(written.length >= 1);
    assert.deepEqual(readdirSync(out).sort(), written.map((f) => basename(f)).sort());
    const look = await chrome.evaluate(LOOK);
    assert.equal(look.live, false, 'the export takes the live class off');
    assert.equal(look.bar, false);
    assert.equal(look.note, false);
    assert.equal(look.boxed, 0);
    assert.equal(look.badge, true);
    assert.equal(look.list, true);
  } finally {
    await chrome.close();
  }
});

test('PDF export: print media shows the static look with the live class still on', { skip: SKIP, timeout: 120000 }, async () => {
  const chrome = await openPage(pathToFileURL(file).href, { width: 1000, height: 900, media: 'print' });
  try {
    await chrome.evaluate("document.querySelector('[data-link=\"1\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    const look = await chrome.evaluate(LOOK);
    assert.equal(look.bar, false);
    assert.equal(look.note, false);
    assert.equal(look.badge, true);
    assert.equal(look.list, true);
  } finally {
    await chrome.close();
  }
});

// The toolbar's Copy as image clones the page into an SVG image; this captures that SVG.
const CAPTURE_SVG = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let svg = null;
  const origSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(Image.prototype, 'src', {
    set(val) { if (typeof val === 'string' && val.startsWith('data:image/svg+xml')) svg = decodeURIComponent(val.split(',')[1]); origSrc.set.call(this, val); },
    get() { return origSrc.get.call(this); },
    configurable: true,
  });
  document.querySelector('[data-link="1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.querySelector('[data-export="copy"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 200 && !svg; i++) await sleep(50);
  Object.defineProperty(Image.prototype, 'src', origSrc);
  await sleep(100);
  return { svg, live: document.querySelector('.am-steps').classList.contains('am-steps--live'), boxed: document.querySelectorAll('.am-ln.am-step-on').length };
})()`;

test('Copy as image: the clone has the numbers and the list, no bar, no note, and the page keeps its selection', { skip: SKIP, timeout: 120000 }, async () => {
  const chrome = await openPage(pathToFileURL(file).href, { width: 1000, height: 900 });
  try {
    await chrome.page('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    const r = await chrome.evaluate(CAPTURE_SVG);
    assert.ok(r.svg, 'the page was drawn to an SVG image');
    assert.ok(r.svg.includes('am-step-badge'), 'the badges are in the picture');
    const list = r.svg.match(/<ol[^>]*am-steps-list[^>]*>/)?.[0] ?? '';
    assert.ok(list && !/display:\s*none/.test(list), `the list is shown in the picture: ${list}`);
    assert.ok(!r.svg.includes('am-steps-bar') && !r.svg.includes('am-steps-note'), 'no bar or note in the picture');
    assert.equal(r.live, true, 'the page is live again after the picture');
    assert.equal(r.boxed, 1, 'and keeps the reader\'s step');
  } finally {
    await chrome.close();
  }
});
