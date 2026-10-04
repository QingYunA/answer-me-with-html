// 发版第一步：把版本号写进所有清单并重建打包文件。
// 用法：npm run release -- 0.4.8
// 之后：提交、开 PR、合入；合入后在合入提交上打 tag 并建 GitHub Release（见 CONTRIBUTING.md）。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('用法：npm run release -- <x.y.z>');
  process.exit(2);
}

const FILES = [
  'package.json',
  'package-lock.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'plugins/answer-me-with-html-always/.claude-plugin/plugin.json',
];

const current = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')).version;
for (const f of FILES) {
  const url = new URL(f, ROOT);
  const json = JSON.parse(readFileSync(url, 'utf8'));
  const next = bump(json, f);
  writeFileSync(url, `${JSON.stringify(next, null, 2)}\n`);
}
execFileSync('npm', ['run', 'build', '--silent'], { cwd: fileURLToPath(ROOT), stdio: 'inherit', shell: process.platform === 'win32' });
console.log(`✓ ${current} → ${version}：${FILES.length} 个清单已更新，打包文件已重建。下一步：npm test，然后提交并开 PR。`);

// 只改各文件里属于本项目的 version 字段，返回新对象。
function bump(json, file) {
  if (file === 'package-lock.json') {
    return { ...json, version, packages: { ...json.packages, '': { ...json.packages[''], version } } };
  }
  if (file.endsWith('marketplace.json')) {
    return { ...json, plugins: json.plugins.map((p) => ({ ...p, version })) };
  }
  return { ...json, version };
}
