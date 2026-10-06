// Language rule (issue #39): the repository speaks English; the product speaks the reader's language.
// This test fails on Chinese or Japanese text in the files listed in SCOPE, outside the ALLOWED spans
// (Markdown only) and the EXCEPTIONS (JavaScript only).
// Later tickets widen the rule by adding entries to SCOPE (and, if needed, to ALLOWED or EXCEPTIONS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const blank = (s) => s.replace(/[^\n]/g, ' ');

// Keeps the given { start, end } ranges of the text in place and blanks the rest.
// Line breaks stay, so line numbers still match the source.
function keepRanges(text, ranges) {
  let out = '';
  let at = 0;
  for (const { start, end } of ranges) {
    out += blank(text.slice(at, start)) + text.slice(start, end);
    at = end;
  }
  return out + blank(text.slice(at));
}

// One pass over JavaScript (or CSS) source. Returns the string and comment ranges, in order:
// { type: 'string' | 'comment', start, end, name }. A string range is the text between the quotes; a template
// literal gives one range per chunk between its interpolations. `name` marks the first string argument of a
// test / it / describe call. Regex literals and other code give no range.
function jsTokens(src) {
  const tokens = [];
  const stack = [{ tpl: false, depth: 0 }];
  let last = '';
  const isName = (i) => /\b(?:test|it|describe)(?:\.\w+)?\(\s*$/.test(src.slice(Math.max(0, i - 40), i));
  const end = (re, i) => { re.lastIndex = i; re.exec(src); return re.lastIndex || src.length; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top.tpl) {
      if (c === '\\') i++;
      else if (c === '`' || (c === '$' && src[i + 1] === '{')) {
        tokens.push({ type: 'string', start: top.chunk, end: i, name: top.name });
        if (c === '`') { stack.pop(); last = '`'; } else { stack.push({ tpl: false, depth: 0 }); i++; }
      }
      continue;
    }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const j = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
      const k = j === -1 ? src.length : src[i + 1] === '/' ? j : j + 2;
      tokens.push({ type: 'comment', start: i, end: k });
      i = k - 1;
      continue;
    }
    // A slash after an operator, an opening bracket or `return` / `typeof` starts a regex literal; otherwise it divides.
    if (c === '/' && (!last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof)\s*$/.test(src.slice(Math.max(0, i - 12), i)))) {
      i = end(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/y, i) - 1;
      last = ')';
      continue;
    }
    if (c === '"' || c === "'") {
      const k = end(c === '"' ? /"(?:\\.|[^"\\\n])*"/y : /'(?:\\.|[^'\\\n])*'/y, i);
      tokens.push({ type: 'string', start: i + 1, end: k - 1, name: isName(i) });
      i = k - 1;
      last = c;
      continue;
    }
    if (c === '`') { stack.push({ tpl: true, chunk: i + 1, name: isName(i) }); continue; }
    if (c === '{') top.depth++;
    if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); stack[stack.length - 1].chunk = i + 1; continue; }
      top.depth--;
    }
    if (!/\s/.test(c)) last = c;
  }
  return tokens;
}

// The tokens of JavaScript source that `keep` selects; everything else is blanked.
const jsText = (keep) => (src) => keepRanges(src, jsTokens(src).filter(keep));

// What part of a file the check reads. Every part keeps the line breaks, so lines map back to the source.
const PARTS = {
  whole: (text) => text,
  // JavaScript string and template-literal text: what the CLI prints.
  strings: jsText((t) => t.type === 'string'),
  // JavaScript and CSS comments.
  comments: jsText((t) => t.type === 'comment'),
  // Test files: test names and comments only; fixtures, expected output and other code are blanked.
  testText: jsText((t) => t.type === 'comment' || t.name),
  // The whole skill except its description: the description quotes Chinese trigger phrases users type.
  skill: (text) => text.replace(/^description:.*\n(?:[ \t]+.*\n)*/m, (m) => m.replace(/[^\n]/g, ' ')),
  // Writing-check warning text: the literal parts of every `message:` / `suggestion:` value.
  // Interpolations and "quoted" spans are dropped: they hold the flagged Chinese text, which is the subject.
  lintMessages: (text) =>
    keepRanges(
      text,
      [...text.matchAll(/\b(?:message|suggestion):\s*(`[^`]*`|'[^']*')/g)].flatMap((m) => {
        const start = m.index + m[0].length - m[1].length + 1;
        const inner = m[1].slice(1, -1);
        const ranges = [];
        let at = 0;
        for (const s of inner.matchAll(/\$\{[^}]*\}|"[^"]*"/g)) {
          ranges.push({ start: start + at, end: start + s.index });
          at = s.index + s[0].length;
        }
        return [...ranges, { start: start + at, end: start + inner.length }];
      }),
    ),
};

const commandFiles = () => readdirSync(join(ROOT, 'commands')).filter((f) => f.endsWith('.md')).map((f) => `commands/${f}`);

// Every file under a directory whose name matches `re`.
const filesIn = (dir, re) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .filter((f) => re.test(f))
    .map((f) => `${dir}/${f.replaceAll('\\', '/')}`); // repo-relative POSIX paths, so EXCEPTIONS match on Windows too
const JS = /\.m?js$/;
const JS_CSS = /\.(m?js|css)$/;

// The single scope list: every file that must be English, and which part of it is checked.
const SCOPE = [
  { files: () => ['package.json'], part: 'whole' },
  { files: () => ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'], part: 'whole' },
  { files: () => ['src', 'bin', 'scripts'].flatMap((d) => filesIn(d, JS)), part: 'strings' },
  { files: () => ['src/lint/ste.js'], part: 'lintMessages' },
  { files: () => ['skills/answer-me-with-html/SKILL.md'], part: 'skill' },
  { files: () => ['CONTRIBUTING.md', ...commandFiles()], part: 'whole' },
  {
    files: () => [...['src', 'bin', 'scripts'].flatMap((d) => filesIn(d, JS_CSS)), ...['bench', 'docs/demo'].flatMap((d) => filesIn(d, JS))],
    part: 'comments',
  },
  { files: () => readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`), part: 'testText' },
];

// Markdown spans where Chinese is the subject, not the medium. They are removed before the check.
const ALLOWED = [
  /^(```|~~~)[\s\S]*?^\1/gm, // fenced code blocks
  /`[^`\n]+`/g, // inline code spans
];

// JavaScript lines whose Chinese or Japanese is legitimate: input the code reads or text the page shows,
// not text the CLI prints. `lines` matches the exempt lines (every line of the file when omitted).
// A single line can instead end in `// lang-ok: <reason>`.
const EXCEPTIONS = [
  { dir: 'src/languages/', why: 'the page and player labels of each supported language' },
  { file: 'src/lint/wordlist.zh.js', why: 'the Chinese writing-check word list' },
  { file: 'src/lint/ste.js', lines: /^.*[`"]的[`"].*$/gm, why: 'names the Chinese particle the writing check counts' },
  { file: 'src/svg/text.js', lines: /^.*(?:`の`|`《ワンピース》`|`TCP の3ウェイ…`).*$/gm, why: 'examples for the Japanese detection' },
  { file: 'scripts/smoke-install.mjs', lines: /^.*input: '## A 标题.*$/gm, why: 'Chinese render input for the smoke test' },
  { file: 'test/config.test.js', lines: /^test\('setConfig: booleans accept .*$/gm, why: 'names the Chinese input aliases under test' },
  { file: 'test/lint.test.js', lines: /^test\('(?:Chinese light verbs:|Chinese chained|messages: chained) .*$/gm, why: 'names the Chinese text the writing check flags' },
];

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u; // Han, kana, CJK punctuation, fullwidth forms

// 0-based indexes of the lines of a JavaScript file that the check skips.
function skippedLines(src, file) {
  const lineOf = (offset) => src.slice(0, offset).split('\n').length - 1;
  const skipped = new Set();
  src.split('\n').forEach((line, i) => /\/\/ lang-ok:/.test(line) && skipped.add(i));
  for (const { lines } of EXCEPTIONS.filter((e) => e.file === file || (e.dir && file.startsWith(e.dir)))) {
    const spans = lines ? [...src.matchAll(lines)].map((m) => [m.index, m.index + m[0].length]) : [[0, src.length]];
    for (const [from, to] of spans) for (let i = lineOf(from); i <= lineOf(to); i++) skipped.add(i);
  }
  return skipped;
}

// The lines of `src` with Chinese or Japanese in the checked `part`, reported as they read in the source.
function findCJK(src, part, file) {
  const markdown = file.endsWith('.md');
  let checked = PARTS[part](src);
  if (markdown) checked = ALLOWED.reduce((acc, re) => acc.replace(re, blank), checked);
  const skipped = markdown ? new Set() : skippedLines(src, file);
  const source = src.split('\n');
  return checked
    .split('\n')
    .map((text, i) => ({ i, text }))
    .filter(({ i, text }) => !skipped.has(i) && CJK.test(text))
    .map(({ i }) => ({ line: i + 1, text: source[i] }));
}

test('language: Chinese prose outside allowed spans is reported with its line number', () => {
  const text = 'Use the `进行优化` check.\n```\n中文示例\n```\n说明：这是中文。\nEnglish only.';
  assert.deepEqual(findCJK(text, 'whole', 'x.md'), [{ line: 5, text: '说明：这是中文。' }]);
});

test('language: fullwidth punctuation alone counts as Chinese', () => {
  assert.equal(findCJK('value，next', 'whole', 'x.md').length, 1);
});

test('language: kana counts as CJK', () => {
  assert.equal(findCJK('コピーしました', 'whole', 'x.md').length, 1);
});

test('language: inline code spans exempt Markdown only, and the original source line is reported', () => {
  const src = "say('use `中文` here'); // note\n";
  assert.deepEqual(findCJK(src, 'strings', 'x.js'), [{ line: 1, text: "say('use `中文` here'); // note" }]);
  assert.equal(findCJK('// see `中文`\n', 'comments', 'x.js').length, 1);
});

test('language: a comment after a division is still read', () => {
  assert.deepEqual(findCJK('const a = b / 2; // 中文\n', 'testText', 'x.test.js'), [{ line: 1, text: 'const a = b / 2; // 中文' }]);
});

test('language: test names and comments are read in test files, fixtures are not', () => {
  const src = "test(`名字 ${x}`, () => {\n  const s = '夹具';\n});\nit.skip('跳过', f);\n";
  assert.deepEqual(findCJK(src, 'testText', 'x.test.js').map((o) => o.line), [1, 4]);
});

test('language: a line ending in a lang-ok marker is skipped', () => {
  assert.deepEqual(findCJK("const a = '中文'; // lang-ok: input alias\n", 'strings', 'x.js'), []);
});

test('language: every file in scope is English outside allowed spans', () => {
  const files = SCOPE.flatMap(({ files, part }) => files().map((file) => ({ file, part })));
  assert.ok(files.length >= 6);
  const offenders = files.flatMap(({ file, part }) =>
    findCJK(readFileSync(join(ROOT, file), 'utf8'), part, file).map(({ line, text }) => `${file} (${part}) line ${line}: ${text.trim()}`),
  );
  assert.deepEqual(offenders, []);
});

test('language: every exception still matches lines in its file', () => {
  const stale = EXCEPTIONS.filter(({ file, lines }) => file && lines && ![...readFileSync(join(ROOT, file), 'utf8').matchAll(lines)].length);
  assert.deepEqual(stale.map((e) => e.file), []);
});
