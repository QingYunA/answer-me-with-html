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
// The website editor reads an issue with the same parser (/themes/new/?issue=<n>), so the two never disagree.
import { parseIssue } from '../src/themes/submission-issue.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THEMES_DIR = join(ROOT, 'marketplace/themes');
const EDITOR_URL = 'https://answer-me-with-html.com/themes/new/';
const RULES_URL = 'https://github.com/QingYunA/answer-me-with-html/blob/main/CONTRIBUTING.md#theme-catalog';

// The hidden first line of the bot comment: the workflow finds its own comment by it.
export const MARKER = '<!-- theme-submission -->';
const MAX_SHOWN = 20;
const MAX_MESSAGE = 300;

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

// The last line of the bot comment: the editor page loads the theme of the issue and draws it. The number comes from the event, so it is
// checked to be digits before it goes into a link.
const renderedLink = (number) => (/^[1-9]\d{0,9}$/.test(String(number)) ? `[See it rendered](${EDITOR_URL}?issue=${number})\n` : '');

// The Markdown of the bot comment. Everything that comes from the issue stays inside the code fence.
export function commentBody({ name, problems, number }) {
  if (!problems.length) {
    return `${MARKER}\nThe theme \`${name}\` passes the catalog checks. A maintainer will review it before it goes into the catalog.\n\n${renderedLink(number)}`.trimEnd().concat('\n');
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
    renderedLink(number),
  ].join('\n').trimEnd().concat('\n');
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

const readIssue = (env) => JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).issue ?? {};
const issueBody = (env) => readIssue(env).body ?? '';

// Step outputs are lines of name=value: a value with a newline could add an output of its own, so the name is only passed on when it is valid.
function check(env, cwd) {
  const issue = readIssue(env);
  const result = checkSubmission(issue.body ?? '', existingNames());
  writeFileSync(join(cwd, 'comment.md'), commentBody({ ...result, number: issue.number }));
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
