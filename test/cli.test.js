import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, oldNodeHint } from '../src/cli.js';
import { tempHome } from '../src/home.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-test-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function run(args, { stdin = '', env = {} } = {}) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_HOME: dir, ...env }, cwd: dir,
  });
  return { code, out: out.text, err: err.text };
}

const GOOD = '---\ntitle: CLI 测试\n---\n## A 流程\n```flow\nA -> B\n```\n';

test('cli: --version and --help', async () => {
  assert.match((await run(['--version'])).out, /^\d+\.\d+\.\d+/);
  assert.match((await run([])).out, /Usage:/);
});

test('cli: oldNodeHint names the Node version below 20 and is empty from 20 on', () => {
  assert.match(oldNodeHint('v18.20.0'), /needs Node\.js 20 or newer \(found v18\.20\.0\).*https:\/\/nodejs\.org\//);
  assert.equal(oldNodeHint('v20.0.0'), '');
  assert.equal(oldNodeHint('v24.1.0'), '');
});

test('cli render: reads stdin, writes to AM_HOME/pages, prints the path and stats', async () => {
  const r = await run(['render', '-'], { stdin: GOOD });
  assert.equal(r.code, 0, r.err);
  const file = r.out.match(/✓ (.+\.html)/)[1];
  assert.ok(file.startsWith(join(dir, 'pages', 'CLI-测试-')));
  assert.match(readFileSync(file, 'utf8'), /<h1>CLI 测试<\/h1>/);
  assert.match(r.out, /sheet · blueprint · 1 panel · flow×1/);
  assert.match(r.out, /STE ✓ 0 warnings/);
});

test('cli render: the injected clock sets the default file name; the injected open runs as configured', async () => {
  const opened = [];
  const now = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const call = (args) => main(args, {
    stdout: sink().stream, stderr: sink().stream, stdin: Readable.from([GOOD]),
    env: { AM_HOME: dir, AM_NO_UPDATE_CHECK: '1' }, cwd: dir, now: () => now, open: (f) => opened.push(f),
  });
  assert.equal(await call(['render', '-']), 0);
  assert.deepEqual(opened, [join(dir, 'pages', 'CLI-测试-20260102-030405.html')]);
  assert.equal(await call(['render', '-', '--no-open']), 0);
  assert.equal(opened.length, 1, '--no-open does not open');
});

test('cli video: the summary line names the theme', async () => {
  const r = await run(['video', '-', '--voice', 'off', '--theme', 'shadcn'], { stdin: '---\ntitle: V\n---\n## A\n> 一句。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video · shadcn · 1 scene · 1 beat/);
});

test('cli render: file argument + -o + theme override', async () => {
  writeFileSync(join(dir, 'in.md'), GOOD);
  const r = await run(['render', 'in.md', '-o', 'out/x.html', '--theme', 'shadcn']);
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'out/x.html'), 'utf8'), /data-theme="shadcn"/);
});

test('cli render: -o rejects an existing folder with one actionable error', async () => {
  mkdirSync(join(dir, 'render-folder'));
  const r = await run(['render', '-', '-o', 'render-folder'], { stdin: GOOD });
  assert.equal(r.code, 2);
  assert.match(r.err, /^✗ -o names a folder; give a file path, for example -o page\.html\n$/);
  assert.equal(r.out, '');
});

test('cli executable: a folder output exits without an internal stack', () => {
  mkdirSync(join(dir, 'bundle-folder'));
  const cli = fileURLToPath(new URL('../skills/answer-me-with-html/scripts/am.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'render', '-', '-o', 'bundle-folder'], {
    cwd: dir, input: GOOD, encoding: 'utf8',
    env: { ...process.env, AM_HOME: dir, AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1' },
  });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stderr, '✗ -o names a folder; give a file path, for example -o page.html\n');
  assert.equal(r.stdout, '');
});

test('cli render: an extensionless -o remains a file and says so', async () => {
  const r = await run(['render', '-', '-o', 'extensionless-page'], { stdin: GOOD });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'extensionless-page'), 'utf8'), /<h1>CLI 测试<\/h1>/);
  assert.match(r.out, /! -o names a file without an extension; use \.html for an HTML page/);
});

test('cli render: -o creates a missing parent for an HTML file', async () => {
  const r = await run(['render', '-', '-o', 'new-parent/page.html'], { stdin: GOOD });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'new-parent/page.html'), 'utf8'), /<h1>CLI 测试<\/h1>/);
  assert.doesNotMatch(r.out, /without an extension/);
});

test('cli video: -o rejects an existing folder and notices an extensionless file', async () => {
  mkdirSync(join(dir, 'video-folder'));
  const src = '---\ntitle: V\n---\n## A\n> Narration.\n';
  const folder = await run(['video', '-', '--voice', 'off', '-o', 'video-folder'], { stdin: src });
  assert.equal(folder.code, 2);
  assert.match(folder.err, /^✗ -o names a folder; give a file path, for example -o page\.html\n$/);
  assert.equal(folder.out, '');

  const file = await run(['video', '-', '--voice', 'off', '-o', 'extensionless-video'], { stdin: src });
  assert.equal(file.code, 0, file.err);
  assert.match(readFileSync(join(dir, 'extensionless-video'), 'utf8'), /<html/);
  assert.match(file.out, /! -o names a file without an extension; use \.html for an HTML page/);
});

test('cli video: a folder output is rejected before narration starts', async () => {
  const folder = join(dir, 'video-before-voice');
  const home = join(dir, 'unused-voice-home');
  mkdirSync(folder);
  let calls = 0;
  const provider = {
    name: 'test', voice: 'test', id: 'output-path-test', concurrency: 1,
    synth: async () => { calls++; return new Int16Array(16000); },
  };
  const out = sink();
  const err = sink();
  const code = await main(['video', '-', '-o', folder, '--no-open'], {
    stdout: out.stream, stderr: err.stream,
    stdin: Readable.from(['## A\n> Narration.\n']),
    env: { AM_HOME: home, AM_NO_UPDATE_CHECK: '1' }, cwd: dir, ttsProvider: provider,
  });
  assert.equal(code, 2, err.text);
  assert.equal(calls, 0, 'an invalid destination must not synthesize narration');
  assert.equal(existsSync(home), false, 'no narration cache is created');
  assert.equal(out.text, '');
  assert.equal(err.text, '✗ -o names a folder; give a file path, for example -o page.html\n');
});

test('cli render: limits 0 / 0 renders a page and does not hang', { timeout: 5000 }, async () => {
  const r = await run(['render', '-', '-o', 'zero.html'], { stdin: '## A\n```limits\nx | 0 / 0\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(dir, 'zero.html'), 'utf8'), /am-lim/);
});

test('cli render: a component syntax error gives the absolute line, component name and a correct example, exit code 1', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n文本\n```flow\nA -> B\n(未闭合 -> C\n```' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L5 \[flow\] flow: unclosed shape bracket/);
  assert.match(r.err, /Correct example:\n {4}```flow/);
  assert.match(r.err, /am help flow/);
});

test('cli render: a callout body that starts with "type: <kind>" fails and shows the type on the fence line', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n文本\n```callout\ntype: info\nBody\n```\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L4 \[callout\] callout: put the type on the fence line, not in the body: ```callout info/);
  assert.match(r.err, /Correct example:\n {4}```callout warn Caution/);
  assert.match(r.err, /am help callout/);
});

test('cli render: a first body line "type: warning|error|note", with or without a # comment, fails and names the right fence type', async () => {
  for (const [line, fix] of [['type: warning', 'warn'], ['type: error', 'err'], ['type: note # the kind', 'info'], ['type: ok  # fine', 'ok']]) {
    const r = await run(['render', '-'], { stdin: `## A\n文本\n\`\`\`callout\n${line}\nBody\n\`\`\`\n` });
    assert.equal(r.code, 1, line);
    assert.match(r.err, new RegExp(`✗ L4 \\[callout\\] callout: put the type on the fence line, not in the body: \`\`\`callout ${fix} \\[title\\]`), line);
  }
});

test('cli render: a first body line "type: " followed by several words stays body text', async () => {
  const r = await run(['render', '-', '-o', 'callout-words.html'], { stdin: '## A\n```callout info\ntype: of the valve is shown below\nBody\n```\n' });
  assert.equal(r.code, 0, r.err);
});

test('cli render: a "type: <kind>" line that is not the first body line stays body text', async () => {
  const r = await run(['render', '-', '-o', 'callout-ok.html'], { stdin: '## A\n```callout info\nBody\ntype: warn\n```\n' });
  assert.equal(r.code, 0, r.err);
});

test('cli render: a parse error gives the line number', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n```flow\nA -> B' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L2 Cannot parse the draft: fenced block/);
});

test('cli render: a table without a delimiter row fails with the header line and a correct example', async () => {
  const r = await run(['render', '-'], { stdin: '## A\n| 位置 | 删了什么 |\n| staging 库 | 整库重建 |\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L2 Cannot parse the draft: table has no delimiter row: put \|---\|---\| on the line under the header row/);
  assert.match(r.err, /Correct example:\n {4}\| 位置 \| 删了什么 \|\n {4}\|---\|---\|\n {4}\| staging 库 \| 整库重建 \|/);
});

test('cli render: duplicate explicit panel IDs fail with the second line and a fix', async () => {
  const r = await run(['render', '-'], { stdin: '---\ntitle: Dup\n---\n\n## A First\n\nalpha\n\n## A Second\n\nbeta\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ L9 Cannot parse the draft: Duplicate panel ID "A"/);
  assert.match(r.err, /"## A First" \(L5\).*"## A Second" \(L9\)/);
  assert.match(r.err, /different explicit ID.*remove one explicit ID/);
});

test('cli render: style 80 prints warnings and still renders; strict refuses to render', async () => {
  const bad = '## A\nUtilize the tool.';
  const soft = await run(['render', '-'], { stdin: bad });
  assert.equal(soft.code, 0);
  assert.match(soft.out, /STE 1 warning[\s\S]*L2 \[word\] not recommended: "Utilize" → use/);

  const before = readdirSync(join(dir, 'pages')).length;
  const strict = await run(['render', '-', '--style', 'strict'], { stdin: bad });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /STE check failed/);
  assert.equal(readdirSync(join(dir, 'pages')).length, before, 'a strict failure writes no file');
});

// Render in a fresh data directory with an injected clock and opener; each call is one second later, so every page gets its own name.
function retrying(t) {
  const home = mkdtempSync(join(tmpdir(), 'am-replace-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const opened = [];
  let now = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const call = async (args, stdin = '') => {
    const out = sink();
    const err = sink();
    now += 1000;
    const code = await main(args, {
      stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
      env: { AM_HOME: home, AM_NO_UPDATE_CHECK: '1' }, cwd: home, now: () => now, open: (f) => opened.push(f),
    });
    return { code, out: out.text, err: err.text, file: out.text.match(/^✓ (.+\.html)$/m)?.[1] };
  };
  return { home, call, opened };
}

const WARNED = '---\ntitle: Retry\n---\n## A\nUtilize the tool.\n';
const FIXED = '---\ntitle: Retry\n---\n## A\nUse the tool.\n';

test('cli render: a page with warnings goes to pages/ but does not open; --open still opens it', async (t) => {
  const { home, call, opened } = retrying(t);
  const r = await call(['render', '-'], WARNED);
  assert.equal(r.code, 0, r.err);
  assert.equal(dirname(r.file), join(home, 'pages'));
  // includes, not a RegExp: a Windows path has backslashes.
  assert.ok(r.out.includes(`Not opened because of the warnings; to render again, add --replace ${r.file}`), r.out);
  assert.deepEqual(opened, []);

  const forced = await call(['render', '-', '--open'], WARNED);
  assert.deepEqual(opened, [forced.file]);
  assert.doesNotMatch(forced.out, /Not opened/);
  const quiet = await call(['render', '-', '--no-open'], WARNED);
  assert.doesNotMatch(quiet.out, /Not opened/, 'no note when the page would not open anyway');
});

test('cli render: --replace deletes the earlier page once the new one is written, so one answer leaves one page', async (t) => {
  const { home, call, opened } = retrying(t);
  const first = await call(['render', '-'], WARNED);
  const second = await call(['render', '-', '--replace', first.file], WARNED);
  assert.ok(second.file !== first.file && existsSync(second.file));
  assert.ok(!existsSync(first.file));

  const done = await call(['render', '-', '--replace', second.file], FIXED);
  assert.equal(done.code, 0, done.err);
  assert.deepEqual(readdirSync(join(home, 'pages')), [basename(done.file)]);
  assert.deepEqual(opened, [done.file], 'only the page without warnings opens');
});

test('cli render: --replace takes only a page in pages/, and a failed render keeps the page', async (t) => {
  const { home, call } = retrying(t);
  const page = (await call(['render', '-'], WARNED)).file;

  const outside = join(home, 'keep.html');
  writeFileSync(outside, 'x');
  const refused = await call(['render', '-', '--replace', outside], FIXED);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /--replace takes a page that am render wrote/);
  assert.ok(existsSync(outside), 'a file outside pages/ is never deleted');
  assert.deepEqual(readdirSync(join(home, 'pages')), [basename(page)], 'a refused --replace renders nothing');

  const broken = await call(['render', '-', '--replace', page], '## A\n```flow\nA -> B');
  assert.equal(broken.code, 1);
  assert.ok(existsSync(page), 'the page stays when the new render fails');
});

test('cli lint: checks only; warnings under strict return 1; off skips the check', async () => {
  const bad = '## A\nUtilize the tool.';
  assert.equal((await run(['lint', '-'], { stdin: bad })).code, 0);
  assert.equal((await run(['lint', '-', '--style', 'strict'], { stdin: bad })).code, 1);
  assert.match((await run(['lint', '-', '--style', 'off'], { stdin: bad })).out, /STE check is off/);
  assert.equal((await run(['lint', '-', '--style', 'x'], { stdin: bad })).code, 2);
});

test('cli lint: reports the same warnings as render, in the language of the draft', async () => {
  const th = `---\nlang: th\n---\n## A Section\n${'ฉันกินข้าว'.repeat(10)}\n`; // lang-ok: draft text under test
  const fr = '---\nlang: fr\n---\n## A Section\nPlease utilize the valve, and prior to the test make sure it was closed by the operator.\n';
  const warnLines = (out) => out.split('\n').filter((l) => /^ {2}L\d+ \[/.test(l));
  for (const stdin of [th, fr, GOOD]) {
    const lint = warnLines((await run(['lint', '-'], { stdin })).out);
    const render = warnLines((await run(['render', '-'], { stdin })).out);
    assert.deepEqual(lint, render, `lint and render disagree on: ${stdin.slice(0, 40)}`);
  }
  // The language-neutral rules measure the Thai sentence in words; the English rules stay out of the French draft.
  assert.match(warnLines((await run(['lint', '-'], { stdin: th })).out)[0], /\[sentence-length\].*30 words/);
  assert.deepEqual(warnLines((await run(['lint', '-'], { stdin: fr })).out), []);
});

test('cli list / help', async () => {
  assert.match((await run(['list'])).out, /flow\s+Flowchart/);
  const h = await run(['help', 'sequence']);
  assert.match(h.out, /sequence — Sequence diagram[\s\S]*Example:\n```sequence/);
  assert.match((await run(['help', 'format'])).out, /template: sheet/);
  assert.match((await run(['help', 'patch'])).out, /#am-source/);
  assert.equal((await run(['help', 'nope'])).code, 2);
});

test('cli: usage, list, config and every help topic print English only', async () => {
  const { COMPONENTS } = await import('../src/components/index.js');
  const topics = [...COMPONENTS.keys(), 'html', 'svg', 'format', 'image', 'video', 'patch'];
  const runs = [[], ['list'], ['config'], ...topics.map((t) => ['help', t])];
  for (const args of runs) {
    const r = await run(args, { env: { AM_NO_OPEN: '1' } });
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out + r.err, /[\p{Script=Han}，。：；（）]/u, `am ${args.join(' ')}`);
  }
});

test('cli: invalid and missing arguments', async () => {
  assert.equal((await run(['bogus'])).code, 2);
  assert.equal((await run(['render'])).code, 2);
  assert.equal((await run(['render', 'missing.md'])).code, 2);
  assert.equal((await run(['render', '-'], { stdin: '   ' })).code, 2);
  assert.equal((await run(['render', '--wat'])).code, 2);
});

test('cli config: shows every setting, its current value and the config file path', async () => {
  const r = await run(['config']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /config\.json/);
  for (const key of ['open', 'theme', 'mode', 'style']) assert.match(r.out, new RegExp(`\\b${key}\\b`));
});

test('cli config: scale prints its range and step and accepts a number', async () => {
  const listed = await run(['config']);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /\bscale\s+1\s+.*\(0\.8–1\.5, step 0\.05\)/);
  assert.equal((await run(['config', 'set', 'scale', '1.15'])).code, 0);
  assert.equal((await run(['config', 'get', 'scale'])).out.trim(), '1.15');
  const bad = await run(['config', 'set', 'scale', '1.13']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /0\.8/);
  assert.match(bad.err, /0\.05/);
  await run(['config', 'reset', 'scale']);
});

test('cli config: set / get / reset, changed values are marked with *', async () => {
  assert.equal((await run(['config', 'set', 'theme', 'shadcn'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'shadcn');
  assert.match((await run(['config'])).out, /\* theme\s+shadcn/);
  const rendered = await run(['render', '-', '-o', 'cfg.html'], { stdin: '## A\nx' });
  assert.match(readFileSync(join(dir, 'cfg.html'), 'utf8'), /data-theme="shadcn"/, 'render reads the default theme from config');
  assert.equal(rendered.code, 0);
  assert.equal((await run(['config', 'reset', 'theme'])).code, 0);
  assert.equal((await run(['config', 'get', 'theme'])).out.trim(), 'auto');
});

test('cli patch: keeps the page scale even when the config scale changed', async (t) => {
  t.after(() => run(['config', 'reset', 'scale']));
  // An older page has no data-scale: it stays at 1 even when config now says 1.25.
  assert.equal((await run(['render', '-', '-o', 'plain-scale.html'], { stdin: '## A\nx\n\n## B\ny\n' })).code, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'plain-scale.html'), 'utf8'), /data-scale=/);
  assert.equal((await run(['config', 'set', 'scale', '1.25'])).code, 0);
  assert.equal((await run(['patch', 'plain-scale.html', '--panel', 'B'], { stdin: 'z\n' })).code, 0);
  const plain = readFileSync(join(dir, 'plain-scale.html'), 'utf8');
  assert.doesNotMatch(plain, /data-scale=|--am-scale:/);

  assert.equal((await run(['render', '-', '-o', 'scaled.html'], { stdin: '## A\nx\n\n## B\ny\n' })).code, 0);
  assert.match(readFileSync(join(dir, 'scaled.html'), 'utf8'), /data-scale="1\.25"/);
  assert.equal((await run(['config', 'set', 'scale', '1.5'])).code, 0);
  const r = await run(['patch', 'scaled.html', '--panel', 'B'], { stdin: 'z\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'scaled.html'), 'utf8');
  assert.match(html, /data-scale="1\.25"/);
  assert.match(html, /html \{ --am-scale: 1\.25; \}/);
});

test('cli video: never takes the config scale', async (t) => {
  assert.equal((await run(['config', 'set', 'scale', '1.25'])).code, 0);
  t.after(() => run(['config', 'reset', 'scale']));
  const r = await run(['video', '-', '--voice', 'off', '-o', 'scaled-video.html'], { stdin: '## A\n> Narration.\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'scaled-video.html'), 'utf8');
  assert.doesNotMatch(html, /data-scale=|--am-scale:/);
});

test('cli config: close_after_reply decides whether a rendered or patched page closes its tab after the reply is copied', async () => {
  const off = await run(['render', '-', '-o', 'off.html'], { stdin: '## A\nx' });
  assert.equal(off.code, 0, off.err);
  assert.doesNotMatch(readFileSync(join(dir, 'off.html'), 'utf8'), /closeAfter|am-closing/);
  assert.equal((await run(['config', 'set', 'close_after_reply', 'on'])).code, 0);
  const on = await run(['render', '-', '-o', 'on.html'], { stdin: '## A\nx' });
  assert.equal(on.code, 0, on.err);
  assert.match(readFileSync(join(dir, 'on.html'), 'utf8'), /&quot;closeAfter&quot;/);
  // A patch follows the setting at the time of the patch, like the theme and the style.
  assert.equal((await run(['patch', 'off.html', '--panel', 'A'], { stdin: '## A\ny' })).code, 0);
  assert.match(readFileSync(join(dir, 'off.html'), 'utf8'), /&quot;closeAfter&quot;/);
  await run(['config', 'reset']);
});

test('cli config: booleans print as on/off; an unknown key or invalid value returns 2', async () => {
  await run(['config', 'set', 'open', 'off']);
  assert.equal((await run(['config', 'get', 'open'])).out.trim(), 'off');
  await run(['config', 'reset']);
  const bad = await run(['config', 'set', 'theme', 'neon']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /blueprint \| shadcn/);
  assert.equal((await run(['config', 'set', 'nope', '1'])).code, 2);
  assert.equal((await run(['config', 'frob'])).code, 2);
});

function panelSection(html, id) {
  const m = html.match(new RegExp(`<section class="am-panel[^"]*" id="panel-${id}"[\\s\\S]*?</section>`));
  return m && m[0];
}

const THREE = `---
title: 三面板
---
## A 甲
甲旧文。
## B 乙
乙旧文。
## C 丙
丙旧文。
`;

test('cli patch: changing one panel after render keeps the other panels and writes back to the same file', async () => {
  const rendered = await run(['render', '-', '-o', 'page.html'], { stdin: THREE });
  assert.equal(rendered.code, 0, rendered.err);
  const file = rendered.out.match(/✓ (.+\.html)/)[1];
  assert.equal(file, join(dir, 'page.html'));
  const before = readFileSync(file, 'utf8');
  const beforeB = panelSection(before, 'B');
  const beforeC = panelSection(before, 'C');
  assert.match(before, /甲旧文/);
  assert.match(before, /乙旧文/);

  const patched = await run(['patch', 'page.html', '--panel', '甲'], { stdin: '## A 甲\n甲新文。\n' });
  assert.equal(patched.code, 0, patched.err);
  const outFile = patched.out.match(/✓ (.+\.html)/)[1];
  assert.equal(outFile, file, 'must overwrite the original HTML, not write a new timestamped file');

  const after = readFileSync(file, 'utf8');
  assert.match(after, /甲新文/);
  assert.doesNotMatch(after, /甲旧文/);
  assert.equal(panelSection(after, 'B'), beforeB, 'panel B, not named, stays unchanged');
  assert.equal(panelSection(after, 'C'), beforeC, 'panel C, not named, stays unchanged');
});

test('cli patch: --from reads a file; a missing panel or missing #am-source leaves the file unchanged', async () => {
  const rendered = await run(['render', '-', '-o', 'keep.html'], { stdin: THREE });
  const file = rendered.out.match(/✓ (.+\.html)/)[1];
  const original = readFileSync(file, 'utf8');
  writeFileSync(join(dir, 'panel.md'), '## B 乙\n乙新文。\n');

  const fromFile = await run(['patch', 'keep.html', '--panel', '乙', '--from', 'panel.md']);
  assert.equal(fromFile.code, 0, fromFile.err);
  const afterFrom = readFileSync(file, 'utf8');
  assert.match(afterFrom, /乙新文/);

  const missingPanel = await run(['patch', 'keep.html', '--panel', '不存在'], { stdin: 'x\n' });
  assert.equal(missingPanel.code, 1);
  assert.match(missingPanel.err, /No panel titled/);
  assert.equal(readFileSync(file, 'utf8'), afterFrom, 'a missing panel must not change the file');

  writeFileSync(join(dir, 'plain.html'), '<html><body>no source</body></html>');
  const beforePlain = readFileSync(join(dir, 'plain.html'), 'utf8');
  const noSource = await run(['patch', 'plain.html', '--panel', '甲'], { stdin: 'x\n' });
  assert.equal(noSource.code, 1);
  assert.match(noSource.err, /#am-source/);
  assert.equal(readFileSync(join(dir, 'plain.html'), 'utf8'), beforePlain);

  const noPanelFlag = await run(['patch', 'keep.html'], { stdin: 'x\n' });
  assert.equal(noPanelFlag.code, 2);

  assert.notEqual(original, readFileSync(file, 'utf8'));
});

test('shouldOpen: --no-open > AM_NO_OPEN > config open; --open forces opening', async () => {
  const { shouldOpen } = await import('../src/cli.js');
  assert.equal(shouldOpen({}, {}, { open: true }), true);
  assert.equal(shouldOpen({}, {}, { open: false }), false);
  assert.equal(shouldOpen({ 'no-open': true }, {}, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '1' }, { open: true }), false);
  assert.equal(shouldOpen({}, { AM_NO_OPEN: '0' }, { open: true }), true, 'AM_NO_OPEN=0 does not count as off');
  assert.equal(shouldOpen({}, { CI: 'true' }, { open: true }), false);
  assert.equal(shouldOpen({ open: true }, { AM_NO_OPEN: '1' }, { open: false }), true);
});

test('cli patch: a fake #am-source in the body must not overwrite the page', async () => {
  const src = `---
title: 假源
---
## A 真面板
真内容。
\`\`\`html
<textarea id="am-source">FAKE</textarea>
\`\`\`
## B 另一格
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-src.html'], { stdin: src })).code, 0);
  const patched = await run(['patch', 'fake-src.html', '--panel', '真面板'], {
    stdin: '## A 真面板\n已更新。\n```html\n<textarea id="am-source">FAKE</textarea>\n```\n',
  });
  assert.equal(patched.code, 0, patched.err);
  const after = readFileSync(join(dir, 'fake-src.html'), 'utf8');
  assert.match(after, /已更新/);
  assert.doesNotMatch(after, /真内容/);
  assert.match(after, /保留/);
});

test('cli patch: keeps the theme and template of the page; --theme on this run wins', async () => {
  const src = '---\ntitle: 保留主题\n---\n## A 一\n旧\n\n## B 二\n旧\n';
  assert.equal((await run(['render', '-', '-o', 'keep.html', '--theme', 'shadcn', '--template', 'doc'], { stdin: src })).code, 0);
  const r = await run(['patch', 'keep.html', '--panel', 'B'], { stdin: '新内容\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'keep.html'), 'utf8');
  assert.match(html, /data-theme="shadcn"/);
  assert.match(html, /<main class="am-doc/);
  assert.match(html, /新内容/);
  await run(['patch', 'keep.html', '--panel', 'A', '--theme', 'blueprint'], { stdin: '改主题\n' });
  assert.match(readFileSync(join(dir, 'keep.html'), 'utf8'), /data-theme="blueprint"/);
});

const STE_BAD = `---
title: 关检查
---
## A 甲
Utilize the tool.

## B 乙
保留。
`;

test('cli patch: keeps the data-style of the page instead of falling back to config strict', async (t) => {
  assert.equal((await run(['render', '-', '-o', 'style-off.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'style-off.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'style-off.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'style-off.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新文/);
  assert.match(html, /Utilize the tool/);
});

test('cli patch: --style on this run wins over the style stored in the page', async () => {
  assert.equal((await run(['render', '-', '-o', 'style-cli.html', '--style', 'off'], { stdin: STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'style-cli.html'), 'utf8');
  const r = await run(['patch', 'style-cli.html', '--panel', '乙', '--style', 'strict'], { stdin: '新文。\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE check failed/);
  assert.equal(readFileSync(join(dir, 'style-cli.html'), 'utf8'), before, 'a strict failure must not change the file');
});

test('cli patch: on an old page without data-style, the frontmatter style still wins over config', async (t) => {
  const src = `---
title: 旧页
style: off
---
## A 甲
Utilize the tool.

## B 乙
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'old-style.html'], { stdin: src })).code, 0);
  const stripped = readFileSync(join(dir, 'old-style.html'), 'utf8')
    .replace(/<html\b[^>]*>/, (tag) => tag.replace(/\sdata-style="[^"]*"/, ''));
  writeFileSync(join(dir, 'old-style.html'), stripped);
  assert.doesNotMatch(stripped.match(/<html\b[^>]*>/)[0], /data-style/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'old-style.html', '--panel', '乙'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'old-style.html'), 'utf8');
  assert.match(html, /新文/);
  assert.match(html, /data-style="off"/);
});

test('cli patch: a fake data-video in the body must not turn a sheet page into a video', async () => {
  const src = `---
title: 假视频
---
## A 说明
旧文。
\`\`\`html
<html lang="zh-CN" data-theme="blueprint" data-mode="light" data-video>
\`\`\`
## B 保留
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-video.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'fake-video.html', '--panel', '说明'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sheet ·/);
  assert.doesNotMatch(r.out, /\bvideo ·/);
  const html = readFileSync(join(dir, 'fake-video.html'), 'utf8');
  const root = html.match(/<html\b[^>]*>/)[0];
  assert.doesNotMatch(root, /data-video/);
  assert.match(html, /<main class="am-sheet/);
  assert.match(html, /新文/);
});

test('cli patch: a fake am-doc in the body must not re-render a sheet page as doc', async () => {
  const src = `---
title: 假文档
---
## A 说明
旧文。
\`\`\`html
<main class="am-doc">假目录</main>
\`\`\`
## B 保留
保留。
`;
  assert.equal((await run(['render', '-', '-o', 'fake-doc.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'fake-doc.html', '--panel', '说明'], { stdin: '新文。\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sheet ·/);
  assert.doesNotMatch(r.out, /doc ·/);
  const html = readFileSync(join(dir, 'fake-doc.html'), 'utf8');
  assert.equal(html.match(/<main class="am-(doc|sheet)\b/)[1], 'sheet');
  assert.match(html, /新文/);
});

test('cli patch: a video page made with --voice off stays silent and is not re-voiced from config', async () => {
  const src = '## 场景\n- 画面\n> 旁白。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '-o', 'silent.html'], { stdin: src })).code, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'silent.html'), 'utf8'), /<audio id="amv-audio"/);
  assert.equal((await run(['config', 'set', 'voice', 'system'])).code, 0);
  const r = await run(['patch', 'silent.html', '--panel', '场景'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /system TTS|Voice-over failed/);
  assert.match(r.out, /voice: none/);
  const html = readFileSync(join(dir, 'silent.html'), 'utf8');
  assert.doesNotMatch(html, /<audio id="amv-audio"/);
  assert.match(html, /新旁白|新画面/);
  assert.equal((await run(['config', 'reset', 'voice'])).code, 0);
});

test('cli patch: a video page keeps its theme (3b1b) and prints the video summary', async () => {
  const src = '## 场景\n```flow\nA -> B\n```\n> [A] 连到 B。\n';
  assert.equal((await run(['video', '-', '--voice', 'off', '--theme', '3b1b', '-o', 'v3b.html'], { stdin: src })).code, 0);
  const r = await run(['patch', 'v3b.html', '--panel', '场景', '--voice', 'off'], { stdin: '> 新旁白。\n```flow\nA -> C\n```\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video · 3b1b · 1 scene · 1 beat/);
  const html = readFileSync(join(dir, 'v3b.html'), 'utf8');
  assert.match(html, /data-theme="3b1b" data-mode="dark" data-style="80" data-video/);
  assert.match(html, /新旁白/);
});

const VIDEO_STE_BAD = `## 甲
- 画面
> 我们对系统进行优化。

## 乙
- 另一画面
> 第二句旁白。
`;

test('cli patch: a video page also keeps data-style instead of falling back to config strict', async (t) => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  assert.match(readFileSync(join(dir, 'vstyle.html'), 'utf8'), /data-style="off"/);
  assert.equal((await run(['config', 'set', 'style', 'strict'])).code, 0);
  t.after(() => run(['config', 'reset', 'style']));
  const r = await run(['patch', 'vstyle.html', '--panel', '乙', '--voice', 'off'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 0, r.err);
  const html = readFileSync(join(dir, 'vstyle.html'), 'utf8');
  assert.match(html, /data-style="off"/);
  assert.match(html, /新旁白|新画面/);
});

test('cli patch: on a video page, --style on this run wins over the style stored in the page', async () => {
  assert.equal((await run(['video', '-', '--voice', 'off', '--style', 'off', '-o', 'vstyle-cli.html'], { stdin: VIDEO_STE_BAD })).code, 0);
  const before = readFileSync(join(dir, 'vstyle-cli.html'), 'utf8');
  const r = await run(['patch', 'vstyle-cli.html', '--panel', '乙', '--voice', 'off', '--style', 'strict'], { stdin: '> 新旁白。\n- 新画面\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /STE check failed/);
  assert.equal(readFileSync(join(dir, 'vstyle-cli.html'), 'utf8'), before, 'a strict failure must not change the file');
});

test('render / patch: a newer version in state.json puts the new-version button on the page; AM_NO_UPDATE_CHECK turns it off', async () => {
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ latestVersion: '99.0.0', lastUpdateCheck: Date.now() }));
  try {
    const page = join(dir, 'update.html');
    assert.equal((await run(['render', '-', '-o', page, '--no-open'], { stdin: GOOD })).code, 0);
    assert.match(readFileSync(page, 'utf8'), /data-am="update"[^>]*>● <span class="am-update-text">[^<]*<bdi>99\.0\.0<\/bdi>/);
    assert.equal((await run(['patch', page, '--panel', 'A', '--no-open'], { stdin: '## A 流程\n改过的正文\n', env: { AM_NO_UPDATE_CHECK: '1' } })).code, 0);
    assert.doesNotMatch(readFileSync(page, 'utf8'), /am-update/);
    assert.equal((await run(['render', '-', '-o', page, '--no-open'], { stdin: GOOD, env: { AM_NO_UPDATE_CHECK: '1' } })).code, 0);
    assert.doesNotMatch(readFileSync(page, 'utf8'), /am-update/);
  } finally {
    rmSync(join(dir, 'state.json'), { force: true });
  }
});

// ── every draft error at once, and the kept draft ──

const THREE_ERRORS = [
  '## A 一', '```flow', 'A -> (未闭合 -> C', '```', '', // L1-L5
  '## B 二', '| a | b |', '| 1 | 2 |', '', // L6-L9
  '## C 三', '```flow', 'X -> (又一个 -> Y', '```', '', // L10-L14
].join('\n');

function freshHome() {
  const home = mkdtempSync(join(dir, 'home-'));
  return { home, env: { AM_HOME: home } };
}

test('cli render: every draft error is listed in line order, with a summary, and no page is written', async () => {
  const { home, env } = freshHome();
  const r = await run(['render', '-'], { stdin: THREE_ERRORS, env });
  assert.equal(r.code, 1);
  const lines = [...r.err.matchAll(/^✗ L(\d+) /gm)].map((m) => Number(m[1]));
  assert.deepEqual(lines, [3, 7, 12]);
  assert.match(r.err, /\[flow\].*\n {2}Correct example:[^]*Full syntax: am help flow[^]*✗ L7 Cannot parse the draft: table has no delimiter row[^]*✗ L12 \[flow\]/);
  assert.match(r.err, /✗ 3 errors in the draft; no page was written/);
  assert.ok(!existsSync(join(home, 'pages')), 'no page');
});

test('cli render: a single draft error prints as before, without a summary', async () => {
  const { env } = freshHome();
  const r = await run(['render', '-'], { stdin: '## A\n```flow\nA -> (未闭合 -> C\n```\n', env });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.err, /errors in the draft/);
});

test('cli render: errors past 20 are folded into a count', async () => {
  const { env } = freshHome();
  const blocks = Array.from({ length: 23 }, () => '```flow\nA -> (x -> B\n```\n').join('\n');
  const r = await run(['render', '-'], { stdin: `## A\n${blocks}`, env });
  assert.equal(r.code, 1);
  assert.equal([...r.err.matchAll(/^✗ L\d+ /gm)].length, 20);
  assert.match(r.err, /… 3 more/);
  assert.match(r.err, /✗ 23 errors in the draft/);
});

test('cli render: a failed stdin draft is saved verbatim under drafts/ and its path is printed', async () => {
  const { home, env } = freshHome();
  const r = await run(['render', '-'], { stdin: THREE_ERRORS, env });
  const path = r.err.match(/^ {2}draft: (.+)$/m)[1];
  assert.equal(dirname(path), join(home, 'drafts'));
  assert.match(basename(path), /^[^/]+-\d{8}-\d{6}\.md$/);
  assert.equal(readFileSync(path, 'utf8'), THREE_ERRORS);
});

test('cli render: a strict STE failure and a fatal parse error with a line keep the stdin draft too', async () => {
  const { home, env } = freshHome();
  const strict = await run(['render', '-', '--style', 'strict'], { stdin: '## A\nUtilize the tool.', env });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /^ {2}draft: /m);
  const fatal = await run(['render', '-'], { stdin: '## A\n```flow\nA -> B', env });
  assert.match(fatal.err, /^ {2}draft: /m);
  assert.equal(readdirSync(join(home, 'drafts')).length, 2);
});

test('cli render: an error without a draft line (an empty draft, a bad option) saves nothing', async () => {
  const { home, env } = freshHome();
  await run(['render', '-', '--theme', 'nope'], { stdin: '## A\ntext', env });
  assert.ok(!existsSync(join(home, 'drafts')));
});

test('cli render: a failed draft given as a file argument is not copied and prints no draft line', async () => {
  const { home, env } = freshHome();
  const file = join(dir, 'broken-file.md');
  writeFileSync(file, THREE_ERRORS);
  const r = await run(['render', file], { env });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.err, /^ {2}draft: /m);
  assert.ok(!existsSync(join(home, 'drafts')));
});

test('cli render: a draft in drafts/ is deleted once it renders with no warnings, and kept while it has warnings', async () => {
  const { home, env } = freshHome();
  const clean = await run(['render', '-'], { stdin: THREE_ERRORS.replace('(未闭合 -> C', 'B -> C').replace('(又一个 -> Y', 'X -> Y').replace('| 1 | 2 |', '|---|---|\n| 1 | 2 |'), env });
  assert.equal(clean.code, 0, clean.err);
  assert.ok(!existsSync(join(home, 'drafts')), 'a clean render from stdin saves nothing');

  const draft = join(home, 'drafts', 'x-20260101-000000.md');
  mkdirSync(join(home, 'drafts'), { recursive: true });
  writeFileSync(draft, '## A\nUtilize the tool.');
  const warned = await run(['render', draft], { env });
  assert.equal(warned.code, 0);
  assert.ok(existsSync(draft), 'warnings keep the draft');
  writeFileSync(draft, GOOD);
  const ok = await run(['render', draft], { env });
  assert.equal(ok.code, 0, ok.err);
  assert.ok(!existsSync(draft), 'a clean render deletes the draft');
});

test('cli render: a stdin draft with STE warnings is saved and the page is still written', async () => {
  const { home, env } = freshHome();
  const src = '## A\nUtilize the tool.';
  const r = await run(['render', '-'], { stdin: src, env });
  assert.equal(r.code, 0);
  assert.match(r.out, /STE 1 warning/);
  const path = r.out.match(/^ {2}draft: (.+)$/m)[1];
  assert.equal(readFileSync(path, 'utf8'), src);
  assert.equal(readdirSync(join(home, 'pages')).length, 1);
});

test('cli render: a draft that cannot be saved does not fail a render that wrote its page', async () => {
  const { home, env } = freshHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'drafts'), 'a file where the drafts folder goes');
  // The fallback is the temporary folder: point it at this test's folder, with a file in the way there too.
  const tmp = mkdtempSync(join(dir, 'tmp-'));
  const saved = Object.fromEntries(['TMPDIR', 'TEMP', 'TMP'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { TMPDIR: tmp, TEMP: tmp, TMP: tmp });
  let r;
  try {
    writeFileSync(tempHome(), 'a file where the temporary folder goes');
    r = await run(['render', '-'], { stdin: '## A\nUtilize the tool.', env });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /draft: /);
  assert.equal(readdirSync(join(home, 'pages')).length, 1);
});

test('cli video: a failed stdin video draft is saved under drafts/ as well', async () => {
  const { home, env } = freshHome();
  const src = '---\ntitle: V\n---\n## A\n| a | b |\n| 1 | 2 |\n> 一句。\n';
  const r = await run(['video', '-', '--voice', 'off'], { stdin: src, env });
  assert.equal(r.code, 1);
  const path = r.err.match(/^ {2}draft: (.+)$/m)[1];
  assert.equal(readFileSync(path, 'utf8'), src);
  assert.ok(path.startsWith(join(home, 'drafts')));
});
