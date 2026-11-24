// A panel with a steps block: find the code block and the diagram it links, draw the diagram with the steps, number the code lines,
// and check every step against both. A panel with no steps block takes the ordinary path. Every problem is a RenderError at the
// draft line it belongs to, so one run reports them all; a panel with a problem still renders its blocks, and the page is not written.
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { parseSteps, makeLink, markCodeLines, stepsBlock, linesName } from './steps.js';

const isFence = (b, lang) => b.type === 'fence' && b.lang === lang;
const isCode = (b) => b.type === 'fence' && !COMPONENTS.has(b.lang) && !RAW_LANGS.has(b.lang);
// The components that draw a diagram, and the ones of them that steps can link so far.
const DIAGRAMS = new Set(['flow', 'state', 'tree', 'er', 'class', 'sequence', 'timeline', 'chart']);
const LINKED = ['flow', 'state', 'tree'];

const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');
const quote = (labels) => [...new Set(labels.map((l) => String(l).replace(/`/g, '')))].slice(0, 8).join(', ');

// host: { renderBlocks, renderBlock, RenderError } from src/render.js, which holds the ordinary path of a block.
export function renderPanel(blocks, ctx, host) {
  const { renderBlocks, renderBlock, RenderError } = host;
  const [first, ...extra] = blocks.filter((b) => isFence(b, 'steps'));
  if (!first || ctx.video) return renderBlocks(blocks, ctx);

  const example = COMPONENTS.get('steps').example;
  const problem = (message, line) => {
    const err = new RenderError(message, { line, component: 'steps', example });
    if (!ctx.errors) throw err;
    ctx.errors.push(err);
  };
  ctx.stats.components.steps = (ctx.stats.components.steps ?? 0) + 1;
  for (const b of extra) problem('steps: one steps block per panel; put the second one under its own ## heading, with its own code block', b.line);

  const rest = blocks.filter((b) => !isFence(b, 'steps'));
  const codes = rest.filter(isCode);
  const diagrams = rest.filter((b) => b.type === 'fence' && DIAGRAMS.has(b.lang));
  const plain = () => renderBlocks(rest, ctx);

  // Which blocks can be linked at all.
  if (codes.length === 0) { problem('steps: needs a code block in the same panel; add the code the steps walk through', first.line); return plain(); }
  if (codes.length > 1) { problem(`steps: link one code block, not ${codes.length}; give each code block its own panel and steps block`, first.line); return plain(); }
  if (diagrams.length > 1) { problem(`steps: link one diagram, not ${diagrams.length}; give each diagram its own panel and steps block`, first.line); return plain(); }
  const [code] = codes;
  const [diagram] = diagrams;
  if (code.lang === 'diff') { problem('steps: a diff block is not linked; link a code block, which shows its own line numbers', first.line); return plain(); }
  if (diagram && !LINKED.includes(diagram.lang)) {
    problem(`steps: ${article(diagram.lang)} ${diagram.lang} diagram is not linked yet; steps links flow, state and tree diagrams`, first.line);
    return plain();
  }
  let steps;
  try {
    steps = parseSteps(first.text);
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    problem(err.message, first.line + (err.line || 0));
    return plain();
  }

  // Draw the code, then the diagram with the steps; a block that fails reports itself and the panel renders as it is.
  const attempt = (draw) => {
    try {
      return draw();
    } catch (err) {
      if (!(err instanceof RenderError)) throw err;
      if (!ctx.errors) throw err;
      ctx.errors.push(err);
      return null;
    }
  };
  const codeHtml = attempt(() => renderBlock({ ...code, linked: true }, ctx));
  if (codeHtml === null) return renderBlocks(rest.filter((b) => b !== code), ctx);
  const link = makeLink(steps, ctx.ui);
  let diagramHtml = '';
  if (diagram) {
    ctx.link = link;
    try {
      diagramHtml = attempt(() => renderBlock(diagram, ctx));
    } finally {
      delete ctx.link;
    }
    if (diagramHtml === null) return renderBlocks(rest.filter((b) => b !== diagram), ctx);
  }

  checkSteps(steps, { link, hasDiagram: Boolean(diagram), codeHtml }, (message, step) => problem(message, first.line + step.line));
  const pair = `${diagramHtml}${markCodeLines(codeHtml, steps)}`;
  const block = stepsBlock(pair, steps, ctx.ui);

  // The pair takes the place of the first of its blocks, the diagram before the code; what was written between the two follows it.
  const members = new Set([diagram, code].filter(Boolean));
  const at = rest.map((b, i) => (members.has(b) ? i : -1)).filter((i) => i >= 0);
  const [head, tail] = [Math.min(...at), Math.max(...at)];
  const part = (list) => (list.length ? renderBlocks(list, ctx) : '');
  const others = (from, to) => rest.slice(from, to).filter((b) => !members.has(b));
  return [part(others(0, head)), block, part(others(head, tail)), part(others(tail))].filter(Boolean).join('\n');
}

// The code lines the block shows, from the line numbers in its markup.
function shownLines(codeHtml) {
  const numbers = [...codeHtml.matchAll(/ data-n="(\d+)"/g)].map((m) => Number(m[1]));
  return { from: Math.min(...numbers), to: Math.max(...numbers) };
}

// One problem at most per step, in the order a reader fixes them: the item, then the lines, then the overlap with an earlier step.
function checkSteps(steps, { link, hasDiagram, codeHtml }, report) {
  const shown = shownLines(codeHtml);
  const taken = new Map();
  steps.forEach((step, i) => {
    const item = step.item.replace(/\s+/g, ' ');
    if (hasDiagram) {
      const same = steps.findIndex((s) => s.item.replace(/\s+/g, ' ') === item);
      if (same < i) return report(`steps: "${step.item}" is already step ${same + 1}; give each item one step`, step);
      const count = link.matches[i];
      if (count === 0) return report(`steps: "${step.item}" is not an item of the diagram; write the text of an item exactly as the diagram does${link.seen.length ? ` (${quote(link.seen)})` : ''}`, step);
      if (count > 1) return report(`steps: "${step.item}" matches ${count} items of the diagram; give those items different text`, step);
    }
    if (step.from < shown.from || step.to > shown.to) {
      const where = step.from === step.to ? `${linesName(step)} is not in` : `${linesName(step)} are not all in`;
      return report(`steps: ${where} the code block (lines ${shown.from}-${shown.to})`, step);
    }
    const clash = [...taken].find(([, other]) => step.from <= other.to && other.from <= step.to);
    if (clash) return report(`steps: step ${i + 1} overlaps step ${clash[0] + 1} (${linesName(clash[1])}); give each step its own lines`, step);
    taken.set(i, step);
  });
}
