import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDoc, RenderError } from '../src/render.js';
import { readEmbeddedCode, MAX_CODE_LINES } from '../src/code.js';
import { readPage } from '../src/page.js';
import { main } from '../src/cli.js';

let dir;
const LINES = Array.from({ length: 41 }, (_, i) => `const line${i + 1} = ${i + 1};`);
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-code-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'app.ts'), `${LINES.join('\n')}\n`);
  writeFileSync(join(dir, 'src', 'tag.html'), '<div class="x">a & b</div>\n');
  writeFileSync(join(dir, '.env'), 'TOKEN=abc\n');
  mkdirSync(join(dir, '.ssh'));
  writeFileSync(join(dir, '.ssh', 'config'), 'Host x\n');
  writeFileSync(join(dir, '.git-credentials'), 'https://x\n');
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'config'), '[core]\n');
  writeFileSync(join(dir, 'secrets.json'), '{}\n');
  writeFileSync(join(dir, 'late-leak.ts'), `export const a = 1;\nexport const b = 2;\n${'// filler\n'.repeat(30)}const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x';\n`);
  writeFileSync(join(dir, 'leak.js'), "const key = 'AKIAABCDEFGHIJKLMNOP';\n");
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 0, 2]));
  writeFileSync(join(dir, 'big.txt'), Array.from({ length: MAX_CODE_LINES + 1 }, () => 'x').join('\n'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const draft = (fence, body = '') => `---\ntitle: Code\n---\n## A Panel\n${fence}\n${body}${body ? '\n' : ''}\`\`\`\n`;
const render = (src) => renderDoc(src, {}, {}, { codeDir: dir });
const errorOf = (src) => {
  try {
    render(src);
  } catch (err) {
    return err;
  }
  return null;
};

test('code: src= and lines= embed the lines of a real file, numbered from the first line', () => {
  const { html, stats } = render(draft('```ts src=src/app.ts lines=18-20'));
  assert.match(html, /<figure class="am-codeblock" data-am-src="src\/app.ts" data-am-lines="18-20">/);
  assert.match(html, /<span class="am-code-title">src\/app.ts:18-20<\/span><span class="am-code-lang">ts<\/span>/);
  assert.match(html, /<pre class="am-code am-code--num"><code data-lang="ts"><span class="am-ln" data-n="18">const line18 = 18;<\/span><span class="am-ln" data-n="19">/);
  assert.ok(!html.includes('line21'));
  assert.deepEqual(stats.code, ['src/app.ts:18-20']);
});

test('code: hl= marks lines by their shown number; the language comes from the file name when the fence has none', () => {
  const { html } = render(draft('```src=src/app.ts lines=3-5 hl=4'));
  assert.match(html, /<span class="am-ln am-ln--hl" data-n="4">const line4 = 4;<\/span>/);
  assert.match(html, /<span class="am-ln" data-n="3">/);
  assert.match(html, /<code data-lang="ts">/);
});

test('code: a typed block keeps its text escaped, has a copy button and no line numbers unless start= is set', () => {
  const { html } = render(draft('```python', 'print("<x>")'));
  assert.match(html, /<pre class="am-code"><code data-lang="python"><span class="am-ln">print\(&quot;&lt;x&gt;&quot;\)<\/span><\/code><\/pre>/);
  assert.match(html, /<button class="am-code-copy" type="button" data-am="copy-code" data-done="Copied ✓">Copy<\/button>/);
  const numbered = render(draft('```ts start=38 hl=39 title="limits.ts · sketch"', 'a()\nb()')).html;
  assert.match(numbered, /<span class="am-code-title">limits.ts · sketch<\/span>/);
  assert.match(numbered, /<span class="am-ln am-ln--hl" data-n="39">b\(\)<\/span>/);
});

test('code: the copy label follows the page language', () => {
  const { html } = render(`---\ntitle: 代码\nlang: zh\n---\n## 面板\n\`\`\`bash\nnpm test\n\`\`\`\n`);
  assert.match(html, /data-done="已复制 ✓">复制<\/button>/);
});

test('code: the page keeps the path, not a copy in the draft; the embedded code reads back for am patch', () => {
  const src = draft('```ts src=src/tag.html');
  const { html } = render(src);
  assert.equal(readPage(html).source, src);
  assert.match(html, /&lt;div class=&quot;x&quot;&gt;a &amp; b&lt;\/div&gt;/);
  assert.deepEqual(readEmbeddedCode(html).get('src/tag.html#'), ['<div class="x">a & b</div>']);
});

test('code: a moved file falls back to the code the page already holds; the file wins when it exists', () => {
  const knownCode = new Map([['gone.ts#1-2', ['old()', 'kept()']], ['src/app.ts#1', ['stale()']]]);
  const { html } = renderDoc(`${draft('```ts src=gone.ts lines=1-2')}\n## B\n${draft('```ts src=src/app.ts lines=1').split('## A Panel\n')[1]}`, {}, {}, { codeDir: dir, knownCode });
  assert.match(html, /<span class="am-ln" data-n="1">old\(\)<\/span><span class="am-ln" data-n="2">kept\(\)<\/span>/);
  assert.match(html, /const line1 = 1;/);
  assert.ok(!html.includes('stale()'));
});

test('code: errors name the line of the fence', () => {
  const cases = [
    ['```ts src=missing.ts', /Code file "missing.ts" is not found/],
    ['```ts src=../outside.ts', /is outside the current folder/],
    ['```ts src=/etc/hosts', /is outside the current folder/],
    ['```txt src=.ssh/config', /holds keys or passwords by convention/],
    ['```txt src=.git-credentials', /holds keys or passwords by convention/],
    ['```ini src=.git/config', /holds keys or passwords by convention/],
    ['```json src=secrets.json', /holds keys or passwords by convention/],
    ['```ts src=late-leak.ts lines=1-2', /somewhere in the file; no part of it is embedded/],
    ['```ts src=src/app.ts lines=39-45', /has 41 lines; lines=39-45 goes past the end/],
    ['```ts lines=1-2', /lines= needs src=/],
    ['```ts src=src/app.ts lines=1-3 hl=9', /line 9 is not in the block \(lines 1-3\)/],
    ['```ts src=src/app.ts lines=b-a', /is not a line range/],
    ['```ts file=src/app.ts', /unknown code block setting "file"/],
    ['```env src=.env', /holds keys or passwords by convention/],
    ['```js src=leak.js', /looks like it holds a key or a token/],
    ['```bin src=blob.bin', /binary file/],
    ['```txt src=big.txt', new RegExp(`quote ${MAX_CODE_LINES} lines at most`)],
  ];
  for (const [fence, message] of cases) {
    const err = errorOf(draft(fence));
    assert.ok(err instanceof RenderError, `${fence}: ${err}`);
    assert.equal(err.component, 'code');
    assert.equal(err.line, 5, fence);
    assert.match(err.message, message, fence);
  }
  const body = errorOf(draft('```ts src=src/app.ts', 'typed()'));
  assert.match(body.message, /leave the block empty/);
  const secret = errorOf(draft('```js', "const password = 'Abcdefghijklmnopqrstuvwxyz'"));
  assert.match(secret.message, /the block looks like it holds a key/);
});

test('code: a fence written with ``` and settings only still counts as code, not as a language', () => {
  const { html } = render(draft('```src=src/app.ts lines=1'));
  assert.match(html, /data-am-src="src\/app.ts"/);
});

function sink() {
  let text = '';
  return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } };
}

async function run(args, stdin = '') {
  const out = sink();
  const err = sink();
  const code = await main(args, { stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]), env: { AM_NO_OPEN: '1', AM_HOME: join(dir, 'home') }, cwd: dir });
  return { code, out: out.text, err: err.text };
}

test('cli render: code paths are read from the current folder, and the summary lists the embedded files', async () => {
  mkdirSync(join(dir, 'drafts'), { recursive: true });
  writeFileSync(join(dir, 'drafts', 'd.md'), draft('```ts src=src/app.ts lines=1-2'));
  const r = await run(['render', 'drafts/d.md', '-o', 'out/page.html']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /code embedded from: src\/app.ts:1-2/);
});

test('cli patch: a code file that has moved since the render stays on the page', async () => {
  writeFileSync(join(dir, 'moving.ts'), 'export const a = 1;\n');
  const src = `${draft('```ts src=moving.ts')}\n## B Other\nText.\n`;
  const r = await run(['render', '-', '-o', 'out/moving.html'], src);
  assert.equal(r.code, 0, r.err);
  renameSync(join(dir, 'moving.ts'), join(dir, 'moved.ts'));
  const p = await run(['patch', 'out/moving.html', '--panel', 'B', '-'], 'New text.');
  assert.equal(p.code, 0, p.err);
  const html = readFileSync(join(dir, 'out', 'moving.html'), 'utf8');
  assert.match(html, /<span class="am-ln" data-n="1">export const a = 1;<\/span>/);
  assert.match(html, /New text\./);
});

test('runtime: a code block copies its lines without the line numbers', async () => {
  const code = readFileSync(new URL('../src/runtime/page.js', import.meta.url), 'utf8');
  let copied = null;
  const listeners = {};
  const lines = ['const a = 1;', '  return a;'].map((t) => ({ textContent: t }));
  const button = {
    textContent: 'Copy',
    dataset: { done: 'Copied ✓' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    closest: () => ({ querySelectorAll: () => lines }),
  };
  const document = {
    documentElement: { getAttribute: () => null, setAttribute() {} },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-am="copy-code"]' ? [button] : []),
  };
  const sandbox = { document, navigator: { clipboard: { writeText: async (t) => { copied = t; } } }, setTimeout: () => {}, window: { addEventListener() {} } };
  vm.runInNewContext(code, sandbox);
  await listeners.click();
  assert.equal(copied, 'const a = 1;\n  return a;');
  assert.equal(button.textContent, 'Copied ✓');
});

test('cli patch: a page whose draft quotes a file outside the folder keeps its own copy and reads nothing new', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'am-outside-'));
  writeFileSync(join(outside, 'private.ts'), 'export const secretPlan = 1;\n');
  const known = renderDoc(draft(`\`\`\`ts src=${join(outside, 'private.ts')}`), {}, {}, { codeDir: outside });
  rmSync(outside, { recursive: true, force: true });
  const err = (() => {
    try {
      renderDoc(draft(`\`\`\`ts src=${join(outside, 'private.ts')}`), {}, {}, { codeDir: dir });
    } catch (e) {
      return e;
    }
    return null;
  })();
  assert.match(err.message, /outside the current folder/);
  const kept = renderDoc(draft(`\`\`\`ts src=${join(outside, 'private.ts')}`), {}, {}, { codeDir: dir, knownCode: readEmbeddedCode(known.html) });
  assert.match(kept.html, /secretPlan/);
});

test('code: a block longer than 40 lines renders with a warning; more than 200 lines is still an error', () => {
  const { stats } = render(draft('```ts src=src/app.ts lines=1-40'));
  assert.deepEqual(stats.codeWarnings, []);
  const long = render(draft('```ts src=src/app.ts'));
  assert.equal(long.stats.codeWarnings.length, 1);
  assert.equal(long.stats.codeWarnings[0].line, 5);
  assert.match(long.stats.codeWarnings[0].message, /the block has 41 lines; readers skim past long code/);
});

test('cli render: a long code block is listed as a code warning after the summary', async () => {
  const r = await run(['render', '-', '-o', 'out/long.html'], draft('```ts src=src/app.ts'));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /code 1 warning \(trim the block and run again, or keep it if every line matters\):\n  L5 \[code-length\] the block has 41 lines/);
});
