// A chart from a table of numbers: the chart type follows the fence name, the data is `label | value | value`, like limits.
// This file reads the table and writes the data table under the drawing; chart-bar.js, chart-line.js and chart-pie.js draw it.
import { esc } from '../svg/text.js';
import { diagramLabel } from '../svg/shapes.js';
import { parseAttrs } from '../parse.js';
import { ComponentError, contentLines, fields } from './error.js';
import { drawBars } from './chart-bar.js';
import { drawLines } from './chart-line.js';
import { drawPie } from './chart-pie.js';
import { fmt, percent } from './chart-scale.js';

const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const TYPES = ['bar', 'line', 'pie'];
// The most rows a chart takes: a pie has a slice for each of the 6 series colors.
const MAX_ROWS = { bar: 24, line: 60, pie: 6 };
const MAX_SERIES = 6;
// The labels in the page language (src/languages/<id>.js sets its own). Without a context (component unit tests) they are English.
const EN_WORDS = { name: 'Chart', data: 'Data', value: 'Value', share: 'Share' };

export default {
  name: 'chart',
  summary: 'Bar, line or pie chart from a table of numbers',
  syntax: `\`\`\`chart bar|line|pie [horizontal] [unit=ms]
          | p50 | p95   ← names the series; needed for 2+ numbers
* Redis    | 12  | 40    ← * highlights the row
Memcached  | 9   | 31
\`\`\`
- Types: bar (vertical bars), bar horizontal, line and pie (a donut). Each line is a label and one number for each series.
- A first line whose values are not numbers names the series; its label cell may be empty. With more than one number on a row this line is required. bar and line take 1 to 6 series; up to ${MAX_ROWS.bar} rows for bar, ${MAX_ROWS.line} for line.
- line: each row is a position on the horizontal axis, each series is a line with a dot on every point. With one series and up to 12 points every point carries its value; otherwise only the highlighted row does.
- pie: one number on each row (a series name line may give one name), 0 or more, at least one above 0, up to ${MAX_ROWS.pie} slices. Slices start at 12 o'clock and go clockwise in the order written. A list beside the donut shows each slice's value and percentage; the total is in the middle. With unit=% the values are the shares: no second percentage, no total.
- Numbers are plain: an optional + or -, digits, an optional decimal point. bar and line draw a negative value below the zero line. A bar axis starts at 0; a line axis may start above 0, but starts at 0 when the smallest value is a third of the largest or less, or the values reach 0.
- unit=% (or ms, KB) is added to the axis and the value labels as it is; unit=" ms" gives a space. The panel title is the chart title, so there is no title=.
- * before a label highlights the row. bar: with one series its bar uses the accent color, with several it keeps its series colors, and the other rows turn gray. line: the row's points are larger and carry their value, with a thin dashed guide line (several series: the values in a column beside it); the lines keep their colors. pie: the slice keeps its color and the other slices turn gray.
- With more than one series the chart has a legend. Up to 12 bars carry their value; a collapsed table under the chart holds all the numbers.`,
  example: '```chart bar unit=ms\n       | p50 | p95\n* Redis     | 12  | 40\nMemcached   | 9   | 31\nPostgres    | 28  | 95\n```',
  render(text, { args = '', dir = 'ltr', ui, video } = {}) {
    const options = parseOptions(args);
    const data = parseChart(text, options.type);
    const words = { ...EN_WORDS, ...ui?.chart };
    const label = diagramLabel({ ...ui, chart: words.name }, 'chart', data.rows.map((r) => r.label));
    const svg = draw(options, data, { dir, label });
    // A video has no use for a collapsed table: nobody opens it.
    return `<figure class="am-diagram am-chart">${svg}${video ? '' : dataTable(data, options, words)}</figure>`;
  },
};

const draw = ({ type, horizontal, unit }, data, ctx) => (type === 'line' ? drawLines(data, { unit, ...ctx }) : type === 'pie' ? drawPie(data, { unit, ...ctx }) : drawBars(data, { horizontal, unit, ...ctx }));

// { type, horizontal, unit } from the words after chart: bar, horizontal, unit=ms.
export function parseOptions(args) {
  const attrs = parseAttrs(args);
  const words = Object.keys(attrs).filter((k) => attrs[k] === true);
  const [type, ...modifiers] = words;
  if (!type) throw new ComponentError('chart needs a type: write ```chart bar', 0);
  if (!TYPES.includes(type)) throw new ComponentError(`unknown chart type "${type}"; use bar, line or pie`, 0);
  const unknown = modifiers.find((w) => w !== 'horizontal' || type !== 'bar');
  if (unknown) throw new ComponentError(`chart ${type} has no "${unknown}" option${type === 'bar' ? '; use horizontal' : ''}`, 0);
  const extra = Object.keys(attrs).find((k) => attrs[k] !== true && k !== 'unit');
  if (extra) throw new ComponentError(`chart has no ${extra}= option; the only option is unit= (the panel title is the chart title)`, 0);
  return { type, horizontal: modifiers.includes('horizontal'), unit: typeof attrs.unit === 'string' ? attrs.unit : '' };
}

// { series: [name] | null, rows: [{ label, values, hi, line }] } from the lines of the table. type sets the limits: bar, line or pie.
export function parseChart(text, type = 'bar') {
  const lines = contentLines(text);
  if (!lines.length) throw new ComponentError('chart needs a table: a label and a number on each line', 1);
  const head = fields(lines[0].text).slice(1);
  const named = head.length > 0 && head.every((cell) => !NUMBER.test(cell));
  const series = named ? head : null;
  if (named && head.includes('')) throw new ComponentError(`chart: a series name is empty: "${lines[0].text}"`, lines[0].line);
  const body = named ? lines.slice(1) : lines;
  if (!body.length) throw new ComponentError('chart needs at least one row of numbers under the series names', lines[0].line);
  const width = series ? series.length : fields(body[0].text).length - 1;
  const where = series ? lines[0] : body[0];
  if (type === 'pie' && width > 1) {
    const fix = series ? 'name the one series on the first line, like "| share"' : 'write a label and one number, like "Redis | 12"';
    throw new ComponentError(`chart pie takes one number per row, not ${width}; ${fix}: "${where.text}"`, where.line);
  }
  if (!series && width > 1) {
    throw new ComponentError(`chart: a row with ${width} numbers needs a first line that names the series, like "| ${Array.from({ length: width }, (_, i) => `name ${i + 1}`).join(' | ')}": "${where.text}"`, where.line);
  }
  if (width < 1) throw new ComponentError(`chart row needs a label and a number: "${where.text}"`, where.line);
  if (width > MAX_SERIES) throw new ComponentError(`chart takes up to ${MAX_SERIES} series, not ${width}: "${where.text}"`, where.line);
  const rows = body.map(({ text: t, line }, i) => {
    if (i >= MAX_ROWS[type]) {
      const limit = type === 'pie' ? `${MAX_ROWS.pie} slices, one for each series color; this is slice ${i + 1}` : `${MAX_ROWS[type]} rows; this is row ${i + 1}`;
      throw new ComponentError(`chart ${type === 'pie' ? 'pie ' : ''}takes up to ${limit}`, line);
    }
    return parseRow(t, line, width, series, type);
  });
  if (type === 'pie' && !rows.some((r) => r.values[0] > 0)) {
    throw new ComponentError(`chart pie needs at least one value above 0, like "Redis | 12": "${body[0].text}"`, body[0].line);
  }
  return { series, rows };
}

function parseRow(t, line, width, series, type) {
  const [first, ...cells] = fields(t);
  const hi = first.startsWith('*');
  const label = hi ? first.slice(1).trim() : first;
  if (!label) throw new ComponentError(`chart row needs a label before the first |: "${t}"`, line);
  if (cells.length !== width) {
    const shape = series ? `label | ${series.map(() => 'number').join(' | ')}` : `label${' | number'.repeat(width)}`;
    throw new ComponentError(`chart row has ${cells.length} value${cells.length === 1 ? '' : 's'}, expected ${width} (${shape}): "${t}"`, line);
  }
  const bad = cells.find((c) => !NUMBER.test(c));
  if (bad !== undefined) {
    throw new ComponentError(`chart value "${bad}" is not a number: "${t}"; write plain numbers like 12, -3 or 4.5 and put the unit in unit=`, line);
  }
  const values = cells.map(Number);
  if (values.some((value) => !Number.isFinite(value) || !Number.isFinite(value * 1000))) {
    throw new ComponentError(`chart value is too large to render: "${t}"; write a finite number within the chart's numeric range`, line);
  }
  if (type === 'pie' && values[0] < 0) {
    throw new ComponentError(`chart pie takes values of 0 or more, not ${cells[0]}: "${t}"; a slice cannot be negative, like "Redis | 12"`, line);
  }
  return { label, values, hi, line };
}

// The numbers as a table, collapsed under the chart: a screen reader reads it and a reader can copy the numbers.
// A pie has a share column besides the value.
function dataTable({ series, rows }, { type, unit }, words) {
  const cell = (text) => `<td dir="ltr">${esc(text)}</td>`;
  const pie = type === 'pie';
  const total = pie ? rows.reduce((sum, r) => sum + r.values[0], 0) : 0;
  // With unit=% the values of a pie are the shares already, so there is no share column.
  const shares = pie && unit !== '%';
  const names = pie ? [series?.[0] ?? words.value, ...(shares ? [words.share] : [])] : series;
  const head = names ? `<thead><tr><td></td>${names.map((s) => `<th scope="col">${esc(s)}</th>`).join('')}</tr></thead>` : '';
  const body = rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${r.values.map((v) => cell(fmt(v) + unit)).join('')}${shares ? cell(percent(r.values[0], total)) : ''}</tr>`);
  return `<details class="am-ch-data${pie ? ' am-ch-data--pie' : ''}"><summary>${esc(words.data)}</summary><div class="am-table-wrap"><table>${head}<tbody>${body.join('')}</tbody></table></div></details>`;
}
