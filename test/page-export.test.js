// `am export`: the slice-point calculation without Chrome, the CLI usage and missing-Chrome paths, and one end-to-end
// export of a rendered page guarded by AM_E2E=1 (Chrome, like the other browser tests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, symlinkSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { main } from '../src/cli.js';
import { slicePoints, isHtmlPage, removeStaleSlices, writePngSlices, MAX_SLICE, VIEWPORT, DEVICE_SCALE } from '../src/export.js';
import { renderDoc } from '../src/render.js';
import { findChrome } from '../src/video/export.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-page-export-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function run(args, { env = {} } = {}) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from(['']),
    env: { AM_NO_OPEN: '1', AM_HOME: dir, ...env }, cwd: dir,
  });
  return { code, out: out.text, err: err.text };
}

test('slicePoints: no blocks cuts at the limit', () => {
  assert.deepEqual(slicePoints(4500, [], 1800), [1800, 3600]);
  assert.deepEqual(slicePoints(1800, [], 1800), []);
});

test('slicePoints: a cut moves into the gap between blocks', () => {
  const boxes = [{ top: 0, bottom: 1600 }, { top: 1700, bottom: 3000 }];
  // 1800 is inside the second block, so the cut moves up to its top (a horizontal gap).
  assert.deepEqual(slicePoints(3000, boxes, 1800), [1700]);
  assert.deepEqual(slicePoints(4000, [{ top: 0, bottom: 400 }, { top: 600, bottom: 1000 }, { top: 1500, bottom: 2000 }], 1800), [1500, 3300]);
});

test('slicePoints: one block taller than the limit is cut at the limit', () => {
  assert.deepEqual(slicePoints(5000, [{ top: 0, bottom: 5000 }], 1800), [1800, 3600]);
});

test('slicePoints: no cut falls inside a block when a gap exists', () => {
  const boxes = [{ top: 0, bottom: 400 }, { top: 600, bottom: 1000 }, { top: 1500, bottom: 2000 }, { top: 2400, bottom: 3100 }];
  const cuts = slicePoints(5000, boxes, 1800);
  assert.ok(cuts.length > 0);
  for (const cut of cuts) {
    assert.ok(!boxes.some((b) => cut > b.top && cut < b.bottom), `cut ${cut} is inside a block`);
  }
});

test('isHtmlPage: an existing .html file only', () => {
  const page = join(dir, 'is-html.html');
  writeFileSync(page, '<html></html>');
  writeFileSync(join(dir, 'is-html.txt'), 'x');
  assert.equal(isHtmlPage(page), true);
  assert.equal(isHtmlPage(join(dir, 'is-html.txt')), false);
  assert.equal(isHtmlPage(join(dir, 'missing.html')), false);
});

test('cli export: no --pdf or --png is a usage error', async () => {
  const r = await run(['export', 'page.html']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--pdf <file\.pdf> or --png <dir>/);
  assert.equal(r.out, '');
});

test('cli export: an empty --pdf or --png value exits 2', async () => {
  for (const flag of ['--pdf=', '--png=']) {
    const r = await run(['export', 'page.html', flag]);
    assert.equal(r.code, 2);
    assert.match(r.err, new RegExp(`${flag.slice(0, -1)} needs a path`));
    assert.equal(r.out, '');
  }
});

test('cli export: an unreadable page path exits 2 with a readable error', { skip: (process.platform === 'win32' || process.getuid?.() === 0) ? 'needs a non-root POSIX user' : false }, async () => {
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'page.html'), '<html><body></body></html>');
  chmodSync(locked, 0o000);
  try {
    const r = await run(['export', 'locked/page.html', '--pdf', 'out.pdf']);
    assert.equal(r.code, 2);
    assert.match(r.err, /Cannot read the page locked\/page\.html/);
    assert.doesNotMatch(r.err, /Internal error/);
    assert.equal(r.out, '');
  } finally {
    chmodSync(locked, 0o700);
  }
});

test('cli export: a PDF path that is the input page is refused', { skip: typeof WebSocket === 'undefined' && 'needs Node 22 (built-in WebSocket)' }, async () => {
  const html = '<html><body><p>source</p></body></html>';
  writeFileSync(join(dir, 'same-page.html'), html);
  const r = await run(['export', 'same-page.html', '--pdf', 'same-page.html']);
  assert.equal(r.code, 1);
  assert.match(r.err, /is the input page/);
  assert.equal(readFileSync(join(dir, 'same-page.html'), 'utf8'), html, 'the page is not overwritten');
  // A hard link has its own path but shares the page's inode, so writing the PDF there would replace the page too.
  linkSync(join(dir, 'same-page.html'), join(dir, 'same-page-link.pdf'));
  const linked = await run(['export', 'same-page.html', '--pdf', 'same-page-link.pdf']);
  assert.equal(linked.code, 1);
  assert.match(linked.err, /is the input page/);
  assert.equal(readFileSync(join(dir, 'same-page.html'), 'utf8'), html, 'a hard link does not overwrite the page');
});

test('cli export: a PDF named like one of the PNG slices is refused', { skip: typeof WebSocket === 'undefined' && 'needs Node 22 (built-in WebSocket)' }, async () => {
  writeFileSync(join(dir, 'clash.html'), '<html><body><p>clash</p></body></html>');
  const r = await run(['export', 'clash.html', '--pdf', 'shots/clash-1.png', '--png', 'shots']);
  assert.equal(r.code, 1);
  assert.match(r.err, /has the name of a PNG slice/);
  assert.ok(!existsSync(join(dir, 'shots')), 'nothing is written');
  for (const name of ['clash-0.png', 'clash-01.png', 'clash-1.pdf', 'other-1.png']) {
    const ok = await run(['export', 'clash.html', '--pdf', `shots/${name}`, '--png', 'shots'], { env: { AM_CHROME: join(dir, 'no-such-chrome') } });
    assert.doesNotMatch(ok.err, /has the name of a PNG slice/, `${name} is not a slice name`);
  }
});

// The folder check used to compare path text only, so a symlink to the PNG folder slipped through and the stale-slice
// cleanup deleted the PDF after the command had already reported it.
test('cli export: a slice-named PDF reached through a symlink to the PNG folder is refused', {
  skip: typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, async () => {
  writeFileSync(join(dir, 'alias.html'), '<html><body><p>alias</p></body></html>');
  const real = join(dir, 'alias-real');
  mkdirSync(real);
  symlinkSync(real, join(dir, 'alias-link'));
  writeFileSync(join(real, 'alias-9.png'), '%PDF-1.4 already');
  const r = await run(['export', 'alias.html', '--pdf', 'alias-link/alias-9.png', '--png', 'alias-real'], { env: { AM_CHROME: join(dir, 'no-such-chrome') } });
  assert.equal(r.code, 1);
  assert.match(r.err, /has the name of a PNG slice/);
  assert.equal(readFileSync(join(real, 'alias-9.png'), 'utf8'), '%PDF-1.4 already', 'the PDF is not removed');
  const pdf = await run(['export', 'alias.html', '--pdf', 'alias-link/alias.pdf', '--png', 'alias-real'], { env: { AM_CHROME: join(dir, 'no-such-chrome') } });
  assert.equal(pdf.code, 1);
  assert.match(pdf.err, /No browser at/);
  assert.doesNotMatch(pdf.err, /has the name of a PNG slice/);
});

test('cli export: a slice-named PDF in a missing folder under a symlink is refused', {
  skip: typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, async () => {
  writeFileSync(join(dir, 'missing-alias.html'), '<html><body>source</body></html>');
  const real = join(dir, 'missing-alias-real');
  const alias = join(dir, 'missing-alias-link');
  mkdirSync(real);
  symlinkSync(real, alias);
  for (const [pdfParent, pngParent] of [[alias, real], [real, alias]]) {
    const folder = join(pngParent, 'new', 'nested');
    const r = await run(['export', 'missing-alias.html', '--pdf', join(pdfParent, 'new', 'nested', 'missing-alias-9.png'), '--png', folder], {
      env: { AM_CHROME: join(dir, 'no-such-chrome') },
    });
    assert.equal(r.code, 1);
    assert.match(r.err, /has the name of a PNG slice/);
    assert.equal(r.out, '');
    assert.equal(existsSync(folder), false, 'the collision is caught before creating the folder');
  }
});

// A stand-in for the browser: the height decides how many slices the writer emits, and each PNG's bytes name that height.
function fakePage(height, { shots } = {}) {
  let shot = 0;
  return {
    async page(method) {
      if (method !== 'Page.captureScreenshot') return {};
      shot += 1;
      if (shots && shot > shots) throw new Error('capture failed');
      return { data: Buffer.from(`h${height}-s${shot}`).toString('base64') };
    },
    async evaluate(expr) {
      return String(expr).includes('scrollHeight') ? { empty: false, height, boxes: [] } : true;
    },
  };
}

test('writePngSlices: a shorter re-export removes leftover slices of this page only', async () => {
  const folder = join(dir, 'shorter');
  const html = join(dir, 'page.html');
  writeFileSync(html, '<html>page</html>');
  const warnings = [];
  const onWarn = (message) => warnings.push(message);

  const long = await writePngSlices(fakePage(4000), html, folder, onWarn);
  assert.deepEqual(long.map((f) => basename(f)), ['page-1.png', 'page-2.png', 'page-3.png']);
  const firstSlice = readFileSync(join(folder, 'page-1.png'));

  writeFileSync(join(folder, 'other-1.png'), 'keep-other');
  writeFileSync(join(folder, 'page-2.txt'), 'keep-txt');
  writeFileSync(join(folder, 'page-01.png'), 'keep-pad');
  writeFileSync(join(folder, 'page-2.png.bak'), 'keep-bak');
  writeFileSync(join(folder, 'notes.png'), 'keep-notes');
  writeFileSync(join(folder, 'page-1-1.png'), 'keep-other-page');
  mkdirSync(join(folder, 'nested'));
  writeFileSync(join(folder, 'nested', 'page-2.png'), 'keep-nested');
  mkdirSync(join(folder, 'page-9.png'));
  writeFileSync(join(folder, 'page-9.png', 'inside'), 'keep-dir');
  writeFileSync(join(folder, 'unrelated.png'), 'keep-unrelated');
  if (process.platform !== 'win32') {
    symlinkSync(html, join(folder, 'page-8.png'));
    symlinkSync(join(folder, 'unrelated.png'), join(folder, 'page-7.png'));
    linkSync(html, join(folder, 'page-6.png'));
  }

  const short = await writePngSlices(fakePage(100), html, folder, onWarn);
  assert.deepEqual(short.map((f) => basename(f)), ['page-1.png']);
  assert.notDeepEqual(readFileSync(join(folder, 'page-1.png')), firstSlice, 'the new slice replaces the old one');
  assert.equal(existsSync(join(folder, 'page-2.png')), false);
  assert.equal(existsSync(join(folder, 'page-3.png')), false);
  assert.equal(existsSync(join(folder, 'page-7.png')), false, 'a symlink to some other file is removed');
  for (const name of ['other-1.png', 'page-2.txt', 'page-01.png', 'page-2.png.bak', 'notes.png', 'page-1-1.png', 'unrelated.png']) {
    assert.equal(existsSync(join(folder, name)), true, name);
  }
  assert.equal(readFileSync(join(folder, 'nested', 'page-2.png'), 'utf8'), 'keep-nested');
  assert.equal(readFileSync(join(folder, 'page-9.png', 'inside'), 'utf8'), 'keep-dir');
  assert.equal(readFileSync(html, 'utf8'), '<html>page</html>');
  const text = warnings.join('\n');
  assert.match(text, /page-9\.png/);
  assert.match(text, /not a PNG file/);
  if (process.platform !== 'win32') {
    assert.match(text, /page-8\.png/);
    assert.match(text, /page-6\.png/);
    assert.match(text, /input page/);
    assert.equal(existsSync(join(folder, 'page-8.png')), true, 'a symlink to the page stays');
    assert.equal(existsSync(join(folder, 'page-6.png')), true, 'a hard link to the page stays');
    assert.equal(readFileSync(join(folder, 'unrelated.png'), 'utf8'), 'keep-unrelated');
  }
  assert.equal(warnings.some((w) => /other-1|page-2\.txt|page-01|notes\.png|page-1-1|nested/.test(w)), false);
});

test('writePngSlices: a failed export leaves earlier slices in place', async () => {
  const folder = join(dir, 'failed');
  const html = join(dir, 'fail.html');
  writeFileSync(html, '<html>fail</html>');
  await writePngSlices(fakePage(4000), html, folder);
  const kept = readFileSync(join(folder, 'fail-2.png'));
  await assert.rejects(() => writePngSlices(fakePage(4000, { shots: 1 }), html, folder), /capture failed/);
  assert.equal(readFileSync(join(folder, 'fail-1.png')).toString(), 'h4000-s1', 'the first slice of the failed run was written');
  assert.deepEqual(readFileSync(join(folder, 'fail-2.png')), kept, 'a slice the failed run never reached stays');
  assert.equal(existsSync(join(folder, 'fail-3.png')), true);
});

test('writePngSlices: the last hard link to the input page stays when its original path disappears', async () => {
  const folder = join(dir, 'missing-input');
  const html = join(dir, 'missing-input.html');
  const source = '<html>source draft</html>';
  mkdirSync(folder);
  writeFileSync(html, source);
  const linked = join(folder, 'missing-input-9.png');
  linkSync(html, linked);
  writeFileSync(join(folder, 'missing-input-8.png'), 'stale');
  const page = fakePage(100);
  const capture = page.page;
  page.page = async (method) => {
    if (method === 'Page.captureScreenshot') rmSync(html);
    return capture(method);
  };
  const warnings = [];
  const written = await writePngSlices(page, html, folder, (message) => warnings.push(message));
  assert.deepEqual(written.map((f) => basename(f)), ['missing-input-1.png']);
  assert.equal(existsSync(html), false);
  assert.equal(existsSync(linked), true, 'the last name for the source draft must survive cleanup');
  assert.equal(readFileSync(linked, 'utf8'), source);
  assert.equal(existsSync(join(folder, 'missing-input-8.png')), false, 'ordinary stale slices are still removed');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /missing-input-9\.png.*input page/);
});

for (const target of ['1', '9']) test(`writePngSlices: replacing the input protects both drafts at slice ${target}`, async () => {
  const name = `replaced-${target}`;
  const folder = join(dir, name);
  const html = join(dir, `${name}.html`);
  mkdirSync(folder);
  writeFileSync(html, 'original draft');
  const original = join(folder, `${name}-8.png`);
  const replacement = join(folder, `${name}-${target}.png`);
  linkSync(html, original);
  const page = fakePage(100);
  const capture = page.page;
  page.page = async (method) => {
    if (method === 'Page.captureScreenshot') {
      rmSync(html);
      writeFileSync(html, 'replacement draft');
      linkSync(html, replacement);
    }
    return capture(method);
  };
  if (target === '1') {
    await assert.rejects(() => writePngSlices(page, html, folder), /is the input page/);
  } else {
    await writePngSlices(page, html, folder);
  }
  assert.equal(readFileSync(original, 'utf8'), 'original draft');
  assert.equal(readFileSync(html, 'utf8'), 'replacement draft');
  assert.equal(readFileSync(replacement, 'utf8'), 'replacement draft');
});

test('removeStaleSlices: a dangling slice symlink is removed', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const folder = join(dir, 'dangle');
  const html = join(dir, 'dangle.html');
  mkdirSync(folder);
  writeFileSync(html, '<html>dangle</html>');
  writeFileSync(join(folder, 'page-1.png'), 'keep');
  symlinkSync(join(dir, 'no-such-target'), join(folder, 'page-4.png'));
  const warnings = [];
  removeStaleSlices(folder, 'page', new Set(['page-1.png']), html, (message) => warnings.push(message));
  assert.equal(lstatSync(join(folder, 'page-4.png'), { throwIfNoEntry: false }), undefined);
  assert.equal(readFileSync(join(folder, 'page-1.png'), 'utf8'), 'keep');
  assert.deepEqual(warnings, []);
});

test('removeStaleSlices: a folder that cannot be listed, or a slice that cannot be removed, is a warning', () => {
  const html = join(dir, 'warn.html');
  writeFileSync(html, '<html>warn</html>');
  const warnings = [];
  const onWarn = (message) => warnings.push(message);
  removeStaleSlices(join(dir, 'no-such-slice-dir'), 'page', new Set(), html, onWarn);
  assert.match(warnings.at(-1), /Cannot list/);

  const folder = join(dir, 'locked-slices');
  mkdirSync(folder);
  writeFileSync(join(folder, 'page-2.png'), 'old');
  const skip = process.platform === 'win32' || process.getuid?.() === 0;
  if (skip) return;
  chmodSync(folder, 0o555);
  try {
    removeStaleSlices(folder, 'page', new Set(['page-1.png']), html, onWarn);
    assert.match(warnings.at(-1), /Cannot remove the old PNG slice/);
    assert.equal(readFileSync(join(folder, 'page-2.png'), 'utf8'), 'old');
  } finally {
    chmodSync(folder, 0o755);
  }
});

test('cli export: a missing or non-HTML input exits 2', async () => {
  const missing = await run(['export', 'nope.html', '--pdf', 'out.pdf']);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /not an existing \.html file/);

  writeFileSync(join(dir, 'draft.txt'), 'x');
  const wrongType = await run(['export', 'draft.txt', '--pdf', 'out.pdf']);
  assert.equal(wrongType.code, 2);
  assert.match(wrongType.err, /not an existing \.html file/);
});

// Node 20 has no built-in WebSocket, so exportPage stops at its Node check before it looks for Chrome.
test('cli export: a missing Chrome exits 1 with the path and AM_CHROME', { skip: typeof WebSocket === 'undefined' && 'needs Node 22 (built-in WebSocket)' }, async () => {
  const page = join(dir, 'chrome-missing.html');
  writeFileSync(page, '<html><body></body></html>');
  const r = await run(['export', 'chrome-missing.html', '--pdf', 'out.pdf'], { env: { AM_CHROME: join(dir, 'no-such-chrome') } });
  assert.equal(r.code, 1);
  assert.match(r.err, /No browser at .*no-such-chrome \(from AM_CHROME\)/);
  assert.match(r.err, /Set AM_CHROME/);
  assert.equal(r.out, '');
});

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser export test'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const DRAFT = `---
title: Export test
lang: en
---
An intro line.

## A One
Plain text in the first panel.

## B Two
- first point
- second point

## C Three
\`\`\`flow
Ask -> Reply: answer
\`\`\`
`;

test('e2e: the source disappears during Chrome loading and its last hard link survives', { skip: SKIP, timeout: 120000 }, async () => {
  const html = join(dir, 'vanished.html');
  const folder = join(dir, 'vanished');
  mkdirSync(folder);
  let removed = false;
  const server = createServer((_request, response) => {
    if (!removed) { rmSync(html); removed = true; }
    response.writeHead(204).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const source = `<!doctype html><html><body>Source draft<img src="http://127.0.0.1:${server.address().port}/remove"></body></html>`;
    writeFileSync(html, source);
    const linked = join(folder, 'vanished-9.png');
    linkSync(html, linked);
    writeFileSync(join(folder, 'vanished-8.png'), 'stale');
    const r = await run(['export', html, '--png', folder], { env: { AM_CHROME: CHROME } });
    assert.equal(r.code, 0, r.err);
    assert.equal(removed, true, 'Chrome loaded the page and requested its image');
    assert.equal(existsSync(html), false);
    assert.equal(readFileSync(linked, 'utf8'), source);
    assert.equal(existsSync(join(folder, 'vanished-8.png')), false);
    assert.equal(readFileSync(join(folder, 'vanished-1.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(r.err, /vanished-9\.png.*input page/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const variant of ['folder', 'extension', 'prefix']) test(`e2e: PDF and PNG collision respects filesystem case sensitivity (${variant})`, {
  skip: SKIP || (process.platform === 'win32' && variant === 'folder' && 'symlinks need privileges on Windows'), timeout: 120000,
}, async () => {
  const name = `case-${variant}`;
  const html = join(dir, `${name}.html`);
  writeFileSync(html, '<!doctype html><html><body>Case sensitivity test</body></html>');
  const insensitive = existsSync(join(dir, `${name.toUpperCase()}.HTML`));
  const real = join(dir, `${name}-real`);
  mkdirSync(real);
  let pdf;
  let png;
  if (variant === 'folder') {
    const alias = join(dir, `${name}-alias`);
    symlinkSync(real, alias);
    pdf = join(alias, 'new', `${name}-9.png`);
    png = join(real, 'NEW');
  } else {
    pdf = join(real, variant === 'extension' ? `${name}-1.PNG` : `${name.toUpperCase()}-1.png`);
    png = real;
  }
  const r = await run(['export', html, '--pdf', pdf, '--png', png], { env: { AM_CHROME: CHROME } });
  assert.equal(r.code, insensitive ? 1 : 0, r.err);
  if (insensitive) {
    assert.match(r.err, /has the name of a PNG slice/);
    assert.equal(r.out, '', 'a rejected collision is not reported as a successful export');
  } else {
    assert.equal(readFileSync(join(png, `${name}-1.png`)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal(readFileSync(pdf).subarray(0, 4).toString(), '%PDF', 'the PDF is never removed or overwritten by a PNG');
  assert.equal(readFileSync(html, 'utf8'), '<!doctype html><html><body>Case sensitivity test</body></html>');
});

test('e2e: an inaccessible PNG ancestor reports an export error and preserves the PDF', {
  skip: SKIP || ((process.platform === 'win32' || process.getuid?.() === 0) && 'needs a non-root POSIX user'), timeout: 120000,
}, async () => {
  const html = join(dir, 'inaccessible-png.html');
  const pdf = join(dir, 'inaccessible-png.pdf');
  const locked = join(dir, 'inaccessible-png');
  mkdirSync(locked);
  writeFileSync(html, '<!doctype html><html><body>Readable error test</body></html>');
  chmodSync(locked, 0o000);
  try {
    const r = await run(['export', html, '--pdf', pdf, '--png', join(locked, 'nested')], { env: { AM_CHROME: CHROME } });
    assert.equal(r.code, 1);
    assert.match(r.err, /Cannot check the PNG folder.*EACCES/);
    assert.doesNotMatch(r.err, /Internal error/);
    assert.equal(readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
  } finally {
    chmodSync(locked, 0o700);
  }
});

for (const kind of ['hard', 'symbolic']) for (const index of ['1', '9']) test(`e2e: a ${kind} PDF link to slice ${index} is kept intact`, {
  skip: SKIP || (process.platform === 'win32' && kind === 'symbolic' && 'symlinks need privileges on Windows'), timeout: 120000,
}, async () => {
  const name = `pdf-link-${kind}-${index}`;
  const html = join(dir, `${name}.html`);
  const folder = join(dir, name);
  mkdirSync(folder);
  writeFileSync(html, '<!doctype html><html><body>PDF link test</body></html>');
  const target = join(folder, `${name}-${index}.png`);
  const pdf = join(folder, 'report.pdf');
  writeFileSync(target, 'old output');
  (kind === 'hard' ? linkSync : symlinkSync)(target, pdf);
  const r = await run(['export', html, '--pdf', pdf, '--png', folder], { env: { AM_CHROME: CHROME } });
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /has the name of a PNG slice/);
  assert.equal(r.out, '');
  assert.equal(readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(readFileSync(target), readFileSync(pdf));
  assert.equal(readFileSync(html, 'utf8'), '<!doctype html><html><body>PDF link test</body></html>');
});

test('e2e: a PNG slice path that links to the page is refused, and the page is kept', { skip: SKIP || (process.platform === 'win32' && 'symlinks need privileges on Windows'), timeout: 120000 }, async () => {
  const { html } = renderDoc(DRAFT);
  writeFileSync(join(dir, 'linked.html'), html);
  mkdirSync(join(dir, 'linked-png'), { recursive: true });
  symlinkSync(join(dir, 'linked.html'), join(dir, 'linked-png', 'linked-1.png'));
  const r = await run(['export', 'linked.html', '--png', 'linked-png'], { env: { AM_CHROME: CHROME } });
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /is the input page/);
  assert.equal(readFileSync(join(dir, 'linked.html'), 'utf8'), html, 'the page is not overwritten');
});

test('e2e: am export writes an A4 PDF and PNG slices at 2400 px wide', { skip: SKIP, timeout: 120000 }, async () => {
  const { html } = renderDoc(DRAFT);
  writeFileSync(join(dir, 'export-test.html'), html);
  const r = await run(['export', 'export-test.html', '--pdf', 'out/export-test.pdf', '--png', 'png'], { env: { AM_CHROME: CHROME } });
  assert.equal(r.code, 0, r.err);

  const pdf = readFileSync(join(dir, 'out/export-test.pdf'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF', 'the PDF starts with %PDF');
  const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(mediaBox, 'the PDF has a MediaBox');
  assert.ok(Math.abs(Number(mediaBox[1]) - 595.28) < 1, `A4 width, got ${mediaBox[1]}`);
  assert.ok(Math.abs(Number(mediaBox[2]) - 841.89) < 1, `A4 height, got ${mediaBox[2]}`);

  const pngs = readdirSync(join(dir, 'png'))
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => Number(a.match(/-(\d+)\.png$/)[1]) - Number(b.match(/-(\d+)\.png$/)[1]));
  assert.ok(pngs.length >= 1, 'at least one PNG slice');
  assert.equal(pngs[0], 'export-test-1.png');
  for (const name of pngs) {
    const png = readFileSync(join(dir, 'png', name));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} has the PNG signature`);
    assert.equal(png.readUInt32BE(16), VIEWPORT * DEVICE_SCALE, `${name} is 2400 px wide`);
    assert.ok(png.readUInt32BE(20) <= MAX_SLICE * DEVICE_SCALE, `${name} is at most 3600 px tall`);
  }
  assert.match(r.out, /✓ .*export-test\.pdf/);
  assert.match(r.out, /✓ .*export-test-1\.png/);

  writeFileSync(join(dir, 'png', 'export-test-9.png'), 'stale');
  writeFileSync(join(dir, 'png', 'other-1.png'), 'keep');
  writeFileSync(join(dir, 'png', 'export-test-2.txt'), 'keep');
  const again = await run(['export', 'export-test.html', '--png', 'png'], { env: { AM_CHROME: CHROME } });
  assert.equal(again.code, 0, again.err);
  assert.equal(existsSync(join(dir, 'png', 'export-test-9.png')), false, 'a higher slice from before is removed');
  assert.equal(readFileSync(join(dir, 'png', 'other-1.png'), 'utf8'), 'keep');
  assert.equal(readFileSync(join(dir, 'png', 'export-test-2.txt'), 'utf8'), 'keep');
  const againPngs = readdirSync(join(dir, 'png'))
    .filter((f) => /^export-test-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/-(\d+)\.png$/)[1]) - Number(b.match(/-(\d+)\.png$/)[1]));
  assert.deepEqual(againPngs, pngs);

  writeFileSync(join(dir, 'empty.html'), '<!doctype html><html><body></body></html>');
  const empty = await run(['export', 'empty.html', '--png', 'empty-png'], { env: { AM_CHROME: CHROME } });
  assert.equal(empty.code, 1);
  assert.match(empty.err, /The page is empty/);
  assert.equal(existsSync(join(dir, 'empty-png')), false, 'no PNG folder for an empty page');
});
