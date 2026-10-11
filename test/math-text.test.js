import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { nodeText, formulaOf, textWithMath } from '../src/runtime/math-text.js';
import { RUNTIME_JS } from '../src/assets.js';
import { renderDoc } from '../src/render.js';
import { md } from '../src/markdown.js';
import { loadMath } from '../src/math-load.js';

before(() => loadMath('$x$'));

// A tiny DOM: what the helper reads is nodeType, data, childNodes, parentElement, closest and getAttribute.
const text = (data) => ({ nodeType: 3, data });
const el = (localName, attrs, ...kids) => {
  const node = {
    nodeType: 1, localName, childNodes: kids, parentElement: null,
    getAttribute: (name) => attrs[name] ?? null,
    closest(sel) {
      const name = sel.slice(1, -1);
      for (let n = this; n; n = n.parentElement) if (n.getAttribute?.(name) !== null) return n;
      return null;
    },
  };
  for (const kid of kids) kid.parentElement = node;
  return node;
};
// E = mc^2 as MathML lays it out: one text node per token.
const emc2 = (tex) => el('math', { 'data-am-tex': tex }, el('mi', {}, text('E')), el('mo', {}, text('=')), el('mi', {}, text('m')), el('msup', {}, el('mi', {}, text('c')), el('mn', {}, text('2'))));
const read = (node) => textWithMath(node).replace(/\s+/g, ' ').trim();

test('math text: an inline formula is quoted as the TeX the draft wrote, delimiters included', () => {
  const p = el('p', {}, text('Energy '), emc2('$E = mc^2$'), text(' holds'));
  assert.equal(textWithMath(p), 'Energy $E = mc^2$ holds');
});

test('math text: a display formula keeps its $$ and its lines', () => {
  const block = el('div', {}, emc2('$$\nE = mc^2\n$$'));
  assert.equal(textWithMath(block), '$$\nE = mc^2\n$$');
  assert.equal(read(block), '$$ E = mc^2 $$');
  assert.equal(textWithMath(el('p', {}, text('A '), emc2('$$E=mc^2$$'), text(' B'))), 'A $$E=mc^2$$ B');
});

test('math text: two formulas next to each other are two quotes; the tokens after the first add nothing', () => {
  const first = emc2('$a$');
  const second = emc2('$b$');
  const p = el('p', {}, first, second);
  assert.equal(textWithMath(p), '$a$$b$');
  const tokens = [first.childNodes[0].childNodes[0], first.childNodes[1].childNodes[0]];
  assert.deepEqual(tokens.map(nodeText), ['$a$', '']);
  assert.equal(formulaOf(tokens[1]), first);
});

test('math text: text without a formula is what textContent gives', () => {
  const p = el('p', {}, text('Redis '), el('b', {}, text('keeps')), text(' sessions.'));
  assert.equal(textWithMath(p), 'Redis keeps sessions.');
  assert.equal(nodeText(p.childNodes[0]), 'Redis ');
  assert.equal(formulaOf(p.childNodes[0]), null);
  assert.equal(textWithMath(el('p', {})), '');
});

test('math text: a formula that Temml could not read is its raw TeX once, because it is plain text and not a <math>', () => {
  const p = el('p', {}, text('bad '), el('span', { class: 'am-math-error' }, text('$\\frac{$')), text(' end'));
  assert.equal(textWithMath(p), 'bad $\\frac{$ end');
});

// ── the attribute that render writes ──
const tex = (html) => [...html.matchAll(/<math [^>]*data-am-tex="([^"]*)"/g)].map((m) => m[1]);

test('math text: render writes the draft formula, escaped, on each <math>', () => {
  assert.deepEqual(tex(md('Energy $E = mc^2$ holds')), ['$E = mc^2$']);
  assert.deepEqual(tex(md('$$\na < b\n$$')), ['$$\na &lt; b\n$$']);
  assert.deepEqual(tex(md('so $$a+b$$ here and $x$')), ['$$a+b$$', '$x$']);
  // A "$'" or "$&" in the TeX must reach the page as written (String.replace reads them in a replacement string).
  assert.deepEqual(tex(md("a $x\\$'y$ b")), ['$x\\$&#39;y$']);
});

test('math text: a formula Temml cannot read has no attribute and shows its raw TeX once', () => {
  const html = md('bad $\\frac{$ end');
  assert.deepEqual(tex(html), []);
  assert.equal(html.match(/\$\\frac\{\$/g).length, 1);
});


// ── the script ──
test('math text: every page gets one script, with the helpers, and the reads go through them', () => {
  const plain = renderDoc('---\nlang: en\n---\n## A Panel\n\nCosts $5 and $10.\n').html;
  const math = renderDoc('---\nlang: en\n---\n## A Panel\n\nEnergy $E = mc^2$ holds.\n').html;
  for (const html of [plain, math]) assert.ok(html.includes(RUNTIME_JS));
  assert.ok(RUNTIME_JS.includes('function nodeText(') && RUNTIME_JS.includes('nodeText(node)') && RUNTIME_JS.includes('textWithMath(el)'));
  assert.ok(!/^export /m.test(RUNTIME_JS));
  assert.ok(!RUNTIME_JS.includes('node.data.replace') && !RUNTIME_JS.includes('el?.textContent'), 'every read of page text goes through the helpers');
});

// The keys of blocks without math are pinned against the 0.5.0 runtime in test/remark-browser.test.js.
test('math text: on a page without math, formulaOf is null, so the text of a block is what it was', () => {
  const li = el('li', {}, text('Same '), el('b', {}, text('text')), text(' twice'));
  assert.equal(formulaOf(li.childNodes[0]), null);
  assert.equal(formulaOf(li.childNodes[1].childNodes[0]), null);
  assert.equal(textWithMath(li), 'Same text twice');
});
