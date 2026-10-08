// Right-to-left pages only: src/render.js adds this script after the page script when the page reads right to left.
// The Reply sheet holds the reply as Markdown in a textarea, and a textarea gives the whole text one direction. Lines that start
// with markup or Latin letters ("# Re: ...", "1. [E] ...", "- **A · ...**") then come out reordered for a Hebrew reader.
// This script shows the reply drawn instead: headings, bold answers and quoted comments, each line in its own direction.
// The textarea stays in the sheet as what Copy copies, so the copied text does not change.
// A plain ES module for tests; the page gets it with its `export` keyword dropped and rtl-letter.js in front of it in place of the
// import (src/runtime/compose.js).
import { RTL_LETTER } from './rtl-letter.js';

const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// A line with a right-to-left letter reads right to left; a line without one (an English comment, a path) reads left to right.
const dirOf = (s) => (RTL_LETTER.test(s) ? 'rtl' : 'ltr');

// The only inline Markdown src/runtime/reply-text.js writes: **answer** and _(note)_. Each piece is isolated in its own direction,
// so a Latin answer inside a Hebrew line keeps its place, and "A · title" still starts with the panel letter.
const piece = (tag, text) => `<${tag}><bdi dir="${dirOf(text)}">${text}</bdi></${tag}>`;
function inline(s) {
  return escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, (_, t) => piece('strong', t))
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, (_, pre, t) => pre + piece('em', t));
}

// The reply text (src/runtime/reply-text.js) as HTML, one block per line.
export function replyViewHtml(text) {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const dir = dirOf(line);
      let m;
      if (!line.trim()) return '<div class="am-rv-gap"></div>';
      if ((m = line.match(/^(#{1,2}) (.*)$/))) return `<div class="am-rv-h${m[1].length}" dir="${dir}">${inline(m[2])}</div>`;
      if ((m = line.match(/^(\d+)\. \[([^\]]*)\] (.*)$/))) {
        return `<div class="am-rv-q" dir="${dir}"><bdi>${m[1]}.</bdi> <bdi class="am-rv-tag">${escHtml(m[2])}</bdi> ${inline(m[3])}</div>`;
      }
      if ((m = line.match(/^ {3}([←→]) (.*)$/))) return `<div class="am-rv-a" dir="${dir}">${m[1]} ${inline(m[2])}</div>`;
      if ((m = line.match(/^- (.*)$/))) return `<div class="am-rv-c" dir="${dir}">${inline(m[1])}</div>`;
      // A comment line is shown exactly as the reader typed it.
      if ((m = line.match(/^ {2}> ?(.*)$/))) return `<div class="am-rv-quote" dir="${dirOf(m[1])}">${escHtml(m[1]) || '&nbsp;'}</div>`;
      return `<div dir="${dir}">${inline(line)}</div>`;
    })
    .join('');
}

if (typeof document !== 'undefined') {
  const button = document.querySelector('[data-am="reply"]');
  const sheet = document.querySelector('dialog.am-reply');
  const source = sheet?.querySelector('textarea');
  if (button && source) {
    const view = Object.assign(document.createElement('div'), { className: 'am-reply-view', tabIndex: 0 });
    source.before(view);
    sheet.classList.add('am-reply--view');
    // Runs after the page script's own handler, which has just filled the textarea.
    button.addEventListener('click', () => {
      view.innerHTML = replyViewHtml(source.value);
      view.scrollTop = 0;
    });
  }
}
