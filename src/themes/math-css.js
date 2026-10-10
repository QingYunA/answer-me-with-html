// The page styles for math: Temml's local-font stylesheet with its small font inlined (the page needs no network), then our own rules (math.css).
// src/assets.js (development) and scripts/inline-assets.mjs (bundle) both call this, so the two cannot drift apart.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const need = createRequire(import.meta.url);
const file = (name) => need.resolve(`temml/dist/${name}`);

// own: the text of math.css.
export function composeMathCss(own) {
  const font = readFileSync(file('Temml.woff2')).toString('base64');
  const temml = readFileSync(file('Temml-Local.css'), 'utf8').replace(/\r\n?/g, '\n').replace("url('Temml.woff2')", `url('data:font/woff2;base64,${font}')`);
  return `${temml}\n${own}`;
}
