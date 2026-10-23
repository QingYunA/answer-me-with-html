import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL = readFileSync(fileURLToPath(new URL('../skills/answer-me-with-html/SKILL.md', import.meta.url)), 'utf8');
const line = (start) => SKILL.split('\n').find((l) => l.startsWith(start)) ?? '';

// A choice tool (AskUserQuestion) blocks the turn. If the page link only comes in the
// reply after it, the user answers the page's questions without seeing the page.
test('ask rule: the reply carries the page link before that tool asks', () => {
  const rule = line('- Use `ask` only');
  assert.match(rule, /choice tool/);
  assert.match(rule, /after the reply, never before it/);
  assert.match(rule, /reply carries the page link/);
});

// The same rule has to name the host condition Step 5 uses, or a host without a
// question tool cannot follow both instructions (#233 review).
test('ask rule: the choice tool is scoped to hosts that can ask questions', () => {
  assert.match(line('- Use `ask` only'), /If your host can ask questions/);
});

test('step 5: that choice tool is the one call allowed after the reply, on those hosts only', () => {
  const step = line('5. Reply in the terminal');
  assert.match(step, /No tool call comes after the reply, except the choice tool/);
  assert.match(step, /your host can ask questions/);
});

// Always-on mode is where the old ordering was most likely to be followed blindly.
test('always-on ordering bullet names the same condition', () => {
  const bullet = SKILL.split('\n').find((l) => l.startsWith('- Order: render the page first')) ?? '';
  assert.ok(bullet, 'the always-on ordering bullet is gone');
  assert.match(bullet, /when your host can ask questions/);
});
