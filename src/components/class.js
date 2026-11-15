import dagre from '@dagrejs/dagre';
import { esc, measure } from '../svg/text.js';
import { f, smoothPath, svgOpen, textLines, diagramLabel, mirrorLayout, orderRanks } from '../svg/shapes.js';
import { svgLine } from '../bidi.js';
import { DRAWING } from '../themes/type-scale.js';
import { ComponentError, contentLines } from './error.js';

// RELATION matches UML links; the arrow or diamond belongs to the written end.
const RELATION = /^(\S+)\s+(--\|>|\.\.\|>|\*--|o--|-->|\.\.>|--)\s+([^\s:]+)(?:\s*:\s*(.*))?$/;
// METHOD requires a call signature before any property type, keeping callback-valued properties in the attributes compartment.
const METHOD = /^[+\-#~]?\s*[^:\s(]+\s*\(/;
// ROW is the fixed line height used to measure and draw class compartments.
const ROW = 20;
// PAD leaves room between a class's text and its border.
const PAD = 12;

// parseClass reads declarations, indented members and relationships, validating references once at the draft boundary.
export function parseClass(text) {
  const classes = new Map();
  const relations = [];
  let current;
  for (const { raw, text: line, line: n } of contentLines(text)) {
    if (/^\s/.test(raw)) {
      if (!current) throw new ComponentError('class: write a class or interface before its indented members', n);
      current.members.push(line);
      continue;
    }
    const relation = line.match(RELATION);
    if (relation) {
      relations.push({ from: relation[1], kind: relation[2], to: relation[3], label: relation[4] ?? '', line: n });
      current = null;
      continue;
    }
    const declaration = line.match(/^(?:(class|interface|abstract|enum)\s+)?(\*?)([^\s:]+)$/);
    if (!declaration || /--|\.\.>|[{}]/.test(line)) {
      throw new ComponentError(`class: cannot parse "${line}"; write class User, interface Store, or User --|> Entity`, n);
    }
    const [, kind = 'class', hi, name] = declaration;
    if (classes.has(name)) throw new ComponentError(`class: "${name}" is declared twice`, n);
    current = { name, kind, hi: Boolean(hi), members: [], line: n };
    classes.set(name, current);
  }
  if (!classes.size) throw new ComponentError('class needs at least one class or interface', 1);
  for (const relation of relations) {
    for (const name of [relation.from, relation.to]) {
      if (!classes.has(name)) throw new ComponentError(`class: no declaration for "${name}"`, relation.line);
    }
  }
  return { classes, relations };
}

export default {
  name: 'class',
  summary: 'UML class diagram (attributes, methods, interfaces and relationships)',
  syntax: `\`\`\`class [TB|LR|BT|RL]
abstract Entity
  +id: string
class *User
  -email: string
  +save(): void
interface Store
  +find(id: string): User
User --|> Entity: extends
User ..|> Store: implements
\`\`\`
- Declare class, interface, abstract or enum at column 0; a bare name is a class. * highlights a declaration.
- Indent members. Visibility (+ public, - private, # protected, ~ package), types and signatures are shown as written.
- Attributes and methods occupy separate compartments; a method starts with name( after its optional visibility sign. Parentheses in a property type do not make it a method.
- Links: --|> inheritance, ..|> realization, *-- composition, o-- aggregation, --> association, ..> dependency, -- plain association.
- Arrowheads point at the right-hand declaration; diamonds sit at the left-hand declaration. Labels after : are optional.
- Declare both ends of every link. Self-links and parallel links are supported. The default direction is TB.`,
  example: '```class LR\ninterface Store\n  +find(id: string): User\nclass UserStore\n  -users: User[]\n  +find(id: string): User\nUserStore ..|> Store: implements\n```',
  // render lays out measured UML boxes with dagre and emits the same themed SVG hooks as the other diagrams.
  render(text, { args = '', uid, ui, dir = 'ltr' }) {
    const { classes, relations } = parseClass(text);
    const id = uid();
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: args.match(/\b(TB|LR|BT|RL)\b/i)?.[1].toUpperCase() ?? 'TB', nodesep: 44, ranksep: 64, marginx: 18, marginy: 18 });
    g.setDefaultEdgeLabel(() => ({}));
    const keys = new Map([...classes.keys()].map((name, i) => [name, `n${i}`]));
    for (const c of classes.values()) {
      const stereotype = c.kind === 'class' ? [] : [c.kind];
      const attributes = c.members.filter((m) => !METHOD.test(m));
      const methods = c.members.filter((m) => METHOD.test(m));
      const groups = [[...stereotype, c.name], attributes, methods].filter((rows) => rows.length);
      const widths = groups.flatMap((rows, i) => rows.map((row, n) => measure(row, i || (stereotype.length && !n) ? DRAWING.field : DRAWING.node, { bold: c.hi })));
      g.setNode(keys.get(c.name), { ...c, groups, width: Math.ceil(Math.max(100, ...widths.map((w) => w + 2 * PAD))), height: groups.reduce((n, rows) => n + rows.length * ROW + PAD, 0) });
    }
    relations.forEach((rel, i) => {
      g.setEdge(keys.get(rel.from), keys.get(rel.to), {
        ...rel, width: rel.label ? measure(rel.label, DRAWING.edge) + 12 : 0, height: rel.label ? 20 : 0, labelpos: 'c',
      }, `e${i}`);
    });
    dagre.layout(g, { customOrder: orderRanks });
    if (dir === 'rtl') mirrorLayout(g);
    const edges = g.edges().map((edge) => {
      const rel = g.edge(edge);
      const diamond = rel.kind === '*--' || rel.kind === 'o--';
      const marker = diamond ? (rel.kind === '*--' ? 'filled' : 'diamond') : rel.kind.includes('|>') ? 'triangle' : 'open';
      const end = rel.kind === '--' ? '' : ` marker-${diamond ? 'start' : 'end'}="url(#${id}-${marker})"`;
      const label = rel.label ? `<g class="am-edge-label"><rect x="${f(rel.x - rel.width / 2)}" y="${f(rel.y - 10)}" width="${f(rel.width)}" height="20" rx="3"/>${textLines([rel.label], rel.x, rel.y, ROW, '', dir)}</g>` : '';
      return `<g data-step="${rel.line - 1}"><path class="am-edge${rel.kind.startsWith('..') ? ' am-edge--dashed' : ''}" d="${smoothPath(rel.points)}"${end}/>${label}</g>`;
    });
    const nodes = g.nodes().map((key) => {
      const c = g.node(key);
      const x = c.x - c.width / 2;
      const y = c.y - c.height / 2;
      let top = y;
      const rows = c.groups.map((group, k) => {
        const separator = k ? `<path class="am-edge" d="M${f(x)},${f(top)} h${f(c.width)}"/>` : '';
        const text = group.map((member, n) => {
          // The kind label keeps the theme's node color, but is smaller and muted above the name.
          const kind = !k && !n && c.kind !== 'class';
          return `<text class="am-node-text" x="${f(k ? (dir === 'rtl' ? x + c.width - PAD : x + PAD) : c.x)}" y="${f(top + PAD / 2 + ROW * (n + 0.5))}" text-anchor="${k ? 'start' : 'middle'}" dominant-baseline="central"${k || kind ? ` style="font-size:${DRAWING.field}px${kind ? ';font-style:italic;opacity:0.65' : ''}"` : ''}>${esc(svgLine(member, dir))}</text>`;
        }).join('');
        top += group.length * ROW + PAD;
        return separator + text;
      }).join('');
      return `<g class="am-node am-node--rect${c.hi ? ' am-node--hi' : ''}" data-key="${esc(c.name)}" data-step="${c.line - 1}"><rect class="am-node-shape" x="${f(x)}" y="${f(y)}" width="${f(c.width)}" height="${f(c.height)}" rx="3"/>${rows}</g>`;
    });
    const defs = `<defs>${[['triangle', 'M0,0 L10,5 L0,10 Z'], ['diamond', 'M0,5 L6,0 L12,5 L6,10 Z'], ['filled', 'M0,5 L6,0 L12,5 L6,10 Z'], ['open', 'M1,1 L9,5 L1,9']].map(([kind, path]) => `<marker id="${id}-${kind}" viewBox="-1 -1 14 12" refX="${kind === 'diamond' || kind === 'filled' ? 12 : 10}" refY="5" markerWidth="12" markerHeight="10" orient="auto-start-reverse"><path class="${kind === 'filled' ? 'am-arrow' : kind === 'open' ? 'am-edge' : 'am-class-hollow'}" d="${path}"/></marker>`).join('')}</defs>`;
    return `<figure class="am-diagram am-class">${svgOpen(g.graph().width, g.graph().height, diagramLabel(ui, 'class', [...classes.keys()]), dir)}${defs}${edges.join('')}${nodes.join('')}</svg></figure>`;
  },
};
