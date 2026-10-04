// Skill / 命令文件的 YAML 头必须能被严格的 YAML 解析器读取：npx skills 和各家 Agent 都用它加载 skill。
// 我们自己的稿件解析器按行切分、更宽松，测不出这类问题（见 PR #2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function frontmatterFiles() {
  const skills = readdirSync(join(ROOT, 'skills')).map((d) => join('skills', d, 'SKILL.md'));
  const commands = readdirSync(join(ROOT, 'commands')).filter((f) => f.endsWith('.md')).map((f) => join('commands', f));
  return [...skills, ...commands];
}

function frontmatter(file) {
  const m = readFileSync(join(ROOT, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} 缺少 YAML 头`);
  return parse(m[1], { strict: true, uniqueKeys: true });
}

test('frontmatter: 所有 SKILL.md 与命令文件的 YAML 头都能被严格解析', () => {
  const files = frontmatterFiles();
  assert.ok(files.length >= 2);
  for (const file of files) {
    let data;
    assert.doesNotThrow(() => { data = frontmatter(file); }, `${file} 的 YAML 头无效`);
    assert.equal(typeof data.description, 'string', `${file} 需要字符串 description`);
    assert.ok(data.description.trim().length > 0, `${file} 的 description 为空`);
  }
});

test('frontmatter: SKILL.md 的 description 不超过 Claude Code 的 1536 字符上限', () => {
  for (const dir of readdirSync(join(ROOT, 'skills'))) {
    const fm = frontmatter(join('skills', dir, 'SKILL.md'));
    const len = `${fm.description}${fm.when_to_use ?? ''}`.length;
    assert.ok(len <= 1536, `${dir}: description 共 ${len} 字符，超出部分会在 skill 列表里被截掉`);
  }
});

test('frontmatter: SKILL.md 的 description 不超过 Agent Skills 规范的 1024 字符上限', () => {
  // 超限时严格的宿主（如 zcode）会整个丢弃 skill，且没有可见报错（见 issue #23）。
  for (const dir of readdirSync(join(ROOT, 'skills'))) {
    const len = [...frontmatter(join('skills', dir, 'SKILL.md')).description].length;
    assert.ok(len <= 1024, `${dir}: description 共 ${len} 字符，规范上限是 1024`);
  }
});

test('frontmatter: SKILL.md 的 name 与目录名一致', () => {
  for (const dir of readdirSync(join(ROOT, 'skills'))) {
    assert.equal(frontmatter(join('skills', dir, 'SKILL.md')).name, dir);
  }
});
