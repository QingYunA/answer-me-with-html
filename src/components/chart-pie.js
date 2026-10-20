// Pie charts, drawn as a donut with a legend list beside it, as a static svg like the bars. The slices start at 12 o'clock and go clockwise
// in the order written; a right-to-left page draws the mirror image (counterclockwise, the donut on the right, the legend on its left).
// Each slice and its legend row are one step group, so a video adds the slices one by one.
import { measure } from '../svg/text.js';
import { f, svgOpen, mirror } from '../svg/shapes.js';
import { fmt, percent } from './chart-scale.js';
import { PAD, FS, LH, text, fitLines, shorten, stepGroup, tooltip } from './chart-parts.js';
import { DRAWING } from '../themes/type-scale.js';

const R = 96; // outer radius of the donut
const R_IN = 60;
const GAP = 32; // between the donut and the legend
const LABEL_MAX = 170; // the label column of the legend; a longer label wraps to two lines
const COL_GAP = 12;
const SW = 16; // the swatch and the space after it
const ROW_PAD = 10;
const TAU = Math.PI * 2;

// data: { series: [name] | null, rows: [{ label, values: [number], hi }] }; unit is added to the values and the total.
export function drawPie(data, { unit = '', dir = 'ltr', label }) {
  const { rows } = data;
  const rtl = dir === 'rtl';
  const values = rows.map((r) => r.values[0]);
  const total = values.reduce((a, b) => a + b, 0);
  const anyHi = rows.some((r) => r.hi);

  const lines = rows.map((r) => fitLines(r.label, LABEL_MAX, 2, FS.legend));
  const labelW = Math.max(...lines.flat().map((l) => measure(l, FS.legend)));
  const shown = values.map((v) => `${fmt(v)}${unit}`);
  // With unit=% the values are the shares already: no second percentage and no total.
  const asShares = unit === '%';
  const shares = asShares ? [] : values.map((v) => percent(v, total));
  const valueW = Math.max(...shown.map((s) => measure(s, FS.legend)));
  const shareW = asShares ? 0 : Math.max(...shares.map((s) => measure(s, FS.legend)));
  const heights = lines.map((ls) => Math.max(ls.length * LH + ROW_PAD, 24));
  const legendH = heights.reduce((a, b) => a + b, 0);
  const legendW = SW + labelW + COL_GAP + valueW + (asShares ? 0 : COL_GAP + shareW);

  const H = Math.ceil(Math.max(2 * R, legendH) + 2 * PAD);
  const W = Math.ceil(PAD + 2 * R + GAP + legendW + PAD);
  const [cx, cy] = [PAD + R, H / 2];
  const X = mirror(W, rtl);
  // The legend is laid out from its left edge, which is its start on the inline-end side of the donut.
  const lx = PAD + 2 * R + GAP;
  const [valueX, shareX] = [lx + SW + labelW + COL_GAP + valueW, lx + legendW];

  // A point on a circle of radius r around the centre, at a fraction of a turn clockwise from 12 o'clock.
  const at = (r, turn) => `${f(X(cx + r * Math.sin(turn * TAU)))},${f(cy - r * Math.cos(turn * TAU))}`;
  // Each arc is drawn in two halves, so a slice of the whole turn is an arc too. The sweep flag turns over when the drawing is mirrored.
  const [outer, inner] = rtl ? [0, 1] : [1, 0];
  const ring = (r, from, to, sweep) => `A${r},${r} 0 0 ${sweep} ${at(r, (from + to) / 2)} A${r},${r} 0 0 ${sweep} ${at(r, to)}`;
  const slice = (from, to) => (to - from > 1 - 1e-9
    // The whole turn is two circles, not a slice: no seam at 12 o'clock.
    ? `M${at(R, from)} ${ring(R, from, to, outer)} Z M${at(R_IN, from)} ${ring(R_IN, from, to, inner)} Z`
    : `M${at(R, from)} ${ring(R, from, to, outer)} L${at(R_IN, to)} ${ring(R_IN, to, from, inner)} Z`);

  const body = [];
  let [turn, top] = [0, cy - legendH / 2];
  for (const [i, row] of rows.entries()) {
    const span = total > 0 ? values[i] / total : 0;
    const mid = top + heights[i] / 2;
    const first = mid - ((lines[i].length - 1) * LH) / 2;
    const parts = [];
    if (span > 0) parts.push(`<path class="am-ch-slice am-ch-s${i + 1}" d="${slice(turn, turn + span)}"/>`);
    parts.push(`<rect class="am-ch-sw am-ch-s${i + 1}" x="${f(rtl ? W - lx - 10 : lx)}" y="${f(mid - 5)}" width="10" height="10" rx="2"/>`);
    parts.push(...lines[i].map((l, j) => text('am-ch-leg', X(lx + SW), first + j * LH, l, dir, ' dominant-baseline="central"')));
    parts.push(text('am-ch-num', X(valueX), mid, shown[i], dir, ' text-anchor="end" dominant-baseline="central"'));
    if (!asShares) parts.push(text('am-ch-num', X(shareX), mid, shares[i], dir, ' text-anchor="end" dominant-baseline="central"'));
    body.push(stepGroup(i, `am-ch-row${anyHi ? (row.hi ? ' is-hi' : ' is-dim') : ''}`, tooltip(row.label, lines[i].join(' ')), parts.join('')));
    turn += span;
    top += heights[i];
  }
  if (!asShares) body.push(totalText(fmt(total), unit, X(cx), cy, dir));
  return `${svgOpen(W, H, label, dir)}${body.join('')}</svg>`;
}

// The total in the hole of the donut, as large as the hole lets it be. A unit that does not fit on the line goes on a line of its own.
function totalText(total, unit, x, y, dir) {
  const room = 1.6 * R_IN;
  const size = (str, max) => Math.max(DRAWING.totalMin, Math.min(max, Math.floor(room / measure(str, 1))));
  // style, not the SVG attribute: `.am-diagram text` sets 13px and a stylesheet wins over a presentation attribute.
  const one = (str, at, max) => text('am-ch-total', x, at, str, dir, ` text-anchor="middle" dominant-baseline="central" style="font-size:${size(str, max)}px"`);
  if (!unit || measure(`${total}${unit}`, DRAWING.totalFit) <= room) return one(`${total}${unit}`, y, DRAWING.totalMax);
  return one(total, y - 8, DRAWING.totalMax) + one(shorten(unit.trim(), room, DRAWING.totalUnit), y + 12, DRAWING.totalUnit);
}
