import { mdInline } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, contentLines, fields } from './error.js';

// A decision the reader makes on the page. The page's Reply button collects the answers (and the panel comments) into one
// Markdown reply that the reader pastes back to the agent. The option marked * is the agent's suggestion and starts selected.
const OPTION = /^([*-])\s+(.+)$/;

export default {
  name: 'ask',
  summary: 'A decision the reader makes on the page (collected by Reply)',
  pageOnly: true,
  panelOnly: true,
  syntax: `\`\`\`ask [multi]
The question, one sentence
* The option you suggest | optional note   ← * marks the suggestion; it starts selected
- Another option | optional note
\`\`\`
- The first line is the question. Each option starts with * or -. Write 2 to 6 options.
- One choice: exactly one * option. multi lets the reader pick several; * marks the ones that start picked.
- Place the ask in the panel whose content the answer changes. The Reply button turns the answers into one reply.`,
  example: '```ask\nWhich cache do we use?\n* Redis | keeps data after a restart\n- Memcached | simpler, no disk\n```',
  // The text the STE check reads: options are list items; the note reads as a second clause of the item.
  lint(text) {
    return text.split('\n').map((l) => l.replace(OPTION, (_, mark, body) => `- ${fields(body).filter(Boolean).join(': ')}`)).join('\n');
  },
  render(text, { args, uid, ui = {} }) {
    const multi = /(^|\s)multi(\s|$)/.test(args);
    const lines = contentLines(text);
    const [first, ...rest] = lines;
    if (!first || OPTION.test(first.text)) throw new ComponentError('ask: the first line is the question', first?.line ?? 1);
    const options = rest.map(({ text: t, line }) => {
      const m = t.match(OPTION);
      if (!m) throw new ComponentError(`ask: "${t}" is not an option; start it with * (suggested) or -`, line);
      const [label, note = ''] = fields(m[2]);
      if (!label) throw new ComponentError('ask: an option needs a label before |', line);
      return { label, note, suggested: m[1] === '*', line };
    });
    if (options.length < 2 || options.length > 6) throw new ComponentError(`ask: write 2 to 6 options, not ${options.length}`, first.line);
    const suggested = options.filter((o) => o.suggested).length;
    if (!multi && suggested !== 1) {
      throw new ComponentError(`ask: mark exactly one option with * as your suggestion (found ${suggested}); add multi to let the reader pick several`, first.line);
    }
    const seen = new Set();
    for (const o of options) {
      if (seen.has(o.label)) throw new ComponentError(`ask: two options are both "${o.label}"`, o.line);
      seen.add(o.label);
    }
    const id = uid();
    const type = multi ? 'checkbox' : 'radio';
    const items = options.map((o) => `<label class="am-ask-opt"><input type="${type}" name="${id}" value="${esc(o.label)}"${o.suggested ? ' checked data-suggested' : ''}><span class="am-ask-body"><span class="am-ask-label">${mdInline(o.label)}</span>${o.suggested ? ` <span class="am-ask-tag">${esc(ui.reply?.suggested ?? 'suggested')}</span>` : ''}${o.note ? `<small class="am-ask-note">${mdInline(o.note)}</small>` : ''}</span></label>`);
    return `<fieldset class="am-ask" data-ask="${id}"${multi ? ' data-multi' : ''}><legend class="am-ask-q">${mdInline(first.text)}</legend>${items.join('')}</fieldset>`;
  },
};
