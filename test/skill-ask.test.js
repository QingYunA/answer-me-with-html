import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL = readFileSync(fileURLToPath(new URL('../skills/answer-me-with-html/SKILL.md', import.meta.url)), 'utf8');
const line = (start) => SKILL.split('\n').find((l) => l.startsWith(start)) ?? '';

// A choice tool (AskUserQuestion) blocks the turn. If the page link only comes in the reply after it,
// the user answers the page's questions without seeing the page.
test('ask rule: write the page link before a choice tool asks the page questions', () => {
  const rule = line('- Use `ask` only');
  assert.match(rule, /choice tool/);
  assert.match(rule, /page link, then call the tool/);
});

test('step 5: a choice tool for the asks is the one tool call allowed after the reply', () => {
  assert.match(line('5. Reply in the terminal'), /No tool call comes after the reply, except a choice tool for the page's asks/);
});
