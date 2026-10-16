// The value axis of a chart. It always includes 0 (no broken axis) and ends on a tick: the first nice tick at or above the peak. limits has its
// own scale (niceScale, with 40% room above the peak, for a bar against a limit); a chart leaves no more room than its value labels need, and
// chart-bar.js reserves that in pixels.

// Large finite numbers are already integers; multiplying them by 1000 can overflow.
const round = (n) => (Number.isInteger(n) ? n : Math.round(n * 1000) / 1000) || 0;
const MANTISSAS = [1, 2, 2.5, 5];
// A chart reads well with up to this many steps from the bottom of the axis to the top.
const MAX_STEPS = 7;

// A number as written on a tick or a bar: no float noise, no sign on zero.
export const fmt = (n) => String(round(n));

// Nice steps, smallest first: 1, 2, 2.5, 5 times a power of ten. Whole numbers only get whole steps.
function* steps(peak, whole) {
  for (let power = Math.floor(Math.log10(peak)) - 2; ; power++) {
    for (const m of MANTISSAS) {
      const step = round(m * 10 ** power);
      if (!whole || Number.isInteger(step)) yield step;
    }
  }
}

// { min, max, step, ticks } for a list of values.
export function niceRange(values) {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError('chart values must be finite');
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const peak = Math.max(hi, -lo);
  if (peak === 0) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  const count = (value, step) => {
    if (value === 0) return 0;
    const n = Math.max(1, Math.ceil(value / step));
    return round(n * step) < value ? n + 1 : n;
  };
  const whole = values.every(Number.isInteger);
  let step;
  for (step of steps(peak, whole)) if (count(hi, step) + count(-lo, step) <= MAX_STEPS) break;
  const down = count(-lo, step);
  const up = count(hi, step);
  const min = round(-down * step);
  const max = round(up * step);
  if (!Number.isFinite(max - min)) throw new RangeError('chart values are too large to scale');
  const ticks = Array.from({ length: down + up + 1 }, (_, i) => round((i - down) * step));
  return { min, max, step, ticks };
}

// A share of a pie as written beside a slice and in the data table: a whole number, one decimal when a slice is so small that rounding
// would show 0% (a slice of 0 shows 0%), and <0.1% under that.
export function percent(value, total) {
  const p = total > 0 ? (value / total) * 100 : 0;
  if (p === 0 || Math.round(p) > 0) return `${Math.round(p)}%`;
  const tenth = Math.round(p * 10) / 10;
  return tenth > 0 ? `${tenth}%` : '<0.1%';
}

// The value axis of a line: it covers the data, and a line encodes position, not length, so it may start above 0. It includes 0 when the
// values reach it or cross it, or when the smallest value is at most a third of the largest (the lines then rise from the floor); 0 would
// squeeze values that are all large into a flat line. The ticks still end on nice values at or beyond the data.
export function lineRange(values) {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError('chart values must be finite');
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  if (lo <= hi / 3 || lo === hi) return niceRange(values);
  const whole = values.every(Number.isInteger);
  const count = (step) => Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9);
  let step;
  for (step of steps(hi - lo, whole)) if (count(step) <= MAX_STEPS) break;
  const down = Math.floor(lo / step + 1e-9);
  const up = Math.ceil(hi / step - 1e-9);
  const [min, max] = [round(down * step), round(up * step)];
  if (!Number.isFinite(max - min)) throw new RangeError('chart values are too large to scale');
  return { min, max, step, ticks: Array.from({ length: up - down + 1 }, (_, i) => round((down + i) * step)) };
}
