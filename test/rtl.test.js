// Right-to-left pages (Hebrew, Arabic, Persian, Urdu, Yiddish): the root says dir="rtl", the layout mirrors, diagrams read from the right,
// code stays left to right, and a left-to-right page is not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';
import { COMPONENTS } from '../src/components/index.js';
import { replyText } from '../src/runtime/reply-text.js';
import { RTL_CSS } from '../src/assets.js';

const draft = (lang, body) => `---\nlang: ${lang}\n---\n${body}`;
const FLOW = '## A זרימה\n```flow LR\nטיוטה -> הכלי am: קורא\nהכלי am -> דף HTML\n```\n';

const flow = (text, args, dir) => COMPONENTS.get('flow').render(text, { args, uid: () => 'u1', ui: {}, dir });
const sequence = (text, dir) => COMPONENTS.get('sequence').render(text, { args: '', uid: () => 'u1', ui: {}, dir });

// The centre x of each node, by name, read from the node's text.
function nodeCentres(svg) {
  const out = {};
  for (const m of svg.matchAll(/<g class="am-node[^"]*" data-key="([^"]+)"[^>]*>[\s\S]*?<text x="([\d.]+)"/g)) out[m[1]] = Number(m[2]);
  return out;
}
const svgWidth = (svg) => Number(svg.match(/<svg viewBox="0 0 (\d+)/)[1]);

test('rtl: a Hebrew page writes dir="rtl" on the root and on the toolbar copy of the root settings', () => {
  const { html, language } = renderDoc(draft('he', FLOW));
  assert.equal(language.dir, 'rtl');
  assert.match(html, /<html lang="he" dir="rtl" data-theme=/);
  assert.match(html, /data-am-root-lang="he" data-am-root-dir="rtl"/);
});

test('rtl: Arabic, Persian, Urdu and Yiddish pages are right to left too, without a label file of their own', () => {
  for (const tag of ['ar', 'fa', 'ur', 'yi']) assert.match(renderDoc(draft(tag, '## A x\ny\n')).html, /<html lang="[^"]+" dir="rtl"/, tag);
});

test('rtl: an undeclared Hebrew draft is detected as he and is right to left', () => {
  assert.match(renderDoc('## A סקירה\nזהו תיאור קצר בעברית.\n').html, /<html lang="he" dir="rtl"/);
});

test('rtl: a Hebrew page uses Hebrew labels and a Hebrew font stack', () => {
  const { html } = renderDoc(draft('he', FLOW));
  assert.match(html, />תגובה<\/button>/);
  assert.match(html, /html:lang\(he\)\[data-theme\]\[data-mode\] \{\n {2}--font-sans: [^;]*"Noto Sans Hebrew"/);
});

test('rtl: a right-to-left page carries the rtl styles, a left-to-right page does not', () => {
  assert.ok(renderDoc(draft('he', FLOW)).html.includes(RTL_CSS));
  for (const lang of ['en', 'zh', 'ja']) assert.ok(!renderDoc(draft(lang, '## A x\ny\n')).html.includes(RTL_CSS), lang);
});

test('rtl: code blocks, diffs and inline code stay left to right', () => {
  assert.match(RTL_CSS, /html\[dir="rtl"\] \.am-codeblock, html\[dir="rtl"\] \.am-code, html\[dir="rtl"\] pre \{ direction: ltr; text-align: left; \}/);
  assert.match(RTL_CSS, /html\[dir="rtl"\] :not\(pre\) > code \{ direction: ltr; unicode-bidi: isolate; \}/);
  // The diff block uses the same .am-codeblock / .am-code classes.
  const { html } = renderDoc(draft('he', '## A קוד\n```diff\n- a\n+ b\n```\n'));
  assert.match(html, /class="am-codeblock am-codeblock--diff"/);
});

test('rtl: table headers and other small labels use the sans font, with no letter spacing or capitals', () => {
  const rule = RTL_CSS.match(/html\[dir="rtl"\] \.am-md th,[^{]*\{([^}]*)\}/);
  assert.ok(rule, 'a rule for table headers');
  assert.match(rule[1], /font-family: var\(--font-sans\)/);
  assert.match(rule[1], /letter-spacing: normal/);
  assert.match(rule[1], /text-transform: none/);
});

test('rtl: flow LR is mirrored, the first node on the right and arrows pointing left', () => {
  const text = 'Start -> Middle: go\nMiddle -> End';
  const ltr = flow(text, 'LR', 'ltr');
  const rtl = flow(text, 'LR', 'rtl');
  const [a, b] = [nodeCentres(ltr), nodeCentres(rtl)];
  assert.ok(a.Start < a.Middle && a.Middle < a.End, 'left to right by default');
  assert.ok(b.Start > b.Middle && b.Middle > b.End, 'right to left on an rtl page');
  const w = svgWidth(rtl);
  // The viewBox rounds the drawing width up, so the mirror image is within one pixel.
  for (const name of ['Start', 'Middle', 'End']) assert.ok(Math.abs(b[name] - (w - a[name])) <= 1, `${name} is the mirror image`);
  // Edges run from a larger x to a smaller one.
  const [x1, x2] = rtl.match(/class="am-edge" d="M([\d.]+),[\d.]+ L([\d.]+)/).slice(1).map(Number);
  assert.ok(x1 > x2);
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  assert.doesNotMatch(ltr, /direction=/);
});

test('rtl: the label of a group box sits in its top right corner on an rtl page', () => {
  const text = 'A -> B\ngroup G: A, B';
  const rect = (svg) => svg.match(/<rect class="am-cluster" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).slice(1).map(Number);
  const labelX = (svg) => Number(svg.match(/<text class="am-cluster-label" x="([\d.]+)"/)[1]);
  const [lx, lw] = rect(flow(text, 'LR', 'ltr'));
  assert.equal(labelX(flow(text, 'LR', 'ltr')), lx + 8);
  const rtl = flow(text, 'LR', 'rtl');
  const [rx, rw] = rect(rtl);
  assert.ok(Math.abs(labelX(rtl) - (rx + rw - 8)) < 0.2);
  assert.ok(Math.abs(rw - lw) < 0.2);
});

test('rtl: a sequence diagram puts the first participant on the right', () => {
  const text = 'Client -> Server: hello\nServer -> Server: think';
  const actorX = (svg, name) => Number(svg.match(new RegExp(`<g data-key="${name}"><rect class="am-actor" x="([\\d.]+)"`))[1]);
  const ltr = sequence(text, 'ltr');
  const rtl = sequence(text, 'rtl');
  assert.ok(actorX(ltr, 'Client') < actorX(ltr, 'Server'));
  assert.ok(actorX(rtl, 'Client') > actorX(rtl, 'Server'));
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  // The self call loops out to the left of the lifeline.
  const loop = rtl.match(/d="M([\d.]+),[\d.]+ H([\d.]+) V/).slice(1).map(Number);
  assert.ok(loop[1] < loop[0]);
});

test('rtl: a sequence or flow without a page direction renders exactly as before (left to right)', () => {
  const text = 'A -> B: x\nB --> A';
  assert.equal(sequence(text, undefined), sequence(text, 'ltr'));
  assert.equal(flow(text, 'LR', undefined), flow(text, 'LR', 'ltr'));
});

test('rtl: the limits scale starts from the right on an rtl page', () => {
  const render = (dir) => COMPONENTS.get('limits').render('Size | 4 / 10 | KB', { args: '', dir });
  assert.match(render('rtl'), /class="am-lim-mark" style="right: /);
  assert.match(render('ltr'), /class="am-lim-mark" style="left: /);
  assert.doesNotMatch(render('rtl'), /style="left: /);
});

test('rtl: the reply arrow points the way the text runs', () => {
  const ui = { decisions: 'D', comments: 'C', confirmed: 'ok', untouched: 'kept', was: 'was', typed: 'typed' };
  const decisions = [{ panel: 'A', question: 'Q', picked: ['x'], suggested: ['x'], touched: true }];
  assert.match(replyText({ title: 'T', decisions, comments: [], ui }), / {3}→ \*\*x\*\*/);
  assert.match(replyText({ title: 'T', decisions, comments: [], ui, rtl: true }), / {3}← \*\*x\*\*/);
});

test('rtl: a left-to-right page has no dir attribute and no mirrored diagram', () => {
  const { html } = renderDoc(draft('en', '## A Flow\n```flow LR\nA -> B\n```\n'));
  assert.doesNotMatch(html, /<html[^>]*\sdir=/);
  assert.doesNotMatch(html, /data-am-root-dir="/);
  assert.doesNotMatch(html, /direction="rtl"/);
});
