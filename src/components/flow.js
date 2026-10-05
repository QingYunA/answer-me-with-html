// Flow / architecture diagram: the model writes only relations (A -> B: label), dagre computes coordinates, this file draws the layout as SVG.
import dagre from '@dagrejs/dagre';
import { esc, measure, wrap } from '../svg/text.js';
import { f, smoothPath, arrowDefs, svgOpen, textLines, diagramLabel } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';

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
- The text inside the brackets is the node's identity; later lines can refer to the node by that text alone. The default direction is TB (top to bottom).`,
  example: '```flow LR\n(User) -> Gateway: HTTPS\nGateway -> Auth & *Service\nService -> [(Database)]\ngroup Backend: Auth, Service\n```',
  render(text, { args, uid, ui }) {
    const model = parseFlow(text);
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    return `<figure class="am-diagram am-flow">${layout(model, DIRS.has(dir) ? dir : 'TB', uid(), ui)}</figure>`;
  },
};

export function parseFlow(text) {
  const nodes = new Map();
  const edges = [];
  const groups = [];
  const upsert = (spec, line) => {
    const prev = nodes.get(spec.id);
    if (!prev) nodes.set(spec.id, { ...spec, line });
    else nodes.set(spec.id, { ...prev, shape: spec.explicit ? spec.shape : prev.shape, hi: prev.hi || spec.hi });
    return spec.id;
  };

  for (const { text: t, line } of contentLines(text)) {
    const g = t.match(/^group\s+(.+?)\s*[:：]\s*(.+)$/i);
    if (g) {
      groups.push({ name: g[1], members: g[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean), line });
      continue;
    }
    const { chain, label } = parseChain(t, line);
    const ids = chain.map((step) => ({ ...step, ids: step.nodes.map((n) => upsert(n, line)) }));
    for (let k = 1; k < ids.length; k++) {
      const isLast = k === ids.length - 1;
      for (const from of ids[k - 1].ids) {
        for (const to of ids[k].ids) {
          edges.push({ from, to, dashed: ids[k].arrow === '-->', label: isLast ? label : '', line });
        }
      }
    }
  }
  if (!nodes.size) throw new ComponentError('flow needs at least one node', 1);
  for (const grp of groups) {
    const missing = grp.members.filter((m) => !nodes.has(m));
    if (missing.length) throw new ComponentError(`group ${grp.name} refers to nodes that do not exist: ${missing.join(', ')}`, grp.line);
  }
  return { nodes, edges, groups };
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
    return `<rect class="am-cluster" x="${f(x)}" y="${f(y)}" width="${f(c.width)}" height="${f(c.height)}" rx="4"/><text class="am-cluster-label" x="${f(x + 8)}" y="${f(y + 14)}">${esc(grp.name)}</text>`;
  });

  // In video mode, items appear step by step by source line: edges written on one line and nodes first seen there form one step.
  const stepOf = new Map([...new Set([...[...nodes.values()].map((n) => n.line), ...edges.map((e) => e.line)])].sort((a, b) => a - b).map((l, k) => [l, k]));
  const edgeSvg = edges.map((e, i) => {
    const data = g.edge({ v: key.get(e.from), w: key.get(e.to), name: `e${i}` });
    const pts = clipEnds(data.points, g.node(key.get(e.from)), nodes.get(e.from).shape, g.node(key.get(e.to)), nodes.get(e.to).shape);
    const path = `<path class="am-edge${e.dashed ? ' am-edge--dashed' : ''}" d="${smoothPath(pts)}" marker-end="url(#${id}-arrow)"/>`;
    if (!e.label) return `<g data-step="${stepOf.get(e.line)}">${path}</g>`;
    const w = measure(e.label, EDGE_FS) + 10;
    return `<g data-step="${stepOf.get(e.line)}">${path}<g class="am-edge-label"><rect x="${f(data.x - w / 2)}" y="${f(data.y - 9)}" width="${f(w)}" height="18" rx="3"/>${textLines([e.label], data.x, data.y, LH)}</g></g>`;
  });

  const nodeSvg = [...nodes.values()].map((n) => {
    const { x, y } = g.node(key.get(n.id));
    const { width: w, height: h, lines } = sizes.get(n.id);
    return `<g class="am-node am-node--${n.shape}${n.hi ? ' am-node--hi' : ''}" data-key="${esc(n.label)}" data-step="${stepOf.get(n.line)}">${shapeSvg(n.shape, x, y, w, h)}${textLines(lines, x, y + (n.shape === 'db' ? 4 : 0), LH)}</g>`;
  });

  const { width, height } = g.graph();
  const label = diagramLabel(ui, 'flow', [...nodes.keys()].slice(0, 8));
  return `${svgOpen(width, height, label)}${arrowDefs(id)}<g>${clusters.join('')}</g><g>${edgeSvg.join('')}</g><g>${nodeSvg.join('')}</g></svg>`;
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
