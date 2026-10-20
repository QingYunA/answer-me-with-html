import { mdInline } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, contentLines } from './error.js';
import { parseAttrs } from '../parse.js';

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
      return `<div class="am-kv-cell${wide ? ' am-kv-cell--wide' : ''}"><dt>${esc(m[1].trim())}</dt><dd>${mdInline(m[2])}</dd></div>`;
    });
    if (!cells.length) throw new ComponentError('kv needs at least one key: value line', 1);
    return `<dl class="am-kv" style="--kv-cols: ${cols}">${cells.join('')}</dl>`;
  },
};
