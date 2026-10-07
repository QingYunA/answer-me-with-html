import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { md, mdInline, collectHtmlNotes } from '../src/markdown.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { main } from '../src/cli.js';

const page = (src) => md(src).trim();
const notesOf = (src, fn = md) => collectHtmlNotes(() => fn(src)).notes.map((n) => n.message);

// ── placeholders ──
test('raw html: a placeholder in a sentence is shown as text', () => {
  assert.equal(page('ssh user@<host> and grep <pid>'), '<p>ssh user@&lt;host&gt; and grep &lt;pid&gt;</p>');
  assert.equal(page('Array<string> and Map<K, V>'), '<p>Array&lt;string&gt; and Map&lt;K, V&gt;</p>');
  assert.deepEqual(notesOf('ssh user@<host>'), ['<host> is not an HTML element, shown as text; put code in backticks']);
});

test('raw html: a placeholder alone in a list item, on a line of its own, in a table cell and in a quote', () => {
  assert.equal(page('- <host>\n- <pid> is the process id'), '<ul>\n<li>&lt;host&gt;</li>\n<li>&lt;pid&gt; is the process id</li>\n</ul>');
  assert.equal(page('<host>\nrun **this**'), '<p>&lt;host&gt;\nrun <strong>this</strong></p>');
  assert.match(page('| cmd |\n|---|\n| ls <dir> |'), /<td>ls &lt;dir&gt;<\/td>/);
  assert.equal(page('> quote with <host>'), '<blockquote>\n<p>quote with &lt;host&gt;</p>\n</blockquote>');
  assert.equal(page('text <host>\n\n</host> closes'), '<p>text &lt;host&gt;</p>\n<p>&lt;/host&gt; closes</p>');
});

// ── tags that break the page ──
test('raw html: <script> and <style> in prose are shown as text', () => {
  assert.equal(page('Run <script> after'), '<p>Run &lt;script&gt; after</p>');
  assert.equal(page('x <script>alert(1)</script> y'), '<p>x &lt;script&gt;alert(1)&lt;/script&gt; y</p>');
  assert.equal(page('<style>p{}</style> and <iframe src="x"> and <title>'), '<p>&lt;style&gt;p{}&lt;/style&gt; and &lt;iframe src=&quot;x&quot;&gt; and &lt;title&gt;</p>');
  assert.deepEqual(notesOf('a <script> b'), ['<script> is shown as text; raw markup belongs in an html fence']);
});

test('raw html: a line that starts with <script>, <style> or <textarea> no longer swallows the Markdown after it', () => {
  assert.equal(page('<script> is owned by the page.\n\n## next'), '<p>&lt;script&gt; is owned by the page.</p>\n<h2>next</h2>');
  assert.equal(page('<style> is owned by the CLI\n- list **b**'), '<p>&lt;style&gt; is owned by the CLI</p>\n<ul>\n<li>list <strong>b</strong></li>\n</ul>');
  assert.equal(page('   <script>3 spaces **x**\n\n- item'), '<p>   &lt;script&gt;3 spaces <strong>x</strong></p>\n<ul>\n<li>item</li>\n</ul>');
  assert.match(page('<textarea>\nx\n\n# Heading'), /<h1>Heading<\/h1>/);
  assert.deepEqual(notesOf('<script>\nx'), ['<script> is shown as text; raw markup belongs in an html fence']);
});

test('raw html: a script line inside a list item or a quote is read again too', () => {
  assert.match(page('- <script>x\n- next'), /<li>&lt;script&gt;x<\/li>\n<li>next<\/li>/);
  assert.equal(page('> <style>x\n> more **b**'), '<blockquote>\n<p>&lt;style&gt;x\nmore <strong>b</strong></p>\n</blockquote>');
});

test('raw html: a <pre> block that is closed stays raw; an unclosed one is read again', () => {
  assert.equal(page('<pre>\ncode <b>\n</pre>\n\nafter **x**'), '<pre>\ncode <b>\n</pre><p>after <strong>x</strong></p>');
  assert.equal(page('<pre>\nunclosed\n\nafter **x**'), '<p>&lt;pre&gt;\nunclosed</p>\n<p>after <strong>x</strong></p>');
  assert.deepEqual(notesOf('<pre>\nunclosed'), ['<pre> has no closing tag in the same text, shown as text; put code in backticks']);
});

test('raw html: the tags of a kept block are filtered too', () => {
  assert.equal(page('<div class="a">\n<host>\n<script>x\n</div>'), '<div class="a">\n&lt;host&gt;\n&lt;script&gt;x\n</div>');
  assert.equal(page('<div>Array<string></div>'), '<div>Array&lt;string&gt;</div>');
});

// ── names that are also HTML elements ──
test('raw html: a placeholder named like an element has no partner, so it is shown as text', () => {
  assert.equal(page('sleep <time> then curl -d <data> and swap <a> with <b>'), '<p>sleep &lt;time&gt; then curl -d &lt;data&gt; and swap &lt;a&gt; with &lt;b&gt;</p>');
  assert.match(page('| a |\n|---|\n| wait <time> |'), /<td>wait &lt;time&gt;<\/td>/);
});

test('raw html: an element stays only when it opens and closes inside the same text', () => {
  assert.equal(page('<b>x</b> and **y**'), '<p><b>x</b> and <strong>y</strong></p>');
  assert.equal(page('<b><i>x</b>'), '<p><b>&lt;i&gt;x</b></p>');
  assert.equal(page('<b><i>x</b></i>'), '<p><b>&lt;i&gt;x</b>&lt;/i&gt;</p>');
  assert.equal(page('stray </b> close'), '<p>stray &lt;/b&gt; close</p>');
  assert.equal(page('- a <b>x\n- c</b>'), '<ul>\n<li>a &lt;b&gt;x</li>\n<li>c&lt;/b&gt;</li>\n</ul>');
  assert.equal(page('<b>one\n\ntwo</b>'), '<p>&lt;b&gt;one</p>\n<p>two&lt;/b&gt;</p>');
  assert.deepEqual(notesOf('<b><i>x</b>'), ['<i> has no closing tag in the same text, shown as text; put code in backticks']);
  assert.deepEqual(notesOf('stray </b>'), ['</b> has no opening tag in the same text, shown as text']);
});

test('raw html: inline, only text-level elements stay', () => {
  assert.equal(page('a <div>x</div> b'), '<p>a &lt;div&gt;x&lt;/div&gt; b</p>');
  assert.deepEqual(notesOf('a <div>x</div> b').slice(0, 1), ['<div> is a block element and cannot sit inside a sentence, shown as text; put it on its own line']);
});

test('raw html: a tag that never ends is shown as text, so it cannot run on into the page', () => {
  assert.equal(page('<div class="x\n\nafter **b**'), '&lt;div class="x<p>after <strong>b</strong></p>');
  assert.deepEqual(notesOf('<div title="a>b" class="x\n'), ['<div> is never closed with >, shown as text']);
  assert.equal(page('<div title="a > b">ok</div>'), '<div title="a > b">ok</div>');
});

test('raw html: a comment that never closes is shown as text; a closed comment is left alone', () => {
  assert.equal(page('<!-- note\n\nmore **x**'), '<p>&lt;!-- note</p>\n<p>more <strong>x</strong></p>');
  assert.equal(page('  <!-- note\n- item'), '<p>  &lt;!-- note</p>\n<ul>\n<li>item</li>\n</ul>');
  assert.equal(page('- <!-- open\n- b'), '<ul>\n<li>&lt;!-- open</li>\n<li>b</li>\n</ul>');
  assert.equal(page('<div>\n<!-- open\n<b>x</b>\n</div>'), '<div>\n&lt;!-- open\n<b>x</b>\n</div>');
  assert.equal(page('<!-- ok -->\n\nmore **x**'), '<!-- ok --><p>more <strong>x</strong></p>');
  assert.equal(page('<div>\n<!-- <script> -->\n</div>'), '<div>\n<!-- <script> -->\n</div>');
  assert.deepEqual(notesOf('<!-- note\n\nmore'), ['<!-- is never closed with -->, shown as text']);
  assert.deepEqual(notesOf('<!-- ok -->'), []);
});

test('raw html: a processing instruction, CDATA or declaration is shown as text, inline and as a block', () => {
  assert.equal(page('see <?php echo 1 ?> here'), '<p>see &lt;?php echo 1 ?&gt; here</p>');
  assert.equal(page('x <![CDATA[ y ]]> z'), '<p>x &lt;![CDATA[ y ]]&gt; z</p>');
  assert.equal(page('a <!DOCTYPE html> b'), '<p>a &lt;!DOCTYPE html&gt; b</p>');
  assert.equal(page('<?php echo 1 ?>\nmore **x**'), '<p>&lt;?php echo 1 ?&gt;</p>\n<p>more <strong>x</strong></p>');
  assert.equal(page('<!DOCTYPE html>\n\nafter **y**'), '<p>&lt;!DOCTYPE html&gt;</p>\n<p>after <strong>y</strong></p>');
  assert.equal(page('<![CDATA[\nz\n]]>\n\nafter'), '<p>&lt;![CDATA[\nz\n]]&gt;</p>\n<p>after</p>');
  assert.equal(page('<div>\n<?xml a?> t <!-- c --> <![CDATA[q]]>\n</div>'), '<div>\n&lt;?xml a?&gt; t <!-- c --> &lt;![CDATA[q]]&gt;\n</div>');
  assert.equal(page('| a |\n|---|\n| <?php x ?> |').includes('<td>&lt;?php x ?&gt;</td>'), true);
  assert.deepEqual(notesOf('see <?php echo 1 ?>'), ['<?php is not a tag a page can hold, shown as text; put code in backticks']);
  assert.deepEqual(notesOf('x <![CDATA[ y ]]>', mdInline), ['<![CDATA is not a tag a page can hold, shown as text; put code in backticks']);
  assert.equal(mdInline('a <!DOCTYPE html> <!-- c -->'), 'a &lt;!DOCTYPE html&gt; <!-- c -->');
});

// ── tags that stay ──
test('raw html: text-level elements stay', () => {
  assert.equal(page('a <b>bold</b>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, x<sup>2</sup>, H<sub>2</sub>O, line<br>break<wbr>'),
    '<p>a <b>bold</b>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, x<sup>2</sup>, H<sub>2</sub>O, line<br>break<wbr></p>');
  assert.equal(page('<a href="https://x.org">docs</a> and <span class="z">w</span> and <img src="https://x.org/a.png">'),
    '<p><a href="https://x.org">docs</a> and <span class="z">w</span> and <img src="https://x.org/a.png"></p>');
  assert.match(page('| a | b |\n|---|---|\n| x<br>y | <kbd>q</kbd> |'), /<td>x<br>y<\/td>\n<td><kbd>q<\/kbd><\/td>/);
  assert.equal(page('# Title <i>it</i>'), '<h1>Title <i>it</i></h1>');
  assert.deepEqual(notesOf('<kbd>Ctrl</kbd> <br> <img src="a.png">'), []);
});

test('raw html: block elements on lines of their own stay, with Markdown inside', () => {
  assert.equal(page('<details>\n<summary>more</summary>\n\nhidden **body**\n</details>'), '<details>\n<summary>more</summary><p>hidden <strong>body</strong></p>\n</details>');
  assert.equal(page('<div class="raw-x">raw</div>'), '<div class="raw-x">raw</div>');
  assert.equal(page('<picture>\n<source srcset="a.webp">\n<img src="a.png">\n</picture>'), '<picture>\n<source srcset="a.webp">\n<img src="a.png">\n</picture>');
  assert.deepEqual(notesOf('<details>\n<summary>more</summary>\n</details>'), []);
});

// ── what is never touched ──
test('raw html: code, comments, autolinks, Markdown and fences are left alone', () => {
  assert.equal(page('`<pid>` and <!-- <script> --> and <https://x.org>'), '<p><code>&lt;pid&gt;</code> and <!-- <script> --> and <a href="https://x.org">https://x.org</a></p>');
  assert.equal(page('    <script>indented code</script>'), '<pre><code>&lt;script&gt;indented code&lt;/script&gt;\n</code></pre>');
  assert.equal(page('```\n<host> <script>\n```'), '<pre><code>&lt;host&gt; &lt;script&gt;\n</code></pre>');
  assert.equal(page('**bold** and _em_ and a < b and 3 <4'), '<p><strong>bold</strong> and <em>em</em> and a &lt; b and 3 &lt;4</p>');
  assert.deepEqual(notesOf('`<pid>` <!-- c --> <https://x.org>\n\n```\n<host>\n```'), []);
  const fences = renderDoc('## A\n```html\n<host onclick="x()"><script>1</script></host>\n```\n```svg\n<svg onload="y()"><host/></svg>\n```\n');
  assert.ok(fences.html.includes('<host onclick="x()"><script>1</script></host>'));
  assert.ok(fences.html.includes('<svg onload="y()"><host/></svg>'));
  assert.deepEqual(fences.stats.htmlWarnings, []);
});

// ── attributes ──
test('raw html: event handlers are removed from a kept tag, everything else stays', () => {
  assert.equal(page('<span onclick="x()">s</span>'), '<p><span>s</span></p>');
  assert.equal(page('<span class="a" ONCLICK=x() id=b onmouseover=\'y()\'>s</span>'), '<p><span class="a" id=b>s</span></p>');
  assert.equal(page('see <img src="a.png" onerror="x()">'), '<p>see <img src="a.png"></p>');
  assert.equal(page('<div onmouseover="x()" class="a">\n<b>hi</b>\n</div>'), '<div class="a">\n<b>hi</b>\n</div>');
  assert.equal(page('<iframe srcdoc="x"></iframe> <a formaction="x">t</a>'), '<p>&lt;iframe srcdoc=&quot;x&quot;&gt;&lt;/iframe&gt; <a>t</a></p>');
  assert.deepEqual(notesOf('<span onclick="x()">s</span>'), ['removed onclick from <span>']);
});

test('raw html: javascript:, vbscript: and data: links are removed, however they are written', () => {
  const links = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', '  jav&Tab;ascript:1', '&#106;avascript:1', 'vbscript:x', 'data:text/html,x'];
  for (const url of links) assert.equal(page(`<a href="${url}">t</a>`), '<p><a>t</a></p>', url);
  assert.equal(page('<a href=javascript:x>t</a>'), '<p><a>t</a></p>');
  assert.equal(page('<video poster="javascript:x">\n</video>'), '<video>\n</video>');
  assert.deepEqual(notesOf('<a href="javascript:x" onclick="y">t</a>'), ['removed href, onclick from <a> (unsafe URL)']);
});

test('raw html: https, relative and image data: URLs stay; clean tags come back byte for byte', () => {
  const clean = [
    '<a href="https://x.org/a?b=1&amp;c=2" title="a > b" class=c target=_blank hidden>t</a>',
    '<img src="data:image/png;base64,AAA" alt="x">',
    '<a href="#top">t</a> <a href=\'docs/a.md\'>t</a> <a href=mailto:a@b.c>t</a>',
    '<span style="color: var(--accent)" id="s">t</span>',
  ];
  for (const src of clean) assert.equal(page(`see ${src}`), `<p>see ${src}</p>`);
  assert.equal(page('<a href="data:image/png;base64,AAA">t</a>'), '<p><a>t</a></p>');
  assert.equal(page('see <img src="data:text/html,x">'), '<p>see <img></p>');
  assert.deepEqual(notesOf(clean.join(' ')), []);
});

// ── mdInline and the components that call it ──
test('mdInline: filters the inline tokens it is given', () => {
  assert.equal(mdInline('grep <pid> and <b>x</b> and swap <a> with <b>'), 'grep &lt;pid&gt; and <b>x</b> and swap &lt;a&gt; with &lt;b&gt;');
  assert.equal(mdInline('<script>x</script> **<b>y</b>**'), '&lt;script&gt;x&lt;/script&gt; <strong><b>y</b></strong>');
  assert.equal(mdInline('<span onclick="x">s</span>'), '<span>s</span>');
  assert.deepEqual(notesOf('a <host>', mdInline), ['<host> is not an HTML element, shown as text; put code in backticks']);
});

test('components: kv, tree, timeline and callout filter their text too', () => {
  const src = [
    '## A', '```kv', 'Process: kill <pid>', '```',
    '```tree', 'Root | run <host>', '  child <b>x</b>', '```',
    '```timeline', 'Now | step <script> | wait <time>', '```',
    '```callout warn', 'Body with <host>', '', 'and <script>', 'x', '```', '',
  ].join('\n');
  const { html } = renderDoc(src);
  for (const text of ['kill &lt;pid&gt;', 'run &lt;host&gt;', 'step &lt;script&gt;', 'wait &lt;time&gt;', 'Body with &lt;host&gt;']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('child <b>x</b>'));
});

// ── render: the page and its notes ──
const DRAFT = [
  '---', 'title: Raw html', '---', // 1-3
  '## A Run', // 4
  'Connect with ssh user@<host>.', // 5
  '', // 6
  '- keep **this**', // 7
  '- run <host> again', // 8
  '', // 9
  '<script> alert(1)', // 10
  '- after the script line', // 11
  '', // 12
  '<span onclick="x()">s</span> and <kbd>Ctrl</kbd>', // 13
  '', // 14
  '```kv', // 15
  'Kill: <pid>', // 16
  '```', // 17
  '```html', // 18
  '<host onclick="x()">raw</host>', // 19
  '```', // 20
  '',
].join('\n');

test('render: a draft with <host> and <script> keeps one script element and lists each change with its draft line', () => {
  const clean = renderDoc('## A\nplain\n');
  const { html, stats } = renderDoc(DRAFT);
  assert.equal(html.match(/<script\b/g).length, clean.html.match(/<script\b/g).length);
  assert.ok(html.includes('ssh user@&lt;host&gt;.'));
  assert.ok(html.includes('<li>after the script line</li>'));
  assert.ok(html.includes('<kbd>Ctrl</kbd>'));
  assert.ok(html.includes('<dd>&lt;pid&gt;</dd>'));
  assert.deepEqual(stats.htmlWarnings.map((w) => [w.line, w.message]), [
    [5, '<host> is not an HTML element, shown as text; put code in backticks'],
    [8, '<host> is not an HTML element, shown as text; put code in backticks'],
    [10, '<script> is shown as text; raw markup belongs in an html fence'],
    [13, 'removed onclick from <span>'],
    [16, '<pid> is not an HTML element, shown as text; put code in backticks'],
  ]);
});

test('render: an unclosed comment does not swallow the runtime script or the panels after it', () => {
  const clean = renderDoc('## A\nplain\n');
  const { html, stats } = renderDoc('## A One\n<!-- note\n\n## B Two\nsecond **panel**\n');
  assert.equal(html.match(/<script\b/g).length, clean.html.match(/<script\b/g).length);
  assert.ok(html.includes('&lt;!-- note'));
  assert.ok(html.includes('second <strong>panel</strong>'));
  assert.deepEqual(stats.htmlWarnings, [{ line: 2, message: '<!-- is never closed with -->, shown as text' }]);
});

test('render: a clean draft has no html warnings, and style: strict does not fail on them', () => {
  assert.deepEqual(renderDoc('## A\nplain **text** with `<host>`\n').stats.htmlWarnings, []);
  const strict = renderDoc('---\nstyle: strict\n---\n## A\nUse the <host> name.\n');
  assert.equal(strict.stats.htmlWarnings.length, 1);
});

test('render: notes outside a collector are dropped, and collectors do not leak into each other', () => {
  assert.equal(md('a <host>'), '<p>a &lt;host&gt;</p>\n');
  const outer = collectHtmlNotes(() => {
    md('a <host>');
    collectHtmlNotes(() => md('b <pid>'));
    md('c <dir>');
    return 1;
  });
  assert.deepEqual(outer.notes.map((n) => n.at), ['<host>', '<dir>']);
  assert.throws(() => collectHtmlNotes(() => { throw new Error('x'); }), /x/);
  assert.deepEqual(collectHtmlNotes(() => md('<b>x</b>')).notes, []);
});

test('video: a scene with a placeholder lists the warning too', async () => {
  const src = '---\ntitle: V\n---\n## A Scene\n> Narration line.\n\nConnect to <host>.\n';
  const { html, stats } = await renderVideo(src);
  assert.ok(html.includes('Connect to &lt;host&gt;.'));
  assert.equal(stats.htmlWarnings.length, 1);
});

// ── cli ──
let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-rawhtml-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  let text = '';
  return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } };
}

async function run(args, stdin = '') {
  const out = sink();
  const err = sink();
  const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: dir }, cwd: dir });
  return { code, out: out.text, err: err.text };
}

test('cli render: prints the html warnings with their lines, once each', async () => {
  const r = await run(['render', '-', '-o', 'a.html'], DRAFT.replace('run <host> again', 'run <host> again <host>'));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /  html 5 warnings \(the page differs from the draft here; fix the draft if that is not what you meant\):/);
  assert.match(r.out, /^  L5 \[html\] <host> is not an HTML element, shown as text; put code in backticks$/m);
  assert.match(r.out, /^  L10 \[html\] <script> is shown as text; raw markup belongs in an html fence$/m);
  assert.match(r.out, /^  L13 \[html\] removed onclick from <span>$/m);
  assert.equal(r.out.match(/L8 \[html\]/g).length, 1);
  assert.match(r.out, /STE/);
});

test('cli render: lists at most 20 html warnings; patch and a clean draft print none', async () => {
  const many = `## A\n${Array.from({ length: 25 }, (_, i) => `line ${i} <h${i}>`).join('\n\n')}\n`;
  const r = await run(['render', '-', '-o', 'many.html'], many);
  assert.match(r.out, /html 25 warnings/);
  assert.equal(r.out.match(/\[html\]/g).length, 20);
  assert.match(r.out, /… 5 more/);
  const clean = await run(['render', '-', '-o', 'clean.html'], '## A\nplain\n');
  assert.doesNotMatch(clean.out, /\[html\]|html \d+ warning/);
  const patched = await run(['patch', 'clean.html', '--panel', 'A'], 'Use <host> here.\n');
  assert.equal(patched.code, 0, patched.err);
  assert.match(patched.out, /L2 \[html\] <host> is not an HTML element/);
});
