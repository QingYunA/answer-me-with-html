// Entity relationship diagram: an entity per line at column 0, its fields indented under it, and relationships either
// written as `A 1--* B: label` or implied by a field's `FK -> Entity`. dagre computes the coordinates, this file draws
// the boxes and the crow's-foot ends as SVG, so themes, dark mode, the lightbox and video steps work as they do for flow.
import dagre from '@dagrejs/dagre';
import { esc, measure } from '../svg/text.js';
import { f, smoothPath, svgOpen, diagramLabel } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';

const FS = 13;
const FIELD_FS = 12;
const HEAD_LH = 20;
const FIELD_LH = 17;
const PAD = 11;
const KEY_GAP = 12;
const MIN_WIDTH = 92;
const DIRS = new Set(['TB', 'LR', 'BT', 'RL']);
// Cardinalities. `*` is many, `0..1` is zero or one, `1..*` is one or more; the end mark is drawn from the word.
const CARDS = ['1\\.\\.\\*', '0\\.\\.1', '\\*', '1'];
const MARKERS = new Set(['PK', 'FK', 'UK']);
const RELATIONSHIP = new RegExp(`^(\\S+)\\s+(${CARDS.join('|')})\\s*--\\s*(${CARDS.join('|')})\\s+(\\S+)\\s*(?::\\s*(.*))?$`);

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
- A field's FK -> Entity already draws its relationship, so a relationship line is optional. A relationship line that names the same two entities replaces the implied one and sets the cardinality and the label.
- The type is optional: \`email UK\` is a field with a key but no type.
- A Mermaid line such as USER ||--o{ ORDER is an error: write USER 1--* ORDER.
- The default direction is TB (top to bottom).`,
  example: '```er LR\n*User\n  id PK\n  email string UK\nOrder\n  id PK\n  user_id FK -> User\nUser 1--* Order: places\n```',
  render(text, { args, uid, ui }) {
    const model = parseEr(text);
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    const html = `<figure class="am-diagram am-er">${layout(model, DIRS.has(dir) ? dir : 'TB', uid(), ui)}</figure>`;
    return html;
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
    if (line.includes('--')) throw new ComponentError(`"${line}" is not a relationship; write A 1--* B (cardinalities 1, 0..1, * and 1..*)`, n);
    const hi = line.startsWith('*');
    const name = (hi ? line.slice(1) : line).trim();
    if (!name) throw new ComponentError('an entity needs a name', n);
    if (entities.has(name)) throw new ComponentError(`entity "${name}" is written twice`, n);
    current = { name, hi, fields: [], line: n, step: 0, x: 0, y: 0, width: 0, height: 0 };
    entities.set(name, current);
  }
  if (!entities.size) throw new ComponentError('an entity relationship diagram needs at least one entity (a line at column 0)', 1);
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

// The relationships of the diagram: the ones a FK field implies, then the written ones, which replace the implied
// relationship for the same pair of entities (either direction).
export function relationships({ entities, written }) {
  const byPair = new Map();
  for (const e of entities.values()) {
    for (const field of e.fields) {
      if (!field.ref) continue;
      byPair.set(pairKey(e.name, field.ref), { from: e.name, fromCard: '*', to: field.ref, toCard: '1', label: '', line: field.line });
    }
  }
  for (const rel of written) byPair.set(pairKey(rel.from, rel.to), rel);
  return [...byPair.values()];
}

const pairKey = (a, b) => [a, b].sort().join('\u0000');
const fieldText = (field) => (field.type ? `${field.name} ${field.type}` : field.name);

function nodeSize(entity) {
  const keyWidth = (field) => (field.marker ? measure(field.marker, FIELD_FS, { mono: true }) + KEY_GAP : 0);
  const width = Math.max(
    MIN_WIDTH,
    measure(entity.name, FS) + 2 * PAD,
    ...entity.fields.map((field) => measure(fieldText(field), FIELD_FS) + keyWidth(field) + 2 * PAD),
  );
  return { width: Math.ceil(width), height: HEAD_LH + entity.fields.length * FIELD_LH + 2 * PAD };
}

function layout(model, rankdir, id, ui) {
  const { entities } = model;
  const rels = relationships(model);
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
  rels.forEach((rel, i) => {
    const label = rel.label ? { label: rel.label, width: measure(rel.label, FIELD_FS) + 12, height: 18, labelpos: 'c' } : {};
    g.setEdge(key.get(rel.from), key.get(rel.to), label, `e${i}`);
  });
  dagre.layout(g);

  // In video mode, items appear step by step by source line: an entity line and a relationship line are one step each.
  const steps = [...new Set([...[...entities.values()].map((e) => e.line), ...rels.map((r) => r.line)])].sort((a, b) => a - b);
  const stepOf = new Map(steps.map((line, i) => [line, i]));

  const edgeSvg = rels.map((rel, i) => {
    const data = g.edge({ v: key.get(rel.from), w: key.get(rel.to), name: `e${i}` });
    const points = data.points.map((p) => ({ ...p }));
    const path = `<path class="am-edge" d="${smoothPath(points)}"/>`;
    const ends = endsSvg(points, rel);
    const label = rel.label
      ? `<g class="am-edge-label"><rect x="${f(data.x - (measure(rel.label, FIELD_FS) + 10) / 2)}" y="${f(data.y - 9)}" width="${f(measure(rel.label, FIELD_FS) + 10)}" height="18" rx="3"/>${textAt(rel.label, data.x, data.y)}</g>`
      : '';
    return `<g data-step="${stepOf.get(rel.line)}">${path}${ends}${label}</g>`;
  });

  const nodeSvg = [...entities.values()].map((entity) => {
    const { x, y } = g.node(key.get(entity.name));
    const { width, height } = sizes.get(entity.name);
    const left = x - width / 2;
    const top = y - height / 2;
    const head = `<text class="am-er-head" font-weight="600" x="${f(left + PAD)}" y="${f(top + PAD + HEAD_LH / 2)}" dominant-baseline="central">${esc(entity.name)}</text>`;
    const rule = `<line class="am-er-rule am-edge" opacity="0.45" x1="${f(left)}" y1="${f(top + PAD + HEAD_LH)}" x2="${f(left + width)}" y2="${f(top + PAD + HEAD_LH)}"/>`;
    const fields = entity.fields
      .map((field, i) => {
        const cy = top + PAD + HEAD_LH + FIELD_LH * (i + 0.5) + 1;
        const marker = field.marker ? `<text class="am-er-key am-cluster-label" x="${f(left + width - PAD)}" y="${f(cy)}" text-anchor="end" dominant-baseline="central">${esc(field.marker)}</text>` : '';
        return `<text class="am-er-field" font-size="12" x="${f(left + PAD)}" y="${f(cy)}" dominant-baseline="central">${esc(fieldText(field))}</text>${marker}`;
      })
      .join('');
    return `<g class="am-node am-node--er${entity.hi ? ' am-node--hi' : ''}" data-key="${esc(entity.name)}" data-step="${stepOf.get(entity.line)}"><rect class="am-node-shape" x="${f(left)}" y="${f(top)}" width="${f(width)}" height="${f(height)}" rx="3"/>${head}${rule}${fields}</g>`;
  });

  const { width, height } = g.graph();
  const label = diagramLabel(ui, 'er', [...entities.keys()].slice(0, 8));
  return `${svgOpen(width, height, label)}<g>${edgeSvg.join('')}</g><g>${nodeSvg.join('')}</g></svg>`;
}

// The end marks of one relationship: the written (or implied) cardinality at each end, drawn just outside the boxes.
function endsSvg(points, rel) {
  const [first, last] = [points[0], points.at(-1)];
  const out = [];
  if (points.length > 1) out.push(endMark(last, points.at(-2), rel.toCard), endMark(first, points[1], rel.fromCard));
  return out.join('');
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
  const circle = (back) => {
    const c = at(back, 0);
    return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="3.4"/>`;
  };
  const marks = {
    '1': () => bar(R.back),
    '0..1': () => bar(R.back) + circle(R.back + R.gap),
    '*': () => foot(R.back),
    '1..*': () => foot(R.back) + bar(R.back + R.gap),
  }[card]();
  return `<g class="am-er-end am-edge">${marks}</g>`;
}

function textAt(text, x, y) {
  return `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="central">${esc(text)}</text>`;
}
