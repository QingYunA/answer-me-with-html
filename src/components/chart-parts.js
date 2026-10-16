// Pieces the charts share: sizes, label fitting, the legend, the value axis and the category labels of a vertical chart.
// chart-bar.js, chart-line.js and chart-pie.js draw with them. Positions are laid out left to right; a right-to-left page draws the
// mirror image (see mirror in svg/shapes.js), and text anchors keep their names: the svg's direction="rtl" turns "start" into the
// right end of the text, which is the mirror of the left-to-right placement.
import { esc, measure, wrap } from '../svg/text.js';
import { f } from '../svg/shapes.js';
import { svgLine, svgNumber } from '../bidi.js';

export const PAD = 8;
export const FS = { cat: 12, tick: 11, val: 11, legend: 12 }; // chart.css sets the same sizes
export const LH = 14;
export const PLOT_H = 220;
export const MAX_WIDTH = 880; // width the categories of a vertical chart share
export const SLOT_MAX = 104;
export const SLANT = 40;
export const SLANT_MAX = 140;
export const [COS, SIN] = [Math.cos((SLANT * Math.PI) / 180), Math.sin((SLANT * Math.PI) / 180)];
const LEGEND_LH = 18;

// The text cut to fit, with an ellipsis; the whole text is the tooltip of the label.
export function shorten(text, max, size) {
  if (measure(text, size) <= max) return text;
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join('')}…`, size) > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

// A label in at most maxLines lines of at most maxWidth.
export function fitLines(label, maxWidth, maxLines, size) {
  const lines = wrap(label, maxWidth, size);
  const kept = lines.slice(0, maxLines);
  kept[kept.length - 1] = [kept.at(-1), ...lines.slice(maxLines)].join(' ');
  return kept.map((l) => shorten(l, maxWidth, size));
}

// Ticks, values, shares and the total are numbers: they read left to right in every language. Everything else is text and goes through svgLine.
const NUMBERS = new Set(['am-ch-tick', 'am-ch-val', 'am-ch-num', 'am-ch-total']);
export const text = (cls, x, y, str, dir, attrs = '') => `<text class="${cls}" x="${f(x)}" y="${f(y)}"${attrs}>${esc(NUMBERS.has(cls.split(' ')[0]) ? svgNumber(str, dir) : svgLine(str, dir))}</text>`;

// The legend: a swatch and a name for each series, wrapped to maxWidth. Positions are relative to the legend's left edge.
export function legendLayout(names, maxWidth) {
  if (names.length < 2) return { items: [], height: 0 };
  const items = [];
  let [x, y] = [0, 0];
  for (const [k, name] of names.entries()) {
    const w = 16 + measure(name, FS.legend);
    if (x > 0 && x + w > maxWidth) [x, y] = [0, y + LEGEND_LH];
    items.push({ k, name, x, y, w });
    x += w + 18;
  }
  return { items, height: y + LEGEND_LH + 6, width: Math.max(...items.map((i) => i.x + i.w)) };
}

export function legendSvg({ items }, left, top, { rtl, dir }, W) {
  return items.map(({ k, name, x, y, w }) => {
    const sw = rtl ? W - (left + x) - 10 : left + x;
    return `<rect class="am-ch-sw am-ch-s${k + 1}" x="${f(sw)}" y="${f(top + y + 2)}" width="10" height="10" rx="2"/>${text('am-ch-leg', rtl ? W - (left + x + 16) : left + x + 16, top + y + 7, name, dir, ' dominant-baseline="central"')}`;
  }).join('');
}

// One step of a chart: a video shows the groups one after the other, a page shows them all.
export const stepGroup = (i, cls, title, inner) => `<g data-step="${i}" class="${cls}">${title}${inner}</g>`;
const squash = (s) => s.replace(/\s/g, '');
export const tooltip = (label, shown) => (squash(label) === squash(shown) ? '' : `<title>${esc(label)}</title>`);

// The grid lines and ticks of a value axis up the left side of the plot. y maps a value to its height, width is the width of the plot, W
// the width of the drawing and X the mirror. m has range, tick(v), rtl and dir. The zero line is drawn stronger.
export function valueAxis(m, { axisX, width, y, W, X }) {
  const left = m.rtl ? W - axisX - width : axisX;
  return m.range.ticks.flatMap((t) => [
    `<line class="${t === 0 ? 'am-ch-zero' : 'am-ch-grid'}" x1="${f(left)}" y1="${f(y(t))}" x2="${f(left + width)}" y2="${f(y(t))}"/>`,
    text('am-ch-tick', X(axisX - 6), y(t), m.tick(t), m.dir, ' text-anchor="end" dominant-baseline="central"'),
  ]);
}

// The label of category i under a vertical chart, centred on cx: flat lines or slanted, as the plan says. tip is the tooltip, or ''
// when the whole label is shown.
export function categoryLabel(plan, i, label, cx, catTop, { X, rtl, dir }) {
  if (plan.lines) {
    return { svg: plan.lines[i].map((l, j) => text('am-ch-cat', X(cx), catTop + 11 + j * LH, l, dir, ' text-anchor="middle"')).join(''), tip: '' };
  }
  const shown = plan.shown[i];
  const [ax, ay] = [X(cx + 3), catTop + 4];
  const svg = text('am-ch-cat', ax, ay, shown, dir, ` text-anchor="end" transform="rotate(${rtl ? SLANT : -SLANT} ${f(ax)} ${f(ay)})"`);
  return { svg, tip: tooltip(label, shown) };
}
