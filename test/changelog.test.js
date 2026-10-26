// site/changelog.mjs: the changelog/*.md files read, split, sorted and drawn for the website's changelog page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { changelogHtml, compareVersions, linkRefs, notesHtml, parseEntry, readChangelog, splitNotes } from '../site/changelog.mjs';

const REPO = 'o/r';
const T = { cl_release: 'GitHub Release', cl_anchor: 'Link to version', cl_en_only: 'English only' };

test('changelog: versions sort by number, newest first', () => {
  const sorted = ['0.4.9', '0.5.10', '0.5.2', '0.4.15', '1.0.0'].sort(compareVersions);
  assert.deepEqual(sorted, ['1.0.0', '0.5.10', '0.5.2', '0.4.15', '0.4.9']);
});

test('changelog: splitNotes cuts at the first --- line; a file without one has no Chinese', () => {
  assert.deepEqual(splitNotes('## A\n\nen\n\n---\n\n## 甲\n\n中\n'), { en: '## A\n\nen', zh: '## 甲\n\n中' });
  assert.deepEqual(splitNotes('only english\n'), { en: 'only english', zh: '' });
  assert.equal(splitNotes('a\n----\nb\n').zh, '', 'only a line of exactly --- counts');
});

test('changelog: parseEntry reads the marker and rejects a wrong one', () => {
  const e = parseEntry('0.5.8.md', '<!-- release 0.5.8 2026-10-26 -->\n\nen\n---\n中\n');
  assert.deepEqual(e, { version: '0.5.8', date: '2026-10-26', en: 'en', zh: '中' });
  assert.throws(() => parseEntry('0.5.8.md', 'no marker\n'), /first line/);
  assert.throws(() => parseEntry('0.5.8.md', '<!-- release 0.5.7 2026-10-26 -->\n'), /names version 0\.5\.7/);
});

test('changelog: readChangelog reads the repository files, newest first', () => {
  const entries = readChangelog(fileURLToPath(new URL('../changelog/', import.meta.url)));
  assert.ok(entries.length >= 18);
  const versions = entries.map((e) => e.version);
  assert.deepEqual(versions, [...versions].sort(compareVersions));
});

test('changelog: #123 becomes a link in text, not in code or links', () => {
  assert.equal(linkRefs('<p>fix (#12)</p>', REPO), '<p>fix (<a href="https://github.com/o/r/pull/12">#12</a>)</p>');
  assert.equal(linkRefs('<p><code>#12</code> <a href="x">#13</a> &#39;</p>', REPO), '<p><code>#12</code> <a href="x">#13</a> &#39;</p>');
});

test('changelog: notes headings drop one level', () => {
  const html = notesHtml('## Fixes\n\n### Sub\n\n- a (#5)\n', REPO);
  assert.match(html, /<h3>Fixes<\/h3>/);
  assert.match(html, /<h4>Sub<\/h4>/);
  assert.match(html, /pull\/5/);
});

test('changelog: one section and one list item per version; zh falls back to English', () => {
  const entries = [{ version: '0.5.8', date: '2026-10-26', en: 'new', zh: '新' }, { version: '0.4.7', date: '2026-10-04', en: 'old', zh: '' }];
  const en = changelogHtml(entries, 'en', T, REPO);
  assert.match(en.sections, /<section class="cl-version" id="v0-5-8"/);
  assert.match(en.sections, /<h2 id="v0-5-8-h">0\.5\.8 \(2026-10-26\)<\/h2>/);
  assert.match(en.sections, /releases\/tag\/v0\.4\.7/);
  assert.equal((en.toc.match(/<li>/g) ?? []).length, 2);
  const zh = changelogHtml(entries, 'zh', T, REPO);
  assert.match(zh.sections, /新/);
  assert.match(zh.sections, /<p class="fine cl-note">English only<\/p>/);
  assert.match(zh.sections, /lang="en"[^>]*>\s*<p>old<\/p>/);
  assert.equal((zh.sections.match(/class="fine cl-note"/g) ?? []).length, 1);
});
