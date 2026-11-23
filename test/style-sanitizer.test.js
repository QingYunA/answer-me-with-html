// HTML sanitizers such as DOMPurify drop a whole <style> element when its text holds "<" followed by a letter, "!", "/" or "?"
// (a tag-like sequence, guarded against mXSS). A page viewed through such a viewer then loses all its styling (#452).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as assets from '../src/assets.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';

const TAG_LIKE = /<[A-Za-z!/?]/;
const styles = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const tagLike = (css) => css.match(new RegExp(`.{0,40}${TAG_LIKE.source}.{0,20}`))?.[0];

test('no CSS the pages embed holds a tag-like "<" sequence', () => {
  const sheets = Object.entries(assets).filter(([name, value]) => name.endsWith('_CSS') && typeof value === 'string');
  assert.ok(sheets.length > 5, 'the CSS assets are found');
  for (const [name, css] of sheets) assert.equal(tagLike(css), undefined, `${name} has a tag-like sequence`);
});

test('a rendered page and a video page keep every <style> free of tag-like sequences', async () => {
  for (const theme of ['blueprint', 'paper', 'shadcn']) {
    const { html } = renderDoc(`---\ntitle: Styles\nlang: en\ntheme: ${theme}\n---\nEuler: $e^{i\\pi} + 1 = 0$.\n\n## A Flow\n\`\`\`flow\nA -> B\n\`\`\`\n\n## B Tree\n\`\`\`tree\nroot\n  child\n\`\`\`\n`);
    assert.match(html, /<math/, 'the page has math, so its styles are in');
    for (const css of styles(html)) assert.equal(tagLike(css), undefined, `${theme} page`);
  }
  const { html } = await renderVideo('---\ntitle: Styles video\nlang: en\n---\n## Scene one\n> Hello there.\n');
  for (const css of styles(html)) assert.equal(tagLike(css), undefined, 'video page');
});
