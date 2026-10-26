// The website's changelog page: changelog/<x.y.z>.md files, read, split into English and Chinese, sorted and drawn as HTML.
// A file is `<!-- release x.y.z YYYY-MM-DD -->`, the English notes, a line `---`, the Chinese notes (test/release-notes.test.js checks the files).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const MARKER = /^<!-- release (\d+\.\d+\.\d+) (\d{4}-\d{2}-\d{2}) -->[ \t]*$/;

// Highest version first.
export function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}

// Splits the notes at the first line that is exactly ---. A file without one has no Chinese part: zh is ''.
export function splitNotes(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const at = lines.indexOf('---');
  const text = (part) => part.join('\n').trim();
  return at < 0 ? { en: text(lines), zh: '' } : { en: text(lines.slice(0, at)), zh: text(lines.slice(at + 1)) };
}

// One file's text → { version, date, en, zh }. Throws when the marker is missing or names another version than the file.
export function parseEntry(name, text) {
  const [first, ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  const m = MARKER.exec(first);
  if (!m) throw new Error(`changelog/${name}: the first line must be <!-- release x.y.z YYYY-MM-DD -->`);
  if (`${m[1]}.md` !== name) throw new Error(`changelog/${name}: the marker names version ${m[1]}`);
  return { version: m[1], date: m[2], ...splitNotes(rest.join('\n')) };
}

// Every changelog/*.md, newest version first.
export function readChangelog(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseEntry(f, readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => compareVersions(a.version, b.version));
}

export const versionId = (version) => `v${version.replaceAll('.', '-')}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The notes' own ## headings become <h3> (the version is the <h2>), and ### become <h4>.
const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const level = Math.min(depth + 1, 6);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
  },
});

// #332 → a link, in text only: not inside <a>, <code> or <pre>. GitHub redirects an issue number from /pull/ to /issues/.
export function linkRefs(html, repo) {
  let skip = 0;
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      const tag = /^<(\/?)(a|code|pre)\b/i.exec(part);
      if (tag) skip += tag[1] ? -1 : 1;
      if (part.startsWith('<') || skip > 0) return part;
      return part.replace(/(?<![\w&/#])#(\d+)\b/g, `<a href="https://github.com/${repo}/pull/$1">#$1</a>`);
    })
    .join('');
}

export const notesHtml = (markdown, repo) => linkRefs(marked.parse(markdown), repo);

// The "on this page" list and the sections for one language. t has the page's words: cl_release, cl_anchor, cl_en_only.
export function changelogHtml(entries, lang, t, repo) {
  const toc = entries.map((e) => `<li><a href="#${versionId(e.version)}">${e.version}</a></li>`).join('\n');
  const sections = entries
    .map((e) => {
      const id = versionId(e.version);
      const fallback = lang === 'zh' && !e.zh;
      const notes = notesHtml(lang === 'zh' && e.zh ? e.zh : e.en, repo);
      const lead = fallback ? `<p class="fine cl-note">${t.cl_en_only}</p>\n  ` : '';
      return `<section class="cl-version" id="${id}" aria-labelledby="${id}-h">
  <div class="cl-head">
    <h2 id="${id}-h">${e.version} (${e.date})</h2>
    <a class="cl-link mono" href="#${id}" aria-label="${esc(t.cl_anchor)} ${e.version}">#</a>
    <a class="cl-release mono" href="https://github.com/${repo}/releases/tag/v${e.version}">${t.cl_release} →</a>
  </div>
  ${lead}<div class="cl-notes"${fallback ? ' lang="en"' : ''}>
${notes}</div>
</section>`;
    })
    .join('\n');
  return { toc, sections };
}
