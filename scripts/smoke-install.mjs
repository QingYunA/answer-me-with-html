#!/usr/bin/env node
// Real-install smoke test (called by the CI install job, needs network):
// 1. npx skills add <repo> -l recognizes the skill (fails here when the YAML header is broken, see PR #2);
// 2. install once for real with a temporary HOME, then render a page with the installed am.mjs;
// 3. claude plugin validate checks the manifests of the marketplace and the plugin.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'am-smoke-'));
const env = { ...process.env, HOME: home, AM_HOME: join(home, '.answer-me-with-html'), AM_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const step = (name) => process.stdout.write(`\n▶ ${name}\n`);
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function find(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (['node_modules', '.npm', '.git', 'docs', 'test', 'bench'].includes(e)) continue;
    if (e === name) return p;
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    }
  }
  return null;
}

// The commands in INSTALL.md are run as written, so the guide cannot drift from what works.
// Only the repository source and the agent name are substituted; `claude` is a shim for the pinned Claude Code CLI.
const GUIDE_SOURCE = 'QingYunA/answer-me-with-html';

function guideBlocks() {
  const blocks = [];
  let heading = '';
  let cur = null;
  for (const line of readFileSync(join(ROOT, 'INSTALL.md'), 'utf8').split('\n')) {
    if (cur) {
      if (line.startsWith('```')) { blocks.push({ heading, code: cur.join('\n') }); cur = null; } else cur.push(line);
    } else if (/^#{2,3} /.test(line)) heading = line.replace(/^#+ /, '');
    else if (line.startsWith('```bash')) cur = [];
  }
  return blocks;
}

function runGuide() {
  const blocks = guideBlocks();
  const block = (h) => {
    const b = blocks.find((x) => x.heading.startsWith(h));
    if (!b) throw new Error(`INSTALL.md has no bash block under "${h}"`);
    return b.code;
  };
  const guide = readFileSync(join(ROOT, 'INSTALL.md'), 'utf8');
  const updateCmd = (prefix) => {
    const m = guide.match(new RegExp('`(' + prefix + '[^`]*)`'));
    if (!m) throw new Error(`INSTALL.md names no "${prefix}" command`);
    return m[1];
  };
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec npx -y @anthropic-ai/claude-code@latest "$@"\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

  // One fresh HOME per scenario, so nothing leaks between agents.
  const scenario = (name, { isolateClaude = false } = {}) => {
    const h = mkdtempSync(join(tmpdir(), `am-guide-${name}-`));
    const e = { ...env, HOME: h, AM_HOME: join(h, '.answer-me-with-html'), ...(isolateClaude ? { CLAUDE_CONFIG_DIR: join(h, '.claude-config') } : {}), PATH: `${bin}:${process.env.PATH}` };
    const bash = (code, { allowFail = false } = {}) => {
      const cmd = code.replaceAll(GUIDE_SOURCE, ROOT).replaceAll('<your agent name>', name);
      try { return strip(execFileSync('bash', ['-c', cmd], { encoding: 'utf8', env: e, stdio: ['pipe', 'pipe', 'pipe'] })); }
      catch (err) { if (allowFail) return strip(String(err.stdout ?? '')); throw err; }
    };
    return { h, bash };
  };

  for (const agent of ['claude-code', 'codex', 'cursor']) {
    step(`INSTALL.md, skill route, agent "${agent}"`);
    const { h, bash } = scenario(agent);
    bash(block('Step 1'));
    if (/answer-me-with-html/.test(bash(block('Step 2'), { allowFail: true }))) throw new Error('Step 2 found an install in a fresh HOME');
    bash(block('Any other agent'));
    if (!bash(block('Step 4')).includes(version)) throw new Error(`Step 4 did not print ${version}`);
    const am = find(h, 'am.mjs');
    if (!am) throw new Error('am.mjs not found after the guide installed the skill');
    const page = execFileSync(process.execPath, [am, 'render', '-', '--no-open'], { encoding: 'utf8', env: { ...env, HOME: h, AM_HOME: join(h, '.answer-me-with-html') }, input: '## A 标题\n文字\n' });
    if (!/^✓ /m.test(page)) throw new Error(`the guide's skill install cannot render a page:\n${page}`);
    if (!/answer-me-with-html/.test(bash(block('Step 2'), { allowFail: true }))) throw new Error('Step 2 did not find the install it just made');
    process.stdout.write(`✓ ${agent}: install, version check and render work\n`);
  }

  step('INSTALL.md, Claude Code plugin route');
  const { h, bash } = scenario('claude-code', { isolateClaude: true });
  bash(block('Step 1'));
  bash(block('Claude Code'));
  if (!/answer-me-with-html@answer-me-with-html[\s\S]*enabled/.test(bash('claude plugin list'))) throw new Error('plugin is not listed as enabled');
  const pluginAm = find(join(h, '.claude-config', 'plugins', 'cache', 'answer-me-with-html', 'answer-me-with-html'), 'am.mjs');
  if (!pluginAm) throw new Error('am.mjs not found after the guide installed the plugin');
  if (!find(join(h, '.claude-config', 'plugins', 'cache', 'answer-me-with-html', 'answer-me-with-html'), 'config.md')) throw new Error('the config command is not part of the installed plugin');
  bash(updateCmd('claude plugin update'));
  process.stdout.write('✓ plugin route: install, enabled, commands present, update works\n');
  rmSync(h, { recursive: true, force: true });
}

try {
  step('npx skills add -l');
  const list = strip(sh('npx', ['-y', 'skills@latest', 'add', ROOT, '-l']));
  // Check only key signals, not the full wording: a skip / parse error fails, and the list must contain the skill name.
  if (/Skipped|parse error|No (valid )?skills found/i.test(list) || !/answer-me-with-html/.test(list)) {
    throw new Error(`skills CLI did not recognize the skill:\n${list}`);
  }
  process.stdout.write('✓ skills CLI recognizes answer-me-with-html\n');

  step('npx skills add -g (temporary HOME)');
  sh('npx', ['-y', 'skills@latest', 'add', ROOT, '-g', '-a', 'claude-code', '-y', '--copy']);
  const installed = find(join(home, '.claude'), 'am.mjs');
  if (!installed) throw new Error('am.mjs not found after install');
  const out = sh(process.execPath, [installed, 'render', '-', '--no-open'], { input: '## A 标题\n```flow\nA -> B\n```\n' });
  if (!/^✓ /m.test(out)) throw new Error(`the installed am.mjs cannot render a page:\n${out}`);
  process.stdout.write(`✓ ${installed} can render a page\n`);

  step('claude plugin install (isolated config directory)');
  const cfg = join(home, '.claude-config');
  const claude = (...args) => sh('npx', ['-y', '@anthropic-ai/claude-code@latest', 'plugin', ...args], { env: { ...env, CLAUDE_CONFIG_DIR: cfg } });
  claude('marketplace', 'add', ROOT);
  claude('install', 'answer-me-with-html@answer-me-with-html');
  const cache = join(cfg, 'plugins', 'cache', 'answer-me-with-html');
  const pluginAm = find(join(cache, 'answer-me-with-html'), 'am.mjs');
  if (!pluginAm) throw new Error('am.mjs not found after plugin install');
  const out2 = sh(process.execPath, [pluginAm, 'render', '-', '--no-open'], { input: '## A 标题\n文字\n' });
  if (!/^✓ /m.test(out2)) throw new Error(`the plugin's am.mjs cannot render a page:\n${out2}`);
  process.stdout.write('✓ the plugin installs and its am.mjs renders a page\n');

  step('claude plugin validate');
  // On a validation failure claude exits non-zero and execFileSync throws; output wording is no longer matched.
  sh('npx', ['-y', '@anthropic-ai/claude-code@latest', 'plugin', 'validate', ROOT]);
  process.stdout.write('✓ marketplace and plugin manifests pass validation\n');

  runGuide();
} catch (e) {
  process.stderr.write(`✗ ${e.stderr ? strip(String(e.stderr)) : ''}${e.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
