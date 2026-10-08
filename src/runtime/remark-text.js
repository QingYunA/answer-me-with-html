// The remark part of the reply a reader copies from the page: block highlights with an optional note each.
// A plain ES module for tests; the page gets it with its `export` keyword dropped (src/runtime/compose.js).
// Block identity survives renumbering the same way panel comments do: panel id plus a fingerprint of the text,
// so `am patch` moving a block between indexes still finds it.

// Whitespace-collapsed, first `len` characters of a block: the readable identity of its text.
export function fingerprint(text, len = 80) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, len);
}

// remarks: [{ panel, quote, kind, note }] — quote is the fingerprint, kind one of remarkKinds(ui).
export function remarkText(remarks, ui) {
  const lines = [];
  for (const r of remarks) {
    const where = r.panel ? `[${r.panel}] ` : '';
    const note = r.note.trim() ? ` — ${r.note.trim().replace(/\n+/g, ' ')}` : '';
    lines.push(`- ${where}"${r.quote}" (${ui.remark.kinds[r.kind] ?? r.kind})${note}`);
  }
  return lines.join('\n');
}
