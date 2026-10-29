// `am export`: a rendered page as an A4 PDF and as PNG slices that can be pasted into a chat app. The page is opened as a
// file:// URL in the system Chrome (no npm dependency), printed with its own @media print rules, and captured in screen
// media at 1200 CSS px wide and deviceScaleFactor 2. The interactive chrome (toolbar, reply, remarks, update notice) is
// hidden: a picture has no buttons. The CDP client and Chrome launch code are shared with video export (src/chrome.js).
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPage, findChrome, ExportError } from './chrome.js';

export { ExportError };

export const VIEWPORT = 1200;       // CSS px; a chat app shows a wide page better than a phone layout
export const DEVICE_SCALE = 2;      // 2400 PNG pixels wide
export const MAX_SLICE = 1800;      // CSS px; 3600 PNG pixels tall
const SETTLE_MS = 400;              // web fonts and the sheet planner need a beat after load

// The chrome that makes no sense in a picture. The page's print CSS hides the same controls for the PDF; this is the
// screen-media list, plus the remark popover and the new-version notice, which only @media print hides.
const CHROME_CSS = `.am-toolbar, .am-reply, .am-reply-bar, .am-comment, .am-comment-btn, .am-remark-pop,
.am-update, .am-btn--update, .am-lightbox, .am-code-copy, .am-diagram-expand, .am-toc, .am-delta-switch {
  display: none !important;
}`;

// Where to cut a page of pageHeight CSS px into slices no taller than maxHeight, without cutting through a panel or the
// header when a gap exists. boxes are the page's block boxes ({top, bottom} in CSS px). A cut is moved up to the top of
// the block it would cross, which is a horizontal gap; when even that top is at or above the previous cut (one block
// taller than the limit), the cut falls back to the limit and may split that block. Returns the cut y values; the slices
// are [0, cut1], [cut1, cut2], ...
export function slicePoints(pageHeight, boxes = [], maxHeight = MAX_SLICE) {
  const limit = Math.floor(maxHeight);
  if (!(limit > 0)) throw new RangeError('maxHeight must be greater than 0');
  if (!(pageHeight > 0)) return [];
  const cuts = [];
  let start = 0;
  while (pageHeight - start > limit) {
    const target = start + limit;
    const cut = Math.floor(gapCut(start, target, boxes) ?? target);
    cuts.push(cut > start ? cut : target);
    start = cuts[cuts.length - 1];
  }
  return cuts;
}

// The highest y at or below target that is not strictly inside a box, moving up to a box top while target is inside one.
// null when no such y is above start, which is the fallback case of a single block taller than the limit.
function gapCut(start, target, boxes) {
  let y = target;
  for (;;) {
    const box = boxes.find((b) => y > b.top && y < b.bottom);
    if (!box) return y > start ? y : null;
    if (!(box.top > start)) return null;
    y = box.top;
  }
}

// Write the PDF and/or the PNG slices and return the files written, in that order. The CLI prints them.
export async function exportPage(file, { pdf, png, env = process.env, onFile = () => {} } = {}) {
  if (typeof WebSocket === 'undefined') throw new ExportError('Export needs Node.js 22 or later (built-in WebSocket)');
  // The page holds the source draft in #am-source, so writing the PDF over it would lose the draft.
  if (pdf && existsSync(pdf) && sameFile(pdf, file)) {
    throw new ExportError(`The PDF ${pdf} is the input page: choose another file name`);
  }
  const chrome = findChrome(env);
  if (!chrome) throw new ExportError('No Chrome / Chromium / Edge found. Set the browser path with the AM_CHROME environment variable');
  // A custom path is used as given, so a typo would only show up as a spawn error that does not name the variable to fix.
  if (isPath(chrome) && !existsSync(chrome)) {
    const from = env.AM_CHROME ? 'AM_CHROME' : env.CHROME_PATH ? 'CHROME_PATH' : 'the built-in path';
    throw new ExportError(`No browser at ${chrome} (from ${from}). Set AM_CHROME to the Chrome / Chromium / Edge binary`);
  }
  const page = await openPage(pathToFileURL(file).href, {
    env,
    chromePath: chrome,
    width: VIEWPORT,
    height: 900,
    deviceScaleFactor: DEVICE_SCALE,
    media: 'screen',
  });
  const written = [];
  try {
    if (pdf) {
      const writtenPdf = await writePdf(page, pdf);
      written.push(writtenPdf);
      onFile(writtenPdf);
    }
    if (png) {
      const writtenPngs = await writePngSlices(page, file, png);
      written.push(...writtenPngs);
      writtenPngs.forEach(onFile);
    }
  } finally {
    await page.close();
  }
  return written;
}

async function writePdf(page, file) {
  // Print media: the page's own @media print rules, and the layout runtime's beforeprint / afterprint handling.
  await page.page('Emulation.setEmulatedMedia', { media: 'print' });
  await settle(page);
  const { data } = await page.page('Page.printToPDF', {
    printBackground: true,
    // Part of the agreed contract: a page's own @page rules win. A page written by am has no @page size, so it prints
    // on the A4 paper below; an html fence that sets @page is the author's explicit choice.
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    paperWidth: 8.27,   // A4, 210 x 297 mm
    paperHeight: 11.69,
  });
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(data, 'base64'));
  } catch (e) {
    throw new ExportError(`Cannot write the PDF ${file}: ${e.message}`);
  }
  return file;
}

// A PNG per slice, named <page-name>-1.png, -2.png ... in the folder the user gave (created when missing).
async function writePngSlices(page, htmlFile, folder) {
  await page.page('Emulation.setEmulatedMedia', { media: 'screen' });
  await settle(page);
  const layout = await page.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, ${SETTLE_MS}));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(CHROME_CSS)};
    document.head.append(style);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    };
    return {
      empty: document.body.children.length === 0 && !document.body.textContent.trim(),
      height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
      boxes: [...document.querySelectorAll('.am-head, .am-panel')]
        .filter((el) => el.getClientRects().length)
        .map(box),
    };
  })()`);
  if (layout.empty) throw new ExportError('The page is empty: there is nothing to export');

  try {
    mkdirSync(folder, { recursive: true });
    if (!statSync(folder).isDirectory()) throw new Error('not a folder');
  } catch (e) {
    throw new ExportError(`Cannot use the PNG folder ${folder}: ${e.message}`);
  }

  const cuts = slicePoints(layout.height, layout.boxes, MAX_SLICE);
  const name = basename(htmlFile).replace(/\.html?$/i, '') || 'page';
  const bounds = [0, ...cuts, layout.height];
  const written = [];
  for (let i = 1; i < bounds.length; i++) {
    const top = bounds[i - 1];
    const height = bounds[i] - top;
    if (height <= 0) continue;
    const { data } = await page.page('Page.captureScreenshot', {
      format: 'png',
      // Capture each slice of the full page, not just the part inside a 900px viewport.
      captureBeyondViewport: true,
      clip: { x: 0, y: top, width: VIEWPORT, height, scale: 1 },
    });
    const file = join(folder, `${name}-${i}.png`);
    try {
      writeFileSync(file, Buffer.from(data, 'base64'));
    } catch (e) {
      throw new ExportError(`Cannot write the PNG ${file}: ${e.message}`);
    }
    written.push(file);
  }
  return written;
}

// Let the page re-layout after a media change: the sheet planner restores and re-plans, and fonts may still settle.
const settle = (page) => page.evaluate(`(async () => {
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, ${SETTLE_MS}));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
})()`);

// True when the path names an existing .html file. The CLI uses the same rule before it opens Chrome.
export function isHtmlPage(file) {
  return /\.html?$/i.test(file) && statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

// The same file on disk: a symlink or a hard link to the page is the page, so compare the device and inode, not the path.
const sameFile = (a, b) => {
  const x = statSync(a);
  const y = statSync(b);
  return x.dev === y.dev && x.ino === y.ino;
};

const isPath = (value) => value.includes('/') || value.includes('\\');
