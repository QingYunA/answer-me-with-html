import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, remarkText } from '../src/runtime/remark-text.js';
import { renderDoc } from '../src/render.js';

const ui = {
  remark: {
    on: 'Remark on', off: 'Remark', hint: 'Optional note', save: 'Save', remove: 'Remove', section: 'Remarks',
    kinds: { suggestion: 'suggestion', keep: 'keep', question: 'question', concern: 'concern' },
  },
};

test('fingerprint collapses whitespace and caps length', () => {
  assert.equal(fingerprint('  a\n\n b   c  '), 'a b c');
  assert.equal(fingerprint('x'.repeat(200)).length, 80);
});

test('remarkText quotes the block, names the kind and the note', () => {
  const out = remarkText([
    { panel: 'net', quote: 'TCP is reliable', kind: 'question', note: 'why three packets' },
    { panel: '', quote: 'Title', kind: 'keep', note: '' },
  ], ui);
  assert.equal(out, '- [net] "TCP is reliable" (question) — why three packets\n- "Title" (keep)');
});

test('a rendered page carries the remark button and the remark runtime', () => {
  const page = renderDoc('# Title\n\n## Panel\n\nText\n', {}, {}).html;
  assert.match(page, /data-am="remark"/);
  assert.match(page, /am-remark-pop/);
});

test('every language file labels the remark kinds', async () => {
  for (const lang of ['en', 'zh', 'zh-Hant', 'ja']) {
    const labels = (await import(`../src/languages/${lang}.js`)).default.ui.remark;
    for (const kind of ['suggestion', 'keep', 'question', 'concern']) {
      assert.ok(labels.kinds[kind], `${lang} misses the ${kind} label`);
    }
  }
});
