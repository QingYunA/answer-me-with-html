// The line chart (spec #264, slice 2): parsing and limits, the axis, value labels, the highlight, thinned category labels, right-to-left
// mirroring, the data table and the video steps. The parts shared with bar are in chart.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseChart, parseOptions } from '../src/components/chart.js';
import { measure } from '../src/svg/text.js';
import { lineRange, niceRange } from '../src/components/chart-scale.js';
import { CHART_CSS } from '../src/assets.js';
import { renderDoc, RenderError } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';

const chart = COMPONENTS.get('chart');
const render = (text, args = 'line', extra = {}) => chart.render(text, { args, uid: () => 'u1', ...extra });
const throwsAt = (fn, line, pattern) => assert.throws(fn, (e) => e instanceof ComponentError && e.line === line && (!pattern || pattern.test(e.message)), `line ${line} ${pattern ?? ''}`);
const num = Number;
// The dots in document order: { x, y, r, cls }.
const dots = (html) => [...html.matchAll(/<circle class="am-ch-dot (am-ch-s\d)" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map((m) => ({ cls: m[1], x: num(m[2]), y: num(m[3]), r: num(m[4]) }));
const segments = (html) => [...html.matchAll(/<path class="am-ch-line (am-ch-s\d)" d="M([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)"/g)].map((m) => ({ cls: m[1], x0: num(m[2]), y0: num(m[3]), x1: num(m[4]), y1: num(m[5]) }));
const texts = (html, cls) => [...html.matchAll(new RegExp(`<text class="${cls}(?: am-ch-s\\d)?"([^>]*)>([^<]*)</text>`, 'g'))].map((m) => m[2]);
const guides = (html) => [...html.matchAll(/<line class="am-ch-guide" x1="([\d.-]+)"/g)].map((m) => num(m[1]));
const zeroY = (html) => num(html.match(/<line class="am-ch-zero" x1="[\d.]+" y1="([\d.]+)"/)[1]);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

const THREE = '       | p50 | p95 | p99\nMon    | 12  | 40  | 80\nTue    | 18  | 44  | 85\n* Wed  | 9   | 38  | 70\nThu    | 22  | 41  | 42';
const rows = (n, label = 'R') => Array.from({ length: n }, (_, i) => `${label}${i + 1} | ${(i * 7) % 23}`).join('\n');

// ── parsing ──
test('chart line: the type is accepted, and horizontal is a bar option only', () => {
  assert.deepEqual(parseOptions('line'), { type: 'line', horizontal: false, unit: '' });
  assert.deepEqual(parseOptions('line unit=ms'), { type: 'line', horizontal: false, unit: 'ms' });
  throwsAt(() => parseOptions('line horizontal'), 0, /chart line has no "horizontal" option/);
  assert.match(render('A | 1\nB | 2'), /^<figure class="am-diagram am-chart"><svg /);
});

test('chart line: 1 to 6 series, and up to 60 rows', () => {
  const row = (label, n) => `${label} | ${Array.from({ length: n }, (_, i) => i + 1).join(' | ')}`;
  const head = (n) => `| ${Array.from({ length: n }, (_, i) => `s${i + 1}`).join(' | ')}`;
  assert.equal(render(`${head(6)}\n${row('A', 6)}\n${row('B', 6)}`).match(/class="am-ch-dot /g).length, 12);
  throwsAt(() => render(`${head(7)}\n${row('A', 7)}`), 1, /up to 6 series, not 7/);
  assert.equal(parseChart(rows(60), 'line').rows.length, 60);
  throwsAt(() => parseChart(rows(61), 'line'), 61, /up to 60 rows; this is row 61/);
  throwsAt(() => parseChart(`| v\n${rows(61)}`, 'line'), 62, /up to 60 rows/);
  // The 24 rows of a bar chart do not limit a line.
  throwsAt(() => parseChart(rows(25), 'bar'), 25, /up to 24 rows/);
});

test('chart line: more than one number per row needs the series names, like bar', () => {
  throwsAt(() => render('Mon | 12 | 40'), 1, /a row with 2 numbers needs a first line that names the series/);
  throwsAt(() => render('| p50 | p95\nMon | 12 | x'), 2, /"x" is not a number/);
  throwsAt(() => render('| p50 | p95\nMon | 12'), 2, /chart row has 1 value, expected 2/);
});

// ── drawing ──
test('chart line: a dot on every point and a segment between the points of a series, in a group for each row', () => {
  const html = render(THREE);
  assert.equal(dots(html).length, 12);
  assert.equal(segments(html).length, 9, '3 series, 3 gaps');
  assert.equal((html.match(/<g data-step="\d" class="am-ch-row/g) || []).length, 4);
  assert.deepEqual(new Set(dots(html).map((d) => d.cls)), new Set(['am-ch-s1', 'am-ch-s2', 'am-ch-s3']));
  assert.doesNotMatch(html, /<script|foreignObject|<style|href=/);
});

test('chart line: heights follow the values from a zero line at the bottom, and the first row is on the left', () => {
  const html = render('A | 10\nB | 20\nC | 40');
  const [a, b, c] = dots(html);
  const zero = zeroY(html);
  assert.ok(Math.abs((zero - b.y) - 2 * (zero - a.y)) < 0.5 && Math.abs((zero - c.y) - 4 * (zero - a.y)) < 0.5, `${a.y} ${b.y} ${c.y}`);
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(Math.abs(b.x - a.x - (c.x - b.x)) < 0.01, 'the points are one slot apart');
});

test('chart line: a segment runs from the edge of one dot to the edge of the next, in the series color', () => {
  const html = render('| a | b\nA | 10 | 5\nB | 20 | 8');
  const [d, s] = [dots(html), segments(html)];
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.cls), ['am-ch-s1', 'am-ch-s2']);
  assert.ok(s[0].x0 > d[0].x && s[0].x1 < d[2].x, 'the line starts after the first dot and ends before the second');
  assert.ok(s[0].y1 < s[0].y0, 'it rises with the values');
});

test('lineRange: a line axis covers the data and may start above 0, unlike a bar', () => {
  const large = lineRange([1000, 1010, 1160]);
  assert.deepEqual({ min: large.min, max: large.max }, { min: 1000, max: 1175 }, 'values that are all large do not start at 0');
  assert.ok(large.ticks.every((t) => t >= 1000 && t <= 1175) && large.ticks.length <= 8);
  assert.equal(niceRange([1000, 1160]).min, 0, 'a bar axis still starts at 0');
  const lo = lineRange([950, 1010]);
  assert.deepEqual({ min: lo.min, max: lo.max }, { min: 950, max: 1010 });
  assert.deepEqual(lineRange([0.8, 1.2]).ticks, [0.8, 0.9, 1, 1.1, 1.2]);
});

test('lineRange: the axis includes 0 when the smallest value is at most a third of the largest, and when values reach or cross 0', () => {
  assert.deepEqual(lineRange([7, 22, 9]), niceRange([7, 22, 9]), '7 is under a third of 22');
  assert.equal(lineRange([10, 30]).min, 0, 'exactly a third');
  assert.ok(lineRange([10.5, 30]).min > 0, 'just over a third');
  assert.deepEqual(lineRange([-3, 5]), niceRange([-3, 5]), 'crossing zero');
  assert.deepEqual(lineRange([-20, -5]), niceRange([-20, -5]), 'all negative');
  assert.deepEqual(lineRange([0, 5]), niceRange([0, 5]));
  assert.deepEqual(lineRange([5, 5]), niceRange([5, 5]), 'a flat line');
  assert.throws(() => lineRange([1, Infinity]), RangeError);
});

test('lineRange: the ticks are nice, one step apart, and end at or beyond the data', () => {
  for (const values of [[1000, 1160], [950, 1010], [2500, 2600], [3, 4, 5], [123456789012, 123456789999], [4.5, 9.7], [11, 15]]) {
    const r = lineRange(values);
    assert.ok(r.min <= Math.min(...values) && r.max >= Math.max(...values), JSON.stringify(values));
    assert.ok(r.max - Math.max(...values) < r.step && Math.min(...values) - r.min < r.step, 'less than a step of room');
    assert.ok(r.ticks.length >= 2 && r.ticks.length <= 8);
    assert.ok(r.ticks.every((t, i) => i === 0 || Math.abs(t - r.ticks[i - 1] - r.step) < r.step * 1e-6));
    assert.equal(r.ticks[0], r.min);
    assert.equal(r.ticks.at(-1), r.max);
  }
  assert.ok(lineRange([3, 4, 5]).ticks.every(Number.isInteger), 'whole numbers get whole ticks');
});

test('chart line: values that are all large do not start the axis at 0, and values that rise from the floor do', () => {
  const large = render('Jan | 1000\nFeb | 1010\nMar | 1160');
  assert.equal(texts(large, 'am-ch-tick')[0], '1000');
  assert.doesNotMatch(large, /class="am-ch-zero"/, 'no zero line when 0 is not on the axis');
  const [a, b, c] = dots(large);
  assert.ok(a.y > b.y && b.y > c.y && a.y - c.y > 150, 'the line uses the height of the plot');
  const small = render('A | 7\nB | 22\nC | 9');
  assert.equal(texts(small, 'am-ch-tick')[0], '0');
  assert.match(small, /class="am-ch-zero"/);
  assert.equal(texts(render('A | 12\nB | -8'), 'am-ch-tick')[0], '-10');
  // A bar chart of the same numbers still starts at 0.
  assert.equal(texts(render('A | 1000\nB | 1160', 'bar'), 'am-ch-tick')[0], '0');
});

test('chart line: a negative value is drawn below the zero line, with ticks below it', () => {
  const html = render('A | 12\nB | -8\nC | 0');
  const [a, b, c] = dots(html);
  const zero = zeroY(html);
  assert.ok(a.y < zero && b.y > zero, 'a positive point is above the zero line and a negative one below it');
  assert.ok(Math.abs(c.y - zero) < 0.01);
  assert.ok(texts(html, 'am-ch-tick').some((t) => t.startsWith('-')));
  assert.equal((html.match(/class="am-ch-zero"/g) || []).length, 1);
});

test('chart line: unit is added to the ticks, the value labels and the table', () => {
  const html = render('A | 12\nB | -8', 'line unit=ms');
  assert.ok(texts(html, 'am-ch-tick').every((t) => t.endsWith('ms')));
  assert.deepEqual(texts(html, 'am-ch-val'), ['12ms', '-8ms']);
  assert.match(html, /<td dir="ltr">12ms<\/td>/);
});

test('chart line: a legend only when there is more than one series, and the swatches match the lines', () => {
  assert.deepEqual(texts(render(THREE), 'am-ch-leg'), ['p50', 'p95', 'p99']);
  assert.deepEqual([...render(THREE).matchAll(/class="am-ch-sw (am-ch-s\d)"/g)].map((m) => m[1]), ['am-ch-s1', 'am-ch-s2', 'am-ch-s3']);
  assert.doesNotMatch(render('| only\nA | 1\nB | 2'), /am-ch-sw/);
  assert.doesNotMatch(render('A | 1\nB | 2'), /am-ch-sw/);
});

// ── value labels ──
test('chart line: with one series and up to 12 points every point carries its value', () => {
  assert.equal(texts(render(rows(12)), 'am-ch-val').length, 12);
  assert.equal(texts(render(rows(13)), 'am-ch-val').length, 0);
  assert.equal(texts(render(rows(60)), 'am-ch-val').length, 0);
});

test('chart line: with several series only the highlighted row carries values', () => {
  assert.equal(texts(render(THREE), 'am-ch-val').length, 3, 'the three points of Wed');
  assert.equal(texts(render('| a | b\nA | 1 | 2\nB | 3 | 4'), 'am-ch-val').length, 0, 'no highlight, no labels');
  const many = `${rows(30)}\n* Last | 5`;
  assert.deepEqual(texts(render(many), 'am-ch-val'), ['5'], 'one series with many points: the highlighted row only');
});

test('chart line: with several series the labels of the highlighted row form a column beside the guide, in series colors, none touching', () => {
  const html = render('| a | b | c | d\n* X | 10 | 11 | 12 | 30\nY | 1 | 2 | 3 | 4\nZ | 2 | 2 | 2 | 2');
  const labels = [...html.matchAll(/<text class="am-ch-val (am-ch-s\d)" x="([\d.-]+)" y="([\d.-]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ cls: m[1], x: num(m[2]), y: num(m[3]), anchor: m[4], t: m[5] }));
  assert.equal(labels.length, 4);
  assert.deepEqual(new Set(labels.map((l) => l.cls)), new Set(['am-ch-s1', 'am-ch-s2', 'am-ch-s3', 'am-ch-s4']), 'each label has the class of its series');
  assert.deepEqual(labels.map((l) => l.t).sort(), ['10', '11', '12', '30']);
  assert.equal(new Set(labels.map((l) => l.x)).size, 1, 'one column');
  const [guide] = guides(html);
  assert.ok(labels.every((l) => l.x > guide && l.anchor === 'start'), 'on the inline-end side of the guide');
  const ys = labels.map((l) => l.y).sort((p, q) => p - q);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 13 - 0.11, `labels ${ys.join(' ')}`);
  // Where the dots are far apart, each label stays at the height of its dot.
  const far = render('| a | b\n* X | 10 | 90\nY | 1 | 2');
  const [dotA, dotB] = dots(far);
  const farLabels = [...far.matchAll(/<text class="am-ch-val (am-ch-s\d)" x="[\d.-]+" y="([\d.-]+)"/g)].map((m) => ({ cls: m[1], y: num(m[2]) }));
  assert.ok(Math.abs(farLabels.find((l) => l.cls === 'am-ch-s1').y - dotA.y) < 0.2 && Math.abs(farLabels.find((l) => l.cls === 'am-ch-s2').y - dotB.y) < 0.2);
});

test('chart line: the labels of dots that are close are ordered like the dots, and pushed up when the column reaches the bottom of the plot', () => {
  const html = render('| a | b | c\n* X | 0 | 0 | 0\nY | 1 | 1 | 1');
  const ys = [...html.matchAll(/<text class="am-ch-val am-ch-s\d" x="[\d.-]+" y="([\d.-]+)"/g)].map((m) => num(m[1]));
  assert.equal(ys.length, 3);
  const sorted = [...ys].sort((p, q) => p - q);
  for (let i = 1; i < 3; i++) assert.ok(sorted[i] - sorted[i - 1] >= 12.9);
  const zero = num(html.match(/<line class="am-ch-zero" x1="[\d.]+" y1="([\d.]+)"/)[1]);
  assert.ok(sorted.at(-1) <= zero + 0.1, 'the lowest label does not go below the plot');
});

test('chart line: near the end of the plot the column goes to the inline-start side of the guide, in both directions', () => {
  const body = '| a | b\nA | 1 | 5\nB | 2 | 6\nC | 3 | 7\nD | 4 | 8\n* E | 5 | 9';
  const ltr = render(body, 'line', { dir: 'ltr' });
  const [guide] = guides(ltr);
  const anchors = [...ltr.matchAll(/<text class="am-ch-val am-ch-s\d" x="([\d.-]+)"[^>]*text-anchor="(\w+)"/g)].map((m) => ({ x: num(m[1]), a: m[2] }));
  assert.ok(anchors.every((l) => l.x < guide && l.a === 'end'));
  const rtl = render(body, 'line', { dir: 'rtl' });
  const [rguide] = guides(rtl);
  const ranchors = [...rtl.matchAll(/<text class="am-ch-val am-ch-s\d" x="([\d.-]+)"[^>]*text-anchor="(\w+)"/g)].map((m) => ({ x: num(m[1]), a: m[2] }));
  assert.ok(ranchors.every((l) => l.x > rguide && l.a === 'end'), 'mirrored: the column is on the right of the guide, which is on the left');
  // In the middle of the plot the column is on the inline-end side: to the left of the guide in a right-to-left page.
  const mid = render('| a | b\nA | 1 | 5\n* B | 2 | 6\nC | 3 | 7\nD | 4 | 8\nE | 5 | 9', 'line', { dir: 'rtl' });
  assert.ok([...mid.matchAll(/<text class="am-ch-val am-ch-s\d" x="([\d.-]+)"/g)].every((m) => num(m[1]) < guides(mid)[0]));
});

test('chart line: the labels of the column stay inside the drawing', () => {
  for (const dir of ['ltr', 'rtl']) {
    for (const hi of [0, 4, 9]) {
      const body = Array.from({ length: 10 }, (_, i) => `${i === hi ? '* ' : ''}R${i} | ${i * 100} | ${i * 90 + 5}`).join('\n');
      const html = render(`| a | b\n${body}`, 'line unit=ms', { dir });
      const w = num(html.match(/viewBox="0 0 (\d+)/)[1]);
      const found = [...html.matchAll(/<text class="am-ch-val am-ch-s\d" x="([\d.-]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)];
      assert.equal(found.length, 2);
      for (const m of found) {
        const width = measure(m[3].replaceAll(LRI, '').replaceAll(PDI, ''), 11, { bold: true });
        const [x, anchor] = [num(m[1]), m[2]];
        // In a right-to-left drawing "start" is the right end of the text.
        const [from, to] = (anchor === 'start') === (dir === 'ltr') ? [x, x + width] : [x - width, x];
        assert.ok(from >= 0 && to <= w + 0.5, `${dir} row ${hi}: ${m[3]} spans ${from}-${to} in ${w}`);
      }
    }
  }
});

// ── highlight ──
test('chart line: * makes the points of the row larger, adds a guide line at its x and keeps every line in its series color', () => {
  const html = render(THREE);
  const all = dots(html);
  const [wed, others] = [all.slice(6, 9), all.filter((_, i) => i < 6 || i > 8)];
  assert.ok(wed.every((d) => d.r > 5), 'larger dots on the highlighted row');
  assert.ok(others.every((d) => d.r < 4));
  assert.deepEqual(guides(html), [wed[0].x], 'one guide, at the x of the row');
  assert.match(CHART_CSS, /\.am-ch-guide \{ stroke: var\(--ink-3, #8b929e\); stroke-width: 1; stroke-dasharray: 3 3; \}/, 'a 1px dashed guide in --ink-3');
  assert.match(html, /<g data-step="2" class="am-ch-row is-hi">/);
  assert.doesNotMatch(html, /is-dim/, 'a line chart never grays a row');
  assert.deepEqual(new Set(all.map((d) => d.cls)), new Set(['am-ch-s1', 'am-ch-s2', 'am-ch-s3']), 'no accent color, even with one series');
  assert.deepEqual(dots(render('* A | 5\nB | 4')).map((d) => d.cls), ['am-ch-s1', 'am-ch-s1']);
  assert.deepEqual(guides(render('A | 1\nB | 2')), []);
  assert.equal(guides(render('* A | 1\nB | 2\n* C | 3')).length, 2, 'every highlighted row has a guide');
});

// ── category labels ──
test('chart line: a few points show every label, flat', () => {
  const html = render('Mon | 1\nTue | 2\nWed | 3');
  assert.deepEqual(texts(html, 'am-ch-cat'), ['Mon', 'Tue', 'Wed']);
  assert.doesNotMatch(html, /rotate\(/);
});

test('chart line: many points thin the labels to every nth one, which do not overlap, before they slant', () => {
  const body = Array.from({ length: 40 }, (_, i) => `Week ${i + 1} | ${i}`).join('\n');
  const html = render(body);
  const groups = [...html.matchAll(/<g data-step="(\d+)" class="am-ch-row">([\s\S]*?)<\/g>/g)].filter((m) => m[2].includes('am-ch-cat'));
  const steps = groups.map((m) => num(m[1]));
  assert.ok(steps.length >= 8 && steps.length < 40, `${steps.length} labelled rows`);
  assert.doesNotMatch(html, /rotate\(/);
  assert.equal(steps[0], 0);
  assert.ok(steps.every((n, k) => k === 0 || n - steps[k - 1] === steps[1] - steps[0]), 'every nth row');
  // The centres of neighbouring labels are further apart than the widest line of a label.
  const xs = groups.map((m) => num(m[2].match(/<text class="am-ch-cat" x="([\d.-]+)"/)[1]));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= measure('Week', 12), `${xs[i - 1]} ${xs[i]}`);
});

test('chart line: a highlighted row keeps its label when the labels are thinned, and the labels beside it make room', () => {
  const body = Array.from({ length: 40 }, (_, i) => `${i === 36 ? '* ' : ''}Week ${i + 1} | ${i}`).join('\n');
  const html = render(body);
  const group = (i) => html.match(new RegExp(`<g data-step="${i}" class="am-ch-row[^"]*">([\\s\\S]*?)</g>`))[1];
  assert.match(group(36), /am-ch-cat/, 'the highlighted row has its label');
  assert.doesNotMatch(group(35), /am-ch-cat/);
  assert.doesNotMatch(group(37), /am-ch-cat/);
});

test('chart line: labels too long to fit flat are slanted and cut, and a very long one gets a tooltip', () => {
  const long = 'A rather long category name that goes on '.repeat(3);
  const html = render(`${long} one | 1\n${long} two | 2\n${long} three | 3`);
  assert.equal((html.match(/transform="rotate\(-40 /g) || []).length, 3);
  assert.match(html, /…<\/text>/);
  assert.match(html, /<title>A rather long category name/);
});

test('chart line: nothing leaves the drawing: labels, dots and the last value label stay inside it', () => {
  const body = Array.from({ length: 60 }, (_, i) => `${i === 59 ? '* ' : ''}A longer label number ${i + 1} | ${(i * 37) % 1000}`).join('\n');
  for (const dir of ['ltr', 'rtl']) {
    const html = render(body, 'line unit=ms', { dir });
    const w = num(html.match(/viewBox="0 0 (\d+)/)[1]);
    for (const d of dots(html)) assert.ok(d.x - d.r >= 0 && d.x + d.r <= w, `${dir}: dot at ${d.x} in ${w}`);
    for (const m of html.matchAll(/<text class="am-ch-(?:val|cat)" x="([\d.-]+)"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)) {
      const half = measure(m[2].replaceAll(LRI, '').replaceAll(PDI, ''), 12) / 2;
      assert.ok(num(m[1]) - half >= 0 && num(m[1]) + half <= w + 0.5, `${dir}: "${m[2]}" at ${m[1]} in ${w}`);
    }
  }
});

// ── right-to-left ──
test('chart line, rtl: the first row is on the right, only the positions mirror, and numbers stay left to right', () => {
  const ltr = render(THREE, 'line unit=%', { dir: 'ltr' });
  const rtl = render(THREE, 'line unit=%', { dir: 'rtl' });
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  assert.doesNotMatch(ltr, /direction=/);
  const [l, r] = [dots(ltr), dots(rtl)];
  assert.ok(l[0].x < l[9].x && r[0].x > r[9].x, 'the category axis starts from the right');
  assert.deepEqual(r.map((d) => d.y), l.map((d) => d.y));
  const w = num(ltr.match(/viewBox="0 0 (\d+)/)[1]);
  assert.ok(Math.abs(l[0].x + r[0].x - w) < 0.2, 'x is the mirror image');
  assert.deepEqual(guides(rtl), [num((w - guides(ltr)[0]).toFixed(1))]);
  const numbers = [...texts(rtl, 'am-ch-val'), ...texts(rtl, 'am-ch-tick')];
  assert.ok(numbers.length > 8 && numbers.every((t) => t.startsWith(LRI) && t.endsWith(PDI)));
  const s = segments(rtl);
  assert.ok(s[0].x1 < s[0].x0, 'a segment runs from the right to the left');
  assert.deepEqual(texts(ltr, 'am-ch-val'), ['70%', '38%', '9%'], 'the highest dot has the top label');
});

test('chart line, rtl: a negative value keeps its sign on the left', () => {
  const html = render('A | 12\n* B | -8', 'line unit=%', { dir: 'rtl' });
  assert.ok(texts(html, 'am-ch-val').includes(`${LRI}-8%${PDI}`));
});

test('chart line: a page in Hebrew gets a mirrored line chart', () => {
  const { html } = renderDoc('---\nlang: he\n---\n## A\n```chart line\nא | 1\nב | 2\n```\n', { theme: 'blueprint' });
  assert.match(html, /<svg [^>]*direction="rtl"/);
  assert.match(html, /<summary>נתונים<\/summary>/);
  assert.match(html, /aria-label="תרשים: א, ב"/);
});

// ── the data table, pages and videos ──
test('chart line: the data table is the same as the bar chart one', () => {
  const html = render(THREE, 'line unit=ms');
  assert.match(html, /<details class="am-ch-data"><summary>Data<\/summary>/);
  assert.match(html, /<th scope="col">p50<\/th><th scope="col">p95<\/th><th scope="col">p99<\/th>/);
  assert.match(html, /<tr><th scope="row">Mon<\/th><td dir="ltr">12ms<\/td><td dir="ltr">40ms<\/td><td dir="ltr">80ms<\/td><\/tr>/);
  assert.doesNotMatch(html, /am-ch-data--pie/);
});

test('page: a line chart brings the chart styles and its errors name the line', () => {
  const ok = renderDoc('## A\n```chart line\nA | 1\nB | 2\n```\n', { theme: 'blueprint' }).html;
  assert.match(ok, /\.am-ch-line\.am-ch-s1 \{ stroke: var\(--series-1, /);
  assert.throws(() => renderDoc('## A\n```chart line\nA | 1\nB | x\n```\n', { theme: 'blueprint' }), (e) => e instanceof RenderError && e.line === 4 && /is not a number/.test(e.message));
});

test('video: a line chart grows row by row, each row a step with its points and the segments that lead to them', async () => {
  const draft = '---\ntitle: T\n---\n## A\n```chart line unit=ms\n| a | b\nMon | 12 | 3\nTue | 9 | 4\n* Wed | 28 | 5\n```\n> Monday.\n> Tuesday.\n> Wednesday.\n';
  const { html } = await renderVideo(draft);
  const groups = [...html.matchAll(/<g data-step="(\d)" class="am-ch-row[^"]*">([\s\S]*?)<\/g>/g)].map((m) => ({ step: m[1], dots: (m[2].match(/<circle/g) || []).length, lines: (m[2].match(/<path class="am-ch-line/g) || []).length }));
  assert.deepEqual(groups, [{ step: '0', dots: 2, lines: 0 }, { step: '1', dots: 2, lines: 2 }, { step: '2', dots: 2, lines: 2 }]);
  assert.match(html, /\.am-ch-line\.am-ch-s1 \{/);
  assert.doesNotMatch(html, /<details class="am-ch-data"/);
});
