// Flow / architecture diagram: the model writes only relations (A -> B: label), dagre computes coordinates, this file draws the layout as SVG.
import dagre from '@dagrejs/dagre';
import { esc, measure, wrap } from '../svg/text.js';
import { f, smoothPath, arrowDefs, svgOpen, textLines, diagramLabel } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';
import { splitMarker, markState, deltaAttr, withDelta, SIGN } from './delta.js';

const FS = 13;
const LH = 17;
const TEXT_MAX = 150;
const EDGE_FS = 11.5;
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
  - Added is drawn in the theme's ok color, removed faded with a struck-through label, changed with a warn outline, and each marked node gets a +, − or ~ badge. A count row and a Before / Changes / After switch sit under the diagram.
  - A line that starts with a marker and a space is always read as a marker. To keep a node name that starts with "- ", write it in brackets: [- Gateway].`,
  example: '```flow LR\n(User) -> Gateway: HTTPS\nGateway -> Auth & *Service\nService -> [(Database)]\ngroup Backend: Auth, Service\n```',
  render(text, { args, uid, ui, warn, video }) {
    const model = parseFlow(text);
    model.warnings.forEach((w) => warn?.(w));
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    const html = `<figure class="am-diagram am-flow">${layout(model, DIRS.has(dir) ? dir : 'TB', uid(), ui)}</figure>`;
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

function layout({ nodes, edges, groups }, rankdir, id, ui) {
  const g = new dagre.graphlib.Graph({ compound: groups.length > 0, multigraph: true });
  g.setGraph({ rankdir, nodesep: 36, ranksep: 46, marginx: 14, marginy: groups.length ? 26 : 14 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre reserves ids such as "\x00" internally; nodes and groups always get internal numbers, so no user-written name can collide.
  const key = new Map([...nodes.keys()].map((name, i) => [name, `n${i}`]));
  const gkey = (i) => `g${i}`;
  const sizes = new Map();
  for (const n of nodes.values()) {
    const s = nodeSize(n);
    sizes.set(n.id, s);
    g.setNode(key.get(n.id), { width: s.width, height: s.height });
  }
  groups.forEach((grp, i) => {
    g.setNode(gkey(i), { label: grp.name });
    grp.members.forEach((m) => g.setParent(key.get(m), gkey(i)));
  });
  edges.forEach((e, i) => {
    const label = e.label ? { label: e.label, width: measure(e.label, EDGE_FS) + 12, height: 18, labelpos: 'c' } : {};
    g.setEdge(key.get(e.from), key.get(e.to), label, `e${i}`);
  });
  dagre.layout(g);

  const clusters = groups.map((grp, i) => {
    const c = g.node(gkey(i));
    const x = c.x - c.width / 2;
    const y = c.y - c.height / 2;
    const mark = deltaAttr(grp.state);
    return `<rect class="am-cluster"${mark} x="${f(x)}" y="${f(y)}" width="${f(c.width)}" height="${f(c.height)}" rx="4"/><text class="am-cluster-label"${mark} x="${f(x + 8)}" y="${f(y + 14)}">${esc(grp.name)}</text>${badgeSvg(grp.state, x + c.width, y)}`;
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
    return `${open}${path}<g class="am-edge-label"><rect x="${f(data.x - w / 2)}" y="${f(data.y - 9)}" width="${f(w)}" height="18" rx="3"/>${textLines([e.label], data.x, data.y, LH)}</g></g>`;
  });

  const nodeSvg = [...nodes.values()].map((n) => {
    const { x, y } = g.node(key.get(n.id));
    const { width: w, height: h, lines } = sizes.get(n.id);
    const badge = badgeSvg(n.state, ...badgePoint(n.shape, x, y, w, h));
    return `<g class="am-node am-node--${n.shape}${n.hi ? ' am-node--hi' : ''}" data-key="${esc(n.label)}" data-step="${stepOf.get(n.line)}"${deltaAttr(n.state)}>${shapeSvg(n.shape, x, y, w, h)}${textLines(lines, x, y + (n.shape === 'db' ? 4 : 0), LH)}${badge}</g>`;
  });

  const { width, height } = g.graph();
  const label = diagramLabel(ui, 'flow', [...nodes.keys()].slice(0, 8));
  const heads = ['added', 'removed'].filter((state) => edges.some((e) => e.state === state));
  return `${svgOpen(width, height, label)}${arrowDefs(id, heads)}<g>${clusters.join('')}</g><g>${edgeSvg.join('')}</g><g>${nodeSvg.join('')}</g></svg>`;
}

// The +, − or ~ badge of a marked item: a small disc on the corner of its shape. It carries data-delta itself because a group box's badge sits beside it, not inside.
function badgeSvg(state, x, y) {
  if (!state) return '';
  return `<g class="am-delta-badge am-delta-badge--${state}"${deltaAttr(state)} transform="translate(${f(x)},${f(y)})"><circle r="7"/><text text-anchor="middle" dominant-baseline="central">${SIGN[state]}</text></g>`;
}

// Where the badge sits: the top right corner, pulled in where the shape has no corner there.
function badgePoint(shape, x, y, w, h) {
  if (shape === 'diamond') return [x + w / 4, y - h / 4];
  if (shape === 'round') return [x + w / 2 - h * 0.15, y - h / 2 + h * 0.15];
  return [x + w / 2, y - h / 2];
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
