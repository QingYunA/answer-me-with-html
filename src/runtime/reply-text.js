// The reply a reader copies from the page: one Markdown text with the decisions and the panel comments.
// A plain ES module for tests; the page gets it with its `export` keyword dropped (src/runtime/compose.js).
// decisions: [{ panel, question, picked: [label], suggested: [label], touched }]; comments: [{ panel, title, text }].
// Comment text is quoted line by line, so text the reader typed cannot pass as part of the structure.
// rtl: the page reads right to left, so the arrow before each answer points left, the way the text runs.
export function replyText({ title, decisions, comments, ui, rtl = false }) {
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
  if (written.length) {
    out.push('', `## ${ui.comments}`);
    for (const c of written) {
      out.push(`- **${c.panel} · ${c.title}**`, ...c.text.trim().split('\n').map((l) => `  > ${l}`));
    }
    out.push('', `_${ui.typed}_`);
  }
  return `${out.join('\n')}\n`;
}
