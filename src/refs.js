// Source references in prose: an inline code span whose whole text is path:42 or path:18-30 cites lines of a file. The render
// checks each one against the folder that code blocks read from (src/code.js) and warns when the file or the lines are not there.
// A warning, not an error: the page is still written, because a page may cite another project's files.

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { codeSpans } from './markdown.js';
import { localPath, isSecretPath, MAX_FILE_BYTES } from './code.js';

// The whole span: a path without spaces or colons, a colon, a line or a range. A path looks like a file: it has a / or an extension
// with a letter in it, so localhost:3000 and 127.0.0.1:8080 are not references.
const REF = /^([^\s:`]+):(\d+)(?:-(\d+))?$/;
const FILE_LIKE = /\/|\.[A-Za-z][\w-]*$/;

// blocks: the draft's blocks; Markdown blocks and callouts are read. Returns [{ line, rule: 'ref', message }] in draft order.
export function checkRefs(blocks, { baseDir }) {
  const files = new Map();
  const warnings = [];
  for (const block of blocks) {
    const first = block.type === 'md' ? block.line : block.lang === 'callout' ? block.line + 1 : null;
    if (first === null) continue;
    let cursor = 0;
    for (const span of codeSpans(block.text)) {
      const found = block.text.indexOf(span.raw, cursor);
      if (found >= 0) cursor = found + span.raw.length;
      const problem = checkRef(span.text.trim(), baseDir, files);
      if (problem) warnings.push({ line: first + (found < 0 ? 0 : block.text.slice(0, found).split('\n').length - 1), rule: 'ref', message: problem });
    }
  }
  return warnings;
}

// What is wrong with one span, or null when it is not a reference, it is fine, or it cannot be checked here.
function checkRef(text, baseDir, files) {
  const m = text.match(REF);
  if (!m || !FILE_LIKE.test(m[1]) || isAbsolute(m[1]) || /^[~\\]/.test(m[1]) || m[1].includes('\\')) return null;
  const [, path, a, b = a] = m;
  const from = Number(a);
  const to = Number(b);
  if (from < 1) return `\`${text}\`: lines start at 1`;
  if (to < from) return `\`${text}\`: the first line comes after the last; write ${path}:${to}-${from}`;
  if (!files.has(path)) files.set(path, inspect(path, baseDir));
  const file = files.get(path);
  if (!file) return null;
  if (file.missing) return `\`${text}\`: no such file in ${baseDir}`;
  if (file.folder) return `\`${text}\`: ${path} is a folder, not a file`;
  if (to > file.lines) return `\`${text}\`: the file has ${file.lines} line${file.lines === 1 ? '' : 's'}`;
  return null;
}

// { lines } for a file that can be read, { missing } or { folder } for a path to warn about, null for one not to check.
// The rules of src/code.js apply: only files inside baseDir, after links are followed, and no secret file or folder is read.
// A missing path is a warning only when its first folder is in baseDir: then it claims to be a file of this project.
function inspect(path, baseDir) {
  const written = localPath(path, baseDir);
  if (!written || isSecretPath(relative(baseDir, written))) return null;
  if (!exists(written)) {
    const top = path.split('/')[0];
    return path.includes('/') && exists(join(baseDir, top)) ? { missing: true } : null;
  }
  try {
    const real = realpathSync(written);
    const root = realpathSync(baseDir);
    if (!localPath(real, root) || isSecretPath(relative(root, real))) return null;
    const stat = statSync(real);
    if (stat.isDirectory()) return { folder: true };
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const buf = readFileSync(real);
    if (buf.includes(0)) return null;
    const text = buf.toString('utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    return { lines: text ? text.split('\n').length : 0 };
  } catch {
    return null;
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
