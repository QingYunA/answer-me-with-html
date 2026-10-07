// Shared by en.js and zh.js: turn a Markdown draft into escaped, lightly highlighted HTML for a <pre><code> block.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function line(raw, state) {
  const t = esc(raw);
  if (/^```/.test(raw)) {
    state.fence = !state.fence;
    return `<span class="hl-f">${t}</span>`;
  }
  if (/^---\s*$/.test(raw)) {
    state.front = !state.front;
    return `<span class="hl-m">${t}</span>`;
  }
  if (state.front) return t.replace(/^([\w-]+):/, '<span class="hl-k">$1</span>:');
  if (/^## /.test(raw)) return `<span class="hl-h">${t.replace(/(\{[^}]*\})/, '<span class="hl-a">$1</span>')}</span>`;
  if (/^&gt; /.test(t)) return `<span class="hl-q">${t.replace(/\[([^\]]+)\]/g, '<span class="hl-x">[$1]</span>')}</span>`;
  if (state.fence) return t.replace(/(--?&gt;|&lt;--?)/g, '<span class="hl-o">$1</span>').replace(/^(note|participants|group)\b/, '<span class="hl-k">$1</span>');
  return t;
}

export function draftHtml(source) {
  const state = { fence: false, front: false };
  return source.trim().split('\n').map((l) => line(l, state)).join('\n');
}

export const escapeHtml = esc;
