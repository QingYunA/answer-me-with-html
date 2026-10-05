// Pure planner for justified ("photo wall") rows on sheet pages. No DOM access.
//
// This file must stay inlinable into the page script: top-level declarations only, no imports, and the exports are
// `planLayout` and the constants the DOM adapter shares (STEP, MAX_SCALE, MIN_SCALE). The page build strips the `export ` keyword,
// and test/layout-plan.test.js checks that this still works.
//
// planLayout({ width, gap, cols, panels }) -> { rows: [{ columns: [{ panels: [index, ...], width }], height }] }
//
// Input (all lengths in px):
//   width   container width
//   gap     space between columns, and between two panels stacked in one column
//   cols    most columns in one row (the planner never uses more than MAX_COLUMNS, but spans stay shares of `cols`)
//   panels  one entry per panel, in reading order:
//     samples   [{ w, h }] panel height at sampled widths, ascending by w (heights between samples are interpolated)
//     minWidth  narrowest feasible width (clamped to `width`)
//     maxWidth  widest useful width; beyond it the panel only gains empty space (default: no limit)
//     natural   natural diagram width for a diagram-only panel (default: none)
//     pad       panel width not used by the diagram (padding and border; default 0)
//     span      the author's width hint in grid columns (default 1); span >= cols keeps the panel alone in its row
//
// Output: { rows, maxScale }. Rows are in reading order; a row is a list of columns (at most `cols`); a column holds one panel or two
// consecutive panels, stacked. For integer inputs the column widths plus the gaps between them equal `width`.
// Rows are chosen by dynamic programming over break points; widths by a search in STEP px steps. Cost per row:
//   H = tallest column; waste = sum((H - columnHeight) * columnWidth) + sum over diagrams wider than maxWidth of (w - maxWidth) * h
//   dev = sum(((w - preferred) / oneColumn)^2) + SCALE_WEIGHT * sum over diagrams of (ln(scale) / ln(MAX_SCALE))^2
//   cost = waste / 1000 + PREF_WEIGHT * dev * H
// Scale band: diagrams on one page stay at similar sizes. With the result's `maxScale` as the diagram size limit, a diagram is
// shown at scale min(maxScale, (width - pad) / natural). The planner tries a few bands [lo, lo * BAND_RATIO] (lo in BAND_LOS) and
// keeps the cheapest plan in which no diagram is narrower than scale lo and none is shown above the band's top, so the largest and
// smallest diagram scale on the page differ by at most BAND_RATIO. A panel wider than its diagram's top size keeps the diagram at
// that size, and the page script must set the diagram's max-width to natural * maxScale. The band starts no higher than the
// largest scale the page allows the least roomy diagram, so one wide diagram lowers the band for the others.
// If no band is feasible the plan is made without a band (maxScale = MAX_SCALE); if no plan fits (or the input is unusable) the
// result is a single column: one panel per row at the full width.

export const STEP = 10;
export const MAX_SCALE = 1.25;
export const MIN_SCALE = 0.75; // the narrowest a diagram is shown, as a share of its natural width
const MAX_COLUMNS = 6; // rows with more columns are unreadable, and the search grows steeply with the column count
const BAND_RATIO = 1.25; // the largest and smallest diagram scale on a page differ by at most this
const BAND_LOS = [MIN_SCALE, 0.85, 0.95, 1]; // lower ends tried for the band; lo * BAND_RATIO is the upper end (1.25 means no upper limit)
const SCALE_WEIGHT = 3;
const PREF_WEIGHT = 0.15;

function heightAt(samples, w) {
  const i = samples.findIndex((s) => s.w >= w);
  if (i === -1) return samples[samples.length - 1].h;
  if (i === 0) return samples[0].h;
  const a = samples[i - 1];
  const b = samples[i];
  return a.h + ((b.h - a.h) * (w - a.w)) / (b.w - a.w);
}

// Every way to split `len` consecutive panels into columns of 1 or 2 panels, as lists of column sizes.
function splits(len) {
  if (len === 0) return [[]];
  return [1, 2].filter((k) => k <= len).flatMap((k) => splits(len - k).map((rest) => [k, ...rest]));
}

function singleColumn(width, panels) {
  return { rows: panels.map((_, i) => ({ columns: [{ panels: [i], width }], height: 0 })) };
}

export function planLayout({ width, gap = 0, cols = 3, panels }) {
  const usable = Number.isFinite(width) && width > 0 && panels.every((p) => Array.isArray(p.samples) && p.samples.length > 0);
  if (!usable) return singleColumn(width, panels);

  // `cols` stays the unit of the author's spans; no row gets more than MAX_COLUMNS columns however large `cols` is.
  const maxColumns = Math.min(cols, MAX_COLUMNS);
  const oneColumn = Math.max(1, (width - gap * (cols - 1)) / cols);
  // Per-panel limits. With a band [lo, lo * BAND_RATIO], a diagram is no narrower than scale lo and shown at most at the top of the
  // band: a wider panel keeps it at that size and gains empty space, which the cost counts as waste.
  const prepare = (lo) => panels.map((p) => {
    const pad = p.pad ?? 0;
    const diagram = lo > 0 && p.natural > 0;
    const scaleCap = diagram ? Math.min(MAX_SCALE, lo * BAND_RATIO) : MAX_SCALE;
    return {
      ...p,
      minWidth: Math.min(width, Math.max(Math.ceil(p.minWidth || 0), diagram ? Math.ceil(p.natural * lo + pad) : 0)),
      maxWidth: Math.min(p.maxWidth ?? Infinity, diagram ? p.natural * scaleCap + pad : Infinity),
      scaleCap,
      pad,
      preferred: Math.min(width, (p.span ?? 1) * oneColumn + ((p.span ?? 1) - 1) * gap),
      alone: (p.span ?? 1) >= cols,
    };
  });
  let info = prepare(0);
  // Beyond its maxWidth a panel only gains empty space, so its height stops changing there (matters when a band lowers maxWidth).
  const heightOf = (p, w) => heightAt(p.samples, Math.min(w, p.maxWidth));
  const columnHeight = (col, w) => col.reduce((h, k) => h + heightOf(info[k], w), 0) + gap * (col.length - 1);

  function bestColumns(columns) {
    const avail = width - gap * (columns.length - 1);
    const mins = columns.map((c) => Math.max(...c.map((k) => info[k].minWidth)));
    const minsFrom = mins.map((_, n) => mins.slice(n).reduce((s, w) => s + w, 0));
    if (minsFrom[0] > avail) return null;
    let best = null;
    const evaluate = (ws) => {
      const hs = ws.map((w, n) => columnHeight(columns[n], w));
      const H = Math.max(...hs);
      let waste = 0;
      let dev = 0;
      ws.forEach((w, n) => {
        waste += (H - hs[n]) * w;
        for (const k of columns[n]) {
          const p = info[k];
          if (w > p.maxWidth) waste += (w - p.maxWidth) * heightOf(p, w);
          dev += ((w - p.preferred) / oneColumn) ** 2;
          if (p.natural > 0) {
            const scale = Math.min(p.scaleCap, Math.max(w - p.pad, 1) / p.natural);
            dev += SCALE_WEIGHT * (Math.log(scale) / Math.log(MAX_SCALE)) ** 2;
          }
        }
      });
      const cost = waste / 1000 + PREF_WEIGHT * dev * H;
      if (!best || cost < best.cost) best = { cost, ws, height: H, columns };
    };
    const choose = (n, used, ws) => {
      if (n === columns.length - 1) {
        const w = avail - used;
        if (w >= mins[n]) evaluate([...ws, w]);
        return;
      }
      for (let w = mins[n]; used + w + minsFrom[n + 1] <= avail; w += STEP) choose(n + 1, used + w, [...ws, w]);
    };
    choose(0, 0, []);
    return best;
  }

  // Best columns for one row of panels i..j.
  function bestRow(i, j) {
    if (j > i && info.slice(i, j + 1).some((p) => p.alone)) return null;
    let best = null;
    for (const split of splits(j - i + 1)) {
      if (split.length > maxColumns) continue;
      let next = i;
      const columns = split.map((size) => Array.from({ length: size }, () => next++));
      const r = bestColumns(columns);
      if (r && (!best || r.cost < best.cost)) best = r;
    }
    return best;
  }

  // Row breaks in reading order, for the band set up in `info`. A row holds at most 2 * maxColumns panels. Null if nothing fits.
  function solve() {
    const n = panels.length;
    const total = Array(n + 1).fill(Infinity);
    const from = Array(n + 1).fill(-1);
    const chosen = Array(n + 1).fill(null);
    total[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = Math.max(0, j - 2 * maxColumns); i < j; i++) {
        if (total[i] === Infinity) continue;
        const r = bestRow(i, j - 1);
        if (r && total[i] + r.cost < total[j]) {
          total[j] = total[i] + r.cost;
          from[j] = i;
          chosen[j] = r;
        }
      }
    }
    if (total[n] === Infinity) return null;
    const rows = [];
    for (let j = n; j > 0; j = from[j]) {
      const r = chosen[j];
      rows.unshift({ columns: r.columns.map((panelsInColumn, c) => ({ panels: panelsInColumn, width: r.ws[c] })), height: r.height });
    }
    return { rows, cost: total[n] };
  }

  let best = null;
  const diagrams = panels.filter((p) => p.natural > 0);
  if (diagrams.length > 1) {
    // No diagram can be shown larger than the page allows, so the band cannot start above the smallest of those limits.
    const reach = Math.min(...diagrams.map((p) => Math.min(MAX_SCALE, Math.max(width - (p.pad ?? 0), 1) / p.natural)));
    for (const lo of new Set([...BAND_LOS.filter((x) => x < reach), reach])) {
      info = prepare(lo);
      const r = solve();
      if (r && (!best || r.cost < best.cost)) best = { ...r, maxScale: Math.min(MAX_SCALE, lo * BAND_RATIO) };
    }
    info = prepare(0);
  }
  best ??= solve();
  return best ? { rows: best.rows, maxScale: best.maxScale ?? MAX_SCALE } : singleColumn(width, panels);
}
