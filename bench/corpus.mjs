#!/usr/bin/env node
// Reports what the model writes in bench/corpus: hand-written HTML pages against the Markdown drafts
// the skill sent to the CLI for the same questions. It reads the token counts saved by count-tokens.mjs,
// so the numbers never change.
// Usage: node bench/corpus.mjs
import { readFileSync } from 'node:fs';

const { model, date, tokens, html } = JSON.parse(readFileSync(new URL('corpus/tokens.json', import.meta.url), 'utf8'));
const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
const of = (ext) => Object.entries(tokens).filter(([f]) => f.endsWith(ext)).map(([, n]) => n);
const pages = of('.html');
const drafts = of('.md');
const total = pages.reduce((n, x) => n + x, 0);
const share = (n) => `${Math.round((100 * n) / total)}%`;

console.log(`Token counts: ${model}, ${date}`);
console.log(`Hand-written HTML: ${pages.length} pages, ${Math.round(mean(pages))} tokens on average`);
console.log(`  SVG ${share(html.svg)} · CSS ${share(html.css)} · tags ${share(total - html.svg - html.css - html.text)} · text ${share(html.text)}`);
console.log(`Markdown drafts:   ${drafts.length} drafts, ${Math.round(mean(drafts))} tokens on average`);
console.log(`The model writes ${(mean(pages) / mean(drafts)).toFixed(1)}× fewer tokens with the skill`);
