// Flow / architecture diagram: the model writes only relations (A -> B: label), dagre computes coordinates, this file draws the layout as SVG.
import dagre from '@dagrejs/dagre';
import { esc, measure, wrap } from '../svg/text.js';
import { f, smoothPath, arrowDefs, svgOpen, textLines, diagramLabel, mirrorLayout } from '../svg/shapes.js';
import { svgLine } from '../bidi.js';
import { ComponentError, contentLines } from './error.js';
import { splitMarker, markState, deltaAttr, withDelta, SIGN } from './delta.js';

const FS = 13;
const LH = 17;
const TEXT_MAX = 150;
const EDGE_FS = 11.5;
const CLUSTER_FS = 11;
const CLUSTER_LABEL_H = 15;
const DIRS = new Set(['TB', 'LR', 'BT', 'RL']);

// Shape brackets: match longer opening brackets first.
const BRACKETS = [
  { open: '[(', close: ')]', shape: 'db' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
];
const ARROW = /^\s*(-->|->)\s*/;

export default {
  name: 'flow',
  summary: 'Flowchart / architecture diagram (automatic layout)',
  syntax: `\`\`\`flow [TB|LR|BT|RL]
A -> B: label                 ← solid line; text after the colon is the edge label
A --> C                       ← dashed line
A -> B -> C                   ← chain
A -> B & C                    ← fan-out
(Start)  {Valid?}  [(Database)]  [text with: a colon]   ← rounded / diamond / cylinder / rectangle
*Key node                     ← * prefix highlights
group Group name: B, C        ← draw a group box around nodes
\`\`\`
- The text inside the brackets is the node's identity; later lines can refer to the node by that text alone. The default direction is TB (top to bottom).
- Change markers show what a plan adds, removes and changes. A line can start with + (added), - (removed) or ~ (changed), followed by a space:
\`\`\`flow LR
Client -> Gateway
+ Gateway -> [(Cache)]: lookup
+ Cache -> Service: miss
- Gateway -> Service
~ *Service
\`\`\`
  - A marker applies to every link on its line. A node is removed when it appears only on - lines, added when it appears only on + lines, and unchanged when it also appears on an unmarked line, even if its links changed. ~ Node on a line without an arrow marks that node as changed.
  - ~ on a line with an arrow is an error: remove the old link with - and add the new one with +. That is also how a link's label changes. The same link both unmarked and marked is an error too.
  - + group Name: A, B and - group Name: A, B mark a group box. A group that is not removed and holds only removed nodes is a warning. Markers combine with * and every shape bracket.
  - The Changes view draws added in the theme's ok color, removed faded with a struck-through label, changed with a warn outline, and each marked node with a +, − or ~ badge. A count row and a Before / Changes / After switch sit under the diagram: Before and After show the diagram as it was and as it will be, plain and without the items that are not in that view.
  - A line that starts with a marker and a space is always read as a marker. To keep a node name that starts with "- ", write it in brackets: [- Gateway].`,
  example: '```flow LR\n(User) -> Gateway: HTTPS\nGateway -> Auth & *Service\nService -> [(Database)]\ngroup Backend: Auth, Service\n```',
  render(text, { args, uid, ui, warn, video, dir: pageDir = 'ltr' }) {
    const model = parseFlow(text);
    model.warnings.forEach((w) => warn?.(w));
    const flowDir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    const html = `<figure class="am-diagram am-flow">${layout(model, DIRS.has(flowDir) ? flowDir : 'TB', uid(), ui, pageDir)}</figure>`;
    return withDelta(html, [...model.nodes.values(), ...model.edges, ...model.groups].map((x) => x.state ?? null), { ui, video });
  },
};

export function parseFlow(text) {
  const nodes = new Map();
  const edges = [];
  const groups = [];
  // before / after: whether the node exists before and after the change; tilde: a "~ Node" line marked it changed.
  const upsert = (spec, line, mark) => {
    const prev = nodes.get(spec.id);
    const seen = { before: mark !== '+', after: mark !== '-', tilde: mark === '~' };
    if (!prev) nodes.set(spec.id, { ...spec, ...seen, line });
    else {
      const merged = { before: prev.before || seen.before, after: prev.after || seen.after, tilde: prev.tilde || seen.tilde };
      nodes.set(spec.id, { ...prev, ...merged, shape: spec.explicit ? spec.shape : prev.shape, hi: prev.hi || spec.hi });
    }
    return spec.id;
  };

  for (const { text: raw, line } of contentLines(text)) {
    const { mark, text: t } = splitMarker(raw);
    const g = t.match(/^group\s+(.+?)\s*[:：]\s*(.+)$/i);
    if (g) {
      if (mark === '~') throw new ComponentError('flow: ~ marks a node, not a group. Use + group or - group to add or remove a group box', line);
      const state = markState(mark);
      groups.push({ name: g[1], members: g[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean), line, ...(state && { state }) });
      continue;
    }
    const { chain, label } = parseChain(t, line);
    if (mark === '~' && chain.length > 1) {
      throw new ComponentError('flow: ~ marks a node, not a link. To change a link, remove the old one and add the new one: "- A -> B" then "+ A -> C"', line);
    }
    const ids = chain.map((step) => ({ ...step, ids: step.nodes.map((n) => upsert(n, line, mark)) }));
    for (let k = 1; k < ids.length; k++) {
      const isLast = k === ids.length - 1;
      for (const from of ids[k - 1].ids) {
        for (const to of ids[k].ids) {
          const state = markState(mark);
          edges.push({ from, to, dashed: ids[k].arrow === '-->', label: isLast ? label : '', line, ...(state && { state }) });
        }
      }
    }
  }
  if (!nodes.size) throw new ComponentError('flow needs at least one node', 1);
  for (const grp of groups) {
    const missing = grp.members.filter((m) => !nodes.has(m));
    if (missing.length) throw new ComponentError(`group ${grp.name} refers to nodes that do not exist: ${missing.join(', ')}`, grp.line);
  }
  checkLinks(edges);
  const settled = new Map([...nodes].map(([id, n]) => {
    const state = nodeState(n);
    return [id, state ? { ...n, state } : n];
  }));
  return { nodes: settled, edges, groups, warnings: groupWarnings(groups, settled) };
}

// Removed when the node exists only before, added when only after; on both sides it is unchanged unless a "~ Node" line marked it.
function nodeState({ before, after, tilde }) {
  if (before && !after) return 'removed';
  if (after && !before) return 'added';
  return tilde ? 'changed' : null;
}

// A link that is written both unmarked and marked says two things about the same link.
function checkLinks(edges) {
  const key = (e) => `${e.from}\u0000${e.to}`;
  for (const e of edges.filter((x) => x.state)) {
    const plain = edges.find((x) => !x.state && key(x) === key(e));
    if (plain) throw new ComponentError(`flow: the link ${e.from} -> ${e.to} is written unmarked on line ${plain.line} and as ${e.state === 'added' ? '+' : '-'} here. Mark every line of that link, or none`, e.line);
  }
}

// A group that stays after the change but holds only removed nodes would be an empty box in the After view.
function groupWarnings(groups, nodes) {
  return groups
    .filter((g) => g.state !== 'removed' && g.members.every((m) => nodes.get(m).state === 'removed'))
    .map((g) => ({ line: g.line, message: `group ${g.name} holds only removed nodes and would be an empty box after the change. Mark it with "- group ${g.name}: ${g.members.join(', ')}"` }));
}

// One line = node groups (separated by &) joined by arrows, optionally ending with ": label".
function parseChain(t, line) {
  const chain = [];
  let pos = 0;
  let arrow = null;
  for (;;) {
    const group = [];
    for (;;) {
      const { node, end } = parseNode(t, pos, line);
      group.push(node);
      pos = end;
      const amp = t.slice(pos).match(/^\s*&\s*/);
      if (!amp) break;
      pos += amp[0].length;
    }
    chain.push({ arrow, nodes: group });
    const a = t.slice(pos).match(ARROW);
    if (!a) break;
    arrow = a[1];
    pos += a[0].length;
  }
  const rest = t.slice(pos).trim();
  if (rest && !/^[:：]/.test(rest)) {
    throw new ComponentError(`flow cannot parse "${t}". Write a link as A -> B: label`, line);
  }
  return { chain, label: rest.replace(/^[:：]\s*/, '') };
}

function parseNode(t, start, line) {
  let pos = start + t.slice(start).match(/^\s*/)[0].length;
  const hi = t[pos] === '*';
  if (hi) pos++;
  const bracket = BRACKETS.find((b) => t.startsWith(b.open, pos));
  let label;
  let end;
  if (bracket) {
    const close = t.indexOf(bracket.close, pos + bracket.open.length);
    if (close === -1) throw new ComponentError(`flow: unclosed shape bracket, missing ${bracket.close}`, line);
    label = t.slice(pos + bracket.open.length, close).trim();
    end = close + bracket.close.length;
  } else {
    const m = t.slice(pos).match(/^(.*?)(?=\s*(?:-->|->|&|[:：]|$))/);
    label = m[1].trim();
    end = pos + m[0].length;
  }
  if (!label) throw new ComponentError(`flow has an empty node: "${t}"`, line);
  return { node: { id: label, label, shape: bracket?.shape ?? 'rect', explicit: Boolean(bracket), hi }, end };
}

function nodeSize(node) {
  const lines = wrap(node.label, TEXT_MAX, FS);
  const tw = Math.max(...lines.map((l) => measure(l, FS)));
  const th = lines.length * LH;
  const w = Math.max(tw + 28, 64);
  const h = th + 18;
  const size = {
    rect: [w, h],
    round: [w + 12, h],
    diamond: [(tw + 28) * 1.5, h * 1.6],
    db: [w, h + 14],
  }[node.shape];
  return { lines, width: size[0], height: size[1] };
}

const nodeKey = (i) => `n${i}`;
const gkey = (i) => `g${i}`;
const reserveKey = (i) => `r${i}`;

// Run dagre. reserve maps each group whose name found no free place in the first layout to the side it gets room on:
// in TB and BT a label-sized node above the group's first members, which dagre keeps clear of every edge passing by;
// in LR and RL a strip inserted under the box's top edge, or above its bottom edge when an edge crosses the top one
// (edges there mostly run sideways, so a strip stays empty).
function runLayout({ nodes, edges, groups }, rankdir, rtl, widths, reserve) {
  const g = new dagre.graphlib.Graph({ compound: groups.length > 0, multigraph: true });
  g.setGraph({ rankdir, nodesep: 36, ranksep: 46, marginx: 14, marginy: groups.length ? 26 : 14 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre reserves ids such as "\x00" internally; nodes and groups always get internal numbers, so no user-written name can collide.
  const key = new Map([...nodes.keys()].map((name, i) => [name, nodeKey(i)]));
  const sizes = new Map();
  for (const n of nodes.values()) {
    const s = nodeSize(n);
    sizes.set(n.id, s);
    g.setNode(key.get(n.id), { width: s.width, height: s.height });
  }
  const vertical = rankdir === 'TB' || rankdir === 'BT';
  groups.forEach((grp, i) => {
    g.setNode(gkey(i), { label: grp.name });
    grp.members.forEach((m) => g.setParent(key.get(m), gkey(i)));
    if (!reserve.has(i) || !vertical) return;
    g.setNode(reserveKey(i), { width: widths[i] + 4, height: CLUSTER_LABEL_H });
    g.setParent(reserveKey(i), gkey(i));
    // Seen from the top of the drawing (BT reverses every edge): the room goes above the group's first members, those no other
    // member points to, and below every node outside the group that points to one of them, so their edges pass beside it.
    const down = edges.map((e) => (rankdir === 'TB' ? [e.from, e.to] : [e.to, e.from]));
    const link = (a, b, name) => (rankdir === 'TB' ? g.setEdge(a, b, {}, name) : g.setEdge(b, a, {}, name));
    const inside = new Set(grp.members);
    const first = grp.members.filter((m) => !down.some(([a, b]) => b === m && a !== m && inside.has(a)));
    (first.length ? first : grp.members.slice(0, 1)).forEach((m, k) => {
      link(reserveKey(i), key.get(m), `r${i}-${k}`);
      down.forEach(([a, b], j) => {
        if (b === m && !inside.has(a)) link(key.get(a), reserveKey(i), `r${i}-${k}-${j}`);
      });
    });
  });
  edges.forEach((e, i) => {
    const label = e.label ? { label: e.label, width: measure(e.label, EDGE_FS) + 12, height: 18, labelpos: 'c' } : {};
    g.setEdge(key.get(e.from), key.get(e.to), label, `e${i}`);
  });
  dagre.layout(g);
  // A right-to-left page mirrors the finished layout: every direction then reads from the right, and LR runs right to left.
  if (rtl) mirrorLayout(g);
  if (!vertical) {
    for (const [i, side] of reserve) {
      const c = g.node(gkey(i));
      insertStrip(g, side === 'top' ? top(c) + 2 : top(c) + c.height - 2, CLUSTER_LABEL_H + 3);
    }
  }
  return { g, key, sizes };
}

// Push everything below the line y down by d: nodes, edge points, edge labels, and the boxes that start below it; a box the line
// cuts through grows by d. The drawing gets d taller.
function insertStrip(g, y, d) {
  for (const v of g.nodes()) {
    const n = g.node(v);
    if (v.startsWith('g') && top(n) < y && top(n) + n.height > y) {
      n.height += d;
      n.y += d / 2;
    } else if (n.y > y) n.y += d;
  }
  for (const e of g.edges()) {
    const edge = g.edge(e);
    edge.points = edge.points.map((p) => (p.y > y ? { ...p, y: p.y + d } : p));
    if (edge.y !== undefined && edge.y > y) edge.y += d;
  }
  g.graph().height += d;
}

const top = (n) => n.y - n.height / 2;

// Where each group name goes: [x, baseline] of its text, or null when no place along the top of the box is free of nodes, edges,
// edge labels and other group names. The name starts in the corner where reading starts (top left, or top right on a right-to-left
// page) and slides toward the other corner past whatever is in the way.
function placeLabels({ g, key, sizes }, { nodes, edges, groups }, widths, rtl, reserve) {
  const boxes = [];
  for (const n of nodes.values()) {
    const { x, y } = g.node(key.get(n.id));
    const { width: w, height: h } = sizes.get(n.id);
    boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
  }
  const segments = [];
  edges.forEach((e, i) => {
    const data = g.edge({ v: key.get(e.from), w: key.get(e.to), name: `e${i}` });
    const pts = data.points;
    for (let k = 1; k < pts.length; k++) segments.push([pts[k - 1], pts[k]]);
    if (e.label) {
      const w = measure(e.label, EDGE_FS) + 10;
      boxes.push([data.x - w / 2, data.y - 9, data.x + w / 2, data.y + 9]);
    }
  });
  return groups.map((grp, i) => {
    const c = g.node(gkey(i));
    const left = c.x - c.width / 2;
    const right = left + c.width;
    const w = widths[i];
    const own = grp.state ? [[rtl ? left - 8 : right - 8, top(c) - 8, rtl ? left + 8 : right + 8, top(c) + 8]] : [];
    // A name needs air around it: an edge label right beside it would read as one phrase with it.
    const free = (x0, y0, y1) => {
      const box = [x0 - 5, y0 - 2, x0 + w + 5, y1 + 2];
      const wide = [x0 - 10, y0 - 2, x0 + w + 10, y1 + 2];
      return ![...boxes, ...own].some((b) => overlaps(wide, b)) && !segments.some(([p, q]) => segmentHits(p, q, box));
    };
    // First just under the top edge, then on the room reserved for it: a node, or a strip along the bottom edge.
    const room = g.hasNode(reserveKey(i)) ? g.node(reserveKey(i)) : null;
    const baselines = reserve.get(i) === 'bottom' ? [top(c) + c.height - 6] : room ? [top(c) + 14, room.y + 4] : [top(c) + 14];
    for (const baseline of baselines) {
      const [y0, y1] = [baseline - 11, baseline + 4];
      for (let s = 0; s <= Math.max(0, c.width - 16 - w); s += 4) {
        const x0 = rtl ? right - 8 - w - s : left + 8 + s;
        if (free(x0, y0, y1)) {
          boxes.push([x0, y0, x0 + w, y1]);
          return [rtl ? x0 + w : x0, baseline];
        }
      }
    }
    if (!room) return null;
    // The reserved node is clear by construction (dagre spaces it from every edge), so the name goes there.
    const baseline = baselines.at(-1);
    const x0 = room.x - w / 2;
    boxes.push([x0, baseline - 11, x0 + w, baseline + 4]);
    return [rtl ? x0 + w : x0, baseline];
  });
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// Does the segment p-q cross the box [x0, y0, x1, y1]? Liang-Barsky clipping.
function segmentHits(p, q, [x0, y0, x1, y1]) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [a, b] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (a === 0) {
      if (b < 0) return false;
    } else {
      const t = b / a;
      if (a < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// The width of a group name: monospace on a left-to-right page, the sans font on a right-to-left one (src/themes/rtl.css).
const labelWidth = (name, pageDir) => measure(name, CLUSTER_FS, { mono: pageDir !== 'rtl' }) + 2;

function layout(model, rankdir, id, ui, pageDir = 'ltr') {
  const { nodes, edges, groups } = model;
  const rtl = pageDir === 'rtl';
  const widths = groups.map((grp) => labelWidth(grp.name, pageDir));
  let run = runLayout(model, rankdir, rtl, widths, new Set());
  let spots = placeLabels(run, model, widths, rtl, new Map());
  // A group name that would sit on an edge or a node gets room of its own in another layout: first along the top of its box,
  // and in LR and RL, when an edge crosses that room too, along the bottom.
  const reserve = new Map();
  for (const side of ['top', 'bottom']) {
    const crowded = spots.flatMap((s, i) => (s ? [] : [i]));
    if (!crowded.length) break;
    for (const i of crowded) reserve.set(i, side);
    run = runLayout(model, rankdir, rtl, widths, reserve);
    spots = placeLabels(run, model, widths, rtl, reserve);
  }
  const { g, key, sizes } = run;

  const clusters = groups.map((grp, i) => {
    const c = g.node(gkey(i));
    const x = c.x - c.width / 2;
    const y = c.y - c.height / 2;
    const mark = deltaAttr(grp.state);
    // The badge sits in the corner opposite the one where reading starts.
    const badgeX = rtl ? x : x + c.width;
    const [labelX, labelY] = spots[i] ?? [rtl ? x + c.width - 8 : x + 8, y + 14];
    return `<rect class="am-cluster"${mark} x="${f(x)}" y="${f(y)}" width="${f(c.width)}" height="${f(c.height)}" rx="4"/><text class="am-cluster-label"${mark} x="${f(labelX)}" y="${f(labelY)}">${esc(svgLine(grp.name, pageDir))}</text>${badgeSvg(grp.state, badgeX, y)}`;
  });

  // In video mode, items appear step by step by source line: edges written on one line and nodes first seen there form one step.
  const stepOf = new Map([...new Set([...[...nodes.values()].map((n) => n.line), ...edges.map((e) => e.line)])].sort((a, b) => a - b).map((l, k) => [l, k]));
  const edgeSvg = edges.map((e, i) => {
    const data = g.edge({ v: key.get(e.from), w: key.get(e.to), name: `e${i}` });
    const pts = clipEnds(data.points, g.node(key.get(e.from)), nodes.get(e.from).shape, g.node(key.get(e.to)), nodes.get(e.to).shape);
    const head = e.state ? `${id}-arrow-${e.state}` : `${id}-arrow`;
    const path = `<path class="am-edge${e.dashed ? ' am-edge--dashed' : ''}" d="${smoothPath(pts)}" marker-end="url(#${head})"/>`;
    const open = `<g data-step="${stepOf.get(e.line)}"${deltaAttr(e.state)}>`;
    if (!e.label) return `${open}${path}</g>`;
    const w = measure(e.label, EDGE_FS) + 10;
    return `${open}${path}<g class="am-edge-label"><rect x="${f(data.x - w / 2)}" y="${f(data.y - 9)}" width="${f(w)}" height="18" rx="3"/>${textLines([e.label], data.x, data.y, LH, '', pageDir)}</g></g>`;
  });

  const nodeSvg = [...nodes.values()].map((n) => {
    const { x, y } = g.node(key.get(n.id));
    const { width: w, height: h, lines } = sizes.get(n.id);
    const badge = badgeSvg(n.state, ...badgePoint(n.shape, x, y, w, h, rtl));
    return `<g class="am-node am-node--${n.shape}${n.hi ? ' am-node--hi' : ''}" data-key="${esc(n.label)}" data-step="${stepOf.get(n.line)}"${deltaAttr(n.state)}>${shapeSvg(n.shape, x, y, w, h)}${textLines(lines, x, y + (n.shape === 'db' ? 4 : 0), LH, '', pageDir)}${badge}</g>`;
  });

  const { width, height } = g.graph();
  const label = diagramLabel(ui, 'flow', [...nodes.keys()].slice(0, 8));
  const heads = ['added', 'removed'].filter((state) => edges.some((e) => e.state === state));
  return `${svgOpen(width, height, label, pageDir)}${arrowDefs(id, heads)}<g>${clusters.join('')}</g><g>${edgeSvg.join('')}</g><g>${nodeSvg.join('')}</g></svg>`;
}

// The +, − or ~ badge of a marked item: a small disc on the corner of its shape. It carries data-delta itself because a group box's badge sits beside it, not inside.
function badgeSvg(state, x, y) {
  if (!state) return '';
  return `<g class="am-delta-badge am-delta-badge--${state}"${deltaAttr(state)} transform="translate(${f(x)},${f(y)})"><circle r="7"/><text text-anchor="middle" dominant-baseline="central">${SIGN[state]}</text></g>`;
}

// Where the badge sits: the top right corner (top left on a right-to-left page), pulled in where the shape has no corner there.
function badgePoint(shape, x, y, w, h, rtl = false) {
  const s = rtl ? -1 : 1;
  if (shape === 'diamond') return [x + s * (w / 4), y - h / 4];
  if (shape === 'round') return [x + s * (w / 2 - h * 0.15), y - h / 2 + h * 0.15];
  return [x + s * (w / 2), y - h / 2];
}

function shapeSvg(shape, x, y, w, h) {
  const l = x - w / 2;
  const t = y - h / 2;
  if (shape === 'diamond') {
    return `<polygon class="am-node-shape" points="${f(x)},${f(t)} ${f(x + w / 2)},${f(y)} ${f(x)},${f(t + h)} ${f(l)},${f(y)}"/>`;
  }
  if (shape === 'db') {
    const ry = 7;
    return `<path class="am-node-shape" d="M${f(l)},${f(t + ry)} A${f(w / 2)},${ry} 0 0 1 ${f(l + w)},${f(t + ry)} V${f(t + h - ry)} A${f(w / 2)},${ry} 0 0 1 ${f(l)},${f(t + h - ry)} Z"/><path class="am-node-shape" d="M${f(l)},${f(t + ry)} A${f(w / 2)},${ry} 0 0 0 ${f(l + w)},${f(t + ry)}"/>`;
  }
  const rx = shape === 'round' ? h / 2 : 3;
  return `<rect class="am-node-shape" x="${f(l)}" y="${f(t)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}"/>`;
}

// dagre clips edge endpoints to the rectangle bounds; diamonds need the intersection with the slanted side recomputed, or arrows float.
function clipEnds(points, from, fromShape, to, toShape) {
  const pts = points.map((p) => ({ ...p }));
  if (fromShape === 'diamond' && pts.length > 1) pts[0] = diamondPoint(from, pts[1]);
  if (toShape === 'diamond' && pts.length > 1) pts[pts.length - 1] = diamondPoint(to, pts[pts.length - 2]);
  return pts;
}

function diamondPoint(node, toward) {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const k = Math.abs(dx) / (node.width / 2) + Math.abs(dy) / (node.height / 2);
  if (k === 0) return { x: node.x, y: node.y };
  return { x: node.x + dx / k, y: node.y + dy / k };
}
