// Entity relationship diagram: an entity per line at column 0, its fields indented under it, and relationships either
// written as `A 1--* B: label` or implied by a field's `FK -> Entity`. dagre computes the coordinates, this file draws
// the boxes and the crow's-foot ends as SVG, so themes, dark mode, the lightbox and video steps work as they do for flow.
import dagre from '@dagrejs/dagre';
import { esc, measure } from '../svg/text.js';
import { f, smoothPath, svgOpen, textLines, diagramLabel } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';

const FS = 13;
const FIELD_FS = 12;
const KEY_FS = 11; // .am-cluster-label, which the key markers use
const EDGE_FS = 11.5; // .am-edge-label text
const LH = 17;
const HEAD_LH = 20;
const FIELD_LH = 17;
const PAD = 11;
const KEY_GAP = 12;
const MIN_WIDTH = 92;
const LOOP_OUT = 34; // how far a self-reference loops out of the box
const LOOP_STEP = 20; // and how much farther each further self-reference of the same entity goes
const LOOP_END = 18; // how far apart its two ends sit on the edge
const DIRS = new Set(['TB', 'LR', 'BT', 'RL']);
// Cardinalities. `*` is many, `0..1` is zero or one, `1..*` is one or more; the end mark is drawn from the word.
const CARDS = ['1\\.\\.\\*', '0\\.\\.1', '\\*', '1'];
const MARKERS = new Set(['PK', 'FK', 'UK']);
const RELATIONSHIP = new RegExp(`^(\\S+)\\s+(${CARDS.join('|')})\\s*--\\s*(${CARDS.join('|')})\\s+(\\S+)\\s*(?::\\s*(.*))?$`);
// A Mermaid relationship line: its cardinality symbols around `--` (identifying) or `..` (non-identifying).
const MERMAID = /^(\S+)\s+([|o{}]{2})(?:--|\.\.)([|o{}]{2})\s+(\S+)\s*(?::\s*(.*))?$/;
const MERMAID_CARDS = { '||': '1', 'o|': '0..1', '|o': '0..1', '|{': '1..*', '}|': '1..*', 'o{': '*', '}o': '*' };

export default {
  name: 'er',
  summary: 'Entity relationship diagram (automatic layout, crow\'s-foot ends)',
  syntax: `\`\`\`er [TB|LR|BT|RL]
*User                         ← a line at column 0 is an entity; * highlights it
  id PK                       ← an indented line is a field: name [type] [PK|FK|UK]
  email string UK
Order
  id PK
  user_id FK -> User          ← FK -> Entity draws the many-to-one relationship (*--1)
User 1--* Order: places       ← A <cardinality>--<cardinality> B: label (optional)
\`\`\`
- Cardinalities are 1, 0..1, * and 1..*. The left end is drawn at the entity on the left, the right end at the entity on the right.
- A field's FK -> Entity already draws its relationship, so a relationship line is optional. A relationship line that names the same two entities replaces the implied one and sets the cardinality and the label. Two FK fields that point at the same entity draw two relationships.
- The type is optional: \`email UK\` is a field with a key but no type.
- A Mermaid line such as USER ||--o{ ORDER is an error that shows the line written for this component.
- An entity a field or a relationship names must be written at column 0.
- A field that points at its own entity draws a loop.
- The default direction is TB (top to bottom).`,
  example: '```er LR\n*User\n  id PK\n  email string UK\nOrder\n  id PK\n  user_id FK -> User\nUser 1--* Order: places\n```',
  render(text, { args, ui }) {
    const model = parseEr(text);
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    return `<figure class="am-diagram am-er">${layout(model, DIRS.has(dir) ? dir : 'TB', ui)}</figure>`;
  },
};

export function parseEr(text) {
  const entities = new Map();
  const written = [];
  let current = null;
  for (const { raw, text: line, line: n } of contentLines(text)) {
    if (/^\s/.test(raw)) {
      if (!current) throw new ComponentError(`"${line}": a field line must follow an entity; write the entity name at the start of its own line first`, n);
      current.fields.push(parseField(line, n));
      continue;
    }
    const rel = line.match(RELATIONSHIP);
    if (rel) {
      written.push({ from: rel[1], fromCard: rel[2], to: rel[4], toCard: rel[3], label: rel[5]?.trim() ?? '', line: n });
      current = null;
      continue;
    }
    const mermaid = line.match(MERMAID);
    if (mermaid && MERMAID_CARDS[mermaid[2]] && MERMAID_CARDS[mermaid[3]]) {
      throw new ComponentError(`"${line}" is Mermaid syntax; write ${erLineOf(mermaid)}`, n);
    }
    if (line.includes('--') || line.includes('{') || line.includes('}')) {
      throw new ComponentError(`"${line}" is not an entity of this component; write A 1--* B for a relationship, or the entity name at column 0 on its own line`, n);
    }
    const hi = line.startsWith('*');
    const name = (hi ? line.slice(1) : line).trim();
    if (!name) throw new ComponentError('an entity needs a name', n);
    if (entities.has(name)) throw new ComponentError(`entity "${name}" is written twice`, n);
    current = { name, hi, fields: [], line: n };
    entities.set(name, current);
  }
  if (!entities.size) throw new ComponentError('an entity relationship diagram needs at least one entity (a line at column 0)', 1);
  // A name a field or a relationship refers to is looked up by graphlib: a typo would add a node with no size, and the
  // drawing would have NaN in it while the CLI still reported success.
  for (const entity of entities.values()) {
    for (const field of entity.fields) {
      if (field.ref && !entities.has(field.ref)) throw new ComponentError(`no entity "${field.ref}"; write it at column 0`, field.line);
    }
  }
  for (const rel of written) {
    for (const name of [rel.from, rel.to]) {
      if (!entities.has(name)) throw new ComponentError(`no entity "${name}"; write it at column 0`, rel.line);
    }
  }
  return { entities, written };
}

// `name [type] [PK|FK|UK] [-> Entity]`
function parseField(line, n) {
  const tokens = line.split(/\s+/);
  const name = tokens.shift();
  const arrow = tokens.indexOf('->');
  const head = arrow === -1 ? tokens : tokens.slice(0, arrow);
  const ref = arrow === -1 ? null : tokens[arrow + 1];
  if (arrow !== -1 && (ref === undefined || arrow + 2 !== tokens.length)) {
    throw new ComponentError(`"${line}": write the entity a field points at as "-> Entity", after the key marker`, n);
  }
  if (ref !== null && head.at(-1) !== 'FK') {
    throw new ComponentError(`"${line}": only a FK field points at another entity; mark the field FK`, n);
  }
  const at = head.findIndex((t) => MARKERS.has(t));
  if (at !== -1 && at !== head.length - 1) throw new ComponentError(`"${line}": "${head[at]}" must be the last word before "->"`, n);
  const marker = at === -1 ? null : head[at];
  const type = head.slice(0, at === -1 ? head.length : at).join(' ');
  return { name, type, marker, ref, line: n };
}

// The Mermaid line written in this component's syntax: `USER ||--o{ ORDER : places` -> `USER 1--* ORDER: places`.
function erLineOf(mermaid) {
  const [, from, left, right, to, label] = mermaid;
  const text = label?.trim();
  return `${from} ${MERMAID_CARDS[left]}--${MERMAID_CARDS[right]} ${to}${text ? `: ${text}` : ''}`;
}

// The relationships of the diagram: one per FK field that points at another entity, then the written lines, which take
// the place of every implied relationship between the same two entities. Two FK fields to one entity give two edges.
export function relationships({ entities, written }) {
  const implied = [];
  for (const entity of entities.values()) {
    for (const field of entity.fields) {
      if (field.ref) implied.push({ from: entity.name, fromCard: '*', to: field.ref, toCard: '1', label: '', line: field.line });
    }
  }
  const replaced = new Set(written.map((rel) => pairKey(rel.from, rel.to)));
  return [...implied.filter((rel) => !replaced.has(pairKey(rel.from, rel.to))), ...written];
}

const pairKey = (a, b) => [a, b].sort().join('\u0000');
const fieldText = (field) => (field.type ? `${field.name} ${field.type}` : field.name);
// The entity name is always bold (the head carries font-weight), and a highlighted entity makes every line of its box
// bold, which is a little wider.
const nameWidth = (entity) => measure(entity.name, FS, { bold: true });
const rowWidth = (entity, field) => measure(fieldText(field), FIELD_FS, { bold: entity.hi }) + keyWidth(entity, field) + 2 * PAD;
const keyWidth = (entity, field) => (field.marker ? measure(field.marker, KEY_FS, { mono: true, bold: entity.hi }) + KEY_GAP : 0);

function nodeSize(entity) {
  const rows = entity.fields.map((field) => rowWidth(entity, field));
  return { width: Math.ceil(Math.max(MIN_WIDTH, nameWidth(entity) + 2 * PAD, ...rows)), height: HEAD_LH + entity.fields.length * FIELD_LH + 2 * PAD };
}

function layout(model, rankdir, ui) {
  const { entities } = model;
  const rels = relationships(model);
  const loops = rels.filter((rel) => rel.from === rel.to);
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, nodesep: 44, ranksep: 62, marginx: 14, marginy: 14 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre reserves ids such as "\x00" internally; entities always get internal numbers, so no written name can collide.
  const key = new Map([...entities.keys()].map((name, i) => [name, `n${i}`]));
  const sizes = new Map();
  for (const entity of entities.values()) {
    const size = nodeSize(entity);
    sizes.set(entity.name, size);
    g.setNode(key.get(entity.name), { width: size.width, height: size.height });
  }
  // A self-reference does not go through dagre, which would draw a line out of the box; it is drawn as a loop below.
  rels.filter((rel) => rel.from !== rel.to).forEach((rel, i) => {
    const label = rel.label ? { label: rel.label, width: measure(rel.label, EDGE_FS) + 10, height: 18, labelpos: 'c' } : {};
    g.setEdge(key.get(rel.from), key.get(rel.to), label, `e${i}`);
  });
  dagre.layout(g);

  // In video mode, items appear step by step by source line: an entity line and a relationship line are one step each.
  const steps = [...new Set([...[...entities.values()].map((e) => e.line), ...rels.map((r) => r.line)])].sort((a, b) => a - b);
  const stepOf = new Map(steps.map((line, i) => [line, i]));

  const edgeSvg = rels.filter((rel) => rel.from !== rel.to).map((rel, i) => {
    const data = g.edge({ v: key.get(rel.from), w: key.get(rel.to), name: `e${i}` });
    const points = data.points.map((p) => ({ ...p }));
    const label = rel.label ? labelSvg(rel.label, data.x, data.y) : '';
    return `<g data-step="${stepOf.get(rel.line)}"><path class="am-edge" d="${smoothPath(points)}"/>${endsSvg(points, rel)}${label}</g>`;
  });

  const nodeSvg = [...entities.values()].map((entity) => {
    const { x, y } = g.node(key.get(entity.name));
    const size = sizes.get(entity.name);
    return nodeSvgOf(entity, x, y, size, stepOf.get(entity.line));
  });

  // A loop lies outside the box on its right. Two self-references of one entity take their own distance, so both stay
  // visible, and the drawing has to be wide enough for the farthest one and its label.
  const seen = new Map();
  const loopSpecs = loops.map((rel) => {
    const nth = seen.get(rel.from) ?? 0;
    seen.set(rel.from, nth + 1);
    const { x, y } = g.node(key.get(rel.from));
    const size = sizes.get(rel.from);
    return { rel, x, y, size, out: x + size.width / 2 + LOOP_OUT + nth * LOOP_STEP };
  });
  const loopsSvg = loopSpecs.map((spec) => loopSvg(spec, stepOf.get(spec.rel.line)));

  // The drawing is as big as everything drawn on it: dagre sizes the ranks, but a parallel edge bulges past them and a
  // loop sits outside its box, so the extent of every point decides. A shift keeps the origin at 0.
  const xs = [];
  const ys = [];
  const at = (x, y) => {
    xs.push(x);
    ys.push(y);
  };
  for (const entity of entities.values()) {
    const { x, y } = g.node(key.get(entity.name));
    const size = sizes.get(entity.name);
    at(x - size.width / 2, y - size.height / 2);
    at(x + size.width / 2, y + size.height / 2);
  }
  const straight = rels.filter((rel) => rel.from !== rel.to);
  straight.forEach((rel, i) => {
    const data = g.edge({ v: key.get(rel.from), w: key.get(rel.to), name: `e${i}` });
    for (const p of data.points) at(p.x, p.y);
    // dagre gives an edge a label position only when it has a label.
    if (rel.label) {
      const w = labelWidth(rel.label);
      at(data.x - w / 2, data.y - 9);
      at(data.x + w / 2, data.y + 9);
    }
  });
  for (const { rel, y, out } of loopSpecs) {
    at(out + 6 + (rel.label ? labelWidth(rel.label) : 0), y + LOOP_END / 2);
    at(out, y - LOOP_END / 2);
  }
  const margin = 14;
  const shiftX = margin - Math.min(...xs);
  const shiftY = margin - Math.min(...ys);
  const shift = shiftX || shiftY ? ` transform="translate(${f(shiftX)},${f(shiftY)})"` : '';
  const width = Math.ceil(Math.max(...xs) - Math.min(...xs)) + 2 * margin;
  const height = Math.ceil(Math.max(...ys) - Math.min(...ys)) + 2 * margin;
  const label = diagramLabel(ui, 'er', [...entities.keys()].slice(0, 8));
  return `${svgOpen(width, height, label)}<g${shift}><g>${edgeSvg.join('')}</g><g>${loopsSvg.join('')}</g><g>${nodeSvg.join('')}</g></g></svg>`;
}

function nodeSvgOf(entity, x, y, size, step) {
  const left = x - size.width / 2;
  const top = y - size.height / 2;
  const head = `<text class="am-er-head" font-weight="600" x="${f(left + PAD)}" y="${f(top + PAD + HEAD_LH / 2)}" dominant-baseline="central">${esc(entity.name)}</text>`;
  const rule = `<line class="am-er-rule am-edge" opacity="0.45" x1="${f(left)}" y1="${f(top + PAD + HEAD_LH)}" x2="${f(left + size.width)}" y2="${f(top + PAD + HEAD_LH)}"/>`;
  const fields = entity.fields
    .map((field, i) => {
      const cy = top + PAD + HEAD_LH + FIELD_LH * (i + 0.5) + 1;
      // style, not the SVG attribute: `.am-diagram text` sets 13px and a stylesheet wins over a presentation attribute.
      const marker = field.marker ? `<text class="am-er-key am-cluster-label" x="${f(left + size.width - PAD)}" y="${f(cy)}" text-anchor="end" dominant-baseline="central">${esc(field.marker)}</text>` : '';
      return `<text class="am-er-field" style="font-size:${FIELD_FS}px" x="${f(left + PAD)}" y="${f(cy)}" dominant-baseline="central">${esc(fieldText(field))}</text>${marker}`;
    })
    .join('');
  return `<g class="am-node am-node--er${entity.hi ? ' am-node--hi' : ''}" data-key="${esc(entity.name)}" data-step="${step}"><rect class="am-node-shape" x="${f(left)}" y="${f(top)}" width="${f(size.width)}" height="${f(size.height)}" rx="3"/>${head}${rule}${fields}</g>`;
}

// A self-reference: out of the right edge, around, and back into it, with the two ends on that edge. `toward` lies
// outside the box, as it does for an edge between two boxes, so the end marks are drawn outside the border too.
function loopSvg({ rel, x, y, size, out }, step) {
  const right = x + size.width / 2;
  const [ay, by] = [y - LOOP_END / 2, y + LOOP_END / 2];
  const path = `<path class="am-edge" d="M${f(right)},${f(ay)} C${f(out)},${f(ay)} ${f(out)},${f(by)} ${f(right)},${f(by)}"/>`;
  const ends = `${endMark({ x: right, y: ay }, { x: right + 1, y: ay }, rel.fromCard)}${endMark({ x: right, y: by }, { x: right + 1, y: by }, rel.toCard)}`;
  const label = rel.label ? labelSvg(rel.label, out + 6 + labelWidth(rel.label) / 2, y) : '';
  return `<g data-step="${step}">${path}${ends}${label}</g>`;
}

function labelWidth(text) {
  return measure(text, EDGE_FS) + 10;
}

function labelSvg(text, x, y) {
  const w = labelWidth(text);
  return `<g class="am-edge-label"><rect x="${f(x - w / 2)}" y="${f(y - 9)}" width="${f(w)}" height="18" rx="3"/>${textLines([text], x, y, LH)}</g>`;
}

// The end marks of one relationship: the written (or implied) cardinality at each end, drawn just outside the boxes.
function endsSvg(points, rel) {
  if (points.length < 2) return '';
  return endMark(points.at(-1), points.at(-2), rel.toCard) + endMark(points[0], points[1], rel.fromCard);
}

const R = { back: 12, side: 5, gap: 5 };

// One end: a tick for "one", a crow's foot for "many", a circle for "zero", as the notation reads them. point sits on
// the box border; the marks are drawn outside the box, along the edge, so a tick lands near the box and a circle farther.
function endMark(point, toward, card) {
  const dx = point.x - toward.x;
  const dy = point.y - toward.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const at = (back, side) => ({ x: point.x - ux * back + px * side, y: point.y - uy * back + py * side });
  const line = (a, b) => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`;
  const bar = (back) => line(at(back, -R.side), at(back, R.side));
  const foot = (apexBack) => {
    const apex = at(apexBack, 0);
    return [line(at(0, -R.side), apex), line(at(0, 0), apex), line(at(0, R.side), apex)].join('');
  };
  // Filled with the page colour, so the edge does not run through the circle. style, not the attribute: the class sets fill: none.
  const circle = (back) => {
    const c = at(back, 0);
    return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="3.4" style="fill: var(--paper, #ffffff)"/>`;
  };
  const marks = {
    '1': () => bar(R.back),
    '0..1': () => bar(R.back) + circle(R.back + R.gap),
    '*': () => foot(R.back),
    '1..*': () => foot(R.back) + bar(R.back + R.gap),
  }[card]();
  return `<g class="am-er-end am-edge">${marks}</g>`;
}
