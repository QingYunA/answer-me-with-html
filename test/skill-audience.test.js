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
const step5 = section('5. Reply in the terminal', '\n## ');

// One test per acceptance scenario of #320: a delegated report is not a user reply, so it gets the
// findings the parent asked for rather than a two-line answer plus a page link.
test('#320 scenario 1: a delegated research report returns findings and renders no page', () => {
  assert.match(step1, /An internal report returned to another agent is not one/);
  assert.match(step1, /delegated research, implementation, a review or a progress report, return the text or structure it asked for, with the findings and the evidence\. Render no page\./);
});

test('#320 scenario 2: an inherited always-on rule does not make a page for a review report', () => {
  assert.match(alwaysOn, /internal-report rule of step 1 applies here too/);
  assert.match(alwaysOn, /inherits the always-on rule renders no page/);
});

test('#320 scenario 3: the parent\'s reply to the user keeps the normal page rules', () => {
  assert.match(step1, /Its reply to the user follows the normal rules of this section/);
  assert.match(alwaysOn, /attach a page/);
  assert.match(alwaysOn, /Do not skip it because "the answer is short"/);
});

test('#320 scenario 4: a page the parent asked for comes back with the verification details', () => {
  assert.match(step1, /explicitly asks for a page, render it, and return the page path together with the verification details/);
  assert.match(step5, /If a parent agent asked for the page, also return the verification details it asked for/);
});

test('#320 scenario 5: delegation alone never starts a video', () => {
  assert.match(step1, /A video needs an explicit video request; delegation alone never authorizes one/);
  assert.match(SKILL, /Use only when the user explicitly asks for a video/);
});

test('#320: the audience is judged by recipient and request, and the description is for user replies', () => {
  assert.match(step1, /not by the host or agent name/);
  assert.match(SKILL.split('\n---')[0], /proactively and liberally in replies to the user/);
});

// Review on #324: the always-on bullet and step 5 must agree with step 1's explicit-page case.
test('#320 review: always-on keeps the explicit-page exception, and the line limit is for user replies', () => {
  assert.match(alwaysOn, /renders no page, unless the delegated task explicitly asks for one/);
  assert.match(step5, /The 2–3 line limit is for replies to the user/);
});
