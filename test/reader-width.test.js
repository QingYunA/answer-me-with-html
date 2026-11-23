import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderDoc } from '../src/render.js';

test('reader width controls are emitted only when enabled', () => {
  const source = '# Hello\n\nSome text.';
  const normal = renderDoc(source);
  assert.doesNotMatch(normal.html, /<main[^>]*\sdata-am-resizable\b|<div class="am-width-handle"|<button[^>]*popovertarget="am-width-options"/);
  const enabled = renderDoc(source, {}, {}, { resize: true });
  assert.match(enabled.html, /popovertarget="am-width-options"/);
  assert.match(enabled.html, /am-width-handle/);
});
