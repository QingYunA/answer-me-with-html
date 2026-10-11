import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { md, mdInline, collectHtmlNotes } from '../src/markdown.js';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { parseDoc } from '../src/parse.js';
import { lintDoc } from '../src/lint/ste.js';
import { stripMath, hasMath, mayHaveMath, useTemml } from '../src/math.js';
import { loadMath } from '../src/math-load.js';
import { main } from '../src/cli.js';

before(() => loadMath('$x$'));

const formulas = (html) => (html.match(/<math /g) ?? []).length;
const texts = (src) => md(src).replace(/<math[\s\S]*?<\/math>/g, '[M]').trim();

// ── plain text: prices and shell variables ──
test('math: dollar signs in prices and shell variables stay plain text', () => {
  for (const src of ['$5 and $10', '$5-$10', 'costs $5.', '$HOME', '$PATH:$HOME', 'a $ b $ c', '$ x $', 'US$$']) {
    const html = md(src);
    assert.equal(formulas(html), 0, src);
    assert.equal(html.trim(), `<p>${src}</p>`);
  }
});

test('math: a price before a formula does not swallow it', () => {
  assert.equal(texts('costs $5, and $x$ is cheap'), '<p>costs $5, and [M] is cheap</p>');
  assert.equal(texts('$5 + $x$'), '<p>$5 + [M]</p>');
});

// ── inline formulas ──
test('math: inline formulas render as MathML with dir="ltr"', () => {
  for (const src of ['$x$', '($x$)', '$x$-axis', '$w(v)=\\prod_{u\\prec v}N_u^{-1}$。']) { // lang-ok: Chinese input under test
    const html = md(src);
    assert.equal(formulas(html), 1, src);
    assert.match(html, /<math dir="ltr" data-am-tex="[^"]*">/);
  }
  assert.equal(texts('($x$)'), '<p>([M])</p>');
  assert.equal(texts('$x$-axis'), '<p>[M]-axis</p>');
  assert.equal(texts('因此$x^2$是'), '<p>因此[M]是</p>', 'a Chinese character after the closing $ closes the formula'); // lang-ok: Chinese input under test
  assert.equal(texts('$w(v)=\\prod_{u\\prec v}N_u^{-1}$。'), '<p>[M]。</p>'); // lang-ok: Chinese input under test
});

test('math: a closing $ followed by a letter or _ does not close, so shell variables stay text', () => {
  assert.equal(formulas(md('$a$b')), 0);
  assert.equal(formulas(md('$a$_b')), 0);
  assert.equal(formulas(md('$n$-th')), 1);
  assert.equal(formulas(md('$a$ b')), 1);
});

test('math: Pandoc rules for the edges: a space inside the delimiters, a digit after the closing $', () => {
  assert.equal(formulas(md('$ x$')), 0);
  assert.equal(formulas(md('$x $')), 0);
  assert.equal(formulas(md('$x$5')), 0);
  assert.equal(formulas(md('$x$ 5')), 1);
});

test('math: the content is on one line', () => {
  assert.equal(formulas(md('$a\nb$')), 0);
});

test('math: inline formulas use wrap: "tex" so a long one can break after a relation', () => {
  assert.match(md('$a=b+c$'), /<math dir="ltr" data-am-tex="[^"]*"><mrow><mi>a<\/mi><mo>=<\/mo><\/mrow><mrow><mi>b<\/mi><mo>\+<\/mo><\/mrow>/);
});

test('math: \\$ is a dollar sign in text and inside a formula', () => {
  assert.equal(md('\\$5 and \\$10').trim(), '<p>$5 and $10</p>');
  assert.equal(texts('\\$5 and $x$'), '<p>$5 and [M]</p>');
  assert.equal(md('\\$x\\$').trim(), '<p>$x$</p>');
  const html = md('$a\\$b$');
  assert.equal(formulas(html), 1);
  assert.match(html, /\$/);
});

test('math: code spans and fenced code blocks are never touched', () => {
  assert.equal(md('`$x$` and `$a$ $b$`').trim(), '<p><code>$x$</code> and <code>$a$ $b$</code></p>');
  assert.equal(formulas(md('```\n$$\nx^2\n$$\n$y$\n```')), 0);
  assert.equal(formulas(md('~~~tex\n$x$\n~~~')), 0);
  assert.equal(texts('`$HOME` and $x$'), '<p><code>$HOME</code> and [M]</p>');
  assert.equal(formulas(md('$a `b` c$')), 0, 'a backtick ends the search');
});

test('math: emphasis and links around a formula still work', () => {
  assert.equal(texts('**bold $x_1$** and *it $y$*'), '<p><strong>bold [M]</strong> and <em>it [M]</em></p>');
  assert.match(md('[see $x$](https://example.com)'), /<a href="https:\/\/example.com">see <math/);
});

test('math: underscores and stars inside a formula are not read as emphasis', () => {
  const html = md('$a_1 + b_2$ and $c*d*e$');
  assert.equal(formulas(html), 2);
  assert.doesNotMatch(html, /<em>/);
});

test('math: mdInline reads formulas too', () => {
  assert.equal(formulas(mdInline('energy $E=mc^2$')), 1);
});

// ── display blocks ──
test('math: a $$ line, the TeX and a closing $$ line make a display block', () => {
  const html = md('before\n\n$$\n\\frac{a}{b}\n$$\n\nafter');
  assert.match(html, /<div class="am-math-block" dir="ltr"><math dir="ltr" data-am-tex="[^"]*" display="block"/);
  assert.equal(formulas(html), 1);
  assert.match(html, /<p>before<\/p>/);
  assert.match(html, /<p>after<\/p>/);
});

test('math: a display block takes several lines, a closing $$ at the end of the last line, and sits in a paragraph without a blank line', () => {
  assert.equal(formulas(md('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$')), 1);
  assert.equal(formulas(md('$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$')), 1);
  const html = md('text\n$$\nx\n$$\nmore');
  assert.equal(formulas(html), 1);
  assert.match(html, /<p>text<\/p>/);
});

test('math: a one-line $$ … $$ paragraph is a display block', () => {
  const html = md('$$ E = mc^2 $$');
  assert.match(html, /^<div class="am-math-block" dir="ltr"><math dir="ltr" data-am-tex="[^"]*" display="block"/);
  assert.equal(formulas(md('$$E=mc^2$$')), 1);
});

test('math: $$ inside a sentence is display math too', () => {
  const html = md('so $$x^2$$ holds');
  assert.match(html, /<p>so <span class="am-math-block" dir="ltr"><math dir="ltr" data-am-tex="[^"]*" display="block"/);
  assert.match(html, /<\/span> holds<\/p>/);
});

test('math: an unclosed $$ block, a blank line inside it and an empty block stay text', () => {
  assert.equal(formulas(md('$$\nx^2\n')), 0);
  assert.equal(formulas(md('$$\nx\n\ny\n$$')), 0);
  assert.equal(formulas(md('$$\n$$')), 0);
});

test('math: display blocks work inside a list item and a quote', () => {
  assert.equal(formulas(md('- item\n\n  $$\n  x^2\n  $$')), 1);
  assert.equal(formulas(md('> $$\n> x^2\n> $$')), 1);
});

test('math: formulas in a table cell, a heading and a list item', () => {
  assert.match(md('| a |\n|---|\n| $x^2$ |'), /<td><math dir="ltr" data-am-tex="[^"]*">/);
  assert.match(md('### Energy $E$'), /<h3[^>]*>Energy <math/);
  assert.match(md('- one $x$'), /<li>one <math/);
});

test('math: a line with many dollar signs is scanned in linear time', () => {
  const line = '$5 '.repeat(20000);
  const started = Date.now();
  assert.equal(formulas(md(line)), 0);
  assert.equal(formulas(md(`${'$a '.repeat(20000)}`)), 0);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('math: without Temml loaded, $ stays text', async () => {
  useTemml(null);
  try {
    assert.equal(md('$x$').trim(), '<p>$x$</p>');
  } finally {
    await loadMath('$x$');
  }
});

// ── bad TeX ──
test('math: bad TeX is shown as raw TeX in an error style with the message in a title', () => {
  const html = md('see $\\foo{x}$ here');
  assert.match(html, /<span class="am-math-error" title="Unsupported function name: \\foo at position 1">\$\\foo\{x\}\$<\/span>/);
  assert.equal(formulas(html), 0);
  const block = md('$$\nx_{\n$$');
  assert.match(block, /<div class="am-math-block" dir="ltr"><span class="am-math-error" title="Expected &#39;}&#39;, got &#39;EOF&#39; at end of input">\$\$\nx_\{\n\$\$<\/span><\/div>/);
  assert.match(md('$<b>\\bad$'), /\$&lt;b&gt;\\bad\$/);
});

test('math: raw TeX in an error style is escaped', () => {
  const html = md('$\\foo<script>$');
  assert.doesNotMatch(html, /<script>/);
});

test('math: Temml does not follow links or load files from a formula', () => {
  const html = md('$\\href{javascript:alert(1)}{x}$ $\\includegraphics{a.png}$ $\\htmlClass{a}{x}$');
  assert.doesNotMatch(html, /<a\b|<img\b/);
  assert.equal((html.match(/class="am-math-error"/g) ?? []).length, 3);
});

const warningsOf = (source) => renderDoc(source).stats.mathWarnings;

test('math: bad TeX is a warning with the draft line of the formula, and the page is still written', () => {
  const source = '---\ntitle: T\n---\n## A\nfine $x$\n\nbad $\\foo$ here\n\nlast line $y_{$\n';
  const result = renderDoc(source);
  assert.deepEqual(result.stats.mathWarnings.map((w) => w.line), [7, 9]);
  assert.match(result.stats.mathWarnings[0].message, /^\$\\foo\$ is shown as raw TeX: Unsupported function name: \\foo at position 1$/);
  assert.match(result.html, /class="am-math-error"/);
});

test('math: the line of a display block is its opening $$ line; the same bad formula twice gets two lines', () => {
  assert.deepEqual(warningsOf('## A\n$$\n\\foo\n$$\n\ntext\n\n$$\n\\foo\n$$').map((w) => w.line), [2, 8]);
  assert.deepEqual(warningsOf('## A\n$\\bad$\n\n$\\bad$ and $\\bad$').map((w) => w.line), [2, 4, 4]);
});

test('math: the line is right inside a callout, a kv value and a list', () => {
  assert.deepEqual(warningsOf('## A\n```callout\nfirst\nsecond $\\bad$\n```').map((w) => w.line), [4]);
  assert.deepEqual(warningsOf('## A\n```kv\nEnergy: $\\bad$\n```').map((w) => w.line), [3]);
  assert.deepEqual(warningsOf('## A\n- a\n- b $\\bad$').map((w) => w.line), [3]);
});

test('math: \\ref, \\eqref and \\label give a warning and the formula is still typeset', () => {
  const result = renderDoc('## A\n$$\nx \\label{a}\n$$\n\nsee $\\ref{a}$');
  assert.deepEqual(result.stats.mathWarnings.map((w) => w.line), [2, 6]);
  assert.match(result.stats.mathWarnings[0].message, /uses \\ref, \\eqref or \\label; a page has no script to resolve them/);
  assert.match(result.html, /<math dir="ltr"/);
  assert.deepEqual(warningsOf('## A\n$$\n\\tag{1} x\n$$'), [], '\\tag needs no script');
});

test('math: a good draft has no math warning', () => {
  assert.deepEqual(warningsOf('## A\n$x$ and $$y$$ and $5 and $10'), []);
});

// ── the page: styles and font only with math ──
const draft = (body, head = '') => `---\ntitle: T\n${head}---\n## A\n${body}\n`;

test('math: the Temml styles and the font come only with a page that has math', () => {
  const withMath = renderDoc(draft('Energy $E=mc^2$')).html;
  assert.match(withMath, /@font-face \{\s*font-family: 'Temml';\s*src: url\('data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}'\)/);
  assert.match(withMath, /\.am-math-error \{/);
  assert.doesNotMatch(withMath, /url\('Temml\.woff2'\)/);
  for (const body of ['plain text', 'costs $5 and $10', '`$x$`', '```\n$$\nx\n$$\n```']) {
    const html = renderDoc(draft(body)).html;
    assert.doesNotMatch(html.replace(/<script>[\s\S]*<\/script>/, ''), /Temml|am-math/, body); // the page script names the class it marks
  }
});

test('math: a page with only a bad formula carries the error style', () => {
  assert.match(renderDoc(draft('bad $\\foo$')).html, /\.am-math-error \{/);
});

test('math: hasMath tells a formula page from a plain one', () => {
  assert.equal(hasMath('<p><math dir="ltr"></math></p>'), true);
  assert.equal(hasMath('<span class="am-math-error">x</span>'), true);
  assert.equal(hasMath('<p>$5</p><math>raw</math>'), false);
});

test('math: the formula stays left to right on a Hebrew page, and its parts are not isolated again', () => {
  const html = renderDoc(draft('הנוסחה $a_1-b$ ו-$$x^2$$', 'lang: he\n')).html;
  assert.match(html, /<html lang="he" dir="rtl"/);
  assert.equal((html.match(/<math dir="ltr"/g) ?? []).length, 2);
  assert.doesNotMatch(html.match(/<math[\s\S]*?<\/math>/g).join(''), /<bdi/);
});

test('math: the embedded source is the draft as written', () => {
  const source = draft('Energy $E=mc^2$ and\n\n$$\nx\n$$');
  const html = renderDoc(source).html;
  assert.match(html, /<textarea id="am-source"[^>]*>[\s\S]*Energy \$E=mc\^2\$ and[\s\S]*<\/textarea>/);
});

test('math: a video keeps $ as text and gets no math styles', async () => {
  const html = (await renderVideo('---\ntitle: V\n---\n## One\n$x^2$ in a scene\n> narration here\n')).html;
  assert.equal(formulas(html), 0);
  assert.doesNotMatch(html, /Temml/);
});

// ── the STE check ──
const lint = (body) => lintDoc(parseDoc(body));

test('STE check: TeX gives no word warning and no sentence', () => {
  assert.deepEqual(lint('## A\nUse $\\prod_{u \\prec v} N_u^{-1}$ in the sum, where $\\utilize$ is a name.'), []);
  const long = 'Use $a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p + q + r + s + t + u + v + w$ here.';
  assert.deepEqual(lint(`## A\n${long}`), []);
  assert.deepEqual(lint('## A\n关于$x$的说明。'), []); // lang-ok: Chinese input under test
});

test('STE check: a $$ block is not paragraph text', () => {
  const block = '$$\n\\begin{aligned} a. b. c. d. e. f. g. h. \\end{aligned}\n$$';
  assert.deepEqual(lint(`## A\nOne.\n${block}\nTwo.`), []);
  assert.deepEqual(lint('## A\n$$ a. b. c. d. e. f. g. h. $$'), []);
  const six = 'One. Two. Three. Four. Five. Six.';
  assert.deepEqual(lint(`## A\n${six}\n$$\nx\n$$\nSeven.`).map((w) => w.rule), [], 'a $$ block splits the paragraph');
});

test('STE check: words outside the math are still checked', () => {
  assert.deepEqual(lint('## A\nUtilize $x$ now.').map((w) => w.rule), ['word']);
  assert.deepEqual(lint('## A\n$$\nutilize\n$$\nUtilize it.').map((w) => w.line), [5]);
});

test('mayHaveMath: a draft with prices only does not need Temml', () => {
  assert.equal(mayHaveMath('costs $5 and $10, $HOME and $PATH:$HOME'), false);
  assert.equal(mayHaveMath('no dollar at all'), false);
  assert.equal(mayHaveMath('a $x$ b'), true);
  assert.equal(mayHaveMath('a\n$$\nx\n$$\n'), true);
  assert.equal(mayHaveMath('$$ x $$'), true);
});

test('stripMath: removes formulas by the same rule as the renderer', () => {
  assert.equal(stripMath('a $x$ b $5 and $10 c \\$y\\$ $$z$$ d'), 'a  b $5 and $10 c \\$y\\$  d');
  assert.equal(stripMath('$PATH:$HOME'), '$PATH:$HOME');
});

// ── the CLI: warnings, no auto-open, retry with --replace ──
function retrying(t) {
  const home = mkdtempSync(join(tmpdir(), 'am-math-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const opened = [];
  let now = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const call = async (args, stdin = '') => {
    const chunks = { out: '', err: '' };
    const sink = (key) => new Writable({ write(chunk, _enc, cb) { chunks[key] += chunk; cb(); } });
    now += 1000;
    const code = await main(args, {
      stdout: sink('out'), stderr: sink('err'), stdin: Readable.from([stdin]),
      env: { AM_HOME: home, AM_NO_UPDATE_CHECK: '1' }, cwd: home, now: () => now, open: (f) => opened.push(f),
    });
    return { code, out: chunks.out, err: chunks.err, file: chunks.out.match(/^✓ (.+\.html)$/m)?.[1] };
  };
  return { call, opened };
}

test('cli render: a formula Temml cannot read prints a math warning with the line, and the page does not open', async (t) => {
  const { call, opened } = retrying(t);
  const r = await call(['render', '-'], '---\ntitle: M\n---\n## A\nfine\n\nbad $\\foo$\n');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /math 1 warning \(the page is written; fix the TeX and render again\):\n {2}L7 \[math\] \$\\foo\$ is shown as raw TeX: Unsupported function name: \\foo at position 1/);
  assert.ok(r.out.includes(`Not opened because of the warnings; to render again, add --replace ${r.file}`), r.out);
  assert.deepEqual(opened, []);
  assert.ok(existsSync(r.file));
});

test('cli render: the agent fixes the TeX and renders again with --replace; the fixed page opens and the bad one is gone', async (t) => {
  const { call, opened } = retrying(t);
  const bad = await call(['render', '-'], '## A\nbad $\\foo$\n');
  const good = await call(['render', '-', '--replace', bad.file], '## A\nfixed $\\alpha$\n');
  assert.equal(good.code, 0, good.err);
  assert.doesNotMatch(good.out, /math \d warning/);
  assert.ok(!existsSync(bad.file));
  assert.deepEqual(opened, [good.file]);
  assert.match(readFileSync(good.file, 'utf8'), /<math dir="ltr"/);
});

test('cli patch: a panel with a formula is typeset again and keeps its source', async (t) => {
  const { call } = retrying(t);
  const page = await call(['render', '-'], '## A\nplain\n\n## B\nold\n');
  assert.doesNotMatch(readFileSync(page.file, 'utf8').replace(/<script>[\s\S]*<\/script>/, ''), /<math/);
  const patched = await call(['patch', page.file, '--panel', 'B', '-'], '## B\nnew $x^2$\n');
  assert.equal(patched.code, 0, patched.err);
  const html = readFileSync(page.file, 'utf8');
  assert.match(html, /<math dir="ltr" data-am-tex="[^"]*">/);
  assert.match(html, /new \$x\^2\$/);
  const again = await call(['patch', page.file, '--panel', 'B', '-'], '## B\nbad $\\foo$\n');
  assert.match(again.out, /\[math\]/);
});

test('cli lint: TeX is not linted', async (t) => {
  const { call } = retrying(t);
  const r = await call(['lint', '-'], '## A\nUse $\\utilize + \\leverage$ here.\n');
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /\[word\]/);
});
