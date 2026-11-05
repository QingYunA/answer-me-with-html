// State machine diagram: one line per transition (From -> To: event), dagre computes coordinates through flow's runLayout,
// this file draws rounded states, the initial and final pseudo-states and the self-transition loops as SVG.
import { esc } from '../svg/text.js';
import { f, smoothPath, arrowDefs, svgOpen, textLines, diagramLabel } from '../svg/shapes.js';
import { ComponentError, contentLines } from './error.js';
import { splitMarker, markState, deltaAttr, withDelta } from './delta.js';
import { badgeSvg, edgeText, nodeSize, nodeState, runLayout } from './flow.js';
import { LOOP_LABEL, LOOP_OUT, LOOP_STEP, loopBeside, loopBelow, loopPath, loopRoom } from '../svg/loop.js';

const LH = 17; // the line height runLayout measured each state label with
const DOT = 16; // the box dagre reserves for an initial or final pseudo-state
const DIRS = new Set(['TB', 'LR', 'BT', 'RL']);
// The two pseudo-states are not states: they get ids no written name can collide with and a fixed box.
const INITIAL = '\u0000initial';
const FINAL = '\u0000final';

export default {
  name: 'state',
  summary: 'State machine diagram (automatic layout)',
  syntax: `\`\`\`state [TB|LR|BT|RL]
[*] -> Idle                   ← [*] on the left is the initial pseudo-state
Idle -> Connecting: connect()  ← text after the colon is the event; it is optional
Connecting -> Open: SYN-ACK
Connecting -> Closed: RST
Open -> Open: retransmit       ← a self-transition draws a loop
Open -> Closed: close()
Closed -> [*]                  ← [*] on the right is the final pseudo-state
\`\`\`
- One transition per line. A state is a rounded rectangle; the initial pseudo-state is a filled dot, the final one a ringed dot.
- The text on each side of \`->\` is the state's name; later lines can refer to it by that name alone. A line without an arrow declares a state (with a change marker).
- A Mermaid \`stateDiagram-v2\` block is an error that shows the line to write: lines such as \`Idle --> Open\` are rejected with their line number.
- Composite states, parallel regions, entry and exit actions, and history pseudo-states are not drawn.
- Change markers show what a plan adds, removes and changes. A line can start with + (added), - (removed) or ~ (changed), followed by a space:
\`\`\`state LR
[*] -> Idle
Idle -> Connecting: connect()
+ Connecting -> Polling: no reply
- Connecting -> Closed
~ Connecting
Polling -> Open: reply
\`\`\`
  - A marker applies to the transition and to each state on its line. A state is removed when it appears only on - lines, added when it appears only on + lines, and unchanged when it also appears on an unmarked line. ~ State on a line without an arrow marks that state as changed.
  - ~ on a transition is an error: remove the old transition with - and add the new one with +. The same transition both unmarked and marked is an error too.
  - The Changes view draws added in the theme's ok color, removed faded with a struck-through label, changed with a warn outline, and each marked state with a +, − or ~ badge. A count row and a Before / Changes / After switch sit under the diagram.
  - A line that starts with a marker and a space is always read as a marker.`,
  example: '```state LR\n[*] -> Idle\nIdle -> Connecting: connect()\nConnecting -> Open: SYN-ACK\nConnecting -> Closed: RST\nOpen -> Open: retransmit\nOpen -> Closed: close()\nClosed -> [*]\n```',
  render(text, { args, uid, ui, video, dir: pageDir = 'ltr' }) {
    const model = parseState(text);
    const dir = (args.match(/\b(TB|LR|BT|RL)\b/i)?.[1] ?? 'TB').toUpperCase();
    const html = `<figure class="am-diagram am-state">${layout(model, DIRS.has(dir) ? dir : 'TB', uid(), ui, pageDir)}</figure>`;
    return withDelta(html, [...model.nodes.values(), ...model.edges].map((x) => x.state ?? null), { ui, video });
  },
};

export function parseState(text) {
  const nodes = new Map();
  const edges = [];
  const lines = new Set();
  // before / after: whether the state exists before and after the change; tilde: a "~ State" line marked it changed.
  const add = (id, label, kind, line, mark) => {
    const prev = nodes.get(id);
    const seen = { before: mark !== '+', after: mark !== '-', tilde: mark === '~' };
    const tildeLine = mark === '~' ? line : undefined;
    if (!prev) nodes.set(id, { id, label, kind, line, ...seen, ...(tildeLine && { tildeLine }) });
    else nodes.set(id, { ...prev, before: prev.before || seen.before, after: prev.after || seen.after, tilde: prev.tilde || seen.tilde, ...(tildeLine && { tildeLine: prev.tildeLine ?? tildeLine }) });
    return id;
  };
  const resolve = (name, line, mark, side) => {
    if (name !== '[*]') return add(name, name, 'state', line, mark);
    return add(side === 'from' ? INITIAL : FINAL, '[*]', side === 'from' ? 'initial' : 'final', line, mark);
  };

  for (const { text: raw, line: n } of contentLines(text)) {
    const { mark, text: t } = splitMarker(raw);
    if (t.includes('\u0000')) throw new ComponentError(`state: a state name cannot contain U+0000: "${raw}"`, n);
    const state = markState(mark);
    checkMermaid(t, raw, mark, n);
    lines.add(n);
    const at = t.indexOf('->');
    if (at === -1) {
      if (/[:：]/.test(t)) throw new ComponentError(`state cannot parse "${raw}". Write a transition as A -> B: event`, n);
      resolve(t.trim(), n, mark, 'from');
      continue;
    }
    if (mark === '~') throw new ComponentError('state: ~ marks a state, not a transition. To change a transition, remove the old one and add the new one: "- A -> B" then "+ A -> C"', n);
    const from = t.slice(0, at).trim();
    const rest = t.slice(at + 2);
    if (rest.includes('->')) throw new ComponentError(`state takes one transition per line: "${raw}" has two. Split it into two lines`, n);
    const colon = rest.search(/[:：]/);
    const to = (colon === -1 ? rest : rest.slice(0, colon)).trim();
    const label = colon === -1 ? '' : rest.slice(colon + 1).trim();
    if (!from || !to) throw new ComponentError(`state: a transition needs a state on each side of ->; write "${raw}" as A -> B: event`, n);
    const fromId = resolve(from, n, mark, 'from');
    const toId = resolve(to, n, mark, 'to');
    edges.push({ from: fromId, to: toId, label, line: n, ...(state && { state }) });
  }
  if (!nodes.size) throw new ComponentError('state needs at least one state', 1);
  checkTransitions(edges, nodes);
  const settled = new Map([...nodes].map(([id, node]) => {
    const state = nodeState(node);
    return [id, state ? { ...node, state } : node];
  }));
  return { nodes: settled, edges, lines: [...lines].sort((a, b) => a - b) };
}

// Mermaid stateDiagram-v2 syntax is close enough to this one that an agent may paste it: reject it with the line to write.
function checkMermaid(t, raw, mark, line) {
  if (/^stateDiagram(-v2)?$/i.test(t)) {
    throw new ComponentError(`"${raw}" is Mermaid syntax; this block is a state diagram already, so write its transitions one line each, for example: [*] -> Idle`, line);
  }
  if (/^state\s+.+\{$/.test(t)) {
    throw new ComponentError(`"${raw}" is a Mermaid composite state, which this component does not draw; write each state on its own or in a transition`, line);
  }
  if (t === '}') throw new ComponentError(`"${raw}" closes a Mermaid composite state; this component has no nested states, so remove the braces`, line);
  if (!t.includes('-->')) return;
  const fixed = t.replace(/-->/g, '->').replace(/\s*[:：]\s*/, ': ');
  throw new ComponentError(`"${raw}" is Mermaid syntax; write ${mark && mark !== '~' ? `${mark} ` : ''}${fixed}`, line);
}

// A transition written both unmarked and marked says two things about the same transition. The event is part of the transition,
// so two events between the same states are two transitions, and each may carry its own marker.
function checkTransitions(edges, nodes) {
  const keyOf = (e) => `${e.from}\u0000${e.to}\u0000${e.label}`;
  const text = (e) => `${nodes.get(e.from).label} -> ${nodes.get(e.to).label}${e.label ? `: ${e.label}` : ''}`;
  for (const e of edges.filter((x) => x.state)) {
    const plain = edges.find((x) => !x.state && keyOf(x) === keyOf(e));
    if (plain) {
      throw new ComponentError(`state: the transition ${text(e)} is written unmarked on line ${plain.line} and as ${e.state === 'added' ? '+' : '-'} here. Mark every line of that transition, or none`, e.line);
    }
  }
}

function layout(model, rankdir, id, ui, pageDir = 'ltr') {
  const { nodes, edges, lines } = model;
  const rtl = pageDir === 'rtl';
  const side = rtl ? -1 : 1;
  const below = rankdir === 'LR' || rankdir === 'RL';
  const loops = edges.filter((e) => e.from === e.to);
  const straight = edges.filter((e) => e.from !== e.to);

  // A state box is measured once: runLayout gets the same numbers, and the drawing reads back the wrapped lines.
  const boxes = new Map([...nodes.values()].map((n) => {
    if (n.kind !== 'state') return [n.id, { width: DOT, height: DOT, lines: [] }];
    const { width, height, lines } = nodeSize({ label: n.label, shape: 'rect' });
    return [n.id, { width, height, lines }];
  }));

  // With the ranks running sideways a self-transition loops below its state, so dagre gets a taller node for that state: the
  // box is drawn at the top of it and the loops hang into the room under the box, clear of the next rank. In TB and BT the loop
  // lies beside the box, which is the side where the next state of the rank would sit, so dagre gets a wider node instead and
  // the box is drawn at the edge away from the loops.
  const room = new Map();
  const beside = new Map();
  for (const from of new Set(loops.map((e) => e.from))) {
    const own = loops.filter((e) => e.from === from);
    const widths = own.map((e) => (e.label ? edgeText(e.label).width : 0));
    if (below) {
      room.set(from, { y: loopRoom(widths) });
      continue;
    }
    // A wide label pushes the next loop farther out, so two labelled self-transitions do not cover each other.
    let offset = 0;
    beside.set(from, own.map((e, i) => {
      if (i) offset += Math.max(LOOP_STEP, widths[i - 1] + 6);
      return { edge: e, offset, labelWidth: widths[i], extent: LOOP_OUT + offset + 6 + widths[i] };
    }));
    room.set(from, { x: Math.max(...beside.get(from).map((spec) => spec.extent)) });
  }
  const layoutNodes = new Map([...nodes].map(([key, n]) => {
    const box = boxes.get(key);
    const extra = room.get(key) ?? {};
    return [key, { ...n, shape: 'rect', size: [box.width + (extra.x ?? 0), box.height + (extra.y ?? 0)] }];
  }));
  const { g, key } = runLayout({ nodes: layoutNodes, edges: straight, groups: [] }, rankdir, rtl, [], new Map());
  // Where the box of a state is drawn: dagre's node is centred on the box, or larger and the box at the edge away from the room.
  const centre = (nodeId) => {
    const { x, y } = g.node(key.get(nodeId));
    const extra = room.get(nodeId) ?? {};
    return { x: x - (side * (extra.x ?? 0)) / 2, y: y - (extra.y ?? 0) / 2 };
  };

  // In video mode, items appear step by step: every source line is one step, so a line that only marks a state still has one.
  const stepOf = new Map(lines.map((line, i) => [line, i]));

  const drawn = straight.map((e, i) => {
    const data = g.edge({ v: key.get(e.from), w: key.get(e.to), name: `e${i}` });
    return { e, data, points: clipEnds(data.points, e, centre, boxes, room) };
  });
  const edgeSvg = drawn.map(({ e, data, points }) => {
    const head = e.state ? `${id}-arrow-${e.state}` : `${id}-arrow`;
    const path = `<path class="am-edge" d="${smoothPath(points)}" marker-end="url(#${head})"/>`;
    const text = e.label ? edgeLabelSvg(e.label, data.x, data.y, pageDir) : '';
    return `<g data-step="${stepOf.get(e.line)}"${deltaAttr(e.state)}>${path}${text}</g>`;
  });

  // A self-transition lies beside its box; with the ranks running sideways (LR, RL) the edges leave by that side, so the loop
  // lies below the box instead. Further self-transitions of one state take their own distance, so all of them stay visible.
  const seen = new Map();
  const loopSpecs = loops.map((e) => {
    const { x, y } = centre(e.from);
    const box = boxes.get(e.from);
    if (below) {
      const { depth } = seen.get(e.from) ?? { depth: 0 };
      seen.set(e.from, { depth: depth + LOOP_STEP + (e.label ? LOOP_LABEL : 0) });
      const labelWidth = e.label ? edgeText(e.label).width : 0;
      return { e, ...loopBelow({ x, y, height: box.height, depth, side, labelWidth }) };
    }
    const spec = beside.get(e.from).find((x) => x.edge === e);
    return { e, ...loopBeside({ x, y, width: box.width, side, offset: spec.offset, labelWidth: spec.labelWidth }) };
  });
  const loopsSvg = loopSpecs.map(({ e, ...spec }) => {
    const head = e.state ? `${id}-arrow-${e.state}` : `${id}-arrow`;
    const path = `<path class="am-edge" d="${loopPath(spec)}" marker-end="url(#${head})"/>`;
    const text = e.label && spec.label ? edgeLabelSvg(e.label, spec.label.x, spec.label.y, pageDir) : '';
    return `<g data-step="${stepOf.get(e.line)}"${deltaAttr(e.state)}>${path}${text}</g>`;
  });

  const nodeSvg = [...nodes.values()].map((n) => {
    const { x, y } = centre(n.id);
    const box = boxes.get(n.id);
    // A changed state shows its badge on the step of the line that marks it, not on the line that first names it.
    const badgeStep = n.state === 'changed' ? stepOf.get(n.tildeLine ?? n.line) : undefined;
    const badge = badgeSvg(n.state, rtl ? x - box.width / 2 : x + box.width / 2, y - box.height / 2, badgeStep);
    const keyAttr = n.kind === 'state' ? ` data-key="${esc(n.label)}"` : '';
    const open = `<g class="am-node am-node--state${n.kind === 'state' ? '' : ` am-node--${n.kind}`}"${keyAttr} data-step="${stepOf.get(n.line)}"${deltaAttr(n.state)}>`;
    if (n.kind === 'initial') return `${open}<circle class="am-state-dot" cx="${f(x)}" cy="${f(y)}" r="6"/>${badge}</g>`;
    if (n.kind === 'final') return `${open}<circle class="am-state-ring" cx="${f(x)}" cy="${f(y)}" r="6"/><circle class="am-state-core" cx="${f(x)}" cy="${f(y)}" r="2.8"/>${badge}</g>`;
    return `${open}<rect class="am-node-shape" x="${f(x - box.width / 2)}" y="${f(y - box.height / 2)}" width="${f(box.width)}" height="${f(box.height)}" rx="8"/>${textLines(box.lines, x, y, LH, ' class="am-node-text"', pageDir)}${badge}</g>`;
  });

  // The drawing is as big as everything drawn on it: dagre sizes the ranks, but a loop and its label sit outside the box, so
  // the extent of every point decides. A shift keeps the origin at 0.
  const xs = [];
  const ys = [];
  const at = (x, y) => {
    xs.push(x);
    ys.push(y);
  };
  for (const n of nodes.values()) {
    const { x, y } = centre(n.id);
    const box = boxes.get(n.id);
    at(x - box.width / 2, y - box.height / 2);
    at(x + box.width / 2, y + box.height / 2);
  }
  for (const { e, data, points } of drawn) {
    for (const p of points) at(p.x, p.y);
    if (e.label) {
      const { width: w, height: h } = edgeText(e.label);
      at(data.x - w / 2, data.y - h / 2);
      at(data.x + w / 2, data.y + h / 2);
    }
  }
  for (const { e, corners, label } of loopSpecs) {
    corners.forEach(([x, y]) => at(x, y));
    if (label) {
      const { width: w, height: h } = edgeText(e.label);
      at(label.x - w / 2, label.y - h / 2);
      at(label.x + w / 2, label.y + h / 2);
    }
  }
  const margin = 14;
  const shiftX = margin - Math.min(...xs);
  const shiftY = margin - Math.min(...ys);
  const shift = shiftX || shiftY ? ` transform="translate(${f(shiftX)},${f(shiftY)})"` : '';
  const width = Math.ceil(Math.max(...xs) - Math.min(...xs)) + 2 * margin;
  const height = Math.ceil(Math.max(...ys) - Math.min(...ys)) + 2 * margin;
  const names = [...nodes.values()].filter((n) => n.kind === 'state').slice(0, 8).map((n) => n.label);
  const label = diagramLabel(ui, 'state', names);
  const heads = ['added', 'removed'].filter((s) => edges.some((e) => e.state === s));
  return `${svgOpen(width, height, label, pageDir)}${arrowDefs(id, heads)}<g${shift}><g>${edgeSvg.join('')}</g><g>${loopsSvg.join('')}</g><g>${nodeSvg.join('')}</g></g></svg>`;
}

function edgeLabelSvg(label, x, y, pageDir) {
  const { lines, width: w, height: h } = edgeText(label);
  return `<g class="am-edge-label"><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="3"/>${textLines(lines, x, y, LH, '', pageDir)}</g>`;
}

// dagre clips an edge to the node it knows, which is larger than the drawn box when a loop reserves room: clip to the box again,
// along the line from the centre of the box to the next point of the edge.
function clipEnds(points, edge, centre, boxes, room) {
  const pts = points.map((p) => ({ ...p }));
  if (room.has(edge.from) && pts.length > 1) pts[0] = clipToBox(centre(edge.from), boxes.get(edge.from), points[1]);
  if (room.has(edge.to) && pts.length > 1) pts[pts.length - 1] = clipToBox(centre(edge.to), boxes.get(edge.to), points[points.length - 2]);
  return pts;
}

function clipToBox(centre, box, toward) {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const k = Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
  if (k === 0) return { ...centre };
  return { x: centre.x + dx / k, y: centre.y + dy / k };
}
