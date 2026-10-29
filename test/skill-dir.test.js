import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL = 'skills/answer-me-with-html';
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const skillFiles = () => [
  `${SKILL}/SKILL.md`,
  ...readdirSync(`${ROOT}/${SKILL}/references`).map((f) => `${SKILL}/references/${f}`),
];
const skill = read(`${SKILL}/SKILL.md`);

// `${CLAUDE_SKILL_DIR}` is substituted by Claude Code in the text of SKILL.md, so every command in the
// skill spells it out and runs there unchanged. Other hosts leave the token as it stands, and no shell
// variable can carry the path for them: the Bash tool keeps nothing from one call to the next and a
// file-read tool never expands a variable. So the skill tells those hosts to write the absolute path
// into every command instead of defining one, and these tests pin that shape.

test('skill dir: no file defines a path variable that has to outlive one call', () => {
  for (const file of skillFiles()) {
    const body = read(file);
    assert.doesNotMatch(body, /\bSKILL_DIR=/, `${file} assigns a shell variable for the skill directory`);
    assert.doesNotMatch(body, /\$SKILL_DIR\b/, `${file} reads a shell variable for the skill directory`);
  }
});

test('skill dir: every command spells out the host variable instead of a relative path', () => {
  let commands = 0;
  for (const file of skillFiles()) {
    for (const line of read(file).split('\n')) {
      if (!/^\s*node\s/.test(line)) continue;
      commands += 1;
      assert.ok(line.includes('${CLAUDE_SKILL_DIR}/scripts/am.mjs'),
        `${file} runs node on a path that is not the host variable: ${line.trim()}`);
    }
  }
  assert.ok(commands >= 3, `only ${commands} node commands found; the skill must keep them in the file`);
});

test('skill dir: the other-host rule is firm, comes before the first command, and is checked once', () => {
  const rule = skill.indexOf('in place of `${CLAUDE_SKILL_DIR}`');
  assert.ok(rule > 0, 'the rule for hosts that do not substitute the token is missing');
  assert.match(skill, /test -f "<that directory>\/scripts\/am\.mjs"/,
    'the rule has to give the one check that proves the directory is this skill\'s, quoted so a path with a space works');
  assert.match(skill, /keeps no variable from one call to the next/,
    'the rule has to say why a variable cannot carry the path, or an agent will define one anyway');
  const firstCommand = skill.search(/^\s*node\s+\S+\s+(render|patch|video)\b/m);
  assert.ok(firstCommand > rule, 'a command comes before the rule that tells other hosts how to run it');
});

test('skill dir: every file the skill names through the token exists', () => {
  let checked = 0;
  for (const file of skillFiles()) {
    for (const [, rel] of read(file).matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)) {
      checked += 1;
      assert.ok(existsSync(`${ROOT}/${SKILL}/${rel}`), `${file}: ${rel} does not exist`);
    }
  }
  assert.ok(checked >= 4, `only ${checked} paths found through the token; the references must keep them`);
});