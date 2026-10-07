#!/usr/bin/env node
// Counts the tokens of every file in bench/corpus, and of the SVG, CSS and text inside the HTML pages,
// with the model's own tokenizer, and saves them to bench/corpus/tokens.json. Needs Claude Code and no API key:
// each file is sent once inside a prompt, and its count is the prompt's input tokens minus the input tokens
// of the same prompt with no file.
// Usage: node bench/count-tokens.mjs [model]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = process.argv[2] || 'sonnet';
const DIR = fileURLToPath(new URL('corpus', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'bench-tokens-'));

// Total input tokens the main model read for one prompt.
function inputTokens(body) {
  const prompt = `Reply with only the word ok.\n<file>\n${body}\n</file>`;
  const r = spawnSync('claude', ['-p', '--model', MODEL, '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config', '--', prompt], {
    cwd: work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const events = JSON.parse(r.stdout);
  const result = (Array.isArray(events) ? events : [events]).find((e) => e.type === 'result');
  if (!result || result.is_error) throw new Error(`claude -p failed: ${(result?.result || r.stderr || '').slice(0, 300)}`);
  // The model with the most input is the main model; small helper calls are ignored.
  const totals = Object.values(result.modelUsage).map((m) => m.inputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens);
  return Math.max(...totals);
}

// The SVG, CSS and visible text of one hand-written page; tags are what is left.
function parts(html) {
  const svg = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
  const rest = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
  const css = rest.match(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g) || [];
  const text = rest.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { svg: svg.join('\n'), css: css.join('\n'), text };
}

const base = inputTokens('');
const again = inputTokens('');
if (base !== again) throw new Error(`The empty prompt read ${base} and then ${again} tokens; counts would not be exact.`);

const tokens = {};
for (const f of readdirSync(DIR).filter((f) => /\.(html|md)$/.test(f)).sort()) {
  tokens[f] = inputTokens(readFileSync(join(DIR, f), 'utf8')) - base;
  console.log(f, tokens[f]);
}
// Each part is counted once over all pages joined together.
const pages = Object.keys(tokens).filter((f) => f.endsWith('.html')).map((f) => parts(readFileSync(join(DIR, f), 'utf8')));
const html = {};
for (const key of ['svg', 'css', 'text']) {
  html[key] = inputTokens(pages.map((p) => p[key]).join('\n')) - base;
  console.log(key, html[key]);
}
writeFileSync(join(DIR, 'tokens.json'), `${JSON.stringify({ model: MODEL, date: new Date().toISOString().slice(0, 10), tokens, html }, null, 2)}\n`);
