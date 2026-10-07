// Sequence diagram: participants laid out horizontally, messages top to bottom. Spacing derives from message label widths, so labels are never squeezed.
import { esc, measure, wrap } from '../svg/text.js';
import { f, arrowDefs, svgOpen, textLines, diagramLabel, mirror } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';

const FS = 13;
const LH = 16;
const ACTOR_H = 34;
const TOP = 8;
const MARGIN = 12;
const LABEL_MAX = 240;

const RE = {
  participants: /^participants?\s*[:：]\s*(.+)$/i,
  note: /^note\s+([^:：]+)[:：]\s*(.+)$/i,
  divider: /^==\s*(.+?)\s*==$/,
  msg: /^([^:：]+?)\s*(-->|->)\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/,
};

export function parseSequence(text) {
  const participants = [];
  const add = (p) => { if (!participants.includes(p)) participants.push(p); };
  const steps = [];
  for (const { text: t, line } of contentLines(text)) {
    let m;
    if ((m = t.match(RE.participants))) {
      m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean).forEach(add);
    } else if ((m = t.match(RE.note))) {
      const over = m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      over.forEach(add);
      steps.push({ kind: 'note', over, text: m[2].trim(), line });
    } else if ((m = t.match(RE.divider))) {
      steps.push({ kind: 'divider', text: m[1], line });
    } else if ((m = t.match(RE.msg))) {
      add(m[1]);
      add(m[3]);
      steps.push({ kind: 'msg', from: m[1], to: m[3], dashed: m[2] === '-->', label: (m[4] ?? '').trim(), line });
    } else {
      throw new ComponentError(`sequence cannot parse "${t}". Write a message as A -> B: label (--> is a dashed return) and a note as note A: text`, line);
    }
  }
  if (!participants.length) throw new ComponentError('sequence needs at least one message', 1);
  return { participants, steps };
}

export default {
  name: 'sequence',
  summary: 'Sequence diagram (messages between participants)',
  syntax: `\`\`\`sequence [num]
participants: A, B, C        ← optional, fixes the participant order
A -> B: request              ← solid line
B --> A: response            ← dashed line (return)
B -> B: self call
note A: note on one participant
note A, C: note across several participants
== Phase divider ==
\`\`\`
- Argument num: number the messages.`,
  example: '```sequence\nClient -> Server: SYN\nServer --> Client: SYN-ACK\nClient -> Server: ACK\nnote Client, Server: ESTABLISHED\n```',
  render(text, { args, uid, ui, dir = 'ltr' }) {
    const model = parseSequence(text);
    return `<figure class="am-diagram am-seq">${layout(model, { num: /\bnum\b/.test(args), id: uid(), ui, dir })}</figure>`;
  },
};

function layout({ participants: ps, steps }, { num, id, ui, dir = 'ltr' }) {
  const idx = new Map(ps.map((p, i) => [p, i]));
  const actorW = ps.map((p) => Math.max(measure(p, FS) + 28, 84));
  const gaps = ps.slice(1).map((_, i) => (actorW[i] + actorW[i + 1]) / 2 + 28);
  let extraRight = 0;
  let extraLeft = 0;

  const prepared = steps.map((s) => {
    if (s.kind === 'msg') {
      const lines = s.label ? wrap(s.label, LABEL_MAX, FS) : [];
      const width = Math.max(0, ...lines.map((l) => measure(l, FS))) + (num ? 34 : 22);
      const a = idx.get(s.from);
      const b = idx.get(s.to);
      if (a === b) {
        if (a < gaps.length) gaps[a] = Math.max(gaps[a], width + 48);
        else extraRight = Math.max(extraRight, width + 40);
      } else {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        const span = gaps.slice(lo, hi).reduce((x, y) => x + y, 0);
        if (span < width) gaps[hi - 1] += width - span;
      }
      return { ...s, lines, a, b };
    }
    const lines = wrap(s.text, 220, 12);
    const w = Math.max(...lines.map((l) => measure(l, 12))) + 20;
    if (s.kind === 'note' && s.over.length === 1) {
      const i = idx.get(s.over[0]);
      if (i === 0) extraLeft = Math.max(extraLeft, w / 2 - actorW[0] / 2);
      if (i === ps.length - 1) extraRight = Math.max(extraRight, w / 2 - actorW[i] / 2);
    }
    return { ...s, lines, w };
  });

  const xs = [MARGIN + extraLeft + actorW[0] / 2];
  gaps.forEach((g) => xs.push(xs.at(-1) + g));
  const width = xs.at(-1) + actorW.at(-1) / 2 + MARGIN + extraRight;
  // The layout above runs left to right. A right-to-left page draws its mirror image: the first participant on the right,
  // self calls and step numbers on the other side (dx flips the offsets). Text anchors keep their names: the svg's
  // direction="rtl" turns "start" into the right end of the text, which is the mirror of the left-to-right placement.
  const rtl = dir === 'rtl';
  const X = mirror(width, rtl);
  const dx = rtl ? -1 : 1;

  const body = [];
  let y = TOP + ACTOR_H + 22;
  let n = 0;
  for (const [k, s] of prepared.entries()) {
    const start = body.length;
    if (s.kind === 'msg') {
      n++;
      const cls = `am-edge${s.dashed ? ' am-edge--dashed' : ''}`;
      const marker = ` marker-end="url(#${id}-arrow)"`;
      const step = num ? `<text class="am-step" x="${f(X(xs[s.a]) + dx * (s.b >= s.a ? 6 : -6))}" y="${f(y + s.lines.length * LH - 6)}" text-anchor="${s.b >= s.a ? 'start' : 'end'}">${n}</text>` : '';
      if (s.a === s.b) {
        const x = X(xs[s.a]);
        const labelX = x + dx * 40;
        body.push(s.lines.map((l, k) => `<text x="${f(labelX)}" y="${f(y + k * LH + 4)}" dominant-baseline="central">${esc(l)}</text>`).join(''));
        body.push(`<path class="${cls}" d="M${f(x)},${f(y)} H${f(x + dx * 30)} V${f(y + 20)} H${f(x + dx * 2)}"${marker}/>`, step);
        y += Math.max(s.lines.length * LH, 20) + 28;
      } else {
        y += s.lines.length * LH;
        const [x1, x2] = [X(xs[s.a]), X(xs[s.b])];
        const mx = (x1 + x2) / 2;
        body.push(s.lines.map((l, k) => `<text x="${f(mx)}" y="${f(y - 10 - (s.lines.length - 1 - k) * LH)}" text-anchor="middle">${esc(l)}</text>`).join(''));
        body.push(`<path class="${cls}" d="M${f(x1)},${f(y)} L${f(x2 + (x2 > x1 ? -2 : 2))},${f(y)}"${marker}/>`, step);
        y += 24;
      }
    } else if (s.kind === 'note') {
      const xsOver = s.over.map((p) => X(xs[idx.get(p)]));
      const lo = Math.min(...xsOver);
      const hi = Math.max(...xsOver);
      const w = Math.max(s.w, hi - lo + 40);
      const h = s.lines.length * LH + 12;
      const cx = (lo + hi) / 2;
      body.push(`<rect class="am-note" x="${f(cx - w / 2)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="2"/>`);
      body.push(textLines(s.lines, cx, y + h / 2, LH, ' font-size="12"'));
      y += h + 16;
    } else {
      const w = Math.max(...s.lines.map((l) => measure(l, 12))) + 20;
      body.push(`<line class="am-lifeline" x1="${MARGIN}" y1="${f(y + 10)}" x2="${f(width - MARGIN)}" y2="${f(y + 10)}"/>`);
      body.push(`<rect class="am-actor" x="${f(width / 2 - w / 2)}" y="${f(y)}" width="${f(w)}" height="20" rx="2"/>`);
      body.push(textLines(s.lines.slice(0, 1), width / 2, y + 10, LH, ' font-size="12"'));
      y += 34;
    }
    body.splice(start, body.length - start, `<g data-step="${k}">${body.slice(start).join('')}</g>`);
  }
  const height = y + 6;

  const actors = ps.map((p, i) => {
    const x = X(xs[i]);
    return `<line class="am-lifeline" x1="${f(x)}" y1="${TOP + ACTOR_H}" x2="${f(x)}" y2="${f(height - 4)}"/>`
      + `<g data-key="${esc(p)}"><rect class="am-actor" x="${f(x - actorW[i] / 2)}" y="${TOP}" width="${f(actorW[i])}" height="${ACTOR_H}" rx="2"/>`
      + `${textLines([p], x, TOP + ACTOR_H / 2, LH, ' font-weight="600"')}</g>`;
  });
  return `${svgOpen(width, height, diagramLabel(ui, 'sequence', ps), dir)}${arrowDefs(id)}${actors.join('')}${body.join('')}</svg>`;
}
