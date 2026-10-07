// A host can serve a page inside its own document, so the real <html> has none of the page's settings (lang, theme, mode, style).
// The page keeps a copy on its toolbar and its runtime restores what the root lacks; the browser half of that is the last test
// in test/layout-browser.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';

const draft = (template) => `---\ntemplate: ${template}\nlang: ja\ntheme: blueprint\nmode: dark\nstyle: off\n---\n## A Note\nText.\n`;

for (const template of ['sheet', 'doc']) {
  test(`${template}: the toolbar carries the settings written on <html>`, () => {
    const { html } = renderDoc(draft(template));
    const root = html.match(/<html([^>]*)>/)[1];
    const toolbar = html.match(/<div class="am-toolbar"([^>]*)>/)[1];
    for (const [attr, key] of [['lang', 'data-am-root-lang'], ['data-theme', 'data-am-root-theme'], ['data-mode', 'data-am-root-mode'], ['data-style', 'data-am-root-style']]) {
      const value = root.match(new RegExp(`\\s${attr}="([^"]*)"`))[1];
      assert.equal(toolbar.match(new RegExp(`\\s${key}="([^"]*)"`))?.[1], value, key);
    }
    assert.match(toolbar, /data-am-root-lang="ja"[^>]*data-am-root-theme="blueprint"[^>]*data-am-root-mode="dark"[^>]*data-am-root-style="off"/);
  });
}
