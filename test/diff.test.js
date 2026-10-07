import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDoc, RenderError } from '../src/render.js';
import { themeNames } from '../src/themes/registry.js';
import { readPage } from '../src/page.js';
import { replacePanel } from '../src/patch.js';
import { main } from '../src/cli.js';
import { Readable, Writable } from 'node:stream';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-diff-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const draft = (fence, body = '') => `---\ntitle: Diff\n---\n## A Panel\n${fence}\n${body}${body ? '\n' : ''}\`\`\`\n`;
const render = (src) => renderDoc(src, {}, {}, { codeDir: dir });
const errorOf = (src) => {
  try {
    render(src);
  } catch (err) {
    return err;
  }
  return null;
};
const SAMPLE = [
  '@@ -60,3 +60,3 @@',
  ' export function parseCodeArgs(args) {',
  '-  const attrs = parseAttrs(args);',
  '+  const attrs = parseAttrs(args, { diff: true });',
  '   const opts = {};',
].join('\n');

test('diff: red and green lines, old and new gutters from the @@ header, a thin hunk row and a +1 −1 stat', () => {
  const { html, stats } = render(draft('```diff file=src/code.js', SAMPLE));
  assert.match(html, /<figure class="am-codeblock am-codeblock--diff">/);
  assert.match(html, /<span class="am-code-title">src\/code.js<\/span><span class="am-code-stat"><span class="am-code-stat-add">\+1<\/span> <span class="am-code-stat-del">−1<\/span><\/span><span class="am-code-lang">js<\/span><button class="am-code-copy"/);
  assert.match(html, /<pre class="am-code am-code--diff am-code--dnum"><code data-lang="js">/);
  assert.match(html, /<span class="am-ln am-ln--hunk">@@ -60,3 \+60,3 @@<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--ctx" data-o="60" data-n="60"> export function parseCodeArgs\(args\) \{<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--del" data-o="61">-  const attrs = parseAttrs\(args\);<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--add" data-n="61">\+  const attrs = parseAttrs\(args, \{ diff: true \}\);<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--ctx" data-o="62" data-n="62">   const opts = \{\};<\/span>/);
  assert.deepEqual(stats.codeWarnings, []);
});

test('diff: the example of the issue (header counts that do not match the lines) renders with a warning', () => {
  const sample = SAMPLE.replace('@@ -60,3 +60,3 @@', '@@ -60,4 +60,5 @@');
  const { html, stats } = render(draft('```diff file=src/code.js', sample));
  assert.match(html, /am-ln--add/);
  assert.equal(stats.codeWarnings.length, 1);
  assert.equal(stats.codeWarnings[0].line, 5);
  assert.equal(stats.codeWarnings[0].rule, 'diff-counts');
  assert.match(stats.codeWarnings[0].message, /"@@ -60,4 \+60,5 @@" has 3 old and 3 new lines, but its header says 4 and 5/);
});

test('diff: each hunk restarts the numbers; a header without counts means one line', () => {
  const { html, stats } = render(draft('```diff', '@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -10 +10 @@\n-x\n+y\n'.trimEnd()));
  assert.match(html, /data-o="2">-b</);
  assert.match(html, /data-n="2">\+c</);
  assert.match(html, /data-o="10">-x</);
  assert.match(html, /data-n="10">\+y</);
  assert.deepEqual(stats.codeWarnings, []);
});

test('diff: without @@, start= numbers both sides from N; with neither the block has no numbers', () => {
  const body = ' a\n-b\n+c\n+d';
  const numbered = render(draft('```diff start=7', body)).html;
  assert.match(numbered, /am-code--dnum/);
  assert.match(numbered, /<span class="am-ln am-ln--ctx" data-o="7" data-n="7"> a<\/span>/);
  assert.match(numbered, /data-o="8">-b</);
  assert.match(numbered, /data-n="8">\+c</);
  assert.match(numbered, /data-n="9">\+d</);
  const plain = render(draft('```diff', body)).html;
  const pre = plain.match(/<pre[\s\S]*<\/pre>/)[0];
  assert.ok(!pre.includes('data-n') && !pre.includes('data-o') && !pre.includes('am-code--dnum'));
  assert.match(plain, /<pre class="am-code am-code--diff"><code data-lang="diff">/);
  assert.match(plain, /<span class="am-code-stat-add">\+2<\/span> <span class="am-code-stat-del">−1<\/span>/);
});

test('diff: hl= uses new-side numbers and the line keeps its red or green', () => {
  const { html } = render(draft('```diff hl=61,62', SAMPLE));
  assert.match(html, /<span class="am-ln am-ln--add am-ln--hl" data-n="61">/);
  assert.match(html, /<span class="am-ln am-ln--ctx am-ln--hl" data-o="62" data-n="62">/);
  assert.match(html, /<span class="am-ln am-ln--del" data-o="61">/);
  assert.match(errorOf(draft('```diff hl=99', SAMPLE)).message, /hl=99: line 99 is not a new-side line of the diff/);
  assert.match(errorOf(draft('```diff hl=1', ' a\n+b')).message, /hl= on a diff needs line numbers/);
});

test('diff: diff --git, index, ---, +++ and "No newline" lines are kept out of the drawing; +++ names the file', () => {
  const body = ['diff --git a/src/code.js b/src/code.js', 'index 1a2b3c..4d5e6f 100644', '--- a/src/code.js', '+++ b/src/code.js', SAMPLE, '\\ No newline at end of file'].join('\n');
  const { html, stats } = render(draft('```diff', body));
  assert.match(html, /<span class="am-code-title">src\/code.js<\/span>/);
  assert.match(html, /<span class="am-code-lang">js<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--meta">--- a\/src\/code.js<\/span><span class="am-ln am-ln--meta">\+\+\+ b\/src\/code.js<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--meta">\\ No newline at end of file<\/span>/);
  assert.match(html, /<span class="am-code-stat-add">\+1<\/span> <span class="am-code-stat-del">−1<\/span>/);
  assert.deepEqual(stats.codeWarnings, []);
  const named = render(draft('```diff file=other.py', body)).html;
  assert.match(named, /<span class="am-code-title">other.py<\/span>/);
  assert.match(named, /<span class="am-code-lang">py<\/span>/);
  const titled = render(draft('```diff file=other.py title="parser · sketch"', body)).html;
  assert.match(titled, /<span class="am-code-title" title="other.py">parser · sketch<\/span>/);
});

test('diff: a removed line that starts with -- inside a hunk is a line, not a file header', () => {
  const { html } = render(draft('```diff', '@@ -1,2 +1,2 @@\n--- old comment\n+++ new comment\n a'));
  assert.match(html, /<span class="am-ln am-ln--del" data-o="1">--- old comment<\/span>/);
  assert.match(html, /<span class="am-ln am-ln--add" data-n="1">\+\+\+ new comment<\/span>/);
});

test('diff: a blank line is a context line, and blank lines around the diff are dropped', () => {
  const { html, stats } = render(draft('```diff', '\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n\n'));
  assert.match(html, /<span class="am-ln am-ln--ctx" data-o="2" data-n="2"><\/span>/);
  assert.deepEqual(stats.codeWarnings, []);
});

test('diff: the lines keep the diff as written, so Copy gives the diff back', () => {
  const { html } = render(draft('```diff', ['--- a/x.js', '+++ b/x.js', SAMPLE].join('\n')));
  const lines = [...html.matchAll(/<span class="am-ln[^"]*"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(lines.join('\n'), ['--- a/x.js', '+++ b/x.js', SAMPLE].join('\n'));
});

test('diff: errors are line errors with a diff example', () => {
  const cases = [
    ['```diff', 'const a = 1;', 1, /line 1 is not a diff line.*\+, -, a space or @@/],
    ['```diff', ' a\n+b\nplain text', 3, /line 3 is not a diff line/],
    ['```diff', '@@ nonsense @@\n a', 1, /not a hunk header/],
    ['```diff', '@@ -1,3 +1,3 @@\n a\n...\n b', 3, /cut lines.*two hunks/],
    ['```diff', '@@ -1,3 +1,3 @@\n a\n…\n b', 3, /cut lines.*two hunks/],
    ['```diff', ' a\n ...\n b', 2, /cut lines/],
    ['```diff src=src/app.ts', '', 0, /paste the diff/],
    ['```diff src=src/app.ts', ' a', 0, /paste the diff/],
  ];
  for (const [fence, body, offset, message] of cases) {
    const err = errorOf(draft(fence, body));
    assert.ok(err instanceof RenderError, `${fence} ${body}: ${err}`);
    assert.equal(err.component, 'code');
    assert.equal(err.line, 5 + offset, `${fence} ${body}`);
    assert.match(err.message, message);
    assert.match(err.example, /^```diff file=/);
  }
});

test('diff: a plain code block still shows file= as an unknown setting, with its own example', () => {
  const err = errorOf(draft('```ts file=a.ts'));
  assert.match(err.message, /unknown code block setting "file"/);
  assert.match(err.example, /^```ts src=/);
});

test('diff: the line limits and the key check apply as for other code blocks', () => {
  const long = Array.from({ length: 41 }, (_, i) => `+line ${i}`).join('\n');
  const { stats } = render(draft('```diff', long));
  assert.equal(stats.codeWarnings.length, 1);
  assert.equal(stats.codeWarnings[0].rule, 'code-length');
  assert.match(stats.codeWarnings[0].message, /the block has 41 lines/);
  assert.match(errorOf(draft('```diff', Array.from({ length: 201 }, () => '+x').join('\n'))).message, /quote 200 lines at most/);
  assert.match(errorOf(draft('```diff', "+const password = 'Abcdefghijklmnopqrstuvwxyz'")).message, /the block looks like it holds a key/);
});

test('diff: HTML in a line is escaped', () => {
  const { html } = render(draft('```diff', '+<b>"x"</b> & y'));
  assert.match(html, />\+&lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; y</);
});

test('diff: a plain code block renders exactly as before', () => {
  const { html } = render(draft('```python', 'print("<x>")'));
  assert.match(html, /<figure class="am-codeblock"><figcaption class="am-code-head"><span class="am-code-title"><\/span><span class="am-code-lang">python<\/span><button/);
  assert.match(html, /<pre class="am-code"><code data-lang="python"><span class="am-ln">print\(&quot;&lt;x&gt;&quot;\)<\/span><\/code><\/pre>/);
  assert.ok(!html.includes('am-code-stat'));
});

test('diff: the diff styles are on the page only when it has a diff block, in every theme', () => {
  const plain = render(draft('```ts', 'a()')).html;
  assert.ok(!plain.includes('.am-code--diff'));
  for (const theme of themeNames('page')) {
    for (const mode of ['light', 'dark']) {
      const { html } = renderDoc(`---\ntitle: D\ntheme: ${theme}\nmode: ${mode}\n---\n## A\n\`\`\`diff\n${SAMPLE}\n\`\`\`\n`, {}, {}, { codeDir: dir });
      assert.match(html, /\.am-ln--add \{/, theme);
      assert.match(html, /\.am-ln--del \{/, theme);
      assert.match(html, new RegExp(`<html[^>]*data-theme="${theme}"`), theme);
    }
  }
});

test('diff: the draft is kept, and am patch on another panel leaves the diff block as it is', () => {
  const src = `${draft('```diff file=src/code.js', SAMPLE)}\n## B Other\nText.\n`;
  const { html } = render(src);
  assert.equal(readPage(html).source, src);
  assert.equal(replacePanel(src, 'B', 'New text.'), src.replace('Text.\n', 'New text.'));
  const again = render(replacePanel(readPage(html).source, 'B', 'New text.')).html;
  assert.ok(again.includes(html.match(/<figure class="am-codeblock am-codeblock--diff">[\s\S]*?<\/figure>/)[0]));
});

test('cli patch: a page with a diff block keeps it when another panel is patched', async () => {
  const sink = () => { let text = ''; return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } }; };
  const run = async (args, stdin = '') => {
    const out = sink();
    const err = sink();
    const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: join(dir, 'home') }, cwd: dir });
    return { code, out: out.text, err: err.text };
  };
  const src = `${draft('```diff file=src/code.js', SAMPLE)}\n## B Other\nText.\n`;
  const r = await run(['render', '-', '-o', 'out/diff.html'], src);
  assert.equal(r.code, 0, r.err);
  const p = await run(['patch', 'out/diff.html', '--panel', 'B', '-'], 'New text.');
  assert.equal(p.code, 0, p.err);
  const html = readFileSync(join(dir, 'out', 'diff.html'), 'utf8');
  assert.match(html, /<span class="am-ln am-ln--add" data-n="61">/);
  assert.match(html, /New text\./);
});
