// The YAML header of skill and command files must parse with a strict YAML parser: npx skills and every agent load the skill with one.
// Our own draft parser splits by line and is more lenient, so it cannot catch these problems (see PR #2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// skills/ is also the plugin root, so it holds commands/ and .claude-plugin/ beside the skill directories.
const skillDirs = () => readdirSync(join(ROOT, 'skills')).filter((d) => existsSync(join(ROOT, 'skills', d, 'SKILL.md')));

function frontmatterFiles() {
  const skills = skillDirs().map((d) => join('skills', d, 'SKILL.md'));
  const commands = readdirSync(join(ROOT, 'skills/commands')).filter((f) => f.endsWith('.md')).map((f) => join('skills/commands', f));
  return [...skills, ...commands];
}

function frontmatter(file) {
  const m = readFileSync(join(ROOT, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} has no YAML header`);
  return parse(m[1], { strict: true, uniqueKeys: true });
}

test('frontmatter: the YAML header of every SKILL.md and command file parses strictly', () => {
  const files = frontmatterFiles();
  assert.ok(files.length >= 2);
  for (const file of files) {
    let data;
    assert.doesNotThrow(() => { data = frontmatter(file); }, `${file} has an invalid YAML header`);
    assert.equal(typeof data.description, 'string', `${file} needs a string description`);
    assert.ok(data.description.trim().length > 0, `${file} has an empty description`);
  }
});

test('frontmatter: the SKILL.md description stays within the Claude Code limit of 1536 characters', () => {
  for (const dir of skillDirs()) {
    const fm = frontmatter(join('skills', dir, 'SKILL.md'));
    const len = `${fm.description}${fm.when_to_use ?? ''}`.length;
    assert.ok(len <= 1536, `${dir}: description has ${len} characters; the excess is cut off in the skill list`);
  }
});

test('frontmatter: the SKILL.md description stays within the Agent Skills spec limit of 1024 characters', () => {
  // Over the limit, strict hosts (such as zcode) drop the whole skill with no visible error (see issue #23).
  for (const dir of skillDirs()) {
    const len = [...frontmatter(join('skills', dir, 'SKILL.md')).description].length;
    assert.ok(len <= 1024, `${dir}: description has ${len} characters; the spec limit is 1024`);
  }
});

test('frontmatter: the SKILL.md name matches its directory name', () => {
  for (const dir of skillDirs()) {
    assert.equal(frontmatter(join('skills', dir, 'SKILL.md')).name, dir);
  }
});
