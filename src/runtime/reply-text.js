// The reply a reader copies from the page: one Markdown text with the decisions, the panel comments and the block remarks.
// A plain ES module for tests; the page gets it with its `export` keyword dropped (src/runtime/compose.js).
// decisions: [{ panel, question, picked: [label], suggested: [label], touched }]; comments: [{ panel, title, text }];
// remarks: [{ panel, quote, kind, note }], where quote is the start of the marked block and kind is a key of ui.kinds.
// Comment and remark text is quoted line by line, so text the reader typed cannot pass as part of the structure.
// rtl: the page reads right to left, so the arrow before each answer points left, the way the text runs.
export function replyText({ title, decisions, comments, remarks = [], ui, rtl = false }) {
  const arrow = rtl ? '←' : '→';
  const out = [`# Re: ${title}`];
  if (decisions.length) {
    out.push('', `## ${ui.decisions}`);
    decisions.forEach((d, i) => {
      const answer = d.picked.length ? d.picked.map((l) => `**${l}**`).join(', ') : '**—**';
      const same = d.picked.length === d.suggested.length && d.picked.every((l) => d.suggested.includes(l));
      const why = same ? (d.touched ? ui.confirmed : ui.untouched) : `${ui.was}: ${d.suggested.join(', ') || '—'}`;
      out.push(`${i + 1}. [${d.panel}] ${d.question}`, `   ${arrow} ${answer} _(${why})_`);
    });
  }
  const written = comments.filter((c) => c.text.trim());
  const quoted = (text) => (text.trim() ? text.trim().split('\n').map((l) => `  > ${l}`) : []);
  if (written.length) {
    out.push('', `## ${ui.comments}`);
    for (const c of written) out.push(`- **${c.panel} · ${c.title}**`, ...quoted(c.text));
  }
  if (remarks.length) {
    out.push('', `## ${ui.remarks}`);
    for (const r of remarks) {
      const label = [r.panel, ui.kinds?.[r.kind] ?? r.kind].filter(Boolean).join(' · ');
      out.push(`- **${label}** "${r.quote}"`, ...quoted(r.note));
    }
  }
  if (written.length || remarks.some((r) => r.note.trim())) out.push('', `_${ui.typed}_`);
  return `${out.join('\n')}\n`;
}
