import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(fileURLToPath(new URL('../skills/answer-me-with-html/SKILL.md', import.meta.url)), 'utf8');
const workflow = skill.split('## 2. Workflow (one Bash call)')[1]?.split('## 3. Draft format quick reference')[0];

test('skill: choose a writable HTML output before the first render and reuse it on retries', () => {
  assert.ok(workflow, 'workflow section exists');
  const firstRender = workflow.indexOf('render - <<');
  const outputChoice = workflow.indexOf('Before rendering, choose the output');
  assert.ok(outputChoice >= 0 && outputChoice < firstRender, 'output choice precedes the first render example');

  const guidance = workflow.slice(outputChoice, firstRender);
  assert.match(guidance, /actual write permissions/);
  assert.match(guidance, /default output when .* is writable/);
  assert.match(guidance, /writes are limited to the workspace, permissions are unknown, or the default render fails/);
  assert.match(guidance, /-o "<absolute-workspace-path>\/\.tmp\/answers\/topic\.html"/);
  assert.match(guidance, /HTML file, not a folder.*creates missing parent directories/);

  const retry = workflow.slice(firstRender);
  assert.match(retry, /--replace .*for a page in the data directory's `pages\/`/);
  assert.match(retry, /page written with `-o`, reuse the same quoted `-o` HTML file path/);
});
