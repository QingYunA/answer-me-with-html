import { mdInline } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, contentLines } from './error.js';
import { parseAttrs } from '../attrs.js';

export default {
  name: 'kv',
  summary: 'Key-value grid / title block (metadata)',
  syntax: `\`\`\`kv [cols=2]
key: value
* wide key: value   ← starts with *: spans the full row, larger text
\`\`\`
- Splits at the first colon (: or the fullwidth colon); the value may contain more colons.`,
  example: '```kv cols=2\n* Title: Simplified Technical English\nSpecification: ASD-STE100\nOwner: ASD\n```',
  render(text, { args }) {
    const parsed = parseAttrs(args).cols;
    const value = Number(parsed);
    if (Number.isFinite(value) && !Number.isInteger(value)) {
      throw new ComponentError(`kv cols must be a whole number from 1 to 6, not "${parsed}"`, 0);
    }
    const cols = Math.max(1, Math.min(value || 2, 6));
    const cells = contentLines(text).map(({ text: t, line }) => {
      const wide = t.startsWith('*');
      const body = wide ? t.slice(1).trim() : t;
      const m = body.match(/^([^:：]+)[:：]\s*(.*)$/);
      if (!m) throw new ComponentError(`kv line has no colon: "${t}"; expected key: value`, line);
      return { wide, key: m[1].trim(), value: m[2] };
    });
    // The last cell of a row that a wide cell or the end cuts short takes the rest of the row, so the grid has no empty corner.
    const span = new Array(cells.length).fill(1);
    let pos = 0;
    cells.forEach((c, i) => {
      if (c.wide) {
        if (pos > 0) span[i - 1] += cols - pos;
        pos = 0;
      } else pos = (pos + 1) % cols;
    });
    if (pos > 0) span[cells.length - 1] += cols - pos;
    const html = cells.map((c, i) => `<div class="am-kv-cell${c.wide ? ' am-kv-cell--wide' : ''}"${span[i] > 1 ? ` style="grid-column: span ${span[i]}"` : ''}><dt>${esc(c.key)}</dt><dd>${mdInline(c.value)}</dd></div>`);
    if (!cells.length) throw new ComponentError('kv needs at least one key: value line', 1);
    return `<dl class="am-kv" style="--kv-cols: ${cols}">${html.join('')}</dl>`;
  },
};
