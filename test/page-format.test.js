// Ownership rules from CONTRIBUTING.md that a source scan can check:
// - The page format lives in src/page.js; other modules read it back through readPage(), not with their own regex.
// - Server-side HTML escaping goes through esc() in src/svg/text.js.
// src/runtime/ is out of scope: its scripts run inside the page and cannot import these modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// A regex literal (a `/` where an expression starts) or a RegExp(...) call whose pattern names a page-format part.
const REGEX_START = String.raw`(?:(?:^|[=(,:[!&|?{};])\s*\/|RegExp\(\s*['"\x60])`;
const RULES = [
  {
    problem: 'parses the page format with its own regex; read it with readPage() from src/page.js',
    re: new RegExp(`${REGEX_START}[^\\n]*(?:<html\\b|am-source)`),
    owners: ['src/page.js'],
  },
  {
    // A hand-made escape chain must turn & into &amp; first; one escaped < (as in src/raw-html.js) is not a chain.
    problem: 'escapes HTML by hand; use esc() from src/svg/text.js',
    re: /['"`]&amp;['"`]/,
    owners: ['src/svg/text.js', 'src/page.js'],
  },
];

// Returns "file:line problem" for each line that breaks a rule. Whole-line comments are skipped.
function findViolations(file, source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    for (const rule of RULES) {
      if (!rule.owners.includes(file) && rule.re.test(line)) out.push(`${file}:${i + 1} ${rule.problem}`);
    }
  });
  return out;
}

const serverSources = () => readdirSync(join(ROOT, 'src'), { recursive: true })
  .map((f) => `src/${f.split('\\').join('/')}`)
  .filter((f) => f.endsWith('.js') && !f.startsWith('src/runtime/'));

test('page format: only src/page.js parses the page, and server code escapes HTML with esc()', () => {
  const found = serverSources().flatMap((f) => findViolations(f, readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(found, []);
});

test('page format: the scan catches a hand-made lang regex and a hand-made escape chain', () => {
  const source = [
    'const lang = /<html\\b[^>]*?\\slang="([^"]*)"/.exec(html)?.[1];',
    "const data = JSON.stringify(x).replace(/&/g, '&amp;').replace(/\"/g, '&quot;');",
    "const m = html.match(new RegExp('<html[^>]*data-am-theme'));",
    '// A comment may name <html lang> and #am-source.',
    "const help = 'Reads the source draft from the hidden #am-source in <html-file>.';",
  ].join('\n');
  assert.deepEqual(findViolations('src/serve.js', source).map((v) => v.split(' ')[0]), [
    'src/serve.js:1', 'src/serve.js:2', 'src/serve.js:3',
  ]);
  assert.deepEqual(findViolations('src/page.js', source.split('\n')[0]), []);
});
