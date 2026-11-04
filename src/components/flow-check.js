// dagre keeps edge labels off nodes and off each other, but it can route an edge through a node that is not one of its ends, or
// through the label of another edge. This reads a finished layout and says so, with a way to fix the draft.
import { curvePoints, segmentHits } from '../svg/geometry.js';

// How far a box shrinks before an edge counts as inside it: a line that grazes the border is not a crossing.
const NODE_INSET = 2;
const LABEL_INSET = 1;
// The direction to try instead: the other axis.
const OTHER = { LR: 'TB', RL: 'TB', TB: 'LR', BT: 'LR' };

const around = ({ x, y }, { width, height }) => [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
const inset = ([x0, y0, x1, y1], d) => [x0 + d, y0 + d, x1 - d, y1 - d];
const runsThrough = (curve, box) => curve.slice(1).some((p, k) => segmentHits(curve[k], p, box));
const name = (e) => `${e.from} -> ${e.to}`;

// Where a drawn edge runs through something: { edge, kind: 'node', other: node id } for a node that is not its end, and
// { edge, kind: 'label', other: edge } for the label of another edge. Each edge is reported once for each kind.
// run is what runLayout returns; the boxes are the ones the page draws.
export function crossings({ g, key, sizes, labels }, { nodes, edges }) {
  const drawn = edges.map((e, i) => g.edge({ v: key.get(e.from), w: key.get(e.to), name: `e${i}` }));
  const nodeBoxes = [...nodes.keys()].map((id) => [id, inset(around(g.node(key.get(id)), sizes.get(id)), NODE_INSET)]);
  const labelBoxes = edges.map((e, i) => (labels[i] ? inset(around(drawn[i], labels[i]), LABEL_INSET) : null));
  return edges.flatMap((edge, i) => {
    // The edge as drawn: smoothPath cuts each bend, so the curve, not the dagre points, decides what the edge runs through.
    const curve = curvePoints(drawn[i].points);
    const node = nodeBoxes.find(([id, box]) => id !== edge.from && id !== edge.to && runsThrough(curve, box));
    const label = labelBoxes.findIndex((box, j) => j !== i && box && runsThrough(curve, box));
    return [
      ...(node ? [{ edge, kind: 'node', other: node[0] }] : []),
      ...(label >= 0 ? [{ edge, kind: 'label', other: edges[label] }] : []),
    ];
  });
}

const what = ({ edge, kind, other }) => (kind === 'node'
  ? `the edge "${name(edge)}" runs through the node "${other}"`
  : `the edge "${name(edge)}" runs through the label "${other.label}" of "${name(other)}"`);

// What to do when the other direction does not help.
const OTHERWISE = 'split the diagram into an overview and a detail diagram';

// One warning for each crossing, on the draft line of the edge. A fix is only offered when it is true: relayout(dir) lays the same
// diagram out in dir, and the other direction is named only if it has no crossing.
export function crossingWarnings(model, rankdir, run, relayout) {
  const found = crossings(run, model);
  if (!found.length) return [];
  const alt = OTHER[rankdir];
  const clean = crossings(relayout(alt), model).length === 0;
  return found.map((c) => ({
    line: c.edge.line,
    message: `${what(c)}; ${clean ? `\`\`\`flow ${alt} draws this diagram without crossings` : OTHERWISE}`,
  }));
}
