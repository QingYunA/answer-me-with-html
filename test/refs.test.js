import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDoc } from '../src/render.js';
import { main } from '../src/cli.js';

let root;
let dir;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'am-refs-'));
  dir = join(root, 'project');
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), `${Array.from({ length: 30 }, (_, i) => `const a${i + 1} = ${i + 1};`).join('\n')}\n`);
  writeFileSync(join(dir, 'README.md'), 'one\ntwo\nthree');
  writeFileSync(join(dir, '.env'), 'TOKEN=abc\n');
  writeFileSync(join(root, 'outside.ts'), 'export const outside = 1;\n');
});
after(() => rmSync(root, { recursive: true, force: true }));

// The panel body starts on draft line 5.
const draft = (body) => `---\ntitle: Refs\n---\n## A Panel\n${body}\n`;
const refs = (body) => renderDoc(draft(body), {}, {}, { codeDir: dir }).stats.refWarnings;

test('refs: a cited line or range inside the file gives no warning', () => {
  assert.deepEqual(refs('The entry is `src/app.ts:12`, the loop is `src/app.ts:20-30` and the notes are `README.md:3`.'), []);
});

test('refs: a line past the end of the file is a warning at the draft line that cites it', () => {
  const warnings = refs('Intro.\n\nThe loop is `src/app.ts:31`.');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].line, 7);
  assert.match(warnings[0].message, /`src\/app\.ts:31`: the file has 30 lines/);
});

test('refs: a range that ends past the file, starts at 0 or runs backwards is a warning', () => {
  const warnings = refs('- `src/app.ts:25-40`\n- `src/app.ts:0`\n- `src/app.ts:20-10`');
  assert.deepEqual(warnings.map((w) => w.line), [5, 6, 7]);
  assert.match(warnings[0].message, /the file has 30 lines/);
  assert.match(warnings[1].message, /lines start at 1/);
  assert.match(warnings[2].message, /the first line comes after the last/);
});

test('refs: a missing file under a folder that exists is a warning', () => {
  const warnings = refs('See `src/nope.ts:3` and `src/lib/gone.js:1-2`.');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0].message, /`src\/nope\.ts:3`: no such file in /);
  assert.match(warnings[1].message, /`src\/lib\/gone\.js:1-2`: no such file/);
});

test('refs: a folder is not a file', () => {
  const [w] = refs('See `src/lib:3`.');
  assert.match(w.message, /`src\/lib:3`: .*folder, not a file/);
});

test('refs: a path whose first part is not in the folder is another project\'s path and is skipped', () => {
  assert.deepEqual(refs('Upstream: `vendor-repo/lib/x.py:3`, `server.py:8`, `example.com:443`.'), []);
});

test('refs: spans that are not relative file references are ignored', () => {
  assert.deepEqual(refs([
    'Open `localhost:3000`, `127.0.0.1:8080` or `https://example.com:8080/a.js:3`.',
    'Absolute: `/etc/hosts:1`, `~/notes.md:4`, `C:\\src\\a.ts:3`.',
    'Not a whole span: `see src/app.ts:99`, `src/app.ts:99 and more`, `src/app.ts`.',
    'Prose src/app.ts:99 without backticks.',
  ].join('\n\n')), []);
});

test('refs: spans inside a fence or an indented code block are ignored', () => {
  assert.deepEqual(refs('```text\n`src/app.ts:99`\n```'), []);
  assert.deepEqual(refs('~~~\n`src/app.ts:99`\n~~~'), []);
  assert.deepEqual(refs('Before.\n\n    `src/app.ts:99`\n\nAfter.'), []);
});

test('refs: a file outside the current folder, a link out of it or a secret file is not read and gives no warning', () => {
  assert.deepEqual(refs('Outside: `../outside.ts:99`, `../missing/x.ts:3`; secret: `.env:40`.'), []);
});

test('refs: spans in table cells, list items, quotes and callouts are checked at their own lines', () => {
  const warnings = refs([
    '| Step | Code |',
    '| --- | --- |',
    '| parse | `src/app.ts:99` |',
    '',
    '> quoted `src/app.ts:98`',
    '',
    '```callout tip',
    'Read `src/app.ts:97` first.',
    '```',
  ].join('\n'));
  assert.deepEqual(warnings.map((w) => [w.line, w.message.slice(0, 16)]), [[7, '`src/app.ts:99`:'], [9, '`src/app.ts:98`:'], [12, '`src/app.ts:97`:']]);
});

// Component text that renders inline Markdown: a span there is <code> on the page, so it is checked at its own draft line.
test('refs: spans in tree labels and notes are checked at their lines', () => {
  const warnings = refs([
    '```tree',
    'src | the source',
    '  refs.js | checks `src/refs.js:900`',
    '  `src/app.ts:99` app | entry',
    '  ok.ts | `src/app.ts:30`',
    '```',
  ].join('\n'));
  assert.deepEqual(warnings.map((w) => [w.line, w.message.slice(0, 17)]), [[7, '`src/refs.js:900`'], [8, '`src/app.ts:99`: ']]);
});

test('refs: spans in timeline titles and notes and in kv values are checked; the time and the key are plain text', () => {
  const warnings = refs([
    '```timeline',
    '`src/app.ts:91` | starts at `src/app.ts:92` | then `src/app.ts:93`',
    '```',
    '```kv',
    'Entry: `src/app.ts:94`',
    '* Wide: `src/app.ts:95`',
    '```',
  ].join('\n'));
  assert.deepEqual(warnings.map((w) => [w.line, w.message.slice(0, 16)]), [
    [6, '`src/app.ts:92`:'], [6, '`src/app.ts:93`:'], [9, '`src/app.ts:94`:'], [10, '`src/app.ts:95`:'],
  ]);
});

test('refs: spans in an ask question, its options and their previews are checked', () => {
  const warnings = refs([
    '```ask',
    'Keep `src/app.ts:81`?',
    '* Yes `src/app.ts:82` | see `src/app.ts:83`',
    '  :::tree',
    '  root | `src/app.ts:84`',
    '  :::',
    '- No',
    '```',
  ].join('\n'));
  assert.deepEqual(warnings.map((w) => [w.line, w.message.slice(0, 16)]), [
    [6, '`src/app.ts:81`:'], [7, '`src/app.ts:82`:'], [7, '`src/app.ts:83`:'], [9, '`src/app.ts:84`:'],
  ]);
});

test('refs: diagram text shows backticks as text, so flow, sequence, state, limits and annot are not checked', () => {
  assert.deepEqual(refs([
    '```flow', 'A -> B: see `src/app.ts:99`', '```',
    '```sequence', 'A -> B: call `src/app.ts:99`', 'note A: `src/app.ts:99`', '```',
    '```state', '[*] -> Idle: `src/app.ts:99`', '```',
    '```limits', '`src/app.ts:99` | 13 / 20 | ms', '```',
    '```annot', '# head | `src/app.ts:99`', '[span]{`src/app.ts:99`}', '```',
  ].join('\n')), []);
});

test('refs: inline fields are read as inline Markdown, so a field that looks like a fence still has its span checked', () => {
  const warnings = refs('```ask\n~~~ `src/app.ts:99`\n* Yes\n- No\n```');
  assert.deepEqual(warnings.map((w) => w.line), [6]);
});

test('refs: a span the page shows after the raw-HTML filter relexes a block is checked', () => {
  const warnings = refs('<host>\nSee `src/app.ts:99`.');
  assert.deepEqual(warnings.map((w) => w.line), [6]);
});

test('refs: a path that is not checked gets no line-range warning either', () => {
  assert.deepEqual(refs('`../outside.ts:0`, `.env:9-2`, `other-repo/x.py:0`'), []);
  assert.deepEqual(refs('`src/nope.ts:0`').map((w) => w.message), ['`src/nope.ts:0`: lines start at 1']);
});

test('refs: equivalent spellings of a path are classified the same way', () => {
  assert.deepEqual(refs('`./other-repo/x.py:3`, `src/../other-repo/x.py:3`'), []);
  assert.equal(refs('`./src/nope.ts:3`').length, 1);
});

test('refs: a tree line that starts with // is a label, not a comment, so its span is checked', () => {
  assert.deepEqual(refs('```tree\nroot\n  // See `src/app.ts:99`\n```').map((w) => w.line), [7]);
});

test('refs: image alt text shows backticks as text, so a span there is not checked', () => {
  assert.deepEqual(refs('![see `src/app.ts:99`](data:image/png;base64,iVBORw0KGgo=)'), []);
});

test('refs: a third tree field is not shown, so a span there is not checked', () => {
  assert.deepEqual(refs('```tree\nRoot | Note | `src/app.ts:99`\n```'), []);
});

test('refs: a code block named like an Object property does not break the check', () => {
  assert.deepEqual(refs('```constructor\n`src/app.ts:99`\n```\n\n```toString\nx\n```'), []);
});

test('refs: the same span twice is reported at each of its lines', () => {
  assert.deepEqual(refs('`src/app.ts:99`\n\n`src/app.ts:99`').map((w) => w.line), [5, 7]);
});

function sink() {
  let text = '';
  return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } };
}

async function run(args, stdin, opened = []) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_HOME: join(root, 'home'), AM_NO_UPDATE_CHECK: '1' }, cwd: dir, open: (f) => opened.push(f),
  });
  return { code, out: out.text, err: err.text };
}

test('cli render: ref warnings are listed after the summary and keep the page from opening, like code warnings', async () => {
  const opened = [];
  const r = await run(['render', '-'], draft('Use the tool.\n\nThe loop is `src/app.ts:31`.'), opened);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /refs 1 warning \(.+\):\n {2}L7 \[ref\] `src\/app\.ts:31`: the file has 30 lines/);
  assert.match(r.out, /Not opened because of the warnings/);
  assert.deepEqual(opened, []);

  const clean = await run(['render', '-'], draft('Use the tool.\n\nThe loop is `src/app.ts:30`.'), opened);
  assert.doesNotMatch(clean.out, /refs \d/);
  assert.equal(opened.length, 1);
});
