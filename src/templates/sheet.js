// sheet：图纸板。字母编号面板排成网格；blueprint 主题下外框带坐标刻度（纯装饰，无交互）。
import { panelHtml, headHtml } from './panel.js';

const ruler = (side, labels) =>
  `<div class="am-ruler am-ruler--${side}" aria-hidden="true">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;

// 按阅读顺序模拟网格：某面板之后的剩余列放不下下一个面板时，把它拉宽填满本行，避免留下空洞。
// 有面板使用 rows 跨行时，行的占用关系复杂，直接保留作者的布局。
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

// 宽表格和宽图在一列里放不下：表格列太多会把中文挤成一字一行，图被缩小到字看不清。
const WIDE_TABLE_COLS = 4;
const TABLE_COLS_PER_SPAN = 2;
const DIAGRAM_PX_PER_SPAN = 560; // 约 0.75 倍缩放下，每多一列多放这么宽的图
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

// 面板内容至少需要几列。作者显式写了 span 的面板不走这里。
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
${placed.map((p) => panelHtml(p, { cols })).join('\n')}
</div>
</div>
</main>`;
}
