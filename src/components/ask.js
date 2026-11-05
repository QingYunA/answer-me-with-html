import { mdInline } from '../markdown.js';
import { esc } from '../svg/text.js';
import { ComponentError, fields } from './error.js';

// A decision the reader makes on the page. The page's Reply button collects the answers (and the panel comments) into one
// Markdown reply that the reader pastes back to the agent. The option marked * is the agent's suggestion: it carries a tag, and every option starts unselected.
// An option may carry one preview, an indented ::: block that draws what the option means; the agent adds it only when a picture helps.
const OPTION = /^([*-])\s+(.+)$/;
const PREVIEW_OPEN = /^(\s*):::([^\s:]+)(?:\s+(.*))?$/;
const PREVIEW_CLOSE = /^(\s*):::\s*$/;

// The block: the question, then options. The lines inside a preview belong to it, so a * or - there is content, not another option.
// Preview.line is 1-based inside the block; render() maps it to the draft with the line renderFence passes in.
function read(text) {
  const lines = String(text).split('\n');
  let question = null;
  const options = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (question === null) {
      if (OPTION.test(trimmed)) throw new ComponentError('ask: the first line is the question', i + 1);
      question = { text: trimmed, line: i + 1 };
      continue;
    }
    const open = raw.match(PREVIEW_OPEN);
    if (open) {
      if (!current) throw new ComponentError('ask: put a preview under an option', i + 1);
      if (current.preview) throw new ComponentError('ask: one preview per option', i + 1);
      const indent = open[1].length;
      const content = [];
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const end = lines[j].match(PREVIEW_CLOSE);
        if (end && end[1].length === indent) {
          close = j;
          break;
        }
        content.push(lines[j].slice(Math.min(indent, lines[j].match(/^\s*/)[0].length)));
      }
      if (close === -1) throw new ComponentError('ask: the preview block is not closed', i + 1);
      current.preview = { lang: open[2].toLowerCase(), args: (open[3] ?? '').trim(), text: content.join('\n'), line: i + 1 };
      i = close;
      continue;
    }
    const option = trimmed.match(OPTION);
    if (option) {
      const [label, note = ''] = fields(option[2]);
      if (!label) throw new ComponentError('ask: an option needs a label before |', i + 1);
      current = { label, note, suggested: option[1] === '*', line: i + 1, preview: null };
      options.push(current);
      continue;
    }
    throw new ComponentError(`ask: "${trimmed}" is not an option; start it with * (suggested) or -`, i + 1);
  }
  if (!question) throw new ComponentError('ask: write the question on the first line', 1);
  return { question, options };
}

export default {
  name: 'ask',
  summary: 'A decision the reader makes on the page (collected by Reply)',
  pageOnly: true,
  panelOnly: true,
  syntax: `\`\`\`ask [multi] [cards]
The question, one sentence
* The option you suggest | optional note
- Another option | optional note
  :::flow
  A -> B: its preview, drawn in an indented block
  :::
\`\`\`
- The first line is the question. Each option starts with * or -. Write 2 to 6 options.
- One choice: exactly one * option. multi lets the reader pick several; * marks the ones you suggest.
- An option may carry one preview: indent a ::: block under it. Any component works, plus html and svg. Leave it out when a picture does not help.
- cards lays the options out in a grid, for a landing-page choice. Each preview becomes the card's canvas.
- Place the ask in the panel whose content the answer changes. The Reply button turns the answers into one reply.`,
  example: '```ask\nWhich cache do we use?\n* Redis | keeps data after a restart\n- Memcached | simpler, no disk\n```',
  // The text the STE check reads: options are list items; the note reads as a second clause of the item. A preview is a picture, not prose.
  lint(text) {
    const out = [];
    let previewIndent = null;
    for (const line of String(text).split('\n')) {
      const open = line.match(PREVIEW_OPEN);
      const close = line.match(PREVIEW_CLOSE);
      if (previewIndent !== null) {
        if (close && close[1].length === previewIndent) previewIndent = null;
        out.push('');
        continue;
      }
      if (open) {
        previewIndent = open[1].length;
        out.push('');
        continue;
      }
      const option = line.trim().match(OPTION);
      out.push(option ? `- ${fields(option[2]).filter(Boolean).join(': ')}` : line);
    }
    return out.join('\n');
  },
  render(text, { args, uid, ui = {}, line = 0, render }) {
    const multi = /(^|\s)multi(\s|$)/.test(args);
    const cards = /(^|\s)cards(\s|$)/.test(args);
    const { question, options } = read(text);
    if (options.length < 2 || options.length > 6) throw new ComponentError(`ask: write 2 to 6 options, not ${options.length}`, question.line);
    const suggested = options.filter((o) => o.suggested).length;
    if (!multi && suggested !== 1) {
      throw new ComponentError(`ask: mark exactly one option with * as your suggestion (found ${suggested}); add multi to let the reader pick several`, question.line);
    }
    const seen = new Set();
    for (const o of options) {
      if (seen.has(o.label)) throw new ComponentError(`ask: two options are both "${o.label}"`, o.line);
      seen.add(o.label);
    }
    const id = uid();
    const type = multi ? 'checkbox' : 'radio';
    const items = options.map((o) => {
      let preview = '';
      if (o.preview) {
        if (!render) throw new ComponentError('ask: a preview needs a page, not a video', o.preview.line);
        const at = line + o.preview.line;
        const block = { type: 'fence', lang: o.preview.lang, args: o.preview.args, text: o.preview.text, line: at };
        preview = `<div class="am-ask-preview">${render([block])}</div>`;
      }
      const body = `<span class="am-ask-body"><span class="am-ask-label">${mdInline(o.label)}</span>${o.suggested ? ` <span class="am-ask-tag">${esc(ui.reply?.suggested ?? 'suggested')}</span>` : ''}${o.note ? `<small class="am-ask-note">${mdInline(o.note)}</small>` : ''}</span>`;
      return `<div class="am-ask-card"><label class="am-ask-opt"><input type="${type}" name="${id}" value="${esc(o.label)}"${o.suggested ? ' data-suggested' : ''}>${body}</label>${preview}</div>`;
    });
    return `<fieldset class="am-ask${cards ? ' am-ask--cards' : ''}" data-ask="${id}"${multi ? ' data-multi' : ''}><legend class="am-ask-q">${mdInline(question.text)}</legend><div class="am-ask-opts">${items.join('')}</div></fieldset>`;
  },
};
