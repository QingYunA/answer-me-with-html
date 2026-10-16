// The pie chart (spec #264, slice 2): parsing and errors, percentages, the donut and its legend, the highlight, right-to-left mirroring,
// the share column of the data table and the video steps. The parts shared with bar are in chart.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseChart, parseOptions } from '../src/components/chart.js';
import { percent } from '../src/components/chart-scale.js';
import { renderDoc, RenderError } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { LANGUAGES } from '../src/languages/registry.js';
import { CHART_CSS } from '../src/assets.js';

const chart = COMPONENTS.get('chart');
const render = (text, args = 'pie', extra = {}) => chart.render(text, { args, uid: () => 'u1', ...extra });
const throwsAt = (fn, line, pattern) => assert.throws(fn, (e) => e instanceof ComponentError && e.line === line && (!pattern || pattern.test(e.message)), `line ${line} ${pattern ?? ''}`);
const texts = (html, cls) => [...html.matchAll(new RegExp(`<text class="${cls}"[^>]*>([^<]*)</text>`, 'g'))].map((m) => m[1]);
const slices = (html) => [...html.matchAll(/<path class="am-ch-slice (am-ch-s\d)" d="([^"]*)"/g)].map((m) => ({ cls: m[1], d: m[2] }));
const groups = (html) => [...html.matchAll(/<g data-step="(\d+)" class="(am-ch-row[^"]*)">([\s\S]*?)<\/g>/g)].map((m) => ({ step: m[1], cls: m[2], inner: m[3] }));
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
// The first point of a slice's path: where it starts on the outer circle.
const start = (d) => d.match(/^M([\d.-]+),([\d.-]+)/).slice(1).map(Number);
// Where the outer arc of a slice ends.
const outerEnd = (d) => d.match(/A96,96 0 0 [01] [\d.-]+,[\d.-]+ A96,96 0 0 [01] ([\d.-]+),([\d.-]+)/).slice(1).map(Number);
const num = Number;

const THREE = 'Redis | 12\nMemcached | 9\nPostgres | 28';
const SIX = Array.from({ length: 6 }, (_, i) => `S${i + 1} | ${i + 1}`).join('\n');

// ── parsing ──
test('chart pie: the type is accepted, and horizontal is not an option', () => {
  assert.deepEqual(parseOptions('pie unit=%'), { type: 'pie', horizontal: false, unit: '%' });
  throwsAt(() => parseOptions('pie horizontal'), 0, /chart pie has no "horizontal" option/);
  assert.match(render(THREE), /^<figure class="am-diagram am-chart"><svg /);
});

test('chart pie: one number on each row; more than one is an error that says so, with a correct row', () => {
  throwsAt(() => parseChart('Redis | 12 | 40\nMemcached | 9 | 31', 'pie'), 1, /chart pie takes one number per row, not 2; write a label and one number, like "Redis \| 12": "Redis \| 12 \| 40"/);
  throwsAt(() => parseChart('// data\n\nRedis | 12 | 40', 'pie'), 3, /takes one number per row/);
  throwsAt(() => render('| p50 | p95\nRedis | 12 | 40'), 1, /chart pie takes one number per row, not 2; name the one series on the first line, like "\| share": "\| p50 \| p95"/);
});

test('chart pie: a first line may name the series, with exactly one name', () => {
  const { series, rows } = parseChart('| share\nRedis | 12\nMemcached | 9', 'pie');
  assert.deepEqual(series, ['share']);
  assert.equal(rows.length, 2);
  assert.equal(render('| share\nA | 1\nB | 2').match(/<th scope="col">share<\/th>/).length, 1);
  assert.equal(parseChart('A | 1\nB | 2', 'pie').series, null);
  throwsAt(() => parseChart('| a | b\nA | 1', 'pie'), 1, /takes one number per row/);
  throwsAt(() => parseChart('| share\nA | 1 | 2', 'pie'), 2, /1 value|2 values, expected 1/);
});

test('chart pie: values are 0 or more and at least one is above 0, with the line of the error', () => {
  throwsAt(() => parseChart('A | 5\nB | -1', 'pie'), 2, /chart pie takes values of 0 or more, not -1: "B \| -1"; a slice cannot be negative, like "Redis \| 12"/);
  assert.equal(parseChart('A | 0\nB | 5', 'pie').rows.length, 2);
  throwsAt(() => parseChart('A | 0\nB | 0', 'pie'), 1, /at least one value above 0, like "Redis \| 12"/);
  throwsAt(() => parseChart('// c\n| share\n\nA | 0', 'pie'), 4, /at least one value above 0/);
  throwsAt(() => parseChart('A | 1\nB | x', 'pie'), 2, /is not a number/);
  // A bar or a line takes negative values.
  assert.equal(parseChart('A | -5', 'bar').rows[0].values[0], -5);
});

test('chart pie: up to 6 slices, one for each series color', () => {
  assert.equal(parseChart(SIX, 'pie').rows.length, 6);
  throwsAt(() => parseChart(`${SIX}\nS7 | 7`, 'pie'), 7, /chart pie takes up to 6 slices, one for each series color; this is slice 7/);
  throwsAt(() => parseChart(`| share\n${SIX}\nS7 | 7`, 'pie'), 8, /this is slice 7/);
});

// ── percentages ──
test('percent: whole numbers, one decimal when a slice would round to 0%, and <0.1% below that', () => {
  assert.equal(percent(12, 49), '24%');
  assert.equal(percent(9, 49), '18%');
  assert.equal(percent(28, 49), '57%');
  assert.equal(percent(1, 3), '33%');
  assert.equal(percent(5, 5), '100%');
  assert.equal(percent(0, 5), '0%');
  assert.equal(percent(3, 1000), '0.3%');
  assert.equal(percent(4, 1000), '0.4%');
  assert.equal(percent(1, 1000), '0.1%');
  assert.equal(percent(1, 10000), '<0.1%');
  assert.equal(percent(49, 10000), '0.5%');
  assert.equal(percent(0.4, 1000), '<0.1%');
  assert.equal(percent(5, 1000), '1%', '0.5% rounds up to a whole number');
  assert.equal(percent(1, 0), '0%');
});

test('chart pie: each slice shows its color, label, value with the unit and percentage; the total is in the middle', () => {
  const html = render('Redis | 12\nMemcached | 9\nPostgres | 28', 'pie unit=ms');
  assert.deepEqual(texts(html, 'am-ch-leg'), ['Redis', 'Memcached', 'Postgres']);
  assert.deepEqual(texts(html, 'am-ch-num'), ['12ms', '24%', '9ms', '18%', '28ms', '57%']);
  assert.deepEqual(texts(html, 'am-ch-total'), ['49ms']);
  assert.deepEqual([...html.matchAll(/class="am-ch-sw (am-ch-s\d)"/g)].map((m) => m[1]), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3']);
  assert.deepEqual(slices(html).map((s) => s.cls), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3']);
  assert.doesNotMatch(html, /<script|foreignObject|<style|href=/);
});

test('chart pie: small slices show one decimal, a zero slice has a legend row and no arc, and floats are tidied', () => {
  const html = render('Big | 1000\nSmall | 3\nTiny | 0.01\nZero | 0\nSum | 0.1');
  assert.deepEqual(texts(html, 'am-ch-num').filter((_, i) => i % 2 === 1), ['100%', '0.3%', '&lt;0.1%', '0%', '&lt;0.1%']);
  assert.equal(slices(html).length, 4, 'no arc for the zero slice');
  assert.equal(groups(html).length, 5, 'but a row of the legend and a step');
  assert.deepEqual(texts(render('A | 0.1\nB | 0.2'), 'am-ch-total'), ['0.3'], 'no 0.30000000000000004');
});

test('chart pie: six slices with long labels wrap to two lines and nothing leaves the drawing', () => {
  const html = render('Authentication service and gateway handshake for the whole network | 5\nB | 3\nC | 2\nD | 4\nE | 1\nF | 6');
  const w = num(html.match(/viewBox="0 0 (\d+)/)[1]);
  assert.ok(w <= 600, `${w} wide`);
  assert.match(html, /<title>Authentication service and gateway handshake for the whole network<\/title>/);
  assert.ok(texts(html, 'am-ch-leg').length >= 7, 'the first label takes two lines');
  const xs = [...html.matchAll(/<text class="am-ch-num" x="([\d.]+)"/g)].map((m) => num(m[1]));
  assert.ok(xs.every((x) => x <= w));
});

test('chart pie: with unit=% the values are the shares: no second percentage, no total in the middle', () => {
  const html = render('Chrome | 65\n* Safari | 18\nOther | 17', 'pie unit=%');
  assert.deepEqual(texts(html, 'am-ch-num'), ['65%', '18%', '17%'], 'the value only, once');
  assert.deepEqual(texts(html, 'am-ch-total'), []);
  assert.deepEqual(texts(html, 'am-ch-leg'), ['Chrome', 'Safari', 'Other']);
  assert.equal(slices(html).length, 3, 'the slices are drawn as before');
  assert.deepEqual(groups(html).map((g) => g.cls), ['am-ch-row is-dim', 'am-ch-row is-hi', 'am-ch-row is-dim']);
  assert.ok(num(html.match(/viewBox="0 0 (\d+)/)[1]) < num(render('Chrome | 65\n* Safari | 18\nOther | 17', 'pie unit=ms').match(/viewBox="0 0 (\d+)/)[1]), 'the legend is narrower without the share column');
  // The data table has the value column only.
  assert.match(html, /<thead><tr><td><\/td><th scope="col">Value<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><th scope="row">Chrome<\/th><td dir="ltr">65%<\/td><\/tr>/);
  assert.doesNotMatch(html, /Share|<td dir="ltr">\d+%<\/td><td/);
  assert.match(render('| share\nA | 60\nB | 40', 'pie unit=%'), /<th scope="col">share<\/th><\/tr>/);
  // Another unit, even one that contains a %, keeps the shares and the total.
  assert.deepEqual(texts(render('A | 1\nB | 3', 'pie unit=" %"'), 'am-ch-total'), ['4 %']);
  assert.deepEqual(texts(render('A | 1\nB | 3', 'pie unit=ms'), 'am-ch-num'), ['1ms', '25%', '3ms', '75%']);
});

test('chart pie, rtl: with unit=% the numbers are isolated and there is still no total', () => {
  const html = render('A | 60\nB | 40', 'pie unit=%', { dir: 'rtl' });
  assert.deepEqual(texts(html, 'am-ch-num'), [`${LRI}60%${PDI}`, `${LRI}40%${PDI}`]);
  assert.deepEqual(texts(html, 'am-ch-total'), []);
});

// ── the donut ──
test('chart pie: slices start at 12 o\'clock and go clockwise in the order written', () => {
  const html = render('A | 1\nB | 1\nC | 2');
  const [a, b, c] = slices(html);
  const [cx, top] = start(a.d);
  assert.ok(top < 20, 'the first slice starts at the top');
  // A is a quarter turn: it ends at 3 o'clock, where B starts, and B ends at 6 o'clock, where C starts.
  assert.deepEqual(outerEnd(a.d), start(b.d));
  assert.deepEqual(outerEnd(b.d), start(c.d));
  assert.ok(start(c.d)[0] - cx < 0.2 && start(c.d)[1] > start(a.d)[1] + 150, 'C starts at the bottom');
  assert.match(a.d, / A96,96 0 0 1 /, 'the outer arc sweeps clockwise');
  assert.match(a.d, / A60,60 0 0 0 /, 'the inner arc comes back');
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('chart pie: a single slice is a whole ring, not a slice with a seam', () => {
  const html = render('Only | 5');
  const [only] = slices(html);
  assert.equal((only.d.match(/ Z/g) || []).length, 2, 'an outer and an inner circle');
  assert.doesNotMatch(only.d, / L/);
  assert.deepEqual(texts(html, 'am-ch-num'), ['5', '100%']);
});

test('chart pie: the total shrinks to fit the hole, and a long unit goes on a line of its own', () => {
  const html = render('A | 1200000\nB | 3400000', 'pie unit=" requests"');
  assert.deepEqual(texts(html, 'am-ch-total'), ['4600000', 'requests']);
  assert.deepEqual(texts(render('A | 5', 'pie unit=ms'), 'am-ch-total'), ['5ms']);
});

// ── highlight ──
test('chart pie: * keeps the color of its slice and grays the others, legend swatches too', () => {
  const html = render('Chrome | 65\n* Safari | 18\nEdge | 5');
  assert.deepEqual(groups(html).map((g) => g.cls), ['am-ch-row is-dim', 'am-ch-row is-hi', 'am-ch-row is-dim']);
  assert.deepEqual(slices(html).map((s) => s.cls), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3'], 'the slice keeps its series class, not the accent');
  assert.doesNotMatch(html, /am-ch-hi/);
  assert.doesNotMatch(render(THREE), /is-dim|is-hi/);
  assert.match(texts(html, 'am-ch-leg').join(), /Safari/, 'the * is not part of the label');
  const rule = CHART_CSS.match(/\.am-ch-row\.is-dim \.am-ch-bar, \.am-ch-row\.is-dim \.am-ch-slice, \.am-ch-row\.is-dim \.am-ch-sw \{([^}]*)\}/)[1];
  assert.match(rule, /color-mix\(in oklch, var\(--ink-3, #8b929e\) 40%, var\(--paper, #ffffff\)\)/, 'the same gray as a muted bar');
});

// ── the data table ──
test('chart pie: the data table has a value column and a share column', () => {
  const html = render(THREE, 'pie unit=ms');
  assert.match(html, /<details class="am-ch-data am-ch-data--pie"><summary>Data<\/summary>/);
  assert.match(html, /<thead><tr><td><\/td><th scope="col">Value<\/th><th scope="col">Share<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><th scope="row">Redis<\/th><td dir="ltr">12ms<\/td><td dir="ltr">24%<\/td><\/tr>/);
  assert.match(html, /<tr><th scope="row">Postgres<\/th><td dir="ltr">28ms<\/td><td dir="ltr">57%<\/td><\/tr>/);
  assert.match(render('| time\nA | 1\nB | 3', 'pie'), /<th scope="col">time<\/th><th scope="col">Share<\/th>/, 'the series name heads the value column');
  assert.match(CHART_CSS, /\.am-ch-data--pie thead th::before \{ content: none; \}/);
});

test('chart pie: the share header comes from the page language', () => {
  for (const language of LANGUAGES) {
    const { share, value } = language.ui.chart;
    assert.ok(share && value, `${language.id} has both labels`);
    const html = render('A | 1\nB | 3', 'pie', { ui: language.ui });
    assert.match(html, new RegExp(`<th scope="col">${value}</th><th scope="col">${share}</th>`), language.id);
  }
  assert.equal(LANGUAGES.find((l) => l.id === 'zh').ui.chart.share, '占比'); // lang-ok: the label of the Chinese page
});

// ── right-to-left ──
test('chart pie, rtl: counterclockwise from 12 o\'clock, the donut on the right and the legend on its left, numbers left to right', () => {
  const ltr = render('A | 1\nB | 1\nC | 2', 'pie unit=ms', { dir: 'ltr' });
  const rtl = render('A | 1\nB | 1\nC | 2', 'pie unit=ms', { dir: 'rtl' });
  const w = num(ltr.match(/viewBox="0 0 (\d+)/)[1]);
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  const [l, r] = [slices(ltr), slices(rtl)];
  assert.ok(Math.abs(start(l[0].d)[0] + start(r[0].d)[0] - w) < 0.2, 'the first slice starts at the top, mirrored');
  assert.ok(start(l[1].d)[0] > start(l[0].d)[0] && start(r[1].d)[0] < start(r[0].d)[0], 'the second starts to the left of 12 o\'clock');
  assert.match(r[0].d, / A96,96 0 0 0 /, 'the outer arc sweeps the other way');
  const legendX = num(rtl.match(/<rect class="am-ch-sw am-ch-s1" x="([\d.]+)"/)[1]);
  assert.ok(legendX < start(r[0].d)[0], 'the legend is on the left of the donut');
  const ltrX = num(ltr.match(/<rect class="am-ch-sw am-ch-s1" x="([\d.]+)"/)[1]);
  assert.ok(ltrX > start(l[0].d)[0], 'and on the right of it in a left-to-right page');
  const numbers = [...texts(rtl, 'am-ch-num'), ...texts(rtl, 'am-ch-total')];
  assert.equal(numbers.length, 7);
  assert.ok(numbers.every((t) => t.startsWith(LRI) && t.endsWith(PDI)));
  assert.deepEqual(texts(ltr, 'am-ch-num'), ['1ms', '25%', '1ms', '25%', '2ms', '50%']);
});

test('chart pie: a page in Hebrew gets a mirrored donut and the Hebrew labels', () => {
  const { html } = renderDoc('---\nlang: he\n---\n## A\n```chart pie\nא | 1\nב | 2\n```\n', { theme: 'blueprint' });
  assert.match(html, /<svg [^>]*direction="rtl"/);
  assert.match(html, /<th scope="col">ערך<\/th><th scope="col">חלק<\/th>/);
  assert.match(html, /aria-label="תרשים: א, ב"/);
});

// ── pages and videos ──
test('page: a pie chart brings the chart styles, and its errors name the line', () => {
  const ok = renderDoc('## A\n```chart pie\nA | 1\nB | 2\n```\n', { theme: 'blueprint' }).html;
  assert.match(ok, /\.am-ch-slice \{ stroke-width: 2;/);
  assert.throws(() => renderDoc('## A\n```chart pie\nA | 1\nB | -2\n```\n', { theme: 'blueprint' }), (e) => e instanceof RenderError && e.line === 4 && e.component === 'chart' && /values of 0 or more/.test(e.message) && /^```chart bar unit=ms/.test(e.example));
});

test('video: a pie steps slice by slice, each with its legend row, carries its styles and has no data table', async () => {
  const draft = '---\ntitle: T\n---\n## A\n```chart pie unit=ms\nRedis | 12\n* Memcached | 9\nPostgres | 28\n```\n> Redis.\n> Memcached.\n> Postgres.\n';
  const { html } = await renderVideo(draft);
  const g = groups(html.slice(html.indexOf('am-chart')));
  assert.deepEqual(g.slice(0, 3).map((x) => [x.step, x.cls]), [['0', 'am-ch-row is-dim'], ['1', 'am-ch-row is-hi'], ['2', 'am-ch-row is-dim']]);
  assert.ok(g.slice(0, 3).every((x) => x.inner.includes('am-ch-slice') && x.inner.includes('am-ch-leg')));
  assert.match(html, /\.am-ch-slice \{/);
  assert.doesNotMatch(html, /<details class="am-ch-data"/);
});
