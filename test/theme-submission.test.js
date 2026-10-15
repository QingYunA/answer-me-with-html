// scripts/theme-submission.mjs: read a theme submission issue, check it with the catalog rules, write the bot comment and the catalog file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER, catalogFile, checkSubmission, commentBody, existingNames, writeSubmission } from '../scripts/theme-submission.mjs';
import { parseIssue } from '../src/themes/submission-issue.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/theme-submission.mjs');
const COMIC = readFileSync(join(ROOT, 'marketplace/themes/comic.json'), 'utf8');

const tmp = () => mkdtempSync(join(tmpdir(), 'am-submission-'));
const compact = (text = COMIC) => JSON.stringify(JSON.parse(text));

// The body GitHub makes from .github/ISSUE_TEMPLATE/theme.yml.
const issue = ({ name = 'comic-two', json = COMIC, fence = true, ticked = true } = {}) => [
  '### Theme name', '', name, '',
  '### Theme JSON', '', fence ? `\`\`\`json\n${json}\n\`\`\`` : json, '',
  '### License', '', `- [${ticked ? 'X' : ' '}] I made this theme, and I license it under the license in the file.`,
].join('\n');

test('checkSubmission: the License box must stay ticked', () => {
  assert.equal(parseIssue(issue()).licensed, true);
  assert.deepEqual(checkSubmission(issue({ ticked: false }), []).problems.map((p) => p.field), ['agreement']);
});

test('parseIssue: reads the name and the JSON of an issue form', () => {
  const { name, text } = parseIssue(issue());
  assert.equal(name, 'comic-two');
  assert.deepEqual(JSON.parse(text), JSON.parse(COMIC));
});

test('parseIssue: reads JSON with and without the code fence', () => {
  assert.deepEqual(JSON.parse(parseIssue(issue({ fence: false })).text), JSON.parse(COMIC));
  assert.equal(parseIssue(issue({ json: '{"a": 1}' })).text, '{"a": 1}');
  assert.equal(parseIssue(issue({ fence: false, json: '{"a": 1}' })).text, '{"a": 1}');
});

test('parseIssue: a longer fence and a fence-like line inside the JSON do not cut the theme short', () => {
  const body = '### Theme name\n\nx\n\n### Theme JSON\n\n````json\n{"css": "a"}\n```\n{"b": 1}\n````\n';
  assert.equal(parseIssue(body).text, '{"css": "a"}\n```\n{"b": 1}');
});

test('parseIssue: accepts CRLF line breaks and extra whitespace', () => {
  const body = issue({ name: '  comic-two  ' }).replace(/\n/g, '\r\n');
  const { name, text } = parseIssue(body);
  assert.equal(name, 'comic-two');
  assert.deepEqual(JSON.parse(text), JSON.parse(COMIC));
  assert.equal(parseIssue('###   Theme name  \n\n\n\n  x  \n\n\n### Theme JSON\n\n{}\n').name, 'x');
});

test('parseIssue: "_No response_", missing sections and other text give empty values', () => {
  assert.deepEqual(parseIssue('### Theme name\n\n_No response_\n\n### Theme JSON\n\n_No response_\n'), { name: '', text: '', licensed: false });
  assert.deepEqual(parseIssue('### Theme name\n\nx\n'), { name: 'x', text: '', licensed: false });
  assert.deepEqual(parseIssue('Please add my theme!'), { name: '', text: '', licensed: false });
  assert.deepEqual(parseIssue(null), { name: '', text: '', licensed: false });
  assert.deepEqual(parseIssue(undefined), { name: '', text: '', licensed: false });
});

test('checkSubmission: a catalog file under a new name passes', () => {
  const result = checkSubmission(issue(), ['comic', 'manga', 'pop']);
  assert.deepEqual(result.problems, []);
  assert.equal(result.name, 'comic-two');
});

test('checkSubmission: lists the problems of a bad name, a taken name and bad JSON', () => {
  assert.deepEqual(checkSubmission(issue({ name: 'Blueprint' })).problems.map((p) => p.field), ['name']);
  assert.deepEqual(checkSubmission(issue({ name: 'pop' }), ['pop']).problems.map((p) => p.field), ['name']);
  assert.deepEqual(checkSubmission(issue({ json: '{ nope' })).problems.map((p) => p.field), ['json']);
  assert.ok(checkSubmission('Please add my theme!').problems.length >= 2);
});

test('checkSubmission: the 16 KB limit applies to the file that would be committed, not to the pasted text', () => {
  // A minified theme just under the limit grows when it is laid out with 2 spaces, and that is the size that counts.
  const data = JSON.parse(COMIC);
  data.description.zh = '';
  data.description.zh = 'x'.repeat(16 * 1024 - 1 - Buffer.byteLength(JSON.stringify(data)));
  const text = JSON.stringify(data);
  assert.ok(Buffer.byteLength(text) < 16 * 1024);
  assert.ok(Buffer.byteLength(catalogFile(text)) > 16 * 1024);
  assert.ok(checkSubmission(issue({ json: text })).problems.some((p) => p.field === 'size'));
});

test('catalogFile: 2-space JSON with a final newline, the same data', () => {
  const file = catalogFile(compact());
  assert.equal(file, `${JSON.stringify(JSON.parse(COMIC), null, 2)}\n`);
  assert.deepEqual(JSON.parse(file), JSON.parse(COMIC));
  assert.equal(catalogFile(COMIC), COMIC, 'a file that is already laid out this way comes back unchanged');
});

test('commentBody: a passing theme starts with the marker and says a maintainer will review it', () => {
  const body = commentBody(checkSubmission(issue(), []));
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.equal(MARKER, '<!-- theme-submission -->');
  assert.match(body, /`comic-two` passes the catalog checks/);
  assert.match(body, /A maintainer will review it/);
  assert.doesNotMatch(body, /does not pass/);
});

test('commentBody: a failing theme lists the problems inside a code fence', () => {
  const body = commentBody(checkSubmission(issue({ name: 'Blueprint' }), []));
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.match(body, /does not pass the catalog checks/);
  assert.match(body, /```text\nname: The name must use lowercase letters, digits and -/);
  assert.doesNotMatch(body, /themes\/new/, 'no issue number, no link');
});

test('commentBody: both comments end with a link that shows the theme rendered', () => {
  const link = '[See it rendered](https://answer-me-with-html.com/themes/new/?issue=249)\n';
  const pass = commentBody({ ...checkSubmission(issue(), []), number: 249 });
  assert.ok(pass.endsWith(`catalog.\n\n${link}`), pass);
  const fail = commentBody({ ...checkSubmission(issue({ name: 'Blueprint' }), []), number: 249 });
  assert.ok(fail.endsWith(`\n\n${link}`), fail);
  assert.ok(fail.indexOf('```text') < fail.indexOf('See it rendered'), 'the link is outside the code fence');
});

test('commentBody: only a plain issue number goes into the link', () => {
  for (const number of ['1) [x](https://evil.example', '0', -3, 1.5, null, undefined, '', '12 34']) {
    assert.doesNotMatch(commentBody({ name: 'x', problems: [], number }), /See it rendered/, String(number));
  }
  assert.match(commentBody({ name: 'x', problems: [], number: '77' }), /themes\/new\/\?issue=77\)/);
});

test('commentBody: user text cannot close the fence or mention anyone', () => {
  const evil = '```\n@octocat <!-- theme-submission --> [x](https://example.com)\n```';
  const body = commentBody({ name: evil, problems: [{ field: evil, message: `Bad ${evil} @everyone` }] });
  const fenceLines = body.split('\n').filter((l) => l.startsWith('```'));
  assert.deepEqual(fenceLines, ['```text', '```'], 'one fence, opened and closed by us');
  const inside = body.split('```text\n')[1].split('\n```')[0];
  assert.doesNotMatch(inside, /`|\n.*\n/);
  assert.doesNotMatch(body, /@(?!​)/);
  // The only text outside the fence is ours.
  assert.doesNotMatch(body.replace(/```text[\s\S]*?\n```/, ''), /octocat|everyone|example\.com/);
});

test('commentBody: a long problem list is cut', () => {
  const problems = Array.from({ length: 50 }, (_, i) => ({ field: 'css', message: `Problem ${i}.` }));
  const body = commentBody({ name: 'x', problems });
  assert.match(body, /\.\.\. and 30 more\./);
  assert.doesNotMatch(body, /Problem 25/);
});

test('existingNames: the file names of a folder without .json', () => {
  assert.deepEqual(existingNames().sort(), readdirSync(join(ROOT, 'marketplace/themes')).map((f) => f.replace(/\.json$/, '')).sort());
  assert.deepEqual(existingNames(join(tmpdir(), 'am-no-such-folder')), []);
});

test('writeSubmission: writes the catalog file for a passing submission', () => {
  const dir = tmp();
  try {
    const file = writeSubmission(issue({ json: compact() }), dir);
    assert.equal(file, join(dir, 'comic-two.json'));
    assert.equal(readFileSync(file, 'utf8'), COMIC);
    assert.throws(() => writeSubmission(issue({ json: compact() }), dir), /already has a theme named "comic-two"/, 'a name in the catalog is not overwritten');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSubmission: refuses a bad name before it builds a path', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'themes'));
  try {
    for (const name of ['../x', 'Blueprint', 'blueprint', 'index', '', 'a/b', '..', 'a\nb']) {
      assert.throws(() => writeSubmission(issue({ name }), join(dir, 'themes')), /does not pass the catalog checks/, JSON.stringify(name));
    }
    assert.deepEqual(readdirSync(join(dir, 'themes')), []);
    assert.deepEqual(readdirSync(dir), ['themes'], 'nothing was written above the folder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The command line, with an event file like the one GitHub sets in $GITHUB_EVENT_PATH.
function run(command, body, cwd) {
  const event = join(cwd, 'event.json');
  const output = join(cwd, 'output.txt');
  writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 7, body, user: { login: 'someone' } } }));
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [SCRIPT, command], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } });
  return { ...result, output: readFileSync(output, 'utf8') };
}

test('check: writes comment.md and the step outputs for a passing submission', () => {
  const cwd = tmp();
  try {
    const r = run('check', issue(), cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output, 'name=comic-two\nok=true\n');
    const comment = readFileSync(join(cwd, 'comment.md'), 'utf8');
    assert.match(comment, /^<!-- theme-submission -->\nThe theme `comic-two` passes/);
    assert.ok(comment.endsWith('[See it rendered](https://answer-me-with-html.com/themes/new/?issue=7)\n'), 'the issue number of the event is in the link');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('check: a failing submission still exits 0 so the workflow can post the comment', () => {
  const cwd = tmp();
  try {
    const r = run('check', issue({ name: 'pop' }), cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output, 'name=pop\nok=false\n');
    assert.match(readFileSync(join(cwd, 'comment.md'), 'utf8'), /already has a theme named "pop"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('check: a name with a line break cannot add a step output', () => {
  const cwd = tmp();
  try {
    const r = run('check', issue({ name: 'x\nok=true' }), cwd);
    assert.equal(r.output, 'name=\nok=false\n');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('write: refuses a bad name and writes nothing', () => {
  const cwd = tmp();
  const before = readdirSync(join(ROOT, 'marketplace/themes')).sort();
  try {
    for (const name of ['../x', 'Blueprint']) {
      const r = run('write', issue({ name }), cwd);
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, /does not pass the catalog checks/);
    }
    assert.deepEqual(readdirSync(join(ROOT, 'marketplace/themes')).sort(), before);
    assert.ok(!existsSync(join(ROOT, 'marketplace/x.json')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the command line needs an event file and a known command', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'check'], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
