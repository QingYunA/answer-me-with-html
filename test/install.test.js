// Regression tests for install layouts: manifests agree on the version, referenced files exist, and the bundled skill directory runs outside the repository.
// The real npx skills / claude plugin validate install checks run in the CI install job (scripts/smoke-install.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const VERSION = json('package.json').version;

test('install: package.json, plugin.json and marketplace.json have the same version', () => {
  assert.equal(json('.claude-plugin/plugin.json').version, VERSION);
  for (const p of json('.claude-plugin/marketplace.json').plugins) assert.equal(p.version, VERSION, p.name);
});

test('install: every marketplace plugin exists and its name matches plugin.json', () => {
  for (const p of json('.claude-plugin/marketplace.json').plugins) {
    const manifest = join(p.source, '.claude-plugin/plugin.json');
    assert.ok(existsSync(join(ROOT, manifest)), `${p.name}: missing ${manifest}`);
    assert.equal(json(manifest).name, p.name);
  }
});

test('install: script paths referenced by commands and SKILL.md exist', () => {
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    for (const [, rel] of readFileSync(join(ROOT, 'commands', f), 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      assert.ok(existsSync(join(ROOT, rel)), `${f}: ${rel}`);
    }
  }
  const skill = readFileSync(join(ROOT, 'skills/answer-me-with-html/SKILL.md'), 'utf8');
  for (const [, rel] of skill.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)) {
    assert.ok(existsSync(join(ROOT, 'skills/answer-me-with-html', rel)), rel);
  }
});

test('install: the skill directory copied elsewhere renders a page without node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-install-'));
  try {
    cpSync(join(ROOT, 'skills/answer-me-with-html'), join(dir, 'skill'), { recursive: true });
    const out = execFileSync(process.execPath, [join(dir, 'skill/scripts/am.mjs'), 'render', '-', '--no-open', '-o', join(dir, 'p.html')], {
      input: '## A 标题\n```flow\nA -> B\n```\n',
      env: { ...process.env, AM_HOME: join(dir, 'home'), AM_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
    });
    assert.match(out, /✓ .*p\.html/);
    assert.match(readFileSync(join(dir, 'p.html'), 'utf8'), /<svg/);
    assert.match(execFileSync(process.execPath, [join(dir, 'skill/scripts/am.mjs'), '--version'], { encoding: 'utf8' }), new RegExp(VERSION.replace(/\./g, '\\.')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
