// Type scale (#302): one module holds every text size. Page CSS reads the --am-fs-* / --am-ln-* variables (scaled by --am-scale,
// 1 until a later PR sets it); drawing text keeps its viewBox units in --am-fs-d-*, because Node measures the diagram there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE, SIZES, DRAWING, LINES, typeScaleCss } from '../src/themes/type-scale.js';
import { themes } from '../src/themes/registry.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// The page stylesheets the scale covers. video.css is a fixed 1920x1080 stage and never takes the factor.
const PAGE_CSS_FILES = ['base.css', 'chart.css', 'update.css', 'delta.css', 'rtl.css', 'diff.css', 'math.css', 'close-after-reply.css'];
const pageCss = () => PAGE_CSS_FILES.map((file) => [file, read(`src/themes/${file}`)]);
const themeCss = () => themes('page').filter((t) => t.css).map((t) => [t.name, t.css]);

// A declaration whose property is font or font-size and whose value holds a px size.
const pxFont = (css) => [...css.matchAll(/\b(font|font-size)\s*:\s*([^;{}]*)/g)]
  .filter(([, , value]) => /\b[\d.]+px\b/.test(value))
  .map(([decl]) => decl.trim());

test('type scale: the module is frozen and the page CSS has no literal px font size', () => {
  assert.ok(Object.isFrozen(SCALE) && Object.isFrozen(SIZES) && Object.isFrozen(DRAWING) && Object.isFrozen(LINES));
  for (const [name, css] of [...pageCss(), ...themeCss()]) assert.deepEqual(pxFont(css), [], name);
});

test('type scale: every variable a stylesheet reads is defined by typeScaleCss, and every role is used', () => {
  const defined = new Set([...typeScaleCss().matchAll(/--(am-fs-(?:d-)?[\w-]+|am-ln-[\w-]+)\s*:/g)].map((m) => m[1]));
  const css = [...pageCss(), ...themeCss()].map(([, text]) => text).join('\n');
  const used = new Set([...css.matchAll(/var\(--(am-fs-(?:d-)?[\w-]+|am-ln-[\w-]+)/g)].map((m) => m[1]));
  for (const name of used) assert.ok(defined.has(name), `--${name} is read but not defined`);

  const components = readdirSync(join(ROOT, 'src/components')).filter((f) => f.endsWith('.js'))
    .map((f) => read(`src/components/${f}`)).join('\n') + read('src/svg/text.js');
  const uses = (group, role, prefix) => used.has(`${prefix}${role}`) || components.includes(`${group}.${role}`);
  for (const role of Object.keys(SIZES)) assert.ok(uses('SIZES', role, 'am-fs-'), `SIZES.${role} is a dead role`);
  for (const role of Object.keys(DRAWING)) assert.ok(uses('DRAWING', role, 'am-fs-d-'), `DRAWING.${role} is a dead role`);
  for (const role of Object.keys(LINES)) assert.ok(uses('LINES', role, 'am-ln-'), `LINES.${role} is a dead role`);
});

test('type scale: components read the module, with no numeric font size left', () => {
  const files = readdirSync(join(ROOT, 'src/components')).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const src = read(`src/components/${file}`);
    assert.doesNotMatch(src, /\b\w*(?:FS|_SIZE)\s*=\s*\d/, `${file} has a numeric font-size constant`);
    assert.doesNotMatch(src, /font-size:\s*[\d.]+px/, `${file} has a literal px font size`);
  }
});

test('type scale: typeScaleCss scales page text and keeps the toolbar and lightbox header fixed', () => {
  const css = typeScaleCss();
  assert.match(css, /--am-fs-body: calc\(14px \* var\(--am-scale, 1\)\)/);
  assert.match(css, /\.am-toolbar, \.am-lightbox-header \{/);
  assert.match(css, /\.am-toolbar, \.am-lightbox-header \{[^}]*--am-fs-body: 14px;/);
  assert.match(css, /--am-fs-d-node: 13px;/);
  assert.match(css, /--am-ln-segLine: calc\(16px \* var\(--am-scale, 1\)\)/);
});

test('type scale: a line height plus a fixed offset is a calc, not a scaled combined length', () => {
  // The timeline rule sits at the bottom of the time label (whenHeight) plus 7px; scaling 31px as a whole drifts at large scales.
  assert.equal('whenRule' in LINES, false);
  assert.match(read('src/themes/base.css'), /top: calc\(var\(--am-ln-whenHeight\) \+ 7px\)/);
  // Each annotation note row is the note line (segLine) plus 1px; 17px scaled as a whole would drift away from its line.
  assert.equal('annotRow' in LINES, false);
  assert.match(read('src/themes/base.css'), /var\(--rows, 0\) \* \(var\(--am-ln-segLine\) \+ 1px\)/);
  assert.doesNotMatch(typeScaleCss(), /--am-ln-(whenRule|annotRow):/);
});
