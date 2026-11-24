// The steps block: it links the diagram and the code block of one panel. This file reads the steps and writes the markup that
// ties them together; src/steps-panel.js decides which blocks of a panel belong to the pair. Every step is numbered in the markup
// (a badge on its diagram item, a number beside its first line, a numbered list under the pair), so print, image export and a
// page with no JavaScript show the steps; the page runtime (src/runtime/steps.js) adds the bar, the boxes and the clicks on top.
import { ComponentError, contentLines } from './components/error.js';
import { mdInline } from './markdown.js';
import { esc } from './svg/text.js';
import { f } from './svg/shapes.js';
import en from './languages/en.js';

const FORM = '<item> <line or range>: <note>';

// "Write to clipboard 146-147: Try the API first." → { item, from, to, note, line }. The first colon ends the item and its lines;
// the lines are the last number or range before it, so an item may hold digits ("Step 2 3: ..."). line is 1-based inside the block.
function parseStep(text, line) {
  const colon = text.indexOf(':');
  if (colon < 0) throw new ComponentError(`steps: write each step as ${FORM}, for example "Start 10-12: Begin here."`, line);
  const head = text.slice(0, colon).trim();
  const at = head.match(/(?:^|\s)(\d+)(?:-(\d+))?$/);
  if (!at) throw new ComponentError(`steps: "${head}" has no line number before the colon; write ${FORM}`, line);
  const item = head.slice(0, at.index).trim();
  if (!item) throw new ComponentError(`steps: write the item before its lines; ${FORM}`, line);
  const from = Number(at[1]);
  const to = at[2] === undefined ? from : Number(at[2]);
  if (from < 1) throw new ComponentError(`steps: line numbers start at 1; write 1 or more, not ${from}`, line);
  if (to < from) throw new ComponentError(`steps: the range ${from}-${to} ends before it starts; the first line must not be after the last`, line);
  return { item, from, to, note: text.slice(colon + 1).trim(), line };
}

export function parseSteps(text) {
  const steps = contentLines(text).map((l) => parseStep(l.text, l.line));
  if (!steps.length) throw new ComponentError(`steps: write at least one step, as ${FORM}`, 1);
  return steps;
}

// An item is matched by its text. Backticks and runs of spaces do not count, so `parse()` in a tree label is found by parse().
export const normalize = (text) => String(text).replace(/`/g, '').replace(/\s+/g, ' ').trim();

// The page language's labels; a language without its own falls back to English the way every label does.
const labels = (ui) => ui?.steps ?? en.ui.steps;
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));

// What a diagram asks while it draws. node(label) answers for one drawn item: null when no step names it, else the attributes that
// make it a button and the step number for its badge; it also counts the matches, so the caller can tell an item that is not in the
// diagram (0) from one that matches several (2 or more), and keeps every label it was asked about. ends(from, to) marks an edge with the steps at its two ends.
export function makeLink(steps, ui) {
  const t = labels(ui);
  const keys = steps.map((s) => normalize(s.item));
  const matches = steps.map(() => 0);
  const seen = [];
  const index = (label) => (label == null ? -1 : keys.indexOf(normalize(label)));
  return {
    matches,
    seen,
    node(label) {
      seen.push(label);
      const i = index(label);
      if (i < 0) return null;
      matches[i] += 1;
      const name = fill(t.node, { n: i + 1, item: steps[i].item });
      return { n: i + 1, attrs: ` data-link="${i}" tabindex="0" role="button" aria-label="${esc(name)}"` };
    },
    ends(from, to) {
      const [a, b] = [index(from), index(to)];
      return a < 0 && b < 0 ? '' : ` data-ends="${a < 0 ? '-' : a} ${b < 0 ? '-' : b}"`;
    },
  };
}

// The number on a diagram item: a disc on the item's corner in svg, a small tag in a tree. The page hides it while it is live.
export const stepBadgeSvg = (n, x, y) => `<g class="am-step-badge" transform="translate(${f(x)},${f(y)})"><circle r="8"/><text text-anchor="middle" dominant-baseline="central">${n}</text></g>`;
export const stepBadgeHtml = (n) => `<span class="am-step-badge" aria-hidden="true">${n}</span>`;

// Each line of a step carries the step as data-link; the first line also carries the step number, which print shows in its gutter.
export function markCodeLines(html, steps) {
  const byLine = new Map();
  steps.forEach((s, i) => {
    for (let n = s.from; n <= s.to; n++) byLine.set(n, { i, first: n === s.from });
  });
  return html.replace(/<span class="am-ln([^"]*)" data-n="(\d+)">/g, (whole, cls, n) => {
    const hit = byLine.get(Number(n));
    return hit ? `<span class="am-ln${cls}" data-n="${n}" data-link="${hit.i}"${hit.first ? ` data-sn="${hit.i + 1}"` : ''}>` : whole;
  });
}

const linesText = (s, t) => (s.from === s.to ? fill(t.line, { n: s.from }) : fill(t.lines, { from: s.from, to: s.to }));

// The numbered list of the steps: item, its lines, the note. Print, an image and a page with no JavaScript show it under the pair; the live page hides it.
export function stepsList(steps, ui) {
  const t = labels(ui);
  const items = steps.map((s, i) => `<li data-link="${i}"><span class="am-steps-item">${esc(s.item)}</span> <span class="am-steps-lines">${esc(linesText(s, t))}</span>${s.note ? ` <span class="am-steps-text">${mdInline(s.note)}</span>` : ''}</li>`);
  return `<ol class="am-steps-list" aria-label="${esc(t.list)}">${items.join('')}</ol>`;
}

// The pair (or the code alone, for a walkthrough) with its list. The labels the runtime needs for its bar come along as data-.
export function stepsBlock(pair, steps, ui) {
  const t = labels(ui);
  const m = steps.length;
  return `<div class="am-steps" data-steps="${m}" data-count="${esc(t.count)}" data-idle="${esc(fill(t.idle, { m }))}" data-prev="${esc(t.prev)}" data-next="${esc(t.next)}"><div class="am-steps-pair">${pair}</div>${stepsList(steps, ui)}</div>`;
}

// The lines a step covers, for a message: "line 9" or "lines 14-16".
export const linesName = (s) => (s.from === s.to ? `line ${s.from}` : `lines ${s.from}-${s.to}`);
