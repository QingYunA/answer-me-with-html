import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { rootTag, readPage } from '../src/page.js';
import { renderDoc } from '../src/render.js';

test('reader width is opt in and round trips through the page envelope', () => {
  const options = { lang: 'en', theme: 'default', mode: 'light', style: 'default' };
  assert.equal(rootTag(options), rootTag({ ...options, resize: false }));
  assert.equal(readPage(rootTag({ ...options, resize: true })).resize, true);
  assert.equal(readPage(rootTag(options)).resize, false);
  const source = '# Hello\n\nSome text.';
  const normal = renderDoc(source);
  const explicit = renderDoc(source, {}, {}, { resize: false });
  assert.equal(normal.html, explicit.html);
  const enabled = renderDoc(source, {}, {}, { resize: true });
  assert.match(enabled.html, /data-resize/);
  assert.match(enabled.html, /am-width-handle/);
});
