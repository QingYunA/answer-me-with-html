// Source references in prose: an inline code span whose whole text is path:42 or path:18-30 cites lines of a file. The render
// checks each one against the folder that code blocks read from (src/code.js) and warns when the file or the lines are not there.
// A warning, not an error: the page is still written, because a page may cite another project's files.

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { codeSpans } from './markdown.js';
import { localPath, isSecretPath, MAX_FILE_BYTES } from './code.js';
import { contentLines, fields } from './components/error.js';
import { readAsk } from './components/ask.js';

// The whole span: a path without spaces or colons, a colon, a line or a range. A path looks like a file: it has a / or an extension
// with a letter in it, so localhost:3000 and 127.0.0.1:8080 are not references.
const REF = /^([^\s:`]+):(\d+)(?:-(\d+))?$/;
const FILE_LIKE = /\/|\.[A-Za-z][\w-]*$/;

// The parts of a component line that render inline Markdown, so a code span there is <code> on the page. Diagram components
// (flow, sequence, state, limits, annot …) draw their text as is, backticks included, so they have no spans to check.
// lines: the lines the component reads; tree reads every non-empty line, the others skip // comments as contentLines does.
// A Map, so a fence language such as constructor finds nothing.
const INLINE_PARTS = new Map(Object.entries({
  tree: { lines: (text) => String(text).split('\n').map((raw, i) => ({ text: raw.trim(), line: i + 1 })).filter((l) => l.text), parts: (t) => fields(t).slice(0, 2) }, // label and note; tree ignores a third field
  timeline: { lines: contentLines, parts: (t) => fields(t).slice(1, 3) }, // title and note; the time is plain text
  kv: { lines: contentLines, parts: (t) => [(t.startsWith('*') ? t.slice(1).trim() : t).match(/^[^:：]+[:：]\s*(.*)$/)?.[1] ?? ''] }, // the value; the key is plain text
}));

// The texts of one block that may hold code spans, each with the draft line its text starts on. A fence's text starts on the line
// after the fence, so its line n is block.line + n.
function inlineTexts(block) {
  if (block.type === 'md') return [{ text: block.text, line: block.line, inline: false }];
  if (block.lang === 'callout') return [{ text: block.text, line: block.line + 1, inline: false }];
  if (block.lang === 'ask') return askTexts(block);
  const component = INLINE_PARTS.get(block.lang);
  if (!component) return [];
  return component.lines(block.text).flatMap(({ text, line }) => component.parts(text).map((part) => ({ text: part, line: block.line + line, inline: true })));
}

// The question, each option's label and note, and each preview, which is a block of its own. A block the component cannot read is
// a render error anyway, so it has nothing to check.
function askTexts(block) {
  let ask;
  try {
    ask = readAsk(block.text);
  } catch {
    return [];
  }
  return [
    { text: ask.question.text, line: block.line + ask.question.line, inline: true },
    ...ask.options.flatMap((o) => [
      { text: o.label, line: block.line + o.line, inline: true },
      { text: o.note, line: block.line + o.line, inline: true },
      ...(o.preview ? inlineTexts({ type: 'fence', lang: o.preview.lang, text: o.preview.text, line: block.line + o.preview.line }) : []),
    ]),
  ];
}

// blocks: the draft's blocks; Markdown blocks, callouts and the inline text of components are read.
// Returns [{ line, rule: 'ref', message }] in draft order.
export function checkRefs(blocks, { baseDir }) {
  const files = new Map();
  const warnings = [];
  for (const { text, line, inline } of blocks.flatMap(inlineTexts)) {
    for (const span of codeSpans(text, { inline })) {
      const problem = checkRef(span.text.trim(), baseDir, files);
      if (problem) warnings.push({ line: line + span.line, rule: 'ref', message: problem });
    }
  }
  return warnings.sort((a, b) => a.line - b.line);
}

// What is wrong with one span, or null when it is not a reference, it is fine, or it cannot be checked here.
function checkRef(text, baseDir, files) {
  const m = text.match(REF);
  if (!m || !FILE_LIKE.test(m[1]) || isAbsolute(m[1]) || /^[~\\]/.test(m[1]) || m[1].includes('\\')) return null;
  const [, path, a, b = a] = m;
  const from = Number(a);
  const to = Number(b);
  if (!files.has(path)) files.set(path, inspect(path, baseDir));
  const file = files.get(path);
  // A path that is not checked (another project's, outside the folder, a secret file) gets no warning at all.
  if (!file) return null;
  if (from < 1) return `\`${text}\`: lines start at 1`;
  if (to < from) return `\`${text}\`: the first line comes after the last; write ${path}:${to}-${from}`;
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
  const rel = written && relative(baseDir, written);
  if (!rel || isSecretPath(rel)) return null;
  if (!exists(written)) {
    // The first folder of the normalized path, so ./a/x.py and src/../a/x.py count as a/x.py.
    const parts = rel.split(sep);
    return parts.length > 1 && exists(join(baseDir, parts[0])) ? { missing: true } : null;
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
