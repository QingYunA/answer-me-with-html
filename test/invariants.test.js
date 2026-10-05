// Invariant: patching a page with a panel's own source must leave the page unchanged (except timestamps).
// Covers render and video pages, every theme × mode × template combination, with and without a config file, and "patch with a different config".
// The invariant also verifies that the page stores all settings, patch reads them back, and those settings win over the config file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { themeNames, getTheme } from '../src/themes/registry.js';

const EXAMPLES = new URL('../examples/', import.meta.url);
const HOMES = { none: null, cfg: { theme: 'shadcn', mode: 'dark', style: 'off' }, user: { theme: 'notes' } };
// The user home has a theme file (#64): blueprint's colors on a warmer paper, with its own font and one decoration rule.
const { common, light, dark } = getTheme('blueprint').tokens;
const NOTES = {
  label: 'Notes',
  tokens: { common: { ...common, '--font-sans': '"IBM Plex Sans"' }, light: { ...light, '--paper': '#fdfcf8' }, dark },
  css: '& .am-panel-head { letter-spacing: 0.01em; }',
};

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-inv-'));
  for (const [name, config] of Object.entries(HOMES)) {
    mkdirSync(join(dir, name));
    if (config) writeFileSync(join(dir, name, 'config.json'), JSON.stringify(config));
  }
  mkdirSync(join(dir, 'user', 'themes'));
  writeFileSync(join(dir, 'user', 'themes', 'notes.json'), JSON.stringify(NOTES));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

async function run(args, home, stdin = '') {
  let err = '';
  const stderr = new Writable({ write(c, _e, cb) { err += c; cb(); } });
  const code = await main(args, {
    stdout: sink(), stderr, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', AM_HOME: join(dir, home) }, cwd: dir,
  });
  return { code, err };
}

// The render time has minute precision and changes across minutes; before comparing, blank only the footer / player bar time and the video title DATE cell.
const stable = (html) => html
  .replace(/(Answer me with HTML [\d.]+ · )\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '$1<time>')
  .replace(/(<b>DATE<\/b><span>)\d{4}-\d{2}-\d{2}/, '$1<time>');

// Title and source of the first ## panel.
function firstPanel(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l));
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const text = `${lines.slice(start, next < 0 ? undefined : next).join('\n')}\n`;
  return { title: lines[start].replace(/^##\s+/, '').replace(/\s*\{.*\}\s*$/, ''), text };
}

function cases() {
  const out = [];
  const opt = (flag, v) => (v ? [flag, v] : []);
  for (const f of ['architecture.md', 'ste100.md', 'tcp.md', 'tcp.en.md']) {
    for (const theme of [null, ...themeNames('page')]) {
      for (const mode of [null, 'light', 'dark', 'auto']) {
        for (const template of [null, 'sheet', 'doc']) {
          out.push({ cmd: 'render', f, args: [...opt('--theme', theme), ...opt('--mode', mode), ...opt('--template', template)] });
        }
      }
    }
  }
  for (const f of ['video-tcp.md', 'video-tcp.en.md']) {
    for (const theme of [null, ...themeNames('video')]) {
      for (const mode of [null, 'light', 'dark']) {
        out.push({ cmd: 'video', f, args: ['--voice', 'off', ...opt('--theme', theme), ...opt('--mode', mode)] });
      }
    }
  }
  return out;
}

for (const [renderHome, patchHome] of [['none', 'none'], ['cfg', 'cfg'], ['none', 'cfg'], ['cfg', 'none'], ['user', 'user']]) {
  test(`invariant: patching with the source leaves the page unchanged (render config ${renderHome}, patch config ${patchHome})`, async () => {
    const failures = [];
    for (const [i, c] of cases().entries()) {
      const label = `${c.cmd} ${c.f} ${c.args.join(' ') || '(default)'}`;
      const file = join(dir, `${renderHome}-${patchHome}-${i}.html`);
      const made = await run([c.cmd, fileURLToPath(new URL(c.f, EXAMPLES)), '-o', file, '--no-open', ...c.args], renderHome);
      assert.equal(made.code, 0, `${label}: ${made.err}`);
      const before = readFileSync(file, 'utf8');
      const { title, text } = firstPanel(readFileSync(new URL(c.f, EXAMPLES), 'utf8'));
      const patched = await run(['patch', file, '--panel', title, '--no-open'], patchHome, text);
      if (patched.code !== 0) failures.push(`${label}: patch exit code ${patched.code} ${patched.err}`);
      else if (stable(readFileSync(file, 'utf8')) !== stable(before)) failures.push(`${label}: the page changed after patch`);
    }
    assert.deepEqual(failures, []);
  });
}
