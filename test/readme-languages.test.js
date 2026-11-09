import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

// The READMEs are one document in three languages. The English README is the source: the translated
// pages keep its code blocks, badges, URLs and link targets verbatim (only the prose is translated),
// and their in-page anchors follow their own headings. These checks keep the three from drifting
// apart when one of them is edited.

const READMES = ['README.md', 'README.zh-CN.md', 'README.ja.md'];

// Splits a README into its fenced code blocks and the prose around them. A ```` fence holds a
// ``` fence, so the fence that opens a block is also the one that closes it.
function splitFences(text) {
  const code = [];
  const prose = [];
  let fence = null;
  let buf = [];
  for (const line of text.split('\n')) {
    const open = line.match(/^(`{3,})/);
    if (!fence && open) {
      fence = open[1];
      buf = [];
    } else if (fence && line.trim() === fence) {
      code.push(buf.join('\n'));
      fence = null;
    } else if (fence) {
      buf.push(line);
    } else {
      prose.push(line);
    }
  }
  return { code, prose: prose.join('\n') };
}

// GitHub's heading anchors: lowercase, drop the punctuation, turn the spaces into hyphens. A
// heading that repeats gets a -1, -2 suffix on the later copies.
function headingSlugs(prose) {
  const seen = new Map();
  const slugs = new Set();
  for (const line of prose.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    let slug = m[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    slugs.add(n ? `${slug}-${n}` : slug);
  }
  return slugs;
}

const anchors = (prose) => [
  ...[...prose.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
  ...[...prose.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]),
];

// Link targets: Markdown links, href / src attributes and srcset candidates. An in-page anchor is
// local to its language, and the language links at the top are the one row that is allowed to
// differ; everything else (badges, images, URLs) must be the English README's.
function linkTargets(prose) {
  const targets = [];
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) targets.push(m[1]);
  for (const m of prose.matchAll(/(?:href|src)="([^"]+)"/g)) targets.push(m[1]);
  for (const m of prose.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(',')) targets.push(part.trim().split(/\s+/)[0]);
  }
  return targets.filter((t) => !t.startsWith('#') && !/^README(\.[a-z-]+)?\.md$/i.test(t));
}

const inlineCode = (prose) => [...prose.matchAll(/`[^`\n]+`/g)].map((m) => m[0]);

const headingLevels = (prose) =>
  prose.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.match(/^#+/)[0].length);

test('readme languages: each README links to the other two', () => {
  for (const file of READMES) {
    const text = read(file);
    for (const other of READMES.filter((f) => f !== file)) {
      const linked = text.includes(`href="${other}"`) || text.includes(`](${other})`);
      assert.ok(linked, `${file} is missing a link to ${other}`);
    }
  }
});

test('readme languages: the Japanese README carries the English one apart from the prose', () => {
  const en = splitFences(read('README.md'));
  const ja = splitFences(read('README.ja.md'));
  assert.deepEqual(ja.code, en.code, 'code blocks');
  assert.deepEqual(inlineCode(ja.prose), inlineCode(en.prose), 'inline code spans');
  assert.deepEqual(linkTargets(ja.prose), linkTargets(en.prose), 'link targets');
  assert.deepEqual(headingLevels(ja.prose), headingLevels(en.prose), 'heading levels');
});

test('readme languages: in-page anchors point at headings in the same file', () => {
  for (const file of READMES) {
    const { prose } = splitFences(read(file));
    const slugs = headingSlugs(prose);
    for (const anchor of anchors(prose)) {
      assert.ok(slugs.has(anchor), `${file} links to #${anchor}, which is not a heading`);
    }
  }
});
