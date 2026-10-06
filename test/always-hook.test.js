import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Run the hook against an empty AM_HOME, so the developer's own `always` setting does not change the result.
const cleanEnv = { ...process.env, AM_HOME: mkdtempSync(join(tmpdir(), 'am-always-')) };
const read = (p) => JSON.parse(readFileSync(`${ROOT}/${p}`, 'utf8'));

test('always plugin: the hook prints a valid UserPromptSubmit additionalContext', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], {
    input: '{"prompt":"讲讲 TCP"}', encoding: 'utf8', env: cleanEnv,
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /^\[answer-me-with-html always-on\]/);
  assert.ok(out.hookSpecificOutput.additionalContext.length < 600, 'the reminder is injected every turn, so it must be short');
});

test('always plugin: hooks.json points to an existing script and the marketplace lists the plugin', () => {
  const hooks = read('plugins/answer-me-with-html-always/hooks/hooks.json');
  const cmd = hooks.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(cmd.command, 'node');
  assert.equal(cmd.args[0], '${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs');
  const names = read('.claude-plugin/marketplace.json').plugins.map((p) => p.name);
  assert.deepEqual(names, ['answer-me-with-html', 'answer-me-with-html-always']);
});

test('SKILL.md explains the always-on reminder marker', () => {
  assert.match(readFileSync(`${ROOT}/skills/answer-me-with-html/SKILL.md`, 'utf8'), /\[answer-me-with-html always-on\]/);
});

test('always plugin: the reminder asks for --no-open, so no browser opens', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], { encoding: 'utf8', env: cleanEnv });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /--no-open/);
});

test('always plugin: always=off injects no reminder; a broken config still injects it', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(`${tmpdir()}/am-always-`);
  const run = () => spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], {
    encoding: 'utf8', env: { ...process.env, AM_HOME: home },
  });
  try {
    assert.match(run().stdout, /always-on/, 'on by default without a config file');
    writeFileSync(`${home}/config.json`, JSON.stringify({ always: false }));
    const off = run();
    assert.equal(off.status, 0);
    assert.equal(off.stdout, '');
    writeFileSync(`${home}/config.json`, '{ broken');
    assert.match(run().stdout, /always-on/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('render the page before the text reply, so the reply ends with text, not a tool call', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], { encoding: 'utf8', env: cleanEnv });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /render the page first/i);
  assert.match(readFileSync(`${ROOT}/skills/answer-me-with-html/SKILL.md`, 'utf8'), /render the page first/i);
});

test('the reply links the page as a file:// URL, which GUI hosts render as a link', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], { encoding: 'utf8', env: cleanEnv });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /file:\/\//);
  assert.match(readFileSync(`${ROOT}/skills/answer-me-with-html/SKILL.md`, 'utf8'), /\[file:\/\/\/abs\/path\.html\]\(file:\/\/\/abs\/path\.html\)/);
});
