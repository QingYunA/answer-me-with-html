import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md } from '../src/markdown.js';
import { renderDoc } from '../src/render.js';
import { TABLE_CSS, TABLE_JS } from '../src/assets.js';

const TABLE = '| Project | Stars | Updated |\n| --- | ---: | --- |\n| alpha | 12000 | 2025-09-30 |\n| beta | 900 | 2026-10-20 |';
const draft = (attrs) => `---\nlang: en\n---\n## A Projects\n${TABLE}${attrs ? `\n{table ${attrs}}` : ''}\n`;

test('table: without an attribute the Markdown and page output keep their original shape', () => {
  const source = '| Name | N |\n| --- | ---: |\n| alpha | 900 |\n';
  assert.equal(md(source), '<div class="am-table-wrap"><table>\n<thead>\n<tr>\n<th>Name</th>\n<th align="right">N</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>alpha</td>\n<td align="right">900</td>\n</tr>\n</tbody></table></div>\n');
  const { html } = renderDoc(draft());
  assert.ok(html.includes('<div class="am-table-wrap"><table>'));
  assert.ok(!html.includes('data-am-table'));
  assert.ok(!html.includes(TABLE_JS));
  assert.ok(!html.includes(TABLE_CSS));
});

test('table: sort, filter and their combination opt in separately', () => {
  const sort = renderDoc(draft('sort')).html;
  assert.match(sort, /<table data-am-table="sort">/);
  assert.doesNotMatch(sort, /<div class="am-table-controls"/);
  const filter = renderDoc(draft('filter')).html;
  assert.match(filter, /<table data-am-table="filter">/);
  assert.match(filter, /<div class="am-table-controls" hidden>/);
  const both = renderDoc(draft('sort filter')).html;
  assert.match(both, /<div class="am-table-controls" hidden>.*<div class="am-table-wrap"><table data-am-table="sort filter">/);
  assert.ok(both.includes(TABLE_JS));
  assert.ok(both.includes(TABLE_CSS));
});

test('table: the attribute line is not a row, also when a blank line separates it', () => {
  for (const source of [draft('sort filter'), draft('sort filter').replace('\n{table', '\n\n{table')]) {
    const { html } = renderDoc(source);
    assert.match(html, /<table data-am-table="sort filter">/);
    assert.doesNotMatch(html, /<td[^>]*>\{table/);
    assert.equal((html.match(/<tbody><tr>/g) ?? []).length, 1);
    assert.equal((html.match(/<tr>/g) ?? []).length, 3);
  }
});

test('table: look-alike lines elsewhere stay text, and extra options ride along with a recognized flag', () => {
  const ordinary = md('{table sort}\n\n```\n{table filter}\n```\n');
  assert.match(ordinary, /<p>\{table sort\}<\/p>/);
  assert.match(ordinary, /\{table filter\}/);
  const future = renderDoc(draft('sort widths="20%,60%,20%"')).html;
  assert.match(future, /<table data-am-table="sort">/);
  assert.doesNotMatch(future, /<td[^>]*>\{table/);
});

test('table: unrecognized options stay visible and warn instead of vanishing', () => {
  for (const attrs of ['sortt', 'sort=true', 'widths="50%,50%"']) {
    const { html, stats } = renderDoc(`${draft(attrs)}\n`);
    assert.doesNotMatch(html, /<table data-am-table=/);
    assert.match(html, /<td[^>]*>\{table /);
    assert.deepEqual(stats.htmlWarnings, [{ line: 9, message: 'unrecognized table option; use {table sort}, {table filter}, or {table sort filter}' }]);

    const paragraph = renderDoc(draft(attrs).replace('\n{table', '\n\n{table'));
    assert.match(paragraph.html, /<p>\{table /);
    assert.equal(paragraph.stats.htmlWarnings.length, 1);
  }
});

test('table: an option-like row is consumed only when every extra cell exists and is empty', () => {
  const oneColumn = renderDoc('## A\n| Value |\n| --- |\n| {table sort} |\n');
  assert.doesNotMatch(oneColumn.html, /<table data-am-table=/);
  assert.match(oneColumn.html, /<td>\{table sort\}<\/td>/);
  assert.deepEqual(oneColumn.stats.htmlWarnings, []);

  const occupied = renderDoc('## A\n| Value | Note |\n| --- | --- |\n| {table sort} | keep |\n');
  assert.doesNotMatch(occupied.html, /<table data-am-table=/);
  assert.match(occupied.html, /<td>\{table sort\}<\/td>/);
});

test('table: options apply to a table produced by re-lexing an HTML block', () => {
  const { html } = renderDoc('## A\n<script>\n| Value | Note |\n| ---: | --- |\n| 2 | two |\n{table sort}\n');
  assert.match(html, /<table data-am-table="sort">/);
  assert.doesNotMatch(html, /<td[^>]*>\{table/);
});

test('table: the no-JavaScript baseline has every row and no sort buttons or visible filter', () => {
  const { html } = renderDoc(draft('sort filter'));
  assert.match(html, /<div class="am-table-controls" hidden>/);
  assert.doesNotMatch(html, /<button class="am-table-sort"/);
  assert.ok(html.indexOf('alpha') < html.indexOf('beta'));
  assert.match(html, /<td align="right">12000<\/td>/);
  assert.match(html, /<td align="right">900<\/td>/);
});

test('table: print hides the filter and sort indicators, and export hides the same controls', async () => {
  assert.match(TABLE_CSS, /@media print\s*\{[^]*\.am-table-controls \{ display: none !important; \}/);
  assert.match(TABLE_CSS, /@media print\s*\{[^]*\.am-table-sort::after \{ content: none !important; \}/);
  const exporter = await import('../src/export.js');
  assert.ok(exporter, 'the export module loads');
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/export.js', import.meta.url), 'utf8'));
  assert.match(source, /CHROME_CSS = `[^]*\.am-table-controls/);
  assert.match(source, /\.am-table-sort::after \{ content: none !important; \}/);
});

test('table: filter labels follow the page language', () => {
  const zh = renderDoc(draft('filter').replace('lang: en', 'lang: zh')).html;
  assert.match(zh, /aria-label="筛选表格"/);
  const fallback = renderDoc(draft('filter').replace('lang: en', 'lang: fr')).html;
  assert.match(fallback, /aria-label="Filter table"/);
});

test('table: the opted-in runtime is covered by the exact CSP script hash', () => {
  const { html } = renderDoc(draft('sort filter'));
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
  const scriptSource = policy.split('; ').find((part) => part.startsWith('script-src '));
  assert.doesNotMatch(scriptSource, /unsafe-inline|unsafe-eval/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].includes(TABLE_JS));
  const hash = createHash('sha256').update(scripts[0], 'utf8').digest('base64');
  assert.ok(policy.includes(`'sha256-${hash}'`));
});
