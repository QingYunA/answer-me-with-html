import { mdInline } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, contentLines, fields } from './error.js';

export default {
  name: 'timeline',
  summary: 'Timeline / phases',
  syntax: `\`\`\`timeline [h|v]
time | title | note (optional)
*time | title        ← starts with *: highlights the item
\`\`\`
- By default ≤6 items are horizontal and >6 are vertical; the h / v argument forces a direction.`,
  example: '```timeline\n1979 | AECMA starts the study\n1986 | First guide published\n*Now | Free download | Maintained by ASD STEMG\n```',
  render(text, { args }) {
    const items = contentLines(text).map(({ text: t, line }) => {
      const parts = fields(t);
      if (parts.length < 2 || !parts[1]) throw new ComponentError(`timeline line must be time | title | note: "${t}"`, line);
      const hi = parts[0].startsWith('*');
      return { when: hi ? parts[0].slice(1).trim() : parts[0], title: parts[1], detail: parts[2] ?? '', hi };
    });
    if (!items.length) throw new ComponentError('timeline needs at least one item', 1);
    const vertical = /\bv(ertical)?\b/.test(args) || (!/\bh(orizontal)?\b/.test(args) && items.length > 6);
    const lis = items.map((it) => `<li class="am-tl-item${it.hi ? ' am-tl-item--hi' : ''}"><span class="am-tl-when">${esc(it.when)}</span><span class="am-tl-dot"></span><span class="am-tl-title">${mdInline(it.title)}</span>${it.detail ? `<span class="am-tl-text">${mdInline(it.detail)}</span>` : ''}</li>`);
    return vertical
      ? `<ol class="am-timeline am-timeline--v">${lis.join('')}</ol>`
      : `<div class="am-tl-wrap"><ol class="am-timeline am-timeline--h" style="--n: ${items.length}">${lis.join('')}</ol></div>`;
  },
};
