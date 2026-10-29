// `am export`: the slice-point calculation without Chrome, the CLI usage and missing-Chrome paths, and one end-to-end
// export of a rendered page guarded by AM_E2E=1 (Chrome, like the other browser tests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { slicePoints, isHtmlPage, MAX_SLICE, VIEWPORT, DEVICE_SCALE } from '../src/export.js';
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

test('e2e: am export writes an A4 PDF and PNG slices at 2400 px wide', { skip: SKIP, timeout: 120000 }, async () => {
  const { html } = renderDoc(DRAFT);
  writeFileSync(join(dir, 'export-test.html'), html);
  const r = await run(['export', 'export-test.html', '--pdf', 'out/export-test.pdf', '--png', 'png'], { env: { AM_CHROME: CHROME } });
  assert.equal(r.code, 0, r.err);

  const pdf = readFileSync(join(dir, 'out/export-test.pdf'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF', 'the PDF starts with %PDF');

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
});
