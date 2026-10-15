// highlights.json: the release's highlights in every page language, read by the daily check and shown in the new-version popover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HIGHLIGHTS, UPDATE, parseHighlights, pageUpdate, runUpdateCheck, updateHint } from '../src/update.js';
import { languageIds } from '../src/languages/registry.js';
import { readState } from '../src/state.js';
import { renderDoc } from '../src/render.js';

const ROOT = new URL('..', import.meta.url);
const VERSION = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')).version;
const FILE = JSON.parse(readFileSync(new URL('highlights.json', ROOT), 'utf8'));

test('highlights.json: names the package version and gives every page language 1 to 3 short lines', () => {
  assert.equal(FILE.version, VERSION, 'write highlights.json for the new version in the release PR (CONTRIBUTING.md)');
  for (const id of languageIds()) {
    const lines = FILE[id];
    assert.ok(Array.isArray(lines) && lines.length >= 1 && lines.length <= HIGHLIGHTS.lines, `${id}: 1 to ${HIGHLIGHTS.lines} lines`);
    for (const l of lines) assert.ok(l.trim() && l.length <= HIGHLIGHTS.chars, `${id}: "${l}" is empty or longer than ${HIGHLIGHTS.chars}`);
  }
  assert.deepEqual(Object.keys(FILE).sort(), ['version', ...languageIds()].sort(), 'no language without a file in src/languages/');
  // The check keeps the file exactly as written.
  const { version, ...lists } = FILE;
  assert.deepEqual(parseHighlights(FILE, version), lists);
});

test('parseHighlights: only the lists for the version read, plain one-line text within the limits', () => {
  assert.equal(parseHighlights({ version: '0.6.0', en: ['a'] }, '0.7.0'), null, 'another version');
  for (const bad of [null, 'text', ['a'], { version: '0.6.0' }, { version: '0.6.0', en: 'a' }, { version: '0.6.0', en: [] }]) {
    assert.equal(parseHighlights(bad, '0.6.0'), null, JSON.stringify(bad));
  }
  const long = 'x'.repeat(HIGHLIGHTS.chars + 1);
  assert.deepEqual(parseHighlights({
    version: '0.6.0',
    en: [' one ', 2, '', 'line\nbreak', long, 'two', 'three', 'four'],
    'zh-Hant': ['甲'],
    'not a language': ['x'],
    __proto__: ['x'],
  }, '0.6.0'), { en: ['one', 'two', 'three'], 'zh-Hant': ['甲'] });
});

test('runUpdateCheck: stores the highlights of the version it read; a missing or stale file leaves only the version', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-highlights-'));
  const serve = (files) => async (url) => (url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404 });
  try {
    await runUpdateCheck(home, serve({ [UPDATE.url]: { version: '0.6.0' }, [UPDATE.highlightsUrl]: { version: '0.6.0', en: ['New'] } }));
    assert.deepEqual(readState(home).latestHighlights, { en: ['New'] });
    await runUpdateCheck(home, serve({ [UPDATE.url]: { version: '0.7.0' }, [UPDATE.highlightsUrl]: { version: '0.6.0', en: ['Old'] } }));
    assert.equal(readState(home).latestVersion, '0.7.0');
    assert.equal(readState(home).latestHighlights, null, 'highlights of an older version are dropped');
    assert.equal(await runUpdateCheck(home, serve({ [UPDATE.url]: { version: '0.8.0' } })), '0.8.0', 'no highlights file');
    assert.equal(readState(home).latestHighlights, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const STATE = { latestVersion: '0.9.0', latestHighlights: { en: ['New `er` diagrams', '<b>bold</b>'], zh: ['新增 `er` 组件'] } };

test('render: the popover lists the highlights in the page language, else in English, escaped, with `code`', () => {
  const update = pageUpdate(STATE, '0.5.0', '', {}, {});
  const zh = renderDoc('---\nlang: zh\n---\n## A\n中文', {}, {}, { update }).html;
  assert.match(zh, /<p class="am-update-label">这次更新：<\/p>\n<ul class="am-update-notes"><li>新增 <code>er<\/code> 组件<\/li><\/ul>/);
  for (const lang of ['ja', 'fr']) {
    const html = renderDoc(`---\nlang: ${lang}\n---\n## A\nx`, {}, {}, { update }).html;
    assert.match(html, /<li>New <code>er<\/code> diagrams<\/li><li>&lt;b&gt;bold&lt;\/b&gt;<\/li>/, lang);
  }
});

test('render: no highlights, no list; the CLI hint never carries them', () => {
  const update = pageUpdate({ latestVersion: '0.9.0' }, '0.5.0', '', {}, {});
  assert.equal(update.highlights, null);
  assert.doesNotMatch(renderDoc('## A\nx', {}, {}, { update }).html, /<ul class="am-update-notes">/);
  assert.doesNotMatch(updateHint(STATE, '0.5.0', ''), /diagrams|bold|组件/);
});
