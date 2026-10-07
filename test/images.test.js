import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDoc, RenderError } from '../src/render.js';
import { inlineImages, readEmbeddedImages, MAX_IMAGE_BYTES } from '../src/images.js';
import { readPage } from '../src/page.js';
import { lintDoc } from '../src/lint/ste.js';
import { parseDoc } from '../src/parse.js';
import { main } from '../src/cli.js';

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const DATA_URI = `data:image/png;base64,${PNG.toString('base64')}`;

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-images-'));
  mkdirSync(join(dir, 'shots'));
  writeFileSync(join(dir, 'shots', 'ui.png'), PNG);
  writeFileSync(join(dir, 'notes.txt'), 'not an image');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const draft = (line) => `---\ntitle: Images\n---\n## Screen\n${line}\n`;

test('image: an image alone on a line becomes a captioned figure with the file embedded', () => {
  const { html } = renderDoc(draft(`![The login screen](${join(dir, 'shots', 'ui.png')})`));
  assert.ok(/<figure class="am-figure"><img data-am-src="[^"]+" src="data:image\/png;base64,[^"]+" alt="The login screen"><figcaption>The login screen<\/figcaption><\/figure>/.test(html));
  assert.ok(!html.includes('<p><img'));
});

test('image: the page stays one file; the draft in #am-source keeps the path, not the bytes', () => {
  const abs = join(dir, 'shots', 'ui.png');
  const { html } = renderDoc(draft(`![The login screen](${abs})`));
  assert.equal(readPage(html).source, draft(`![The login screen](${abs})`));
  assert.equal(html.split(PNG.toString('base64')).length - 1, 1);
});

test('image: a relative path is read from baseDir', () => {
  const { html } = renderDoc(draft('![UI](shots/ui.png)'), {}, {}, { baseDir: dir });
  assert.ok(html.includes(DATA_URI));
});

test('image: http(s) URLs and data URIs are left alone', () => {
  const src = draft('![Remote](https://example.com/a.png)\n\n![Inline](data:image/gif;base64,R0lGODlhAQABAAAAACw=)');
  const { html } = renderDoc(src);
  assert.ok(html.includes('<img src="https://example.com/a.png"'));
  assert.ok(html.includes('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="'));
  assert.ok(!html.includes('data-am-src'));
});

test('image: an image inside a callout is embedded too', () => {
  const { html } = renderDoc(`## A\n\`\`\`callout info Note\n![UI](${join(dir, 'shots', 'ui.png')})\n\`\`\`\n`);
  assert.ok(html.includes(DATA_URI));
});

test('image: a missing file, a non-image file and a file over the limit are errors at the line that names them', () => {
  for (const [line, pattern] of [
    ['![Gone](/nonexistent/a.png)', /Image not found: "\/nonexistent\/a\.png"/],
    [`![Text](${join(dir, 'notes.txt')})`, /is not an image file/],
  ]) {
    assert.throws(() => renderDoc(draft(line)), (e) => e instanceof RenderError && e.line === 5 && e.component === 'image' && pattern.test(e.message) && /!\[/.test(e.example));
  }
  const big = join(dir, 'big.png');
  writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1));
  assert.throws(() => renderDoc(draft(`![Big](${big})`)), /the limit is 5 MB/);
});

test('image: a space in the path still makes a figure, alone on a line or in a callout', () => {
  mkdirSync(join(dir, 'ui shots'), { recursive: true });
  writeFileSync(join(dir, 'ui shots', 'spectator view.png'), PNG);
  const abs = join(dir, 'ui shots', 'spectator view.png');
  for (const src of [draft(`![The spectator screen](${abs})`), `## A\n\`\`\`callout info Note\n![The spectator screen](${abs})\n\`\`\`\n`]) {
    const { html } = renderDoc(src);
    assert.ok(html.includes(DATA_URI));
    assert.ok(html.includes('<figure class="am-figure">'));
    assert.ok(!html.includes('<p>![The spectator screen]'));
  }
});

test('image: a space in the path keeps a title, and a missing or non-image file is still an error', () => {
  const abs = join(dir, 'ui shots', 'spectator view.png');
  assert.ok(renderDoc(draft(`![UI](${abs} "A title")`)).html.includes(DATA_URI));
  for (const [line, pattern] of [
    ['![Gone](/nonexistent dir/a b.png)', /Image not found: "\/nonexistent dir\/a b\.png"/],
    [`![Text](${join(dir, 'ui shots', 'my notes.txt')})`, /is not an image file/],
  ]) {
    assert.throws(() => renderDoc(draft(line)), (e) => e instanceof RenderError && e.line === 5 && e.component === 'image' && pattern.test(e.message));
  }
});

test('image: a space in a code span is left alone', () => {
  const { html } = renderDoc(draft('Write `![alt](a b.png)` like this.'));
  assert.ok(html.includes('![alt](a b.png)'));
});

test('image: an image that marked leaves as text is an error at its line', () => {
  assert.throws(() => renderDoc(draft('![Odd](/a b/c <1>.png)')), (e) => e instanceof RenderError && e.line === 5 && e.component === 'image' && /was not read as an image/.test(e.message));
});

test('image: parentheses next to a space in the path still make a figure', () => {
  const abs = join(dir, 'ui shots', 'Screenshot (1).png');
  writeFileSync(abs, PNG);
  assert.ok(renderDoc(draft(`![UI](${abs})`)).html.includes(DATA_URI));
  assert.ok(renderDoc(draft(`![UI](${abs} "A title") and (more)`)).html.includes(DATA_URI));
});

test('image: the error names the line even when the draft writes the path as %20', () => {
  assert.throws(() => renderDoc(draft('Intro.\n\n![Gone](/nonexistent%20dir/a.png)')), (e) => e instanceof RenderError && e.line === 7 && e.component === 'image');
});

test('image: ![a](b) typed in a raw html block or diagram text stays literal and passes', () => {
  assert.ok(renderDoc('## A\n```html\n<p>![a](b.png)</p>\n```\n').html.includes('<p>![a](b.png)</p>'));
  assert.doesNotThrow(() => renderDoc('## A\n```flow\nA[![a](b)] -> B\n```\n'));
});

test('image: an image in a tree label works, with or without a space in the path', () => {
  for (const name of ['ui shots/spectator view.png', 'shots/ui.png']) {
    assert.ok(renderDoc(`## A\n\`\`\`tree\n![UI](${join(dir, name)})\n\`\`\`\n`).html.includes(DATA_URI), name);
  }
});

test('image: a space in the path works in kv, tree and timeline text too', () => {
  const abs = join(dir, 'ui shots', 'spectator view.png');
  for (const fence of [`kv\nshot: ![UI](${abs})`, `tree\n![UI](${abs})`, `timeline\n2026 | ![UI](${abs}) | done`]) {
    assert.ok(renderDoc(`## A\n\`\`\`${fence}\n\`\`\`\n`).html.includes(DATA_URI), fence);
  }
});

test('image: a reference-style image with a space in its definition is an error, not text', () => {
  assert.throws(() => renderDoc(draft('![Odd][r]\n\n[r]: /a b/c.png')), (e) => e instanceof RenderError && e.line === 5 && /was not read as an image/.test(e.message));
});

test('image: a relative path in the message names the folder it was read from', () => {
  assert.throws(() => renderDoc(draft('![Gone](gone.png)'), {}, {}, { baseDir: dir }), (e) => e.message.includes(`relative paths are read from ${dir}`));
});

test('image: inlineImages falls back to the known copy only when the file is gone', () => {
  const abs = join(dir, 'shots', 'ui.png');
  const tag = `<img src="${abs}" alt="x">`;
  const known = new Map([[abs, 'data:image/png;base64,OLD'], ['/gone/a.png', 'data:image/png;base64,OLD']]);
  assert.ok(inlineImages(tag, { known }).includes(DATA_URI));
  assert.ok(inlineImages('<img src="/gone/a.png" alt="x">', { known }).includes('base64,OLD'));
});

test('image: readEmbeddedImages reads back what a page embeds, keyed by the draft path', () => {
  const abs = join(dir, 'shots', 'ui.png');
  const { html } = renderDoc(draft(`![UI](${abs})`));
  assert.equal(readEmbeddedImages(html).get(abs), DATA_URI);
});

test('image: the caption goes through the STE check', () => {
  const long = 'This screenshot shows the login screen of the game with the three viewing modes and every button that the player can press during a match, including the menu, the chat box and the score board';
  assert.ok(lintDoc(parseDoc(draft(`![${long}](/a.png)`))).some((w) => w.rule === 'sentence-length'));
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

test('cli render: a relative image is read from the draft file\'s folder', async () => {
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'ui.png'), PNG);
  writeFileSync(join(dir, 'docs', 'd.md'), draft('![UI](ui.png)'));
  const r = await run(['render', 'docs/d.md']);
  assert.equal(r.code, 0, r.err);
  assert.ok(readFileSync(r.out.match(/✓ (.+\.html)/)[1], 'utf8').includes(DATA_URI));
});

test('cli render: a missing image prints the line and a correct example', async () => {
  const r = await run(['render', '-'], draft('![Gone](/nonexistent/a.png)'));
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L5 \[image\] Image not found/);
  assert.match(r.err, /Correct example:/);
  assert.match(r.err, /am help image/);
});

test('cli patch: another panel changes and the image stays, even after the file is gone', async () => {
  const photo = join(dir, 'photo.png');
  writeFileSync(photo, PNG);
  const first = await run(['render', '-'], `## A\n![Photo](${photo})\n\n## B\nold\n`);
  const file = first.out.match(/✓ (.+\.html)/)[1];
  rmSync(photo);
  const patched = await run(['patch', file, '--panel', 'B'], '## B\nnew\n');
  assert.equal(patched.code, 0, patched.err);
  const html = readFileSync(file, 'utf8');
  assert.ok(html.includes(DATA_URI));
  assert.ok(html.includes('<p>new</p>'));
});

test('cli help image: prints the syntax', async () => {
  const r = await run(['help', 'image']);
  assert.equal(r.code, 0);
  assert.match(r.out, /!\[What the picture shows\]/);
});
