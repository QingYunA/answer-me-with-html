// Limit bars (figure E): fill = current value (or the limit itself), vertical line = limit, over-limit in red. Bar length ∝ value, scale starts at 0, no broken axis.
import { esc } from '../svg/text.js';
import { ComponentError, contentLines, fields } from './error.js';

const NICE_MAX = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const NICE_STEP = [1, 2, 2.5, 5, 10];

export function niceScale(peak) {
  if (!Number.isFinite(peak) || peak <= 0) return { max: 1, step: 1 };
  const target = peak * 1.4;
  const pow = 10 ** Math.floor(Math.log10(target));
  const integral = Number.isInteger(peak);
  const nice = NICE_MAX.map((m) => m * pow).find((m) => m >= target - 1e-9) ?? 10 * pow;
  const max = integral ? Math.ceil(nice) : nice;
  const stepPow = 10 ** Math.floor(Math.log10(max));
  const step = [...NICE_STEP.map((s) => (s * stepPow) / 10), ...NICE_STEP.map((s) => s * stepPow)]
    .find((s) => max / s <= 7 && Number.isInteger(round(max / s)) && (integral ? s >= 1 : true)) ?? max;
  return { max: round(max), step: round(step) };
}

const round = (n) => Math.round(n * 1000) / 1000;
const pct = (v, max) => `${Math.round((v / max) * 10000) / 100}%`;
const NUM = /^(?:max\s+)?(-?\d+(?:\.\d+)?)$/i;

export default {
  name: 'limits',
  summary: 'Value vs limit bars',
  syntax: `\`\`\`limits
label | value / limit | unit (optional) | note (optional)
label | limit | unit         ← limit only: the bar fills to the limit
\`\`\`
- A row turns red when the value is over the limit. The limit may be written as "max 20".`,
  example: '```limits\nProcedural sentence | 13 / 20 | words\nDescriptive sentence | max 25 | words\nNoun cluster | 4 / 3 | words | over\n```',
  render(text, { dir = 'ltr', ui } = {}) {
    const rows = contentLines(text).map(({ text: t, line }) => parseRow(t, line));
    if (!rows.length) throw new ComponentError('limits needs at least one line', 1);
    const words = { ...EN_WORDS, ...ui?.limits };
    return `<div class="am-limits">${rows.map((row) => rowHtml(row, dir === 'rtl' ? 'right' : 'left', words)).join('')}</div>`;
  },
};

function parseRow(t, line) {
  const [label, spec = '', unit = '', note = ''] = fields(t);
  const [a, b] = spec.split('/').map((s) => s.trim());
  const nums = (b === undefined ? [a] : [a, b]).map((s) => s?.match(NUM)?.[1]);
  if (!spec || nums.some((n) => n === undefined)) {
    throw new ComponentError(`limits line must be label | value / limit | unit: "${t}"`, line);
  }
  const [value, limit] = b === undefined ? [null, Number(nums[0])] : nums.map(Number);
  return { label, value, limit, unit, note };
}

// The value text in the page language: "13 / max 20 words" in English; src/languages/<id>.js sets its own. Without a context (component
// unit tests) it is English.
const EN_WORDS = { value: '{value} / max {limit}', limit: 'max {limit}' };
const fill = (template, value, limit) => template.replace('{value}', value).replace('{limit}', limit);

// side: where the scale starts, the left, or the right on a right-to-left page.
function rowHtml({ label, value, limit, unit, note }, side = 'left', words = EN_WORDS) {
  const { max, step } = niceScale(Math.max(limit, value ?? 0));
  const shown = value ?? limit;
  const over = value !== null && value > limit;
  const valText = `${value !== null ? fill(words.value, value, limit) : fill(words.limit, value, limit)}${unit ? ` ${unit}` : ''}`;
  const ticks = [];
  if (step > 0 && max > 0) {
    for (let v = 0; v <= max + 1e-9; v += step) ticks.push(`<span style="${side}: ${pct(round(v), max)}">${round(v)}</span>`);
  }
  return `<div class="am-lim${over ? ' is-over' : ''}">
<div class="am-lim-head"><span>${esc(label)}${note ? `<span class="am-lim-note">${esc(note)}</span>` : ''}</span><span class="am-lim-val">${esc(valText)}</span></div>
<div class="am-lim-track"><div class="am-lim-fill" style="width: ${pct(shown, max)}"></div><div class="am-lim-mark" style="${side}: ${pct(limit, max)}"></div></div>
<div class="am-lim-ticks" aria-hidden="true">${ticks.join('')}</div>
</div>`;
}
