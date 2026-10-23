import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL = readFileSync(fileURLToPath(new URL('../skills/answer-me-with-html/SKILL.md', import.meta.url)), 'utf8');

const section = (start, end) => {
  const from = SKILL.indexOf(start);
  assert.ok(from >= 0, `${start} is gone from SKILL.md`);
  const to = SKILL.indexOf(end, from + start.length);
  return SKILL.slice(from, to < 0 ? undefined : to);
};

const step1 = section('## 1. Decide: produce a page or not', '## 2. Workflow');
const alwaysOn = section('### Always-on mode', '## 2. Workflow');

// The audience boundary is the whole point of #320: a delegated report is not a user reply, so it
// gets the findings the parent asked for rather than a two-line answer plus a page link.
test('step 1: an internal report to another agent renders no page', () => {
  assert.match(step1, /An internal report returned to another agent is not one/);
  assert.match(step1, /render no page/);
  assert.match(step1, /return the text or structure it asked for/);
});

test('step 1: a page is allowed only when the delegated task explicitly asks for one', () => {
  assert.match(step1, /explicitly asks for a page or a video/);
  assert.match(step1, /delegation alone never authorizes a video/);
});

test('step 1: the decision is the audience and the request, not the host or agent name', () => {
  assert.match(step1, /not by the host or agent name/);
});

// Always-on inherits the same boundary; without this an inherited rule re-renders every subagent reply.
test('always-on: the internal-report exception is carried there too', () => {
  assert.match(alwaysOn, /internal report/);
  assert.match(alwaysOn, /render no page/);
  assert.match(alwaysOn, /explicitly asks for one/);
});

test('always-on: user-facing triggers are still there', () => {
  assert.match(alwaysOn, /attach a page/);
  assert.match(alwaysOn, /Do not skip it because "the answer is short"/);
});
