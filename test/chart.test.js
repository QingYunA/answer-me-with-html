// The chart component (spec #264): the parts all types share and bar and bar horizontal (line and pie are in chart-line.test.js and chart-pie.test.js). Parsing and errors, the value axis, what the drawing carries
// (value labels, legend, highlight, data table), right-to-left mirroring, and how a page or a video takes the chart styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseChart, parseOptions } from '../src/components/chart.js';
import { niceRange, fmt } from '../src/components/chart-scale.js';
import { niceScale } from '../src/components/limits.js';
import { renderDoc, RenderError } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { LANGUAGES } from '../src/languages/registry.js';
import { CHART_CSS } from '../src/assets.js';

const chart = COMPONENTS.get('chart');
const render = (text, args = 'bar', extra = {}) => chart.render(text, { args, uid: () => 'u1', ...extra });
const throwsAt = (fn, line, pattern) => assert.throws(fn, (e) => e instanceof ComponentError && e.line === line && (!pattern || pattern.test(e.message)), `line ${line} ${pattern ?? ''}`);
const num = (s) => Number(s);
// The bars of a drawing, in document order: { x, y, w, h, cls }.
const bars = (html) => [...html.matchAll(/<rect class="am-ch-bar ([^"]*)" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
  .map((m) => ({ cls: m[1], x: num(m[2]), y: num(m[3]), w: num(m[4]), h: num(m[5]) }));
const texts = (html, cls) => [...html.matchAll(new RegExp(`<text class="${cls}"[^>]*>([^<]*)</text>`, 'g'))].map((m) => m[1]);
const zeroY = (html) => num(html.match(/<line class="am-ch-zero" x1="[\d.]+" y1="([\d.]+)"/)[1]);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

const TWO = '       | p50 | p95\n* Redis     | 12  | 40\nMemcached   | 9   | 31\nPostgres    | 28  | 95';

// ── registry ──
test('chart: is a component with a summary, syntax and an example that renders', () => {
  assert.equal(chart.name, 'chart');
  assert.ok(chart.summary && chart.syntax);
  const [, args, body] = chart.example.match(/^```chart (.*)\n([\s\S]*)\n```$/);
  assert.match(render(body, args), /^<figure class="am-diagram am-chart"><svg /);
});

// ── parsing ──
test('parseChart: a first line with no numbers names the series, and its label cell may be empty', () => {
  const { series, rows } = parseChart(TWO);
  assert.deepEqual(series, ['p50', 'p95']);
  assert.deepEqual(rows.map((r) => [r.label, r.values, r.hi, r.line]), [['Redis', [12, 40], true, 2], ['Memcached', [9, 31], false, 3], ['Postgres', [28, 95], false, 4]]);
  assert.deepEqual(parseChart('Area | p50\nA | 1').series, ['p50'], 'a label in the first cell is ignored too');
});

test('parseChart: without a header there is one series and no names; blank and // lines are skipped', () => {
  const { series, rows } = parseChart('\n// the data\nA | 1\n\nB | 2.5');
  assert.equal(series, null);
  assert.deepEqual(rows.map((r) => [r.label, r.values, r.line]), [['A', [1], 3], ['B', [2.5], 5]]);
});

test('parseChart: numbers have an optional sign and decimal point, and nothing else', () => {
  assert.deepEqual(parseChart('| a | b | c | d\nA | -3.5 | +2 | 0 | 10').rows[0].values, [-3.5, 2, 0, 10]);
  for (const bad of ['1,000', '12ms', '1e3', '.5', '5.', '--1', '1 2', 'n/a', '$5', '50%']) {
    throwsAt(() => parseChart(`A | 1\nB | ${bad}`), 2, /is not a number/);
  }
});

test('parseChart: values that overflow JavaScript numbers are rejected before scale calculation', () => {
  const huge = '9'.repeat(309);
  throwsAt(() => parseChart(`A | ${huge}`), 1, /too large to render/);
  throwsAt(() => parseChart(`A | ${'9'.repeat(306)}`), 1, /too large to render/);
});

test('parseChart: more than one number on a row needs a first line that names the series', () => {
  throwsAt(() => parseChart('Redis | 12 | 40\nMemcached | 9 | 31'), 1, /a row with 2 numbers needs a first line that names the series, like "\| name 1 \| name 2": "Redis \| 12 \| 40"/);
  throwsAt(() => parseChart('// data\n\n* Redis | 12 | 40'), 3, /needs a first line/);
  assert.deepEqual(parseChart('Redis | 12\nMemcached | 9').series, null, 'one unnamed column is fine');
  assert.deepEqual(parseChart('| p50 | p95\nRedis | 12 | 40').series, ['p50', 'p95']);
  assert.throws(() => render('Redis | 12 | 40'), ComponentError);
});

test('parseChart: a row with a different number of cells is an error at its line', () => {
  throwsAt(() => parseChart('| p50 | p95\nA | 1 | 2\nB | 3'), 3, /1 value, expected 2/);
  throwsAt(() => parseChart('A | 1\nB | 1 | 2'), 2, /2 values, expected 1/);
  throwsAt(() => parseChart('A | 1\nB'), 2, /0 values, expected 1/);
  throwsAt(() => parseChart('| p50\n\n\nA | 1 | 2'), 4, /2 values, expected 1/);
});

test('parseChart: a row needs a label, a table needs a row, a series needs a name', () => {
  throwsAt(() => parseChart('| 1'), 1, /needs a label|series name is empty/);
  throwsAt(() => parseChart('A | 1\n | 2'), 2, /needs a label/);
  throwsAt(() => parseChart('* | 2'), 1, /needs a label/);
  throwsAt(() => parseChart(''), 1, /needs a table/);
  throwsAt(() => parseChart('| p50 | p95'), 1, /at least one row/);
  throwsAt(() => parseChart('| p50 |\nA | 1 | 2'), 1, /series name is empty/);
});

test('parseChart: 1 to 6 series and up to 24 rows', () => {
  const row = (label, n) => `${label} | ${Array.from({ length: n }, (_, i) => i + 1).join(' | ')}`;
  const head = (n) => `| ${Array.from({ length: n }, (_, i) => `s${i + 1}`).join(' | ')}`;
  assert.equal(parseChart(`${head(6)}\n${row('A', 6)}`).rows[0].values.length, 6);
  throwsAt(() => parseChart(`${head(7)}\n${row('A', 7)}`), 1, /up to 6 series, not 7/);
  throwsAt(() => parseChart(`| ${'abcdefg'.split('').join(' | ')}\n${row('A', 7)}`), 1, /up to 6 series/);
  const rows = (n) => Array.from({ length: n }, (_, i) => `R${i + 1} | ${i}`).join('\n');
  assert.equal(parseChart(rows(24)).rows.length, 24);
  throwsAt(() => parseChart(rows(25)), 25, /up to 24 rows; this is row 25/);
  throwsAt(() => parseChart(`| v\n${rows(25)}`), 26, /up to 24 rows/);
});

test('parseOptions: the type, horizontal and unit', () => {
  assert.deepEqual(parseOptions('bar'), { type: 'bar', horizontal: false, unit: '' });
  assert.deepEqual(parseOptions('bar horizontal unit=ms'), { type: 'bar', horizontal: true, unit: 'ms' });
  assert.equal(parseOptions('bar unit=%').unit, '%');
  assert.equal(parseOptions('bar unit=" req/s"').unit, ' req/s');
  assert.equal(parseOptions('bar unit=KB horizontal').horizontal, true, 'the order does not matter after the type');
});

test('parseOptions: a missing or unsupported type is an error on the fence line', () => {
  throwsAt(() => parseOptions(''), 0, /needs a type/);
  throwsAt(() => parseOptions('unit=ms'), 0, /needs a type/);
  throwsAt(() => parseOptions('radar'), 0, /unknown chart type "radar"; use bar, line or pie/);
  throwsAt(() => parseOptions('line horizontal'), 0, /chart line has no "horizontal" option/);
  throwsAt(() => parseOptions('pie horizontal'), 0, /chart pie has no "horizontal" option/);
  throwsAt(() => parseOptions('bar sideways'), 0, /no "sideways" option/);
  throwsAt(() => parseOptions('bar title=Latency'), 0, /no title= option/);
});

// ── the value axis ──
test('niceRange: starts at 0 and ends on the first nice tick at or above the peak', () => {
  const cases = [[[95, 31], 100, 20], [[28, 9], 30, 5], [[12], 12, 2], [[1], 1, 1], [[3], 3, 1], [[40], 40, 10], [[0.4], 0.4, 0.1], [[1234], 1400, 200], [[7.5], 8, 2]];
  for (const [values, max, step] of cases) {
    const r = niceRange(values);
    assert.deepEqual({ min: r.min, max: r.max, step: r.step }, { min: 0, max, step }, JSON.stringify(values));
    assert.ok(r.max >= Math.max(...values) && r.max - Math.max(...values) < r.step, 'the room above the peak is less than a step');
  }
  assert.deepEqual(niceRange([0, 0]).ticks, [0, 1]);
  assert.deepEqual(niceRange([95, 31]).ticks, [0, 20, 40, 60, 80, 100]);
  assert.ok(niceRange([95]).max < niceScale(95).max, 'tighter than the limits scale, which is not changed');
  assert.ok(niceRange([3, 1, 2]).ticks.every(Number.isInteger), 'whole numbers get whole ticks');
  for (const values of [[1.0000000001], [-1.0000000001], [1.0000000001, -1], [2.5000000000000002e22], [-2.5000000000000002e22], [1.0000000000000001e23, -1.0000000000000001e23]]) {
    const range = niceRange(values);
    assert.ok(range.min <= Math.min(0, ...values), `${values}: min ${range.min}`);
    assert.ok(range.max >= Math.max(0, ...values), `${values}: max ${range.max}`);
  }
});

test('niceRange: negative values extend the scale below zero, on the same step, and the axis never skips zero', () => {
  const r = niceRange([12, -8, 5, -3.5, 18, -12]);
  assert.ok(r.min <= -12 && r.max >= 18, JSON.stringify(r));
  assert.ok(r.ticks.includes(0));
  assert.equal(r.ticks[0], r.min);
  assert.equal(r.ticks.at(-1), r.max);
  assert.ok(r.ticks.length <= 10);
  assert.ok(r.ticks.every((t, i) => i === 0 || Math.abs(t - r.ticks[i - 1] - r.step) < 1e-9), 'ticks are one step apart');
  const only = niceRange([-5, -20]);
  assert.equal(only.max, 0);
  assert.ok(only.min <= -20);
  assert.ok(niceRange([-1, 2]).ticks.every(Number.isInteger), 'whole numbers get whole ticks');
});

test('chart: large finite values terminate with finite axes and SVG coordinates', () => {
  const probe = `
    import assert from 'node:assert/strict';
    import { niceRange } from ${JSON.stringify(new URL('../src/components/chart-scale.js', import.meta.url).href)};
    import chart from ${JSON.stringify(new URL('../src/components/chart.js', import.meta.url).href)};
    for (const values of [[Infinity], [-Infinity], [NaN], [Number.MAX_VALUE], [-Number.MAX_VALUE], [1e308, -1e308]]) {
      assert.throws(() => niceRange(values), RangeError);
    }
    for (const digits of ['179' + '0'.repeat(303), '1797693134862315' + '0'.repeat(290)]) {
      const peak = Number(digits);
      for (const values of [[peak], [-peak], [peak, -peak], [peak, -1], [1, -peak]]) {
        const r = niceRange(values);
        assert.ok([r.min, r.max, r.step, ...r.ticks].every(Number.isFinite));
        assert.ok(r.ticks.length <= 8);
        assert.ok(r.min <= Math.min(0, ...values) && r.max >= Math.max(0, ...values));
        for (const args of ['bar', 'bar horizontal']) {
          const body = values.map((value, i) => 'R' + i + ' | ' + (value < 0 ? '-' : '') + (Math.abs(value) === peak ? digits : '1')).join('\\n');
          assert.doesNotMatch(chart.render(body, { args }), /NaN|Infinity/);
        }
      }
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { timeout: 5000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('fmt: no float noise and no negative zero', () => {
  assert.equal(fmt(0.1 + 0.2), '0.3');
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(-3.5), '-3.5');
  assert.equal(fmt(12), '12');
});

// ── drawing ──
test('chart bar: a static svg with one bar per value, grouped by row, and no script or foreign content', () => {
  const html = render(TWO);
  assert.match(html, /^<figure class="am-diagram am-chart"><svg viewBox="0 0 \d+ \d+"[^>]* role="img"/);
  assert.equal(bars(html).length, 6);
  assert.equal((html.match(/<g data-step="\d" class="am-ch-row/g) || []).length, 3, 'a group per row, for the video steps');
  assert.doesNotMatch(html, /<script|foreignObject|<style|href=/);
});

test('chart bar: bar heights follow the values from a zero line at the bottom', () => {
  const [a, b, c] = bars(render('A | 10\nB | 20\nC | 40'));
  assert.ok(Math.abs(b.h - 2 * a.h) < 0.5 && Math.abs(c.h - 4 * a.h) < 0.5, `${a.h} ${b.h} ${c.h}`);
  assert.ok(Math.abs(a.y + a.h - (b.y + b.h)) < 0.01, 'all bars stand on the same line');
  assert.ok(a.x < b.x && b.x < c.x, 'the first row is on the left');
  const html = render('A | 10\nB | 20');
  assert.ok(Math.abs(zeroY(html) - (bars(html)[0].y + bars(html)[0].h)) < 0.01, 'the bars stand on the zero line');
});

test('chart bar: a negative value draws below the zero line, with a zero line and ticks below it', () => {
  const html = render('A | 12\nB | -8\nC | 0');
  const [a, b, c] = bars(html);
  const zero = zeroY(html);
  assert.ok(Math.abs(a.y + a.h - zero) < 0.01, 'a positive bar ends on the zero line');
  assert.ok(Math.abs(b.y - zero) < 0.01 && b.h > 0, 'a negative bar starts on the zero line and goes down');
  assert.equal(c.h, 0);
  assert.ok(texts(html, 'am-ch-tick').some((t) => t.startsWith('-')), 'the axis has negative ticks');
  assert.ok(texts(html, 'am-ch-tick').includes('0'));
  assert.equal((html.match(/class="am-ch-zero"/g) || []).length, 1);
});

test('chart bar: the axis starts at 0 even when every value is large', () => {
  const html = render('A | 1000\nB | 1010');
  const [a, b] = bars(html);
  assert.ok(b.h / a.h < 1.02, 'a 1% difference stays a 1% difference in height');
  assert.equal(texts(html, 'am-ch-tick')[0], '0');
});

test('chart bar: unit is added to the ticks, the value labels and the table', () => {
  const html = render('A | 12\nB | -8', 'bar unit=ms');
  assert.ok(texts(html, 'am-ch-tick').every((t) => t.endsWith('ms')));
  assert.deepEqual(texts(html, 'am-ch-val'), ['12ms', '-8ms']);
  assert.match(html, /<td dir="ltr">12ms<\/td>/);
  assert.deepEqual(texts(render('A | 5', 'bar unit=%'), 'am-ch-val'), ['5%']);
});

test('chart bar: bars carry their value up to 12 bars, and not more', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => `R${i + 1} | ${i + 1}`).join('\n');
  assert.equal(texts(render(rows(12)), 'am-ch-val').length, 12);
  assert.equal(texts(render(rows(13)), 'am-ch-val').length, 0);
  const two = (n) => `| a | b\n${Array.from({ length: n }, (_, i) => `R${i + 1} | ${i + 1} | ${i + 2}`).join('\n')}`;
  assert.equal(texts(render(two(6)), 'am-ch-val').length, 12, '6 rows of 2 series are 12 bars');
  assert.equal(texts(render(two(7)), 'am-ch-val').length, 0, 'and 7 rows of 2 are 14');
  assert.equal(texts(render(rows(13), 'bar horizontal'), 'am-ch-val').length, 0);
});

test('chart bar: a legend only when there is more than one series', () => {
  const swatches = (html) => (html.match(/class="am-ch-sw /g) || []).length;
  assert.equal(swatches(render(TWO)), 2);
  assert.deepEqual(texts(render(TWO), 'am-ch-leg'), ['p50', 'p95']);
  assert.equal(swatches(render('| only\nA | 1\nB | 2')), 0, 'one named series has no legend');
  assert.equal(swatches(render('A | 1\nB | 2')), 0);
  assert.equal(swatches(render(TWO, 'bar horizontal')), 2);
});

test('chart bar: each series has its own class, matching its swatch', () => {
  const html = render('| a | b | c\nA | 1 | 2 | 3');
  assert.deepEqual(bars(html).map((b) => b.cls), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3']);
  assert.deepEqual([...html.matchAll(/class="am-ch-sw (am-ch-s\d)"/g)].map((m) => m[1]), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3']);
});

test('chart bar: * highlights a row; the other rows are muted', () => {
  const html = render('* A | 5\nB | 4\nC | 3');
  assert.deepEqual(bars(html).map((b) => b.cls), ['am-ch-hi', 'am-ch-s1', 'am-ch-s1']);
  assert.deepEqual([...html.matchAll(/<g data-step="\d" class="(am-ch-row[^"]*)"/g)].map((m) => m[1]), ['am-ch-row is-hi', 'am-ch-row is-dim', 'am-ch-row is-dim']);
  assert.match(html, /<text class="am-ch-cat"[^>]*>A<\/text>/, 'the * is not part of the label');
  // With several series the highlighted row keeps its series colors.
  assert.deepEqual(bars(render(TWO)).slice(0, 2).map((b) => b.cls), ['am-ch-s1', 'am-ch-s2']);
  // No highlight: no row is muted.
  assert.doesNotMatch(render('A | 5\nB | 4'), /is-dim|is-hi/);
});

test('chart.css: the rows next to a highlight are gray, not translucent, and the data table triangle points down when open in both directions', () => {
  const rule = CHART_CSS.match(/\.am-ch-row\.is-dim \.am-ch-bar, \.am-ch-row\.is-dim \.am-ch-slice, \.am-ch-row\.is-dim \.am-ch-sw \{([^}]*)\}/)[1];
  assert.match(rule, /fill: var\(--line-2, #d6dae1\); fill: color-mix\(in oklch, var\(--ink-3, #8b929e\) 40%, var\(--paper, #ffffff\)\);/, 'a fallback first, then the mix');
  assert.doesNotMatch(rule, /opacity/);
  assert.match(CHART_CSS, /\.am-ch-data\[open\] summary::before \{ transform: rotate\(90deg\); \}/);
  assert.match(CHART_CSS, /html\[dir="rtl"\] \.am-ch-data\[open\] summary::before \{ transform: rotate\(-90deg\); \}/);
  assert.match(CHART_CSS, /prefers-reduced-motion: reduce\) \{ \.am-ch-data summary::before \{ transition: none; \}/);
});

test('chart bar: the data table is collapsed, has the series as column headers and the labels as row headers', () => {
  const html = render(TWO, 'bar unit=ms');
  const details = html.match(/<details class="am-ch-data"><summary>([^<]*)<\/summary>([\s\S]*)<\/details>/);
  assert.equal(details[1], 'Data');
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(details[2], /<th scope="col">p50<\/th><th scope="col">p95<\/th>/);
  assert.match(details[2], /<tr><th scope="row">Redis<\/th><td dir="ltr">12ms<\/td><td dir="ltr">40ms<\/td><\/tr>/);
  assert.equal((details[2].match(/<tr>/g) || []).length, 4);
  assert.doesNotMatch(render('A | 1').match(/<table>[\s\S]*<\/table>/)[0], /<thead>/, 'no names, no head');
});

test('chart bar: labels and series names are escaped', () => {
  const html = render('| a<b\nx"<script> | 1');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /x&quot;&lt;script&gt;/);
  assert.match(html, /<th scope="col">a&lt;b<\/th>/);
});

test('chart bar: a long label in a vertical chart is slanted before it is shortened, and a very long one gets an ellipsis and a tooltip', () => {
  const flat = render('Redis | 1\nMemcached | 2');
  assert.doesNotMatch(flat, /rotate\(/);
  const slanted = render('Authentication service | 1\nAuthorization gateway | 2\nBilling and invoicing | 3\nCustomer notifications | 4\nData warehouse loader | 5\nEdge cache purge | 6');
  assert.equal((slanted.match(/transform="rotate\(-40 /g) || []).length, 6);
  assert.doesNotMatch(slanted, /…/, 'slanted, not shortened');
  const long = render(`${'Very long category name '.repeat(8)}| 1\nShort | 2`);
  assert.match(long, /<title>Very long category name /);
  assert.match(long, /…<\/text>/);
  // A horizontal chart wraps its labels instead.
  assert.doesNotMatch(render('Authentication service for the whole company network | 1', 'bar horizontal'), /rotate\(/);
  assert.ok(texts(render('Authentication service for the whole company network | 1', 'bar horizontal'), 'am-ch-cat').length >= 2);
});

test('chart bar horizontal: bars grow to the right from the zero line, the first row at the top', () => {
  const html = render('A | 10\nB | -5\nC | 20', 'bar horizontal');
  const [a, b, c] = bars(html);
  const zero = num(html.match(/<line class="am-ch-zero" x1="([\d.]+)"/)[1]);
  assert.ok(Math.abs(a.x - zero) < 0.01 && a.w > 0, 'a positive bar starts on the zero line and goes right');
  assert.ok(Math.abs(b.x + b.w - zero) < 0.01, 'a negative bar ends on the zero line');
  assert.ok(Math.abs(c.w - 2 * a.w) < 0.5);
  assert.ok(a.y < b.y && b.y < c.y);
  assert.deepEqual(texts(html, 'am-ch-val'), ['10', '-5', '20']);
});

test('chart bar: many series fit, and the labels never leave the drawing', () => {
  const html = render('| a | b | c | d | e | f\nOne | 5 | 6 | 7 | 8 | 9 | 10\nTwo | 2 | 3 | 4 | 5 | 6 | 7');
  const [w] = html.match(/viewBox="0 0 (\d+)/).slice(1).map(Number);
  for (const b of bars(html)) assert.ok(b.x >= 0 && b.x + b.w <= w, `bar at ${b.x} in ${w}`);
  assert.equal(new Set(bars(html).map((b) => b.cls)).size, 6);
});

// ── right-to-left ──
test('chart bar, rtl: the first row is on the right, the svg says so, and numbers stay left to right', () => {
  const ltr = render('A | 5\nB | -4\nC | 3', 'bar unit=%', { dir: 'ltr' });
  const rtl = render('A | 5\nB | -4\nC | 3', 'bar unit=%', { dir: 'rtl' });
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  assert.doesNotMatch(ltr, /direction=/);
  const [l, r] = [bars(ltr), bars(rtl)];
  assert.ok(l[0].x < l[2].x && r[0].x > r[2].x, 'the category axis starts from the right');
  assert.deepEqual(r.map((b) => b.h), l.map((b) => b.h), 'only the positions mirror');
  const [lw] = ltr.match(/viewBox="0 0 (\d+)/).slice(1).map(Number);
  assert.ok(Math.abs(l[0].x + r[0].x + l[0].w - lw) < 0.2, 'x is the mirror image');
  assert.ok(texts(rtl, 'am-ch-val').every((t) => t.startsWith(LRI) && t.endsWith(PDI)), 'a value such as -4% keeps its sign on the left');
  assert.ok(texts(rtl, 'am-ch-tick').every((t) => t.startsWith(LRI) && t.endsWith(PDI)));
  assert.deepEqual(texts(ltr, 'am-ch-val'), ['5%', '-4%', '3%'], 'a left-to-right page is unchanged');
});

test('chart bar horizontal, rtl: bars grow to the left, and labels sit on the right', () => {
  const ltr = render('A | 10\nB | 20', 'bar horizontal', { dir: 'ltr' });
  const rtl = render('A | 10\nB | 20', 'bar horizontal', { dir: 'rtl' });
  const [lw] = ltr.match(/viewBox="0 0 (\d+)/).slice(1).map(Number);
  const [l, r] = [bars(ltr), bars(rtl)];
  assert.ok(Math.abs(l[0].x + r[0].x + l[0].w - lw) < 0.2);
  const zero = num(rtl.match(/<line class="am-ch-zero" x1="([\d.]+)"/)[1]);
  assert.ok(Math.abs(r[1].x + r[1].w - zero) < 0.01, 'the bars end on the zero line, which is their right end');
  const catX = num(rtl.match(/<text class="am-ch-cat" x="([\d.]+)"/)[1]);
  assert.ok(catX > zero, 'the category labels are on the right of the plot');
});

test('chart rtl: every tick and value is an isolated left-to-right run, so -8% keeps its sign on the left, in both directions of bars', () => {
  for (const args of ['bar unit=%', 'bar horizontal unit=%']) {
    const html = render('A | 12\nB | -8\nC | -3.5', args, { dir: 'rtl' });
    const numbers = [...texts(html, 'am-ch-tick'), ...texts(html, 'am-ch-val')];
    assert.ok(numbers.length > 6);
    assert.ok(numbers.every((t) => t.startsWith(LRI) && t.endsWith(PDI)), `${args}: ${numbers.join(' ')}`);
    assert.ok(numbers.includes(`${LRI}-8%${PDI}`) && numbers.includes(`${LRI}-3.5%${PDI}`), args);
    assert.ok(!texts(html, 'am-ch-cat').some((t) => t.includes('%')));
  }
});

test('chart: a page in Hebrew gets the labels of its language and a mirrored chart', () => {
  const { html } = renderDoc('---\nlang: he\n---\n## A\n```chart bar\nא | 1\nב | 2\n```\n', { theme: 'blueprint' });
  assert.match(html, /<summary>נתונים<\/summary>/);
  assert.match(html, /aria-label="תרשים: א, ב"/);
  assert.match(html, /<svg [^>]*direction="rtl"/);
});

// ── page labels ──
test('chart: the labels come from the page language, English without a context', () => {
  assert.match(render('A | 1'), /<summary>Data<\/summary>/);
  assert.match(render('A | 1'), /aria-label="Chart: A"/);
  for (const language of LANGUAGES) {
    const html = render('A | 1\nB | 2', 'bar', { ui: language.ui });
    assert.match(html, new RegExp(`<summary>${language.ui.chart.data}</summary>`), language.id);
    assert.match(html, new RegExp(`aria-label="${language.ui.chart.name}${language.ui.colon}A${language.ui.sep}B"`), language.id);
  }
});

// ── pages and videos ──
const PAGE = (body) => `## A Latency\n${body}\n`;

test('page: the chart styles come with a chart only, and a page without one is unchanged', () => {
  const withChart = renderDoc(PAGE('```chart bar\nA | 1\n```'), { theme: 'blueprint' }).html;
  const without = renderDoc(PAGE('```limits\nA | 1 / 2\n```'), { theme: 'blueprint' }).html;
  assert.match(withChart, /\.am-ch-s1 \{ fill: var\(--series-1, /);
  assert.match(withChart, /--am-ch-2: /);
  assert.doesNotMatch(without, /am-ch-|--series-/);
  // A chart in a code fence, or the word chart in text, does not bring the styles.
  assert.doesNotMatch(renderDoc(PAGE('A chart is a picture of numbers.\n\n```js\nconst chart = 1;\n```'), { theme: 'blueprint' }).html, /\.am-ch-s1/);
});

test('page: a chart error names the line and shows a correct example', () => {
  const draft = '## A\n```chart bar\nA | 1\nB | x\n```\n';
  assert.throws(() => renderDoc(draft, { theme: 'blueprint' }), (e) => e instanceof RenderError && e.line === 4 && e.component === 'chart' && /is not a number/.test(e.message) && /^```chart bar unit=ms/.test(e.example));
  assert.throws(() => renderDoc('## A\n```chart\nA | 1\n```\n', { theme: 'blueprint' }), (e) => e instanceof RenderError && e.line === 2 && /needs a type/.test(e.message));
  assert.throws(() => renderDoc('## A\n```chart radar\nA | 1\n```\n', { theme: 'blueprint' }), (e) => e instanceof RenderError && /unknown chart type/.test(e.message));
});

test('page: the diagram viewer opens a chart, because its svg is a direct child of an am-diagram', () => {
  const { html } = renderDoc(PAGE('```chart bar\nA | 1\n```'), { theme: 'blueprint' });
  assert.match(html, /<figure class="am-diagram am-chart"><svg /);
  assert.match(html, /class="am-lightbox"/);
});

test('video: a chart steps row by row, carries its styles, and has no data table', async () => {
  const draft = '---\ntitle: T\n---\n## A\n```chart bar horizontal unit=ms\n* Redis | 12\nMemcached | 9\nPostgres | 28\n```\n> Redis is fast.\n> Memcached is faster.\n> Postgres is slow.\n';
  const { html } = await renderVideo(draft);
  assert.deepEqual([...html.matchAll(/<g data-step="(\d)" class="am-ch-row/g)].map((m) => m[1]), ['0', '1', '2']);
  assert.match(html, /\.am-ch-s1 \{ fill: var\(--series-1, /);
  assert.doesNotMatch(html, /<details class="am-ch-data"/);
});
