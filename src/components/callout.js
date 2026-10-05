import { md } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, contentLines } from './error.js';

const KINDS = new Set(['info', 'ok', 'warn', 'err']);
// Words agents write instead of the four kinds; the error names the kind the fence line needs.
const ALIASES = { warning: 'warn', error: 'err', note: 'info' };

export default {
  name: 'callout',
  summary: 'Conclusion / tip / warning bar',
  syntax: `\`\`\`callout <info|ok|warn|err> [title]
Body (Markdown)
\`\`\`
- If the first argument is not a type, the whole argument string is the title and the type is info.`,
  example: '```callout warn Caution\nClose the valve before you remove the pump.\n```',
  render(text, { args }) {
    const [first = '', ...rest] = args.split(/\s+/).filter(Boolean);
    const kind = KINDS.has(first) ? first : 'info';
    const title = (KINDS.has(first) ? rest.join(' ') : args).trim();
    if (!title && !text.trim()) throw new ComponentError('callout needs a title or a body', 1);
    const firstLine = contentLines(text)[0];
    const typeLine = firstLine && firstLine.text.match(/^type\s*[:：]\s*([a-z][\w-]*)\s*(?:#.*)?$/i);
    if (typeLine) {
      const word = typeLine[1].toLowerCase();
      const wrongKind = KINDS.has(word) ? word : ALIASES[word] ?? '<info|ok|warn|err>';
      throw new ComponentError(`callout: put the type on the fence line, not in the body: \`\`\`callout ${wrongKind} [title]. The line "${firstLine.text}" would show as body text`, firstLine.line);
    }
    const head = title ? `<div class="am-callout-title">${esc(title)}</div>` : '';
    const body = text.trim() ? `<div class="am-callout-body am-md">${md(text)}</div>` : '';
    return `<div class="am-callout am-callout--${kind}" role="note">${head}${body}</div>`;
  },
};
