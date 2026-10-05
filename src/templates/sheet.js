// sheet: drawing board. Letter-numbered panels in a grid; under the blueprint theme the frame has coordinate ticks (decorative only, no interaction).
import { panelHtml, headHtml } from './panel.js';

const ruler = (side, labels) =>
  `<div class="am-ruler am-ruler--${side}" aria-hidden="true">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;

// Simulate the grid in reading order: when the columns left after a panel cannot fit the next panel, widen it to fill the row, leaving no holes.
// When a panel spans rows, row occupancy gets complex, so the author's layout is kept as is.
export function fillRows(panels, cols) {
  const spans = panels.map((p) => Math.max(1, Math.min(Number(p.attrs.span) || 1, cols)));
  if (panels.some((p) => Number(p.attrs.rows) > 1)) return spans;
  let used = 0;
  return spans.map((span, i) => {
    if (used + span > cols) used = 0;
    used += span;
    const next = spans[i + 1];
    const fill = next === undefined || used + next > cols ? cols - used : 0;
    used = fill || used === cols ? 0 : used;
    return span + fill;
  });
}

// Wide tables and wide diagrams do not fit one column: too many table columns squeeze Chinese to one character per line, diagrams shrink until text is unreadable.
const WIDE_TABLE_COLS = 4;
const TABLE_COLS_PER_SPAN = 2;
const DIAGRAM_PX_PER_SPAN = 560; // at about 0.75 scale, this much more diagram width per extra column
const CELL_SEP = /(?<!\\)\|/;
const DELIMITER_ROW = /^\|[\s:|-]+\|?$/;

function tableColumns(blocks) {
  const counts = blocks.filter((b) => b.type === 'md').flatMap((b) => {
    const lines = b.text.split('\n').map((l) => l.trim());
    return lines.flatMap((l, i) => (l.startsWith('|') && DELIMITER_ROW.test(lines[i + 1] ?? '') ? [l.split(CELL_SEP).length - 2] : []));
  });
  return Math.max(0, ...counts);
}

const svgWidth = (html) => Math.max(0, ...[...html.matchAll(/<svg\b[^>]*?\swidth="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1])));

// How many columns the panel content needs at least. Panels with an explicit span do not go through here.
export function minSpan(panel) {
  const tableCols = tableColumns(panel.blocks ?? []);
  const byTable = tableCols >= WIDE_TABLE_COLS ? Math.ceil(tableCols / TABLE_COLS_PER_SPAN) : 1;
  const byDiagram = Math.ceil(svgWidth(panel.html ?? '') / DIAGRAM_PX_PER_SPAN);
  return Math.max(1, byTable, byDiagram);
}

export function sheet({ meta, introHtml, panels }) {
  const cols = Math.max(1, Math.min(Number(meta.cols) || 3, 12));
  const sized = panels.map((p) => (p.attrs.span === undefined && minSpan(p) > 1
    ? { ...p, attrs: { ...p.attrs, span: Math.min(minSpan(p), cols) } }
    : p));
  const spans = fillRows(sized, cols);
  const placed = sized.map((p, i) => ({ ...p, attrs: { ...p.attrs, span: spans[i] } }));
  const nums = Array.from({ length: 8 }, (_, i) => i + 1);
  const letters = ['A', 'B', 'C', 'D'];
  return `<main class="am-sheet">
${headHtml(meta, introHtml)}
<div class="am-frame">
${ruler('top', nums)}${ruler('bottom', nums)}${ruler('left', letters)}${ruler('right', letters)}
<div class="am-grid" style="--cols: ${cols}">
${placed.map((p, i) => panelHtml(p, { cols, hints: { span: panels[i].attrs.span } })).join('\n')}
</div>
</div>
</main>`;
}
