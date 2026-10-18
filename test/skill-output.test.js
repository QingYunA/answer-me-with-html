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
