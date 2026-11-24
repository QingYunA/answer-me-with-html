// The steps block (#440): it links the diagram and the code block of one panel. Parsing, every error with its draft line, the
// static markup (numbers, list) that print, no-JS and image export show, and that a page without a steps block stays as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDoc, RenderError } from '../src/render.js';
import { DraftErrors } from '../src/parse.js';
import { COMPONENTS } from '../src/components/index.js';
import { parseSteps } from '../src/steps.js';
import { renderVideo } from '../src/video/render.js';

const CODE = '```js start=10\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n```';
const FLOW = '```flow TB\nStart -> Middle\nMiddle -> End\n```';
const STEPS = '```steps\nStart 10: Begin here.\nMiddle 11-12: The `middle` part.\nEnd 13-14: Finish.\n```';
const draft = (...blocks) => `---\nlang: en\nstyle: off\n---\n## A Panel\n\n${blocks.join('\n\n')}\n`;
const lineOf = (text, snippet) => text.split('\n').findIndex((l) => l.includes(snippet)) + 1;

// Every error of a draft as a list: one error is thrown as itself, several as DraftErrors.
function errorsOf(text, ...rest) {
  try {
    renderDoc(text, ...rest);
  } catch (err) {
    return err instanceof DraftErrors ? err.errors : [err];
  }
  return [];
}

const lines = (html) => new Map([...html.matchAll(/<span class="am-ln[^"]*"([^>]*)>/g)].map(([, attrs]) => [Number(attrs.match(/data-n="(\d+)"/)?.[1]), attrs]));

test('parseSteps: an item, a line or a range, then the note', () => {
  const steps = parseSteps('Write to clipboard 146-147: Try the API first.\nReturn true 148: Done.\nStep 2 3: the item may hold digits\n');
  assert.deepEqual(steps.map(({ item, from, to, note, line }) => ({ item, from, to, note, line })), [
    { item: 'Write to clipboard', from: 146, to: 147, note: 'Try the API first.', line: 1 },
    { item: 'Return true', from: 148, to: 148, note: 'Done.', line: 2 },
    { item: 'Step 2', from: 3, to: 3, note: 'the item may hold digits', line: 3 },
  ]);
});

test('parseSteps: blank lines are skipped, the note may hold a colon, and the first colon ends the item', () => {
  const steps = parseSteps('\nA 1: note: with a colon\n\nB 2-3:\n');
  assert.deepEqual(steps.map(({ item, from, to, note, line }) => ({ item, from, to, note, line })), [
    { item: 'A', from: 1, to: 1, note: 'note: with a colon', line: 2 },
    { item: 'B', from: 2, to: 3, note: '', line: 4 },
  ]);
});

test('parseSteps: spaces around the dash of a range are fine; an item that ends with a dash is an error', () => {
  const [step] = parseSteps('Go 1 - 2: a\n');
  assert.deepEqual([step.item, step.from, step.to], ['Go', 1, 2]);
  assert.throws(() => parseSteps('A 1: ok\nGo - 3: a'), (e) => e.line === 2 && /cannot end with "-"/.test(e.message));
});

test('parseSteps: a line that does not follow the form names the line', () => {
  for (const [text, line, pattern] of [
    ['A 1: ok\nno colon here', 2, /<item> <line or range>: <note>/],
    ['A: no numbers', 1, /line number/],
    ['1-2: no item', 1, /item/],
    ['A 5-3: backwards', 1, /after/],
    ['A 0: zero', 1, /1 or more/],
  ]) {
    assert.throws(() => parseSteps(text), (e) => e.line === line && pattern.test(e.message), text);
  }
  assert.throws(() => parseSteps('  \n'), (e) => /at least one step/.test(e.message));
});

test('a flow diagram and a code block are linked: numbers, boxes and the list are in the markup', () => {
  const { html } = renderDoc(draft(CODE, FLOW, STEPS));
  assert.equal(html.match(/<div class="am-steps"/g).length, 1);
  assert.match(html, /<div class="am-steps"[^>]*data-steps="3"/);
  // Each step covers its lines; the first line of a step carries the step number for print.
  const code = lines(html);
  assert.match(code.get(10), /data-link="0"/);
  assert.match(code.get(10), /data-sn="1"/);
  assert.match(code.get(11), /data-link="1"/);
  assert.match(code.get(11), /data-sn="2"/);
  assert.match(code.get(12), /data-link="1"/);
  assert.doesNotMatch(code.get(12), /data-sn/);
  assert.match(code.get(14), /data-link="2"/);
  // Each linked diagram item is a button with the step in its name, and carries a numbered badge for print.
  for (const [key, i] of [['Start', 0], ['Middle', 1], ['End', 2]]) {
    const node = html.match(new RegExp(`<g class="am-node[^"]*" data-key="${key}"[^>]*>`))[0];
    assert.match(node, new RegExp(`data-link="${i}"`));
    assert.match(node, /tabindex="0"/);
    assert.match(node, /role="button"/);
    assert.match(node, new RegExp(`aria-label="Step ${i + 1}: ${key}`));
  }
  assert.equal(html.match(/class="am-step-badge"/g).length, 3);
  // The edges know which steps they join, so the page can mark the edges of the selected item.
  assert.equal(html.match(/<g data-step="\d+" data-ends="[^"]+">/g).length, 2);
  assert.match(html, /data-ends="0 1"/);
  // The list under the pair: every step, its item, its lines and its note (inline Markdown works).
  const list = html.match(/<ol class="am-steps-list"[^>]*>([\s\S]*?)<\/ol>/)[1];
  assert.equal(list.match(/<li /g).length, 3);
  assert.match(list, /Middle[\s\S]*11[^<]*12[\s\S]*The <code>middle<\/code> part\./);
  // The steps fence draws nothing of its own.
  assert.equal(html.match(/<ol class="am-steps-list"/g).length, 1);
});

test('the pair sits where the first of the diagram and the code block was written, in the order they were written', () => {
  const at = (html, s) => html.indexOf(s);
  const diagramFirst = renderDoc(draft('Before.', FLOW, 'Between.', CODE, STEPS, 'After.')).html;
  assert.ok(at(diagramFirst, 'Before.') < at(diagramFirst, '<div class="am-steps"'));
  assert.ok(at(diagramFirst, '<div class="am-steps"') < at(diagramFirst, 'am-flow') && at(diagramFirst, 'am-flow') < at(diagramFirst, '<figure class="am-codeblock'));
  // The text written between the two moves behind the pair; the steps block itself leaves no trace where it was written.
  assert.ok(at(diagramFirst, 'am-steps-list') < at(diagramFirst, 'Between.') && at(diagramFirst, 'Between.') < at(diagramFirst, 'After.'));
  // Code written first stays first in the markup; the stylesheet puts the diagram on top only when the pair is stacked.
  const codeFirst = renderDoc(draft(CODE, FLOW, STEPS)).html;
  assert.ok(at(codeFirst, '<figure class="am-codeblock') < at(codeFirst, '<div class="am-steps-diagram"'));
  assert.ok(at(diagramFirst, '<div class="am-steps-diagram"') < at(diagramFirst, '<figure class="am-codeblock'));
});

test('a linked code block always shows its line numbers, also with no language and no start=', () => {
  const { html } = renderDoc(draft('```\nline one\nline two\n```', FLOW, '```steps\nStart 1: first\nEnd 2: second\n```'));
  assert.match(html, /<pre class="am-code am-code--num">/);
  assert.deepEqual([...lines(html).keys()], [1, 2]);
});

test('a code block from a file is linked by its file line numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-steps-'));
  try {
    writeFileSync(join(dir, 'f.js'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
    const text = draft('```js src=f.js lines=5-9\n```', FLOW, '```steps\nStart 5-6: a\nEnd 9: b\n```');
    const { html } = renderDoc(text, {}, {}, { codeDir: dir });
    const code = lines(html);
    assert.deepEqual([...code.keys()], [5, 6, 7, 8, 9]);
    assert.match(code.get(5), /data-link="0"/);
    assert.match(code.get(9), /data-link="1"/);
    assert.doesNotMatch(code.get(7), /data-link/);
    assert.deepEqual(errorsOf(draft('```js src=f.js lines=5-9\n```', FLOW, '```steps\nStart 4: a\n```'), {}, {}, { codeDir: dir }).map((e) => e.line), [lineOf(draft('```js src=f.js lines=5-9\n```', FLOW, '```steps\nStart 4: a\n```'), 'Start 4')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no diagram the steps block is a step-by-step walkthrough of the code', () => {
  const { html } = renderDoc(draft(CODE, '```steps\nSet up 10-11: Make the values.\nUse them 12-14: Read them.\n```'));
  assert.match(html, /<div class="am-steps"[^>]*data-steps="2"/);
  assert.doesNotMatch(html.slice(html.indexOf('<div class="am-steps"')), /class="am-step-badge"/);
  assert.match(lines(html).get(10), /data-sn="1"/);
  assert.match(html, /<li data-link="1">[\s\S]*Use them[\s\S]*Read them\./);
});

test('state and tree items link too', () => {
  const state = '```state\n[*] -> Idle\nIdle -> Busy: start\nBusy -> Idle: done\n```';
  const a = renderDoc(draft(CODE, state, '```steps\nIdle 10: wait\nBusy 11-12: work\n```')).html;
  assert.match(a, /<g class="am-node am-node--state" data-key="Idle"[^>]*data-link="0"[^>]*role="button"/);
  assert.match(a, /<g class="am-node am-node--state" data-key="Busy"[^>]*data-link="1"/);
  assert.doesNotMatch(a, /<g class="am-node am-node--state am-node--initial"[^>]*data-link/);
  assert.match(a, /data-ends="0 1"/);
  const tree = '```tree\nsrc\n  runtime\n  themes\n```';
  const b = renderDoc(draft(CODE, tree, '```steps\nruntime 10-11: scripts\nthemes 12: styles\n```')).html;
  assert.match(b, /<div class="am-tree-box"[^>]*data-key="runtime"[^>]*data-link="0"/);
  assert.match(b, /<div class="am-tree-box"[^>]*data-key="themes"[^>]*data-link="1"/);
  const list = renderDoc(draft(CODE, '```tree list\nsrc\n  runtime\n  themes\n    deep\n```', '```steps\ndeep 10: d\nruntime 11: r\n```')).html;
  assert.match(list, /<span class="am-tree-label"[^>]*data-link="0"/);
  assert.match(list, /<span class="am-tree-label"[^>]*data-link="1"/);
});

test('a diagram item with no step is not clickable', () => {
  const { html } = renderDoc(draft(CODE, FLOW, '```steps\nStart 10: only this one\n```'));
  assert.doesNotMatch(html.match(/<g class="am-node[^"]*" data-key="Middle"[^>]*>/)[0], /data-link|tabindex/);
  assert.equal(html.match(/class="am-step-badge"/g).length, 1);
});

test('steps run in the written order, not the diagram order', () => {
  const { html } = renderDoc(draft(CODE, FLOW, '```steps\nEnd 10: first\nStart 11: second\n```'));
  assert.match(html.match(/<g class="am-node[^"]*" data-key="End"[^>]*>/)[0], /data-link="0"/);
  assert.match(html.match(/<g class="am-node[^"]*" data-key="Start"[^>]*>/)[0], /data-link="1"/);
});

test('the labels of the page language come with the block; a right-to-left page puts the badge on the other corner', () => {
  const zh = renderDoc(draft(CODE, FLOW, STEPS).replace('lang: en', 'lang: zh')).html;
  assert.match(zh, /data-count="第 \{n\} 步，共 \{m\} 步：\{item\}"/);
  assert.match(zh, /data-prev="← 上一步"/);
  assert.match(zh, /data-next="下一步 →"/);
  assert.match(zh, /data-hint="点节点或行号；← → 切换，Esc 取消"/);
  assert.match(zh, /data-bar="步骤控制"/);
  const en = renderDoc(draft(CODE, FLOW, STEPS)).html;
  assert.match(en, /data-count="Step \{n\} of \{m\}: \{item\}"/);
  assert.match(en, /data-prev="← Previous"/);
  assert.match(en, /data-next="Next →"/);
  assert.match(en, /data-hint="Click an item or a line number; ← → to move, Esc to clear"/);
  assert.match(en, /data-bar="Step controls"/);
  const badge = (html) => Number(html.match(/<g class="am-step-badge" transform="translate\(([-\d.]+),/)[1]);
  const he = renderDoc(draft(CODE, FLOW, STEPS).replace('lang: en', 'lang: he')).html;
  const nodeBox = (html) => html.match(/data-key="Start"[^>]*>[\s\S]*?<rect class="am-node-shape" x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/);
  const [, x, w] = nodeBox(en);
  assert.ok(Math.abs(badge(en) - Number(x)) < 1, 'left to right: the badge is on the left corner');
  const [, hx, hw] = nodeBox(he);
  assert.ok(Math.abs(badge(he) - (Number(hx) + Number(hw))) < 1, 'right to left: the badge is on the right corner');
  assert.ok(Number(w) > 0 && Number(hw) > 0, 'the node box has a real width');
  assert.ok(Number(hw) === Number(w), 'the same box in both directions');
});

// ── errors ──
test('an item that is not in the diagram is an error at its step line', () => {
  const text = draft(CODE, FLOW, '```steps\nStart 10: ok\nNowhere 11: x\n```');
  const [err, ...more] = errorsOf(text);
  assert.equal(more.length, 0);
  assert.ok(err instanceof RenderError);
  assert.equal(err.line, lineOf(text, 'Nowhere'));
  assert.equal(err.component, 'steps');
  assert.match(err.message, /"Nowhere" is not an item of the diagram/);
  assert.match(err.example, /^```steps/);
});

test('an item that matches more than one entry of the diagram is an error', () => {
  const text = draft(CODE, '```tree list\nsrc\n  index\nlib\n  index\n```', '```steps\nindex 10: which one?\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'index 10'));
  assert.match(err.message, /"index" matches 2 items/);
});

test('a range outside the lines of the code block is an error', () => {
  const text = draft(CODE, FLOW, '```steps\nStart 10: ok\nEnd 14-16: past the end\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'End 14-16'));
  assert.match(err.message, /lines 14-16.*10-14/);
  const before = draft(CODE, FLOW, '```steps\nStart 9: before the start\n```');
  assert.equal(errorsOf(before)[0].line, lineOf(before, 'Start 9'));
});

test('two steps whose ranges overlap are an error at the second', () => {
  const text = draft(CODE, FLOW, '```steps\nStart 10-12: a\nEnd 12-13: b\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'End 12-13'));
  assert.match(err.message, /overlaps/);
});

test('the same item in two steps is an error', () => {
  const text = draft(CODE, FLOW, '```steps\nStart 10: a\nStart 12: b\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'Start 12'));
  assert.match(err.message, /"Start" is already step 1/);
});

test('a steps block in a panel with no code block is an error', () => {
  const text = draft(FLOW, STEPS);
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, '```steps'));
  assert.match(err.message, /needs a code block/);
});

test('a panel with more than one code block, or more than one diagram, is an error', () => {
  const two = draft(CODE, CODE, FLOW, STEPS);
  assert.match(errorsOf(two)[0].message, /one code block, not 2/);
  assert.equal(errorsOf(two)[0].line, lineOf(two, '```steps'));
  const flows = draft(CODE, FLOW, '```state\nA -> B\n```', STEPS);
  assert.match(errorsOf(flows)[0].message, /one diagram, not 2/);
  assert.equal(errorsOf(flows)[0].line, lineOf(flows, '```steps'));
});

test('a diagram type that is not linked yet is an error that names the types that are', () => {
  const text = draft(CODE, '```er\nUser\n  id PK\n```', '```steps\nUser 10: u\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, '```steps'));
  assert.match(err.message, /er diagram/);
  assert.match(err.message, /flow, state and tree/);
});

test('a diff block is not linked', () => {
  const text = draft('```diff\n--- a/x.js\n+++ b/x.js\n@@ -1,1 +1,1 @@\n-a\n+b\n```', FLOW, '```steps\nStart 1: a\n```');
  assert.match(errorsOf(text)[0].message, /diff/);
  assert.equal(errorsOf(text)[0].line, lineOf(text, '```steps'));
});

test('an item that holds a colon in the diagram cannot be linked, and the error says to rename the entry', () => {
  const text = draft(CODE, '```tree\nsrc\n  Part 1: Writing rules\n  other\n```', '```steps\nPart 1: Writing rules 10-11: the rules\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'Part 1: Writing rules 10'));
  assert.match(err.message, /cannot contain a colon/);
  assert.match(err.message, /"Part 1: Writing rules"/);
  // An entry with a colon is not offered as a suggestion for another item.
  const other = draft(CODE, '```tree\nsrc\n  Part 1: Writing rules\n  other\n```', '```steps\nNowhere 10: x\n```');
  assert.doesNotMatch(errorsOf(other)[0].message, /Part 1: Writing rules/);
});

test('the duplicate check reads an item the way matching does: backticks and runs of spaces do not tell two items apart', () => {
  const text = draft(CODE, FLOW, '```steps\n`Start` 10: a\nStart   12: b\n```');
  const [err] = errorsOf(text);
  assert.equal(err.line, lineOf(text, 'Start   12'));
  assert.match(err.message, /already step 1/);
});

test('a video draft is refused with the reason for a steps block, which is not the reason for an ask block', async () => {
  const video = `---\ntitle: T\nlang: en\n---\n> Intro.\n\n## First\n${CODE}\n\n${FLOW}\n\n${STEPS}\n> One line.\n`;
  await assert.rejects(renderVideo(video), (e) => e instanceof RenderError && /steps works on a page only; a video cannot click through steps/.test(e.message) && e.line === lineOf(video, '```steps'));
  assert.match(COMPONENTS.get('ask').pageOnlyReason, /answers/);
});

test('a steps block inside another block, such as an ask option, is an error', () => {
  assert.throws(() => COMPONENTS.get('steps').render('Start 10: a', { lang: 'en', ui: {} }), (e) => /cannot go inside another block/.test(e.message));
});

test('a linked diagram is a group, not a picture, and keeps its name; the list sets its item as Markdown', () => {
  const { html } = renderDoc(draft(CODE, FLOW, '```steps\n`Start` 10: a\nMiddle 11: b\n```'));
  const svg = html.match(/<div class="am-steps-diagram">[\s\S]*?<svg [^>]*>/)[0];
  assert.match(svg, /role="group"/);
  assert.doesNotMatch(svg, /role="img"/);
  assert.match(svg, /aria-label="[^"]+"/);
  assert.match(html, /<li data-link="0">[\s\S]*?<code>Start<\/code>/);
});

test('a steps block belongs in a panel and needs a page', () => {
  const intro = `---\nlang: en\n---\n${STEPS}\n\n## A\ntext\n`;
  const [err] = errorsOf(intro);
  assert.match(err.message, /belongs in a panel/);
  assert.ok(COMPONENTS.get('steps').pageOnly);
});

test('every error of a panel is reported in one run', () => {
  const text = draft(CODE, FLOW, '```steps\nNowhere 10: x\nEnd 40: y\n```');
  assert.equal(errorsOf(text).length, 2);
});

// ── the page ──
test('a page without a steps block carries nothing of the feature', () => {
  // The export menu names the live class it strips from a picture; that is the one mention.
  const html = renderDoc(draft(CODE, FLOW)).html.replaceAll("'.am-steps--live'", '').replaceAll("'am-steps--live'", '');
  assert.doesNotMatch(html, /am-steps/);
  assert.doesNotMatch(html, /am-step-badge/);
  assert.doesNotMatch(html, /data-link=/);
});

test('a page with a steps block carries the runtime and the styles once, inside the one script', () => {
  const { html } = renderDoc(draft(CODE, FLOW, STEPS));
  assert.equal(html.match(/<script>\n/g).length, 1);
  assert.equal(html.split('.am-steps-pair {').length - 1, 1, 'the styles once');
  assert.equal(html.split('root.dataset.hint').length - 1, 1, 'the runtime once');
});

test('the component documents itself: summary, syntax, an example that renders and a full specimen', () => {
  const c = COMPONENTS.get('steps');
  assert.ok(c.summary && c.syntax && c.example && c.specimen);
  assert.equal(c.panelOnly, true);
  assert.doesNotThrow(() => renderDoc(`---\nlang: en\n---\n## steps\n${c.specimen}\n`));
});
