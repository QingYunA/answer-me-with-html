// The `scale` setting (#302): page text and its lines grow, drawing text stays in viewBox units while the drawing box grows,
// and scale 1 leaves the page exactly as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { readPage } from '../src/page.js';
import { scaleSvgBoxes, svgOpen } from '../src/svg/shapes.js';
import { minSpan } from '../src/templates/sheet.js';
import { SCALE } from '../src/themes/type-scale.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const DIAGRAMS = `---
title: Scale
lang: en
---
## A Flow
\`\`\`flow
Client -> Server: request
Server -> Client: reply
\`\`\`

## B Sequence
\`\`\`sequence
Client -> Server: SYN
Server --> Client: ACK
\`\`\`

## C Chart
\`\`\`chart bar
    | p50
Redis | 12
\`\`\`
`;

test('scale: scale 1 is the default and leaves the page byte-identical', () => {
  const source = '## A\nText.\n```flow\nA -> B\n```\n';
  const plain = renderDoc(source).html;
  assert.equal(renderDoc(source, {}, {}, { scale: 1 }).html, plain);
  assert.equal(renderDoc(source, {}, {}, {}).html, plain);
  assert.doesNotMatch(plain, /data-scale=|--am-scale:/);
});

test('scale: the root carries data-scale only when it is not 1, and readPage reads it back', () => {
  const source = '## A\nText.\n';
  const scaled = renderDoc(source, {}, {}, { scale: 1.25 }).html;
  assert.match(scaled, /<html lang="en" data-theme="[^"]+" data-mode="auto" data-style="80" data-scale="1\.25">/);
  assert.equal(readPage(scaled).scale, 1.25);
  const plain = renderDoc(source).html;
  assert.doesNotMatch(plain, /data-scale=/);
  assert.equal(readPage(plain).scale, 1);
  assert.equal(readPage('<html data-scale="2">').scale, 1);
  assert.equal(readPage('<html data-scale="1.13">').scale, 1.13);
  assert.equal(readPage('<html data-scale="1.15">').scale, 1.15);
});

test('scale: page CSS sets --am-scale after the type scale, and not at 1', () => {
  const source = '## A\nText.\n';
  const scaled = renderDoc(source, {}, {}, { scale: 1.25 }).html;
  assert.match(scaled, /--am-fs-body: calc\(14px \* var\(--am-scale, 1\)\)[\s\S]*html \{ --am-scale: 1\.25; \}/);
  assert.doesNotMatch(renderDoc(source).html, /--am-scale:/);
});

test('scale: every component svg box grows by ceil(viewBox × scale), with the viewBox unchanged', () => {
  const scaled = renderDoc(DIAGRAMS, {}, {}, { scale: 1.25 }).html;
  const svgs = [...scaled.matchAll(/<figure class="am-diagram[^"]*"><svg viewBox="0 0 (\d+) (\d+)" width="(\d+)" height="(\d+)"/g)];
  assert.equal(svgs.length, 3, 'flow, sequence and chart each draw one svg');
  for (const [, w, h, width, height] of svgs) {
    assert.equal(width, String(Math.ceil(Number(w) * 1.25)), `width of a ${w}x${h} drawing`);
    assert.equal(height, String(Math.ceil(Number(h) * 1.25)), `height of a ${w}x${h} drawing`);
  }
  // The toolbar's own icon is page chrome, not a diagram.
  assert.match(scaled, /<svg width="15" height="15" viewBox="0 0 24 24"/);
});

test('scale: a raw svg block is not rewritten', () => {
  const source = '## A\n```svg\n<svg viewBox="0 0 100 50" width="100" height="50"><text>hi</text></svg>\n```\n';
  const html = renderDoc(source, {}, {}, { scale: 1.25 }).html;
  assert.match(html, /<svg viewBox="0 0 100 50" width="100" height="50"><text>hi<\/text><\/svg>/);
});

test('scale: scaleSvgBoxes rewrites exactly the svgOpen pattern', () => {
  const html = svgOpen(101, 50, 'Diagram');
  assert.match(html, /^<svg viewBox="0 0 101 50" width="101" height="50" /);
  assert.equal(scaleSvgBoxes(html, 1), html);
  const bigger = scaleSvgBoxes(html, 1.25);
  assert.match(bigger, /^<svg viewBox="0 0 101 50" width="127" height="63" /);
  assert.equal((bigger.match(/viewBox=/g) ?? []).length, 1);
  const icon = '<svg viewBox="0 0 24 24" width="15" height="15" role="img">';
  assert.equal(scaleSvgBoxes(icon, 1.25), icon, 'a box whose width is not its viewBox is left alone');
});

test('scale: a larger scale can raise a diagram panel from 1 column to 2', () => {
  const html = '<svg viewBox="0 0 480 100" width="480" height="100" role="img">';
  assert.equal(minSpan({ blocks: [], html }), 1);
  assert.equal(minSpan({ blocks: [], html: scaleSvgBoxes(html, 1.25) }), 2);
});

test('scale: every catalog theme page font size follows --am-scale', () => {
  const dir = join(ROOT, 'marketplace/themes');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const css = JSON.parse(readFileSync(join(dir, file), 'utf8')).css ?? '';
    const bare = css.replace(/calc\([^)]*\)/g, '');
    const literal = [...bare.matchAll(/\bfont(?:-size)?\s*:\s*([^;{}]+)/g)].filter(([, value]) => /\b\d+(?:\.\d+)?px\b/.test(value));
    assert.deepEqual(literal.map(([decl]) => decl), [], file);
  }
});

test('scale: the toolbar shows a hidden A− / A+ that carry the range from SCALE', () => {
  const html = renderDoc('---\nlang: en\n---\n## A\nText.\n').html;
  const range = `data-min="${SCALE.min}" data-max="${SCALE.max}" data-step="${SCALE.step}"`;
  for (const [action, label, text] of [['scale-down', 'Smaller text', 'A−'], ['scale-up', 'Larger text', 'A+']]) {
    const button = html.match(new RegExp(`<button class="am-btn" type="button" data-am="${action}"[^>]*>[^<]*</button>`))?.[0];
    assert.ok(button, `${action} is on the page`);
    assert.match(button, / hidden>/, `${action} is hidden until the runtime reveals it`);
    assert.ok(button.includes(range), `${action} carries the range`);
    assert.ok(button.includes(`aria-label="${label}" title="${label}"`), `${action} is labelled for a reader`);
    assert.ok(button.endsWith(`>${text}</button>`), `${action} shows ${text}`);
  }
});

test('scale: the buttons carry the labels of the page language', () => {
  const cases = [
    ['zh', '缩小文字', '放大文字'],
    ['ja', '文字を小さく', '文字を大きく'],
    ['he', 'הקטנת הטקסט', 'הגדלת הטקסט'],
  ];
  for (const [lang, down, up] of cases) {
    const html = renderDoc(`---\nlang: ${lang}\n---\n## A\nText.\n`).html;
    assert.ok(html.includes(`aria-label="${down}"`), `${lang} names the smaller-text button`);
    assert.ok(html.includes(`aria-label="${up}"`), `${lang} names the larger-text button`);
  }
});

test('scale: a video page has no text-size buttons', async () => {
  const { html } = await renderVideo('---\ntitle: Video\nlang: en\n---\n> Hello.\n\n## One\n> World.\n');
  assert.doesNotMatch(html, /data-am="scale-(?:down|up)"/);
});
