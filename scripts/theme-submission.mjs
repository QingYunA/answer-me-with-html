// A theme submitted as a GitHub issue (.github/ISSUE_TEMPLATE/theme.yml), for .github/workflows/theme-submission.yml.
//   node scripts/theme-submission.mjs check   read the issue from the event file, write comment.md, set the step outputs name= and ok=
//   node scripts/theme-submission.mjs write   check again, then write marketplace/themes/<name>.json (exit 1 when the theme has a problem)
// The issue text is untrusted. It is read from the event file ($GITHUB_EVENT_PATH), never from the command line or the shell,
// and the name is checked against the catalog rules before it is used in a path, a branch name or a step output.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogProblems } from '../src/themes/catalog-rules.js';
import { NAME } from '../src/themes/check.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THEMES_DIR = join(ROOT, 'marketplace/themes');
const RULES_URL = 'https://github.com/QingYunA/answer-me-with-html/blob/main/CONTRIBUTING.md#theme-catalog';

// The hidden first line of the bot comment: the workflow finds its own comment by it.
export const MARKER = '<!-- theme-submission -->';
const MAX_SHOWN = 20;
const MAX_MESSAGE = 300;

// An issue form writes "### <label>", a blank line and the answer, and "_No response_" for an empty answer.
const section = (body, label) => {
  const heads = [...body.matchAll(/^###[ \t]+(.+?)[ \t]*$/gm)];
  const at = heads.findIndex((m) => m[1].toLowerCase() === label.toLowerCase());
  if (at < 0) return '';
  const end = heads[at + 1]?.index ?? body.length;
  const value = body.slice(heads[at].index + heads[at][0].length, end).trim();
  return value === '_No response_' ? '' : value;
};

// The text of a ```json fence, or the text itself when the answer has no fence. The last line that closes the fence ends it,
// so a fence-like line inside the answer does not cut the theme short.
const unfence = (value) => value.match(/^(`{3,})[^\n]*\n([\s\S]*)\n\1[ \t]*$/)?.[2] ?? value;

// { name, text, licensed } from the body of a submission issue. An unknown format gives empty strings, which then fail the checks.
// licensed: the License box is ticked. The form requires it, but the author can untick it by editing the issue.
export function parseIssue(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  return {
    name: section(text, 'Theme name'),
    text: unfence(section(text, 'Theme JSON')).trim(),
    licensed: /^- \[[xX]\] /m.test(section(text, 'License')),
  };
}

// The bytes that go into marketplace/themes/: the same data, laid out one way for every theme.
export const catalogFile = (text) => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;

// { name, text, problems }. The rules run on the bytes that would be committed, so the 16 KB limit is the limit of the file.
export function checkSubmission(body, existingNames = []) {
  const { name, text, licensed } = parseIssue(body);
  let file = text;
  try {
    file = catalogFile(text);
  } catch {
    // Not JSON: the rules report it.
  }
  const problems = catalogProblems(name, file, { existing: existingNames });
  if (!licensed) problems.push({ field: 'agreement', message: 'Tick the License box: you made this theme and license it under the license in the file.' });
  return { name, text, problems };
}

// Text from the issue, safe inside a code fence and in a comment: no backtick (it could close the fence), no @ (it could mention a person), one short line.
const plain = (s) => String(s).replace(/`/g, "'").replace(/@/g, '@\u200b').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);

// The Markdown of the bot comment. Everything that comes from the issue stays inside the code fence.
export function commentBody({ name, problems }) {
  if (!problems.length) {
    return `${MARKER}\nThe theme \`${name}\` passes the catalog checks. A maintainer will review it before it goes into the catalog.\n`;
  }
  const shown = problems.slice(0, MAX_SHOWN).map((p) => `${plain(p.field)}: ${plain(p.message)}`);
  if (problems.length > MAX_SHOWN) shown.push(`... and ${problems.length - MAX_SHOWN} more.`);
  return [
    MARKER,
    'This theme does not pass the catalog checks yet. Edit the issue to fix the problems below; the checks run again each time you save.',
    '',
    '```text',
    ...shown,
    '```',
    '',
    `The rules are in [CONTRIBUTING.md](${RULES_URL}).`,
    '',
  ].join('\n');
}

export const existingNames = (dir = THEMES_DIR) =>
  (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

// Write the theme file of a submission that passes. Throws when it has a problem, before any path is built from the name.
export function writeSubmission(body, dir = THEMES_DIR) {
  const { name, text, problems } = checkSubmission(body, existingNames(dir));
  if (problems.length || !NAME.test(name)) {
    throw new Error(`The submission does not pass the catalog checks:\n${problems.map((p) => `  ${plain(p.field)}: ${plain(p.message)}`).join('\n')}`);
  }
  const file = join(dir, `${name}.json`);
  writeFileSync(file, catalogFile(text), { flag: 'wx' });
  return file;
}

const issueBody = (env) => {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  return event.issue?.body ?? '';
};

// Step outputs are lines of name=value: a value with a newline could add an output of its own, so the name is only passed on when it is valid.
function check(env, cwd) {
  const result = checkSubmission(issueBody(env), existingNames());
  writeFileSync(join(cwd, 'comment.md'), commentBody(result));
  const ok = result.problems.length === 0;
  const out = `name=${NAME.test(result.name) ? result.name : ''}\nok=${ok}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, out);
  else process.stdout.write(out);
  console.log(ok ? `theme ${result.name}: ok` : `theme submission: ${result.problems.length} problem(s)`);
}

function write(env) {
  try {
    console.log(`wrote ${writeSubmission(issueBody(env))}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (!process.env.GITHUB_EVENT_PATH || !['check', 'write'].includes(command)) {
    console.error('usage: GITHUB_EVENT_PATH=<event.json> node scripts/theme-submission.mjs check|write');
    process.exit(2);
  }
  if (command === 'check') check(process.env, process.cwd());
  else write(process.env);
}
