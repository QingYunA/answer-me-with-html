import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL = 'skills/answer-me-with-html';
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const skill = read(`${SKILL}/SKILL.md`);

// `${CLAUDE_SKILL_DIR}` is replaced by Claude Code only. Other hosts (opencode, Copilot, Continue)
// leave it empty, so a command written as "${CLAUDE_SKILL_DIR}/scripts/am.mjs" runs node on
// /scripts/am.mjs and fails with Cannot find module. The skill resolves $SKILL_DIR once instead, and
// these tests pin that every command goes through it.

test('skill dir: SKILL.md resolves $SKILL_DIR from the host variable, with a guard', () => {
  assert.match(skill, /SKILL_DIR="\$\{CLAUDE_SKILL_DIR\}"/);
  assert.match(skill, /\[ -f "\$SKILL_DIR\/scripts\/am\.mjs" \] \|\| SKILL_DIR="/,
    'a host that does not fill the variable must be forced to write the path out');
  assert.match(skill, /test -f "\$SKILL_DIR\/scripts\/am\.mjs" \|\| \{/,
    'an empty or wrong SKILL_DIR has to fail loudly instead of running /scripts/am.mjs');
});

test('skill dir: the resolution rule comes before the first command that uses it', () => {
  const rule = skill.indexOf('SKILL_DIR="${CLAUDE_SKILL_DIR}"');
  assert.ok(rule > 0, 'the resolution rule is missing');
  const firstUse = skill.search(/node "\$SKILL_DIR\/scripts\/am\.mjs"/);
  assert.ok(firstUse > rule, 'a command uses $SKILL_DIR before the rule that defines it');
  for (const rel of ['references/settings.md', 'references/video.md']) {
    assert.ok(skill.indexOf(rel) === -1 || skill.indexOf(rel) > rule,
      `${rel} is referenced before $SKILL_DIR is resolved`);
  }
});

test('skill dir: no file still invokes the CLI through the unreplaced host variable', () => {
  const files = [`${SKILL}/SKILL.md`, ...readdirSync(`${ROOT}/${SKILL}/references`).map((f) => `${SKILL}/references/${f}`)];
  for (const file of files) {
    const body = read(file);
    // The resolution rule itself is the only place the host variable may appear.
    const stripped = body.replace('SKILL_DIR="${CLAUDE_SKILL_DIR}"', '').replace(/`\$\{CLAUDE_SKILL_DIR\}`/g, '');
    const bad = stripped.match(/\$\{CLAUDE_SKILL_DIR\}\/[^\s`"]+/g) || [];
    assert.deepEqual(bad, [], `${file} runs a path that only Claude Code substitutes: ${bad.join(', ')}`);
  }
});

test('skill dir: every file the skill tells you to read or run exists', () => {
  const files = [`${SKILL}/SKILL.md`, ...readdirSync(`${ROOT}/${SKILL}/references`).map((f) => `${SKILL}/references/${f}`)];
  let checked = 0;
  for (const file of files) {
    for (const [, rel] of read(file).matchAll(/\$SKILL_DIR\/([\w./-]+)/g)) {
      checked += 1;
      assert.ok(existsSync(`${ROOT}/${SKILL}/${rel}`), `${file}: $SKILL_DIR/${rel} does not exist`);
    }
  }
  assert.ok(checked >= 4, `only ${checked} $SKILL_DIR paths found; the commands must go through the variable`);
});
