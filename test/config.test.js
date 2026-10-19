import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, readConfig, setConfig, resetConfig, outputHome, CONFIG_KEYS, ConfigError } from '../src/config.js';
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
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'auto', mode: 'auto', style: '80', voice: 'auto', update_check: true, close_after_reply: false, home: undefined });
});

test('setConfig: booleans accept on/off/true/false/`开`/`关` and are written to the file', () => {
  setConfig('open', 'off', env);
  assert.equal(readConfig(env).values.open, false);
  setConfig('open', '开', env);
  assert.equal(readConfig(env).values.open, true);
  assert.deepEqual(JSON.parse(readFileSync(configPath(env), 'utf8')), { open: true });
});

test('close_after_reply: off by default, and on / off are saved like the other switches', () => {
  assert.equal(readConfig(env).values.close_after_reply, false);
  setConfig('close_after_reply', 'on', env);
  assert.equal(readConfig(env).values.close_after_reply, true);
  setConfig('close_after_reply', 'off', env);
  assert.equal(readConfig(env).values.close_after_reply, false);
  assert.throws(() => setConfig('close_after_reply', '3', env), ConfigError);
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
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'shadcn', mode: 'auto', style: '80', voice: 'auto', update_check: true, close_after_reply: false, home: undefined });
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
  assert.deepEqual(readConfig(env).values, { open: true, theme: 'shadcn', mode: 'auto', style: '80', voice: 'auto', update_check: true, close_after_reply: false, home: undefined });
});

test('CONFIG_KEYS: every key has a label', () => {
  for (const [key, spec] of Object.entries(CONFIG_KEYS)) assert.ok(spec.label, key);
});

test('home: set / reset saves an absolute path in the data directory config, and reset clears it', () => {
  const out = join(home, 'out');
  assert.equal(setConfig('home', out, env), out);
  assert.equal(readConfig(env).values.home, out);
  assert.deepEqual(JSON.parse(readFileSync(configPath(env), 'utf8')), { home: out });
  resetConfig('home', env);
  assert.equal(readConfig(env).values.home, undefined);
  assert.equal(existsSync(configPath(env)), false);
});

test('home: a leading ~ is the home folder, alone or before a subfolder', () => {
  assert.equal(setConfig('home', '~', env), homedir());
  assert.equal(setConfig('home', '~/pages', env), join(homedir(), 'pages'));
});

test('home: a relative path is a ConfigError that asks for an absolute path', () => {
  assert.throws(() => setConfig('home', 'pages', env), (e) => e instanceof ConfigError && /absolute path/.test(e.message));
  assert.throws(() => setConfig('home', './pages', env), ConfigError);
});

test('outputHome: AM_HOME wins over a configured home', () => {
  setConfig('home', join(home, 'out'), env);
  assert.equal(outputHome(env), home);
});

test('outputHome: the configured home when AM_HOME is unset; an unset or invalid home is the data directory', () => {
  const vars = ['HOME', 'USERPROFILE'];
  const saved = vars.map((k) => process.env[k]);
  const user = join(home, 'user');
  mkdirSync(user);
  for (const k of vars) process.env[k] = user;
  try {
    const data = join(user, '.answer-me-with-html');
    assert.equal(outputHome({}), data);
    const out = join(home, 'out');
    setConfig('home', out, {});
    assert.equal(outputHome({}), out);
    writeFileSync(configPath({}), JSON.stringify({ home: 'relative/pages' }));
    assert.equal(outputHome({}), data, 'an invalid stored value falls back to the data directory');
  } finally {
    vars.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
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
