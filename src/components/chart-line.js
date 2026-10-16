// Line charts, drawn as a static svg like the bars: the rows are the positions on the category axis, each series is a polyline with a dot
// on every point. The layout runs left to right; a right-to-left page draws the mirror image (the first row on the right).
// Each row is one step group (the points of the row, the segments that lead to them and the value labels), so a video grows the lines row by row.
import { measure, wrap } from '../svg/text.js';
import { f, svgOpen, mirror } from '../svg/shapes.js';
import { lineRange, fmt } from './chart-scale.js';
import {
  PAD, FS, LH, PLOT_H, MAX_WIDTH, SLOT_MAX, SLANT_MAX, COS, SIN,
  shorten, text, legendLayout, legendSvg, stepGroup, valueAxis, categoryLabel,
} from './chart-parts.js';

const MAX_VALUE_LABELS = 12; // with one series, up to this many points carry their value
const DOT = 3.5;
const DOT_HI = 5.5;
const LABEL_GAP = 9; // from the centre of a dot to the baseline of its label, above it
const MIN_APART = 13; // the least height between two value labels of a column
const LABEL_SIDE = 8; // between a dot and its label in the column
const COLUMN_END = 0.8; // a guide further along than this share of the plot has its column on the inline-start side

// data: { series: [name] | null, rows: [{ label, values, hi }] }; unit is added to the ticks and the value labels.
export function drawLines(data, { unit = '', dir = 'ltr', label }) {
  const { rows } = data;
  const count = rows[0].values.length;
  const m = {
    rows,
    count,
    names: data.series ?? [],
    range: lineRange(rows.flatMap((r) => r.values)),
    unit,
    rtl: dir === 'rtl',
    dir,
    anyHi: rows.some((r) => r.hi),
  };
  m.tick = (v) => `${fmt(v)}${unit}`;
  // One series with few points: every point has its value. Otherwise the highlighted rows only.
  m.carries = (row) => row.hi || (count === 1 && rows.length <= MAX_VALUE_LABELS);
  const box = lineChart(m);
  return `${svgOpen(box.width, box.height, label, dir)}${box.body.join('')}</svg>`;
}

// The rows whose category label is drawn: every step-th row, and every highlighted row (the rows next to it make room).
function shownRows(rows, step) {
  const his = [];
  for (const [i, r] of rows.entries()) if (r.hi && (!his.length || i - his.at(-1) >= step)) his.push(i);
  return rows.map((r, i) => (his.includes(i) ? true : i % step === 0 && his.every((h) => Math.abs(h - i) >= step)));
}

// The category labels: flat in at most two lines when the labels fit the room of their step (thinned to every step-th label, at most
// a quarter of the rows apart), else slanted and cut to SLANT_MAX, thinned so that the slanted lines do not touch.
function planAxis(rows, slot) {
  const labels = rows.map((r) => r.label);
  for (let step = 1; step <= Math.max(1, Math.floor(rows.length / 4)); step++) {
    const show = shownRows(rows, step);
    const room = step * slot - 8;
    const lines = labels.map((l, i) => (show[i] ? wrap(l, room, FS.cat) : null));
    if (lines.every((ls) => !ls || (ls.length <= 2 && ls.every((l) => measure(l, FS.cat) <= room + 0.5)))) return { show, lines, widths: lines.map((ls) => (ls ? Math.max(...ls.map((l) => measure(l, FS.cat))) : 0)) };
  }
  const show = shownRows(rows, Math.max(1, Math.ceil((LH + 1) / (slot * SIN))));
  const shown = labels.map((l) => shorten(l, SLANT_MAX, FS.cat));
  return { show, lines: null, shown, widths: shown.map((l) => measure(l, FS.cat)) };
}

// The value labels of one row. One series: above its dot, below at a valley (both neighbours are higher). Several series: a column beside
// the guide line, each label at the height of its dot and in its series color, pushed apart so none touches another. The column is on the
// inline-end side of the guide, or on the inline-start side when the guide is near the end of the plot (end: which side, 'start' or 'end').
function valueLabels(m, X, x, values, ys, { valleys, end, bottom }) {
  const label = (k, px, py, extra) => text(`am-ch-val am-ch-s${k + 1}`, X(px), py, m.tick(values[k]), m.dir, extra);
  if (ys.length === 1) return text('am-ch-val', X(x), valleys[0] ? ys[0] + LABEL_GAP + FS.val : ys[0] - LABEL_GAP, m.tick(values[0]), m.dir, ' text-anchor="middle"');
  const order = ys.map((y, k) => k).sort((a, b) => ys[a] - ys[b]);
  const at = order.map((k) => ys[k]);
  for (let j = 1; j < at.length; j++) at[j] = Math.max(at[j], at[j - 1] + MIN_APART);
  let limit = bottom;
  for (let j = at.length - 1; j >= 0; j--) {
    at[j] = Math.min(at[j], limit);
    limit = at[j] - MIN_APART;
  }
  const [px, anchor] = end === 'end' ? [x + DOT_HI + LABEL_SIDE, 'start'] : [x - DOT_HI - LABEL_SIDE, 'end'];
  return order.map((k, j) => label(k, px, at[j], ` text-anchor="${anchor}" dominant-baseline="central"`)).join('');
}

// The line from one dot to the next, from the edge of one to the edge of the other, so a dot is never drawn under its own line.
function segment(X, [x0, y0], [x1, y1], [hi0, hi1], k) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const [dx, dy] = [(x1 - x0) / len, (y1 - y0) / len];
  const [r0, r1] = [hi0 ? DOT_HI : DOT, hi1 ? DOT_HI : DOT];
  return `<path class="am-ch-line am-ch-s${k + 1}" d="M${f(X(x0 + dx * r0))},${f(y0 + dy * r0)} L${f(X(x1 - dx * r1))},${f(y1 - dy * r1)}"/>`;
}

function lineChart(m) {
  const { rows, range, rtl, dir } = m;
  const n = rows.length;
  const slot = Math.min(Math.floor(MAX_WIDTH / n), SLOT_MAX);
  const plan = planAxis(rows, slot);
  const labelled = rows.map((r) => m.carries(r));
  const anyLabels = labelled.some(Boolean);
  const valueW = rows.map((r, i) => (labelled[i] ? Math.max(...r.values.map((v) => measure(m.tick(v), FS.val, { bold: m.count > 1 }))) : 0));

  const tickW = Math.max(...range.ticks.map((t) => measure(m.tick(t), FS.tick)));
  // What reaches past the plot on the left and on the right: a flat label is centred on its row, a slanted one ends there and reaches back
  // to the left, a value label is centred on its dot.
  const columnEnd = (i) => ((i + 0.5) / n > COLUMN_END ? 'start' : 'end');
  const over = rows.map((r, i) => {
    const half = Math.max(plan.show[i] ? (plan.lines ? plan.widths[i] / 2 : 0) : 0, valueW[i] / 2);
    const slanted = plan.show[i] && !plan.lines ? plan.widths[i] * COS + FS.cat * SIN - 3 : 0;
    const column = valueW[i] && m.count > 1 ? valueW[i] + DOT_HI + LABEL_SIDE : 0; // the labels beside the guide
    const [left, right] = columnEnd(i) === 'end' ? [0, column] : [column, 0];
    return { left: Math.max(half, slanted, left) - (i + 0.5) * slot, right: Math.max(half, right) - (n - i - 0.5) * slot };
  });
  const axisX = Math.max(PAD + tickW + 6, PAD + Math.max(...over.map((o) => o.left)));
  const plotW = n * slot;
  const legend = legendLayout(m.names, Math.max(plotW + tickW, 240));
  const W = Math.ceil(Math.max(axisX + plotW + Math.max(PAD, 2 + Math.max(...over.map((o) => o.right))), (legend.width ?? 0) + 2 * PAD));
  const plotTop = PAD + legend.height + (anyLabels ? 18 : 6);
  const plotBottom = plotTop + PLOT_H;
  const catTop = plotBottom + (anyLabels ? 22 : 8);
  const catH = plan.lines
    ? Math.max(...plan.lines.map((ls) => (ls ? ls.length : 0))) * LH + 4
    : Math.max(...plan.shown.map((l, i) => (plan.show[i] ? measure(l, FS.cat) : 0))) * SIN + 12;
  const height = catTop + catH + PAD;

  const X = mirror(W, rtl);
  const y = (v) => plotTop + ((range.max - v) / (range.max - range.min)) * PLOT_H;
  const cx = (i) => axisX + (i + 0.5) * slot;
  const body = [legendSvg(legend, PAD, PAD, m, W)];
  body.push(...valueAxis(m, { axisX, width: plotW, y, W, X }));
  for (const [i, row] of rows.entries()) {
    const parts = [];
    // The guide marks the highlighted row; it is drawn first, so the dots and lines run over it.
    if (row.hi) parts.push(`<line class="am-ch-guide" x1="${f(X(cx(i)))}" y1="${f(plotTop)}" x2="${f(X(cx(i)))}" y2="${f(plotBottom)}"/>`);
    if (i > 0) parts.push(...row.values.map((v, k) => segment(X, [cx(i - 1), y(rows[i - 1].values[k])], [cx(i), y(v)], [rows[i - 1].hi, row.hi], k)));
    parts.push(...row.values.map((v, k) => `<circle class="am-ch-dot am-ch-s${k + 1}" cx="${f(X(cx(i)))}" cy="${f(y(v))}" r="${row.hi ? DOT_HI : DOT}"/>`));
    if (labelled[i]) {
      const around = (j, k) => rows[j]?.values[k];
      const valleys = row.values.map((v, k) => i > 0 && i < n - 1 && around(i - 1, k) > v && around(i + 1, k) > v);
      parts.push(valueLabels(m, X, cx(i), row.values, row.values.map(y), { valleys, end: columnEnd(i), bottom: plotBottom }));
    }
    let tip = '';
    if (plan.show[i]) {
      const cat = categoryLabel(plan, i, row.label, cx(i), catTop, { X, rtl, dir });
      parts.push(cat.svg);
      tip = cat.tip;
    }
    body.push(stepGroup(i, `am-ch-row${row.hi ? ' is-hi' : ''}`, tip, parts.join('')));
  }
  return { width: W, height, body };
}
