// A panel with a steps block: find the code block and the diagram it links, draw the diagram with the steps, number the code lines,
// and check every step against both. With a diagram and no code block the panel is in explain mode: the steps are the explanation list. A panel with no steps block takes the ordinary path. Every problem is a RenderError at the
// draft line it belongs to, so one run reports them all; a panel with a problem still renders its blocks, and the page is not written.
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { parseSteps, makeLink, markCodeLines, stepsBlock, explainList, linesName, groupSvg, normalize } from './steps.js';

const isFence = (b, lang) => b.type === 'fence' && b.lang === lang;
const isCode = (b) => b.type === 'fence' && !COMPONENTS.has(b.lang) && !RAW_LANGS.has(b.lang);
// The components that draw a diagram, and the ones of them that steps can link so far.
const DIAGRAMS = new Set(['flow', 'state', 'tree', 'er', 'class', 'sequence', 'timeline', 'chart']);
const LINKED = ['flow', 'state', 'tree'];

const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');
// The labels a reader can type: one with a colon never matches an item, because the first colon ends the item.
const quote = (labels) => [...new Set(labels.map((l) => String(l).replace(/`/g, '')).filter((l) => !l.includes(':')))].slice(0, 8).join(', ');

// The two blocks a steps block links, or null after reporting why a panel has none to link.
function pickBlocks(rest, first, problem) {
  const codes = rest.filter(isCode);
  const diagrams = rest.filter((b) => b.type === 'fence' && DIAGRAMS.has(b.lang));
  if (codes.length === 0 && diagrams.length === 0) return problem('steps: needs a code block or a diagram in the same panel; add the code the steps walk through, or the diagram they explain', first.line);
  if (codes.length > 1) return problem(`steps: link one code block, not ${codes.length}; give each code block its own panel and steps block`, first.line);
  if (diagrams.length > 1) return problem(`steps: link one diagram, not ${diagrams.length}; give each diagram its own panel and steps block`, first.line);
  const [code] = codes;
  const [diagram] = diagrams;
  if (code?.lang === 'diff') return problem('steps: a diff block is not linked; link a code block, which shows its own line numbers', first.line);
  if (diagram && !LINKED.includes(diagram.lang)) {
    return problem(`steps: ${article(diagram.lang)} ${diagram.lang} diagram is not linked yet; steps links flow, state and tree diagrams`, first.line);
  }
  return { code, diagram };
}

// The example an error shows in explain mode: the steps there have no line numbers.
const EXPLAIN_EXAMPLE = '```flow\nCart -> Pay -> Ship\n```\n\n```steps\nCart: The customer fills the cart.\nPay: The payment goes through.\nShip: The warehouse sends the parcel.\n```';

// host: { renderBlocks, renderBlock, RenderError } from src/render.js, which holds the ordinary path of a block.
export function renderPanel(blocks, ctx, host) {
  const { renderBlocks, RenderError } = host;
  const [first, ...extra] = blocks.filter((b) => isFence(b, 'steps'));
  if (!first || ctx.video) return renderBlocks(blocks, ctx);

  const rest = blocks.filter((b) => !isFence(b, 'steps'));
  const explain = !rest.some(isCode) && rest.some((b) => b.type === 'fence' && DIAGRAMS.has(b.lang));
  const example = explain ? EXPLAIN_EXAMPLE : COMPONENTS.get('steps').example;
  const problem = (message, line) => {
    const err = new RenderError(message, { line, component: 'steps', example });
    if (!ctx.errors) throw err;
    ctx.errors.push(err);
    return null;
  };
  ctx.stats.components.steps = (ctx.stats.components.steps ?? 0) + 1;
  for (const b of extra) problem('steps: one steps block per panel; put the second one under its own ## heading, with its own code block', b.line);

  const picked = pickBlocks(rest, first, problem);
  if (!picked) return renderBlocks(rest, ctx);
  let steps;
  try {
    steps = parseSteps(first.text, picked.code ? 'code' : 'explain');
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    problem(err.message, first.line + (err.line || 0));
    return renderBlocks(rest, ctx);
  }
  return assemble({ blocks, rest, ...picked, steps, first }, ctx, host, problem);
}

// Draw the code, then the diagram with the steps, and put the pair in place of the first of its blocks. A block that fails reports
// itself and the panel renders as it is. Explain mode has no code: the pair is the diagram and the explanation list.
function assemble({ blocks, rest, code, diagram, steps, first }, ctx, host, problem) {
  const { renderBlocks, renderBlock, RenderError } = host;
  const attempt = (draw) => {
    try {
      return draw();
    } catch (err) {
      if (!(err instanceof RenderError) || !ctx.errors) throw err;
      ctx.errors.push(err);
      return null;
    }
  };
  const codeHtml = code ? attempt(() => renderBlock({ ...code, linked: true }, ctx)) : null;
  if (code && codeHtml === null) return renderBlocks(rest.filter((b) => b !== code), ctx);
  const link = makeLink(steps, ctx.ui);
  const diagramHtml = diagram ? attempt(() => renderBlock({ ...diagram, link }, ctx)) : '';
  if (diagramHtml === null) return renderBlocks(rest.filter((b) => b !== diagram), ctx);

  checkSteps(steps, { link, hasDiagram: Boolean(diagram), codeHtml }, (message, step) => problem(message, first.line + step.line));
  // The pair keeps the order of the draft; a narrow page stacks it diagram first (src/themes/steps.css).
  const diagramPart = diagram ? `<div class="am-steps-diagram">${groupSvg(diagramHtml)}</div>` : '';
  const second = code ? markCodeLines(codeHtml, steps) : explainList(steps, ctx.ui);
  const secondFirst = blocks.indexOf(code ?? first) < blocks.indexOf(diagram);
  const pair = diagram && secondFirst ? `${second}${diagramPart}` : `${diagramPart}${second}`;
  const block = stepsBlock(pair, steps, ctx.ui, code ? 'code' : 'explain');

  // The pair takes the place of the first of its blocks; what was written between the two follows it. The steps blocks are never drawn.
  const members = new Set([diagram, code ?? first].filter(Boolean));
  const at = blocks.map((b, i) => (members.has(b) ? i : -1)).filter((i) => i >= 0);
  const [head, tail] = [Math.min(...at), Math.max(...at)];
  const part = (list) => (list.length ? renderBlocks(list, ctx) : '');
  const others = (from, to) => blocks.slice(from, to).filter((b) => !members.has(b) && !isFence(b, 'steps'));
  return [part(others(0, head)), block, part(others(head, tail)), part(others(tail))].filter(Boolean).join('\n');
}

// The code lines the block shows, from the line numbers in its markup.
function shownLines(codeHtml) {
  const numbers = [...codeHtml.matchAll(/ data-n="(\d+)"/g)].map((m) => Number(m[1]));
  return { from: Math.min(...numbers), to: Math.max(...numbers) };
}

// A diagram label that starts with the step's item or head, then a colon: the item would have to hold the colon, which it cannot.
function colonLabel(step, labels) {
  const starts = [step.item, step.head].map((t) => `${normalize(t)}:`);
  return labels.map(normalize).find((l) => starts.some((prefix) => l.startsWith(prefix)));
}

// With no code block, a step that ends in a separate number or range ("Order 1-2", not "HTTP/2") was probably written with lines.
const LINES_HINT = '; with no code block, a step has no line numbers';
const endsInNumber = (text) => /\s\d+(?:\s*-\s*\d+)?$/.test(text);

// One problem at most per step, in the order a reader fixes them: the item, then the lines, then the overlap with an earlier step.
// codeHtml is null in explain mode: the steps have no lines to check.
function checkSteps(steps, { link, hasDiagram, codeHtml }, report) {
  const shown = codeHtml === null ? null : shownLines(codeHtml);
  const taken = new Map();
  steps.forEach((step, i) => {
    if (hasDiagram) {
      const same = steps.findIndex((s) => normalize(s.item) === normalize(step.item));
      if (same < i) return report(`steps: "${step.item}" is already step ${same + 1}; give each item one step`, step);
      const count = link.matches[i];
      if (count === 0) {
        const withColon = colonLabel(step, link.seen);
        if (withColon) return report(`steps: a linked item cannot contain a colon, because the first colon ends the item; rename the diagram entry "${withColon}" so it has no colon`, step);
        const hint = !shown && endsInNumber(step.item) ? LINES_HINT : '';
        return report(`steps: "${step.item}" is not an item of the diagram; write the text of an item exactly as the diagram does${quote(link.seen) ? ` (${quote(link.seen)})` : ''}${hint}`, step);
      }
      if (count > 1) return report(`steps: "${step.item}" matches ${count} items of the diagram; give those items different text`, step);
    }
    if (!shown) return;
    if (step.from < shown.from || step.to > shown.to) {
      const where = step.from === step.to ? `${linesName(step)} is not in` : `${linesName(step)} are not all in`;
      return report(`steps: ${where} the code block (lines ${shown.from}-${shown.to})`, step);
    }
    const clash = [...taken].find(([, other]) => step.from <= other.to && other.from <= step.to);
    if (clash) return report(`steps: step ${i + 1} overlaps step ${clash[0] + 1} (${linesName(clash[1])}); give each step its own lines`, step);
    taken.set(i, step);
  });
}
