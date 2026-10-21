import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(fileURLToPath(new URL('../skills/answer-me-with-html/SKILL.md', import.meta.url)), 'utf8');
const workflow = skill.split('## 2. Workflow (one Bash call)')[1]?.split('## 3. Draft format quick reference')[0];

test('skill: keep the default output, fall back to the temporary folder, and use -o only when asked or refused', () => {
  assert.ok(workflow, 'workflow section exists');
  const firstRender = workflow.indexOf('render - <<');
  const outputChoice = workflow.indexOf('Keep the default output');
  assert.ok(outputChoice >= 0 && outputChoice < firstRender, 'output guidance precedes the first render example');

  const guidance = workflow.slice(outputChoice, firstRender);
  assert.match(guidance, /cannot write to `~\/\.answer-me-with-html\/pages`/);
  assert.match(guidance, /saves the page in a private folder in the system temporary folder and says so/);
  assert.match(guidance, /the system may clear that folder/);
  assert.match(guidance, /only when the user wants the page in the workspace or the render fails with `Cannot write the page`/);
  assert.match(guidance, /-o "<absolute-workspace-path>\/\.tmp\/answers\/topic\.html"/);
  assert.match(guidance, /HTML file, not a folder.*creates missing parent directories/);
  assert.match(guidance, /`AM_HOME` only when the whole data directory must move/);

  const retry = workflow.slice(firstRender);
  assert.match(retry, /--replace .*for a page in the data directory's `pages\/` or the temporary folder's `pages\/`/);
  assert.match(retry, /page written with `-o`, reuse the same quoted `-o` HTML file path/);
});

test('skill: errors are read all at once and fixed in the saved draft, not in a new heredoc', () => {
  const read = skill.split('4. Read the output:')[1]?.split('\n5. Reply')[0] ?? '';
  assert.match(read, /lists every error of the draft at once, in line order/);
  assert.match(read, /`  draft: <path>`/);
  assert.match(read, /Change only the flagged lines in that file with your file-edit tool; do not send a new heredoc/);
  assert.match(read, /`am render <path>`; when a page was written, add `--replace` or reuse `-o` as the rule on rendering again below says/);
  assert.match(read, /Retry at most 2 rounds/);
});

test('skill: an unanswered ask is not agreement, in the new and the old reply wording', () => {
  const section = skill.split('## 5. When the user pastes a reply from a page')[1]?.split('\n## 6.')[0];
  assert.ok(section, 'reply section exists');
  const rule = section.split('\n').find((line) => line.includes('`(not answered; suggested: X)`')) ?? '';
  assert.match(rule, /`\(not answered; suggestion kept\)` from a page made by an older version/);
  assert.match(rule, /it is not agreement with X/);
  assert.match(rule, /ask about it in the chat/);
});
