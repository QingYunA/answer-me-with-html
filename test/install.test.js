// Regression tests for install layouts: manifests agree on the version, referenced files exist, and the bundled skill directory runs outside the repository.
// The real npx skills / claude plugin validate install checks run in the CI install job (scripts/smoke-install.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, realpathSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('install: package.json declares the DSH bundle patch, and the patch ships in the package', () => {
  const pkg = json('package.json');
  const patch = pkg.dsh?.bundle?.patch;
  assert.equal(patch, './cordis.patch.yml');
  assert.ok(existsSync(join(ROOT, patch)), `missing ${patch}`);
  assert.ok(pkg.files.includes(patch.replace(/^\.\//, '')), 'cordis.patch.yml must be listed in "files"');
});

// dsh-plugin-hub 1.6.6 and older resolve the entry as exports["."], then main, then index.js, and block a git install that lacks it (#218).
test('install: the package entry ships in the package and has no side effects on import', async () => {
  const pkg = json('package.json');
  assert.equal(pkg.exports?.['.'], undefined, 'exports would hide answer-me-with-html/package.json from cordis.patch.yml');
  const entry = (pkg.main ?? 'index.js').replace(/^\.\//, '');
  assert.equal(entry, 'index.js');
  assert.ok(existsSync(join(ROOT, entry)), `missing ${entry}`);
  assert.ok(pkg.files.includes(entry), `${entry} must be listed in "files"`);
  assert.deepEqual(Object.keys(await import(pathToFileURL(join(ROOT, entry)).href)), []);
});

// DSH's plugin page reads the icon and locale/<language>.json from the installed package; a bad file makes it reject the package's metadata.
test('install: the DSH icon and display text ship in the package and fit what DSH reads', () => {
  const pkg = json('package.json');
  const icon = pkg.icon.replace(/^\.\//, '');
  assert.match(icon, /\.svg$/);
  assert.ok(pkg.files.includes(icon), `${icon} must be listed in "files"`);
  assert.ok(readFileSync(join(ROOT, icon)).length <= 256 * 1024, 'DSH refuses an icon over 256 KiB');
  assert.ok(pkg.files.includes('locale'));
  const locales = readdirSync(join(ROOT, 'locale'));
  assert.ok(locales.includes('en.json'), 'DSH reads the other languages only next to en.json');
  for (const file of locales) {
    const { meta } = json(`locale/${file}`);
    for (const key of ['title', 'description']) assert.ok(typeof meta[key] === 'string' && meta[key].trim(), `${file}: meta.${key}`);
  }
});

// The `!!js` expression is the one thing that can silently drop the skill from every DSH session, so run the shipped text the way the loader does.
const skipSymlink = process.platform === 'win32' ? 'creating directory symlinks on Windows needs privileges' : false;
test('install: the DSH patch resolves bundledSkillDir to the skills directory of the installed package', { skip: skipSymlink }, () => {
  const expr = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8').match(/bundledSkillDir:\s*!!js\s*(.+)$/m)?.[1];
  assert.ok(expr, 'cordis.patch.yml has no `bundledSkillDir: !!js <expr>` line');
  const profile = mkdtempSync(join(tmpdir(), 'am-dsh-'));
  try {
    mkdirSync(join(profile, 'node_modules'));
    symlinkSync(ROOT, join(profile, 'node_modules', json('package.json').name), 'dir');
    const dir = new Function('baseUrl', `return ${expr}`)(`${profile}/`);
    assert.equal(realpathSync(dir), realpathSync(join(ROOT, 'skills')));
    assert.ok(existsSync(join(dir, 'answer-me-with-html/SKILL.md')));
    assert.ok(existsSync(join(dir, 'answer-me-with-html/scripts/am.mjs')));
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
