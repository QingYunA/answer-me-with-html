import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, readConfig, setConfig, resetConfig, CONFIG_KEYS, ConfigError } from '../src/config.js';
import { renderDoc } from '../src/render.js';

let home;
let env;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'am-config-'));
  env = { AM_HOME: home };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

test('configPath: is AM_HOME/config.json', () => {
  assert.equal(configPath(env), join(home, 'config.json'));
});

test('readConfig: returns the defaults when the file does not exist', () => {
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'auto', mode: 'auto', style: '80', voice: 'auto', update_check: true });
});

test('setConfig: booleans accept on/off/true/false/`开`/`关` and are written to the file', () => {
  setConfig('open', 'off', env);
  assert.equal(readConfig(env).values.open, false);
  setConfig('open', '开', env);
  assert.equal(readConfig(env).values.open, true);
  assert.deepEqual(JSON.parse(readFileSync(configPath(env), 'utf8')), { open: true });
});

test('setConfig: validates enum values and lists the choices for an invalid one', () => {
  setConfig('theme', 'shadcn', env);
  assert.equal(readConfig(env).values.theme, 'shadcn');
  assert.throws(() => setConfig('theme', 'neon', env), (e) => e instanceof ConfigError && /blueprint \| shadcn/.test(e.message));
  assert.throws(() => setConfig('nope', '1', env), (e) => e instanceof ConfigError && /open/.test(e.message));
  assert.throws(() => setConfig('open', 'maybe', env), ConfigError);
});

test('resetConfig: resets one key or all keys to the defaults', () => {
  setConfig('open', 'off', env);
  setConfig('theme', 'shadcn', env);
  resetConfig('open', env);
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'shadcn', mode: 'auto', style: '80', voice: 'auto', update_check: true });
  resetConfig(undefined, env);
  assert.equal(existsSync(configPath(env)), false);
});

test('readConfig: falls back to the defaults with a warning when the file is broken', () => {
  writeFileSync(configPath(env), '{ not json');
  const { values, warning } = readConfig(env);
  assert.equal(values.open, true);
  assert.match(warning, /config\.json/);
});

test('readConfig: ignores unknown keys and invalid values', () => {
  writeFileSync(configPath(env), JSON.stringify({ open: 'yes-ish', theme: 'shadcn', extra: 1 }));
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'shadcn', mode: 'auto', style: '80', voice: 'auto', update_check: true });
});

test('CONFIG_KEYS: every key has a label', () => {
  for (const [key, spec] of Object.entries(CONFIG_KEYS)) assert.ok(spec.label, key);
});

test('render: config gives the defaults, explicit draft frontmatter wins', () => {
  const defaults = { theme: 'shadcn', mode: 'dark', style: 'off' };
  const plain = renderDoc('## A\nUtilize it.', {}, defaults);
  assert.match(plain.html, /data-theme="shadcn" data-mode="dark"/);
  assert.equal(plain.warnings.length, 0, 'style: off comes from config');
  const explicit = renderDoc('---\ntheme: blueprint\n---\n## A\nx', {}, defaults);
  assert.match(explicit.html, /data-theme="blueprint"/);
  const flag = renderDoc('---\ntheme: blueprint\n---\n## A\nx', { theme: 'shadcn' }, defaults);
  assert.match(flag.html, /data-theme="shadcn"/, 'command-line arguments win');
});
