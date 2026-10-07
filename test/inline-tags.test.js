// An inline tag inside prose: only a text-level element stays raw. Every other tag reads as the text the draft wrote,
// so a placeholder keeps its words and a tag that could break the page cannot reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, mdInline } from '../src/markdown.js';
import { renderDoc } from '../src/render.js';

test('markdown: a placeholder in prose reads as text instead of an empty element', () => {
  assert.equal(md('ssh user@<host> now').trim(), '<p>ssh user@&lt;host&gt; now</p>');
  assert.equal(md('a <file name> b').trim(), '<p>a &lt;file name&gt; b</p>');
  assert.equal(mdInline('grep <pid> now'), 'grep &lt;pid&gt; now');
  assert.match(md('- one <service-name>\n- two <logfile>'), /<li>one &lt;service-name&gt;<\/li>/);
  assert.match(md('| a | b |\n|---|---|\n| ls | ls <dir>/<name> |'), /<td>ls &lt;dir&gt;\/&lt;name&gt;<\/td>/);
});

test('markdown: a text-level element still passes through, open or close', () => {
  assert.equal(md('a <b>bold</b> b').trim(), '<p>a <b>bold</b> b</p>');
  assert.equal(mdInline('<em>x</em> <code>y</code> <br> <span class="z">w</span>'), '<em>x</em> <code>y</code> <br> <span class="z">w</span>');
  assert.equal(mdInline('a <a href="https://x.org">docs</a>'), 'a <a href="https://x.org">docs</a>');
  assert.equal(mdInline('a <mark>m</mark> and <time datetime="2026-10-07">now</time>'), 'a <mark>m</mark> and <time datetime="2026-10-07">now</time>');
  assert.equal(mdInline('</b> closes'), '</b> closes');
});

test('markdown: an inline tag that could break the page or its offline promise reads as text', () => {
  const pageBreak = ['<script>', '<style>', '<iframe src="https://x.org">', '<object>', '<embed>', '<base>', '<link rel="stylesheet" href="https://x.org/x.css">', '<meta charset="utf-8">', '<div>', '<form>', '<textarea>', '<template>'];
  for (const tag of pageBreak) {
    assert.ok(mdInline(`a ${tag} b`).includes('&lt;'), `${tag} must read as text`);
  }
  // An <img> with a URL would make the page need the network; the draft has ![alt](path) for images.
  assert.equal(mdInline('a <img src="https://x.org/x.png"> b'), 'a &lt;img src=&quot;https://x.org/x.png&quot;&gt; b');
  // A closing tag that names no element is text too.
  assert.equal(mdInline('text </pid> more'), 'text &lt;/pid&gt; more');
});

test('markdown: a code span, a comment and the Markdown syntax itself are untouched', () => {
  assert.equal(mdInline('`<pid>`'), '<code>&lt;pid&gt;</code>');
  assert.equal(md('<!-- note -->'), '<!-- note -->');
  assert.equal(mdInline('**bold** and *em* and [x](https://x.org)'), '<strong>bold</strong> and <em>em</em> and <a href="https://x.org">x</a>');
});

test('markdown: a tag alone on its line is deliberate markup and stays raw', () => {
  assert.equal(md('<div class="raw-x">raw</div>'), '<div class="raw-x">raw</div>');
});

test('render: a draft keeps the words it wrote, and the page keeps its own script tags', () => {
  const { html } = renderDoc('---\nlang: en\ntitle: Placeholders\n---\nRun <script> after ssh user@<host>.\n\n## A\n```kv cols=2\n* Stop it: tasklist /FI "PID eq <pid>"\n```\n');
  assert.match(html, /Run &lt;script&gt; after ssh user@&lt;host&gt;\./);
  assert.match(html, /tasklist \/FI &quot;PID eq &lt;pid&gt;&quot;/);
  assert.doesNotMatch(html, /<pid>|<host>|<script> after/);
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'a draft must not add a script element to the page');
});

test('render: raw markup in an html fence is still embedded as it is', () => {
  const { html } = renderDoc('## A\n```html\n<div class="raw-x">raw</div>\n```\n');
  assert.match(html, /<div class="raw-x">raw<\/div>/);
});
