// The page styles for math: Temml's local-font stylesheet with its small font inlined (the page needs no network), then our own rules (math.css).
// src/assets.js (development) and scripts/inline-assets.mjs (bundle) both call this, so the two cannot drift apart.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const need = createRequire(import.meta.url);
const file = (name) => need.resolve(`temml/dist/${name}`);

// An HTML sanitizer such as DOMPurify drops a whole <style> element whose text holds "<" followed by a letter (#452). Temml's stylesheet
// has two: its comments (one names <menclose>), which are dropped, and the inline SVG data URIs of its arrows, whose < and > are
// percent-encoded (a data URI decodes %3C and %3E to the same SVG).
const sanitizerSafe = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/data:image\/svg\+xml,[^"]*/g, (uri) => uri.replace(/</g, '%3C').replace(/>/g, '%3E'));

// own: the text of math.css.
export function composeMathCss(own) {
  const font = readFileSync(file('Temml.woff2')).toString('base64');
  const temml = readFileSync(file('Temml-Local.css'), 'utf8').replace(/\r\n?/g, '\n').replace("url('Temml.woff2')", `url('data:font/woff2;base64,${font}')`);
  return `${sanitizerSafe(temml)}\n${own}`;
}
