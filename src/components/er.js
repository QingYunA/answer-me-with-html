// Entity relationship diagram: an entity per line at column 0, its fields indented under it, and relationships either
// written as `A 1--* B: label` or implied by a field's `FK -> Entity`. dagre computes the coordinates, this file draws
// the boxes and the crow's-foot ends as SVG, so themes, dark mode, the lightbox and video steps work as they do for flow.
import dagre from '@dagrejs/dagre';
import { esc, measure } from '../svg/text.js';
import { f, smoothPath, svgOpen, textLines, diagramLabel, mirrorLayout } from '../svg/shapes.js';
import { svgLine } from '../bidi.js';
import { ComponentError, contentLines } from './error.js';
import { splitMarker, markState, deltaAttr, withDelta, SIGN } from './delta.js';
import { badgeSvg } from './flow.js';

const FS = 13;
const FIELD_FS = 12;
const KEY_FS = 11; // .am-cluster-label, which the key markers use
const EDGE_FS = 11.5; // .am-edge-label text
const LH = 17;
const HEAD_LH = 20;
const FIELD_LH = 17;
const PAD = 11;
const KEY_GAP = 12;
const SIGN_W = 14; // the room a marked field row keeps at its start for the + - or ~ sign
const MIN_WIDTH = 92;
const LOOP_OUT = 34; // how far a self-reference loops out of the box
const LOOP_STEP = 20; // and how much farther each further self-reference of the same entity goes
const LOOP_END = 18; // how far apart its two ends sit on the edge
const LOOP_LABEL = 24; // the room a loop's label takes below the loop, which the next loop of the same entity leaves free
const LOOP_GAP = 6; // and what is left under the lowest loop of an entity before the next box of its rank
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
- A field that points at its own entity draws a loop: beside the box, or below it in LR and RL.
- The default direction is TB (top to bottom).
- Change markers show what a plan adds, removes and changes. A line can start with + (added), - (removed) or ~ (changed), followed by a space: an entity line at column 0, a field line after its indentation, or a relationship line:
\`\`\`er
User
  ~ email varchar(320) UK
  + phone string
Order
  + coupon_id FK -> Coupon
  - legacy_ref string
+ Coupon
  id PK
- AuditLog
  id PK
+ User 1--* Coupon: owns
\`\`\`
  - An entity is marked only by its own line; a marked field does not mark it. The fields of a + or - entity inherit its marker, and a field with another marker is an error. ~ marks a field as changed and does not show the old value. Markers combine with *.
  - A relationship from an FK field takes the marker of that field; otherwise it is added or removed with an entity at either end. A written relationship line takes its own marker. To change one, remove the old line with - and add the new one with +; ~ on a relationship line is an error.
  - The Changes view draws added in the theme's ok color, removed faded with struck-through text, changed with a warn outline, and each marked entity with a +, − or ~ badge. A marked field row gets a tinted band and its sign at the start of the row. A count row (entities, fields and written relationship lines) and a Before / Changes / After switch sit under the diagram: Before and After show the schema as it was and as it will be, plain and without the items that are not in that view.
  - A line that starts with a marker and a space is always read as a marker.`,
  example: '```er LR\n*User\n  id PK\n  email string UK\nOrder\n  id PK\n  user_id FK -> User\nUser 1--* Order: places\n```',
  render(text, { args, ui, video, dir: pageDir = 'ltr' }) {
    const model = parseEr(text);
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    const html = `<figure class="am-diagram am-er">${layout(model, DIRS.has(dir) ? dir : 'TB', ui, pageDir)}</figure>`;
    // The count row counts what is marked: entities, fields (inherited marks too, as tree does) and relationship lines with a marker of their own.
    const states = [...model.entities.values()].flatMap((e) => [e.state, ...e.fields.map((x) => x.state)]).concat(model.written.map((rel) => rel.state));
    return withDelta(html, states.map((state) => state ?? null), { ui, video });
  },
};

export function parseEr(text) {
  const entities = new Map();
  const written = [];
  let current = null;
  for (const { raw, text: line, line: n } of contentLines(text)) {
    const { mark, text: body } = splitMarker(line);
    const state = markState(mark);
    if (/^\s/.test(raw)) {
      if (!current) throw new ComponentError(`"${line}": a field line must follow an entity; write the entity name at the start of its own line first`, n);
      current.fields.push(settleField(parseField(body, n), mark, current, n));
      continue;
    }
    const rel = body.match(RELATIONSHIP);
    if (rel) {
      if (mark === '~') throw new ComponentError('er: ~ marks an entity or a field, not a relationship. To change a relationship, remove the old line and add the new one: "- A 1--* B" then "+ A 1--1 B"', n);
      written.push({ from: rel[1], fromCard: rel[2], to: rel[4], toCard: rel[3], label: rel[5]?.trim() ?? '', line: n, ...(state && { state }) });
      current = null;
      continue;
    }
    const mermaid = body.match(MERMAID);
    if (mermaid && MERMAID_CARDS[mermaid[2]] && MERMAID_CARDS[mermaid[3]]) {
      throw new ComponentError(`"${line}" is Mermaid syntax; write ${mark && mark !== '~' ? `${mark} ` : ''}${erLineOf(mermaid)}`, n);
    }
    if (body.includes('--') || body.includes('{') || body.includes('}')) {
      throw new ComponentError(`"${line}" is not an entity of this component; write A 1--* B for a relationship, or the entity name at column 0 on its own line`, n);
    }
    const hi = body.startsWith('*');
    const name = (hi ? body.slice(1) : body).trim();
    if (!name) throw new ComponentError('an entity needs a name', n);
    if (entities.has(name)) throw new ComponentError(`entity "${name}" is written twice`, n);
    current = { name, hi, fields: [], line: n, ...(state && { state }) };
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
  checkEnds(entities, written);
  return { entities, written };
}

// A relationship cannot exist where one of its ends does not: between an added and a removed entity it exists in neither view, a + one cannot touch a removed
// entity (it would dangle in After) and a - one cannot touch an added entity (it would dangle in Before). Implied relationships a written line replaces are not checked.
function checkEnds(entities, written) {
  const replaced = new Set(written.map((rel) => pairKey(rel.from, rel.to)));
  const implied = [...entities.values()].flatMap((entity) => entity.fields
    .filter((field) => field.ref && !replaced.has(pairKey(entity.name, field.ref)))
    .map((field) => ({ from: entity.name, to: field.ref, line: field.line, state: field.state === 'changed' ? undefined : field.state })));
  for (const rel of [...implied, ...written]) {
    const ends = [rel.from, rel.to].map((name) => entities.get(name));
    const added = ends.find((e) => e.state === 'added');
    const removed = ends.find((e) => e.state === 'removed');
    if (rel.state === 'added' && removed) {
      throw new ComponentError(`er: the + relationship ${rel.from} to ${rel.to} touches the removed entity ${removed.name}, so it would dangle in the After view. Remove the + or keep ${removed.name}`, rel.line);
    }
    if (rel.state === 'removed' && added) {
      throw new ComponentError(`er: the - relationship ${rel.from} to ${rel.to} touches the added entity ${added.name}, so it would dangle in the Before view. Remove the - or do not add ${added.name}`, rel.line);
    }
    if (!rel.state && added && removed) {
      throw new ComponentError(`er: the relationship ${rel.from} to ${rel.to} joins the added entity ${added.name} and the removed entity ${removed.name}, so it exists in neither view. Remove it or change an entity marker`, rel.line);
    }
  }
}

// The state of a field: its own marker, or the + or - of its entity. A marker that contradicts an inherited one is an error. Only + and - are inherited; ~ marks one field.
function settleField(field, mark, entity, n) {
  const own = markState(mark);
  const inherited = entity.state === 'added' || entity.state === 'removed' ? entity.state : null;
  if (inherited && own && own !== inherited) {
    throw new ComponentError(`er: "${mark}" under the ${inherited} entity ${entity.name} contradicts it. The fields of a ${inherited} entity are ${inherited} too; remove the marker or move the field`, n);
  }
  const state = inherited ?? own;
  return state ? { ...field, state } : field;
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
// Each carries its change state: an implied one takes the + or - of its FK field, a written one its own marker; otherwise a
// relationship is removed or added with an entity at either end (a written line also keeps the state of the FK fields it replaces).
export function relationships({ entities, written }) {
  const ends = (...names) => {
    const states = names.map((name) => entities.get(name).state);
    return ['removed', 'added'].find((s) => states.includes(s));
  };
  const withState = (rel, state) => (state ? { ...rel, state } : rel);
  const implied = [];
  for (const entity of entities.values()) {
    for (const field of entity.fields) {
      if (!field.ref) continue;
      const own = field.state === 'changed' ? null : field.state;
      implied.push(withState({ from: entity.name, fromCard: '*', to: field.ref, toCard: '1', label: '', line: field.line }, own ?? ends(entity.name, field.ref)));
    }
  }
  const replaced = new Set(written.map((rel) => pairKey(rel.from, rel.to)));
  const lines = written.map((rel) => withState(rel, rel.state ?? ends(rel.from, rel.to) ?? implied.find((x) => pairKey(x.from, x.to) === pairKey(rel.from, rel.to) && x.state)?.state));
  return [...implied.filter((rel) => !replaced.has(pairKey(rel.from, rel.to))), ...lines];
}

const pairKey = (a, b) => [a, b].sort().join('\u0000');
const fieldText = (field) => (field.type ? `${field.name} ${field.type}` : field.name);
// The entity name is always bold (the head carries font-weight), and a highlighted entity makes every line of its box
// bold, which is a little wider.
const nameWidth = (entity) => measure(entity.name, FS, { bold: true });
const rowWidth = (entity, field) => measure(fieldText(field), FIELD_FS, { bold: entity.hi }) + keyWidth(entity, field) + signWidth(entity) + 2 * PAD;
// An entity with a marked field keeps a sign column at the start of every row, so the names stay in line.
const signWidth = (entity) => (entity.fields.some((x) => x.state) ? SIGN_W : 0);
const keyWidth = (entity, field) => (field.marker ? measure(field.marker, KEY_FS, { mono: true, bold: entity.hi }) + KEY_GAP : 0);

function nodeSize(entity) {
  const rows = entity.fields.map((field) => rowWidth(entity, field));
  return { width: Math.ceil(Math.max(MIN_WIDTH, nameWidth(entity) + 2 * PAD, ...rows)), height: HEAD_LH + entity.fields.length * FIELD_LH + 2 * PAD };
}

function layout(model, rankdir, ui, pageDir = 'ltr') {
  const { entities } = model;
  const rels = relationships(model);
  const loops = rels.filter((rel) => rel.from === rel.to);
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, nodesep: 44, ranksep: 62, marginx: 14, marginy: 14 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre reserves ids such as "\x00" internally; entities always get internal numbers, so no written name can collide.
  const key = new Map([...entities.keys()].map((name, i) => [name, `n${i}`]));
  // With the ranks running sideways (LR, RL) a self-reference loops below its box, so dagre gets a taller node for an entity
  // that has one: the box is drawn at the top of it and the loops hang into the space under the box, clear of the next entity.
  const below = rankdir === 'LR' || rankdir === 'RL';
  const room = new Map();
  if (below) {
    for (const name of entities.keys()) {
      const own = loops.filter((rel) => rel.from === name);
      if (own.length) room.set(name, loopRoom(own));
    }
  }
  const sizes = new Map();
  for (const entity of entities.values()) {
    const size = nodeSize(entity);
    sizes.set(entity.name, size);
    g.setNode(key.get(entity.name), { width: size.width, height: size.height + (room.get(entity.name) ?? 0) });
  }
  // Where the box of an entity is drawn: dagre's node is centred on the box, or taller and the box at its top.
  const centre = (name) => {
    const { x, y } = g.node(key.get(name));
    return { x, y: y - (room.get(name) ?? 0) / 2 };
  };
  // A self-reference does not go through dagre, which would draw a line out of the box; it is drawn as a loop below.
  rels.filter((rel) => rel.from !== rel.to).forEach((rel, i) => {
    const label = rel.label ? { label: rel.label, width: measure(rel.label, EDGE_FS) + 10, height: 18, labelpos: 'c' } : {};
    g.setEdge(key.get(rel.from), key.get(rel.to), label, `e${i}`);
  });
  dagre.layout(g);
  // A right-to-left page mirrors the finished layout, as flow does; the loops, field names and key markers below follow.
  const rtl = pageDir === 'rtl';
  if (rtl) mirrorLayout(g);

  // In video mode, items appear step by step by source line: an entity line and a relationship line are one step each.
  const steps = [...new Set([...[...entities.values()].map((e) => e.line), ...rels.map((r) => r.line)])].sort((a, b) => a - b);
  const stepOf = new Map(steps.map((line, i) => [line, i]));

  // dagre clips an edge to the node it knows, which is taller than the drawn box when loops hang below it: the ends of such an
  // edge are clipped to the box again, along the line from the centre of the box to the next point of the edge.
  const straight = rels.filter((rel) => rel.from !== rel.to).map((rel, i) => {
    const data = g.edge({ v: key.get(rel.from), w: key.get(rel.to), name: `e${i}` });
    const points = data.points.map((p) => ({ ...p }));
    if (room.has(rel.from)) points[0] = clipToBox(centre(rel.from), sizes.get(rel.from), data.points[1]);
    if (room.has(rel.to)) points[points.length - 1] = clipToBox(centre(rel.to), sizes.get(rel.to), data.points[data.points.length - 2]);
    return { rel, data, points };
  });
  const edgeSvg = straight.map(({ rel, data, points }) => {
    const label = rel.label ? labelSvg(rel.label, data.x, data.y, pageDir) : '';
    return `<g data-step="${stepOf.get(rel.line)}"${deltaAttr(rel.state)}><path class="am-edge" d="${smoothPath(points)}"/>${endsSvg(points, rel)}${label}</g>`;
  });

  const nodeSvg = [...entities.values()].map((entity) => {
    const { x, y } = centre(entity.name);
    const size = sizes.get(entity.name);
    return nodeSvgOf(entity, x, y, size, stepOf.get(entity.line), pageDir);
  });

  // A loop lies outside the box on its right (its left on a right-to-left page, where s is -1). With the ranks running
  // sideways (LR, RL) the edges to the neighbouring ranks leave by that side, so the loop lies below the box instead. Two
  // self-references of one entity take their own distance, so both stay visible, and the drawing has to be wide enough
  // (or tall enough) for the farthest one and its label.
  const s = rtl ? -1 : 1;
  const seen = new Map();
  const loopSpecs = loops.map((rel) => {
    const { nth, depth } = seen.get(rel.from) ?? { nth: 0, depth: 0 };
    seen.set(rel.from, { nth: nth + 1, depth: depth + LOOP_STEP + (rel.label ? LOOP_LABEL : 0) });
    const { x, y } = centre(rel.from);
    const size = sizes.get(rel.from);
    return below ? loopBelow(rel, x, y, size, depth, s) : loopBeside(rel, x, y, size, nth, s);
  });
  const loopsSvg = loopSpecs.map((spec) => loopSvg(spec, stepOf.get(spec.rel.line), pageDir));

  // The drawing is as big as everything drawn on it: dagre sizes the ranks, but a parallel edge bulges past them and a
  // loop sits outside its box, so the extent of every point decides. A shift keeps the origin at 0.
  const xs = [];
  const ys = [];
  const at = (x, y) => {
    xs.push(x);
    ys.push(y);
  };
  for (const entity of entities.values()) {
    const { x, y } = centre(entity.name);
    const size = sizes.get(entity.name);
    at(x - size.width / 2, y - size.height / 2);
    at(x + size.width / 2, y + size.height / 2);
  }
  straight.forEach(({ rel, data, points }) => {
    for (const p of points) at(p.x, p.y);
    // dagre gives an edge a label position only when it has a label.
    if (rel.label) {
      const w = labelWidth(rel.label);
      at(data.x - w / 2, data.y - 9);
      at(data.x + w / 2, data.y + 9);
    }
  });
  for (const { corners } of loopSpecs) corners.forEach(([x, y]) => at(x, y));
  const margin = 14;
  const shiftX = margin - Math.min(...xs);
  const shiftY = margin - Math.min(...ys);
  const shift = shiftX || shiftY ? ` transform="translate(${f(shiftX)},${f(shiftY)})"` : '';
  const width = Math.ceil(Math.max(...xs) - Math.min(...xs)) + 2 * margin;
  const height = Math.ceil(Math.max(...ys) - Math.min(...ys)) + 2 * margin;
  const label = diagramLabel(ui, 'er', [...entities.keys()].slice(0, 8));
  return `${svgOpen(width, height, label, pageDir)}<g${shift}><g>${edgeSvg.join('')}</g><g>${loopsSvg.join('')}</g><g>${nodeSvg.join('')}</g></g></svg>`;
}

// The space under a box for the loops of its entity, in the order they are drawn (see loopBelow): the first one's distance
// from the box, the steps down to the last one, and the label of the last.
function loopRoom(own) {
  const steps = own.slice(0, -1).reduce((depth, rel) => depth + LOOP_STEP + (rel.label ? LOOP_LABEL : 0), 0);
  return LOOP_OUT + steps + (own.at(-1).label ? LOOP_LABEL : 0) + LOOP_GAP;
}

// The point where the line from the centre of a box towards `toward` leaves the box.
function clipToBox(centre, size, toward) {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const k = Math.max(Math.abs(dx) / (size.width / 2), Math.abs(dy) / (size.height / 2));
  if (k === 0) return { ...centre };
  return { x: centre.x + dx / k, y: centre.y + dy / k };
}

function nodeSvgOf(entity, x, y, size, step, pageDir) {
  const left = x - size.width / 2;
  const top = y - size.height / 2;
  // The name starts at the edge where reading starts and the key marker sits at the other one. The anchors keep their names:
  // the svg's direction="rtl" turns "start" into the right end of the text, so on a right-to-left page the name moves to the right edge.
  const [nameX, keyX] = pageDir === 'rtl' ? [left + size.width - PAD, left + PAD] : [left + PAD, left + size.width - PAD];
  const head = `<text class="am-er-head" font-weight="600" x="${f(nameX)}" y="${f(top + PAD + HEAD_LH / 2)}" dominant-baseline="central">${esc(svgLine(entity.name, pageDir))}</text>`;
  const rule = `<line class="am-er-rule am-edge" opacity="0.45" x1="${f(left)}" y1="${f(top + PAD + HEAD_LH)}" x2="${f(left + size.width)}" y2="${f(top + PAD + HEAD_LH)}"/>`;
  // A marked row has a band across the box and its sign at the start of the row; every row of such an entity moves in by the sign column.
  const rtl = pageDir === 'rtl';
  const shift = (rtl ? -1 : 1) * signWidth(entity);
  const fields = entity.fields
    .map((field, i) => {
      const cy = top + PAD + HEAD_LH + FIELD_LH * (i + 0.5) + 1;
      const mark = deltaAttr(field.state);
      // style, not the SVG attribute: `.am-diagram text` sets 13px and a stylesheet wins over a presentation attribute.
      const marker = field.marker ? `<text class="am-er-key am-cluster-label"${mark} x="${f(keyX)}" y="${f(cy)}" text-anchor="end" dominant-baseline="central">${esc(svgLine(field.marker, pageDir))}</text>` : '';
      const band = field.state ? `<rect class="am-er-band"${mark} x="${f(left + 1)}" y="${f(cy - FIELD_LH / 2)}" width="${f(size.width - 2)}" height="${FIELD_LH}"/><text class="am-er-sign"${mark} x="${f(nameX)}" y="${f(cy)}" dominant-baseline="central">${esc(svgLine(SIGN[field.state], pageDir))}</text>` : '';
      return `${band}<text class="am-er-field"${mark} style="font-size:${FIELD_FS}px" x="${f(nameX + shift)}" y="${f(cy)}" dominant-baseline="central">${esc(svgLine(fieldText(field), pageDir))}</text>${marker}`;
    })
    .join('');
  // The badge sits in the corner opposite the one where reading starts.
  const badge = badgeSvg(entity.state, rtl ? left : left + size.width, top);
  return `<g class="am-node am-node--er${entity.hi ? ' am-node--hi' : ''}" data-key="${esc(entity.name)}" data-step="${step}"${deltaAttr(entity.state)}><rect class="am-node-shape" x="${f(left)}" y="${f(top)}" width="${f(size.width)}" height="${f(size.height)}" rx="3"/>${head}${rule}${fields}${badge}</g>`;
}

// A self-reference beside its box: out of the right edge (the left one on a right-to-left page), around, and back into it,
// with the two ends on that edge. Each end mark's `away` point lies outside the box, as it does for an edge between two
// boxes, so the end marks are drawn outside the border too. The label sits beyond the loop.
function loopBeside(rel, x, y, size, nth, s) {
  const edge = x + (s * size.width) / 2;
  const out = edge + s * LOOP_OUT + s * nth * LOOP_STEP;
  const [ay, by] = [y - LOOP_END / 2, y + LOOP_END / 2];
  const label = rel.label ? { x: out + s * 6 + (s * labelWidth(rel.label)) / 2, y } : null;
  return {
    rel,
    a: { x: edge, y: ay },
    b: { x: edge, y: by },
    c: [{ x: out, y: ay }, { x: out, y: by }],
    away: { x: s, y: 0 },
    label,
    corners: [[out + s * 6 + s * (rel.label ? labelWidth(rel.label) : 0), by], [out, ay]],
  };
}

// A self-reference below its box, for the layouts whose ranks run sideways: out of the bottom edge, down, and back up into
// it, bulging `depth` farther than the first loop. The first end sits on the side where reading starts, and the label is
// centred under the loop.
function loopBelow(rel, x, y, size, depth, s) {
  const bottom = y + size.height / 2;
  const out = bottom + LOOP_OUT + depth;
  const [ax, bx] = [x - (s * LOOP_END) / 2, x + (s * LOOP_END) / 2];
  const half = Math.max(LOOP_END / 2, rel.label ? labelWidth(rel.label) / 2 : 0);
  return {
    rel,
    a: { x: ax, y: bottom },
    b: { x: bx, y: bottom },
    c: [{ x: ax, y: out }, { x: bx, y: out }],
    away: { x: 0, y: 1 },
    label: rel.label ? { x, y: out + 6 + 9 } : null,
    corners: [[x - half, bottom], [x + half, out + (rel.label ? 6 + 18 : 0)]],
  };
}

function loopSvg({ rel, a, b, c, away, label }, step, pageDir) {
  const path = `<path class="am-edge" d="M${f(a.x)},${f(a.y)} C${f(c[0].x)},${f(c[0].y)} ${f(c[1].x)},${f(c[1].y)} ${f(b.x)},${f(b.y)}"/>`;
  const ends = `${endMark(a, { x: a.x + away.x, y: a.y + away.y }, rel.fromCard)}${endMark(b, { x: b.x + away.x, y: b.y + away.y }, rel.toCard)}`;
  const text = label ? labelSvg(rel.label, label.x, label.y, pageDir) : '';
  return `<g data-step="${step}"${deltaAttr(rel.state)}>${path}${ends}${text}</g>`;
}

function labelWidth(text) {
  return measure(text, EDGE_FS) + 10;
}

function labelSvg(text, x, y, pageDir) {
  const w = labelWidth(text);
  return `<g class="am-edge-label"><rect x="${f(x - w / 2)}" y="${f(y - 9)}" width="${f(w)}" height="18" rx="3"/>${textLines([text], x, y, LH, '', pageDir)}</g>`;
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
