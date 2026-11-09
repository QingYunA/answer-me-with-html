// Self-reference loop: a relation from an item to itself leaves its box, goes around and comes back. er and state draw it
// the same way, so both read the geometry here; each component adds its own end marks, arrowhead and label.
import { f } from './shapes.js';

export const LOOP_OUT = 34; // how far a self-reference loops out of the box
export const LOOP_STEP = 20; // and how much farther each further self-reference of the same item goes
export const LOOP_END = 18; // how far apart its two ends sit on the edge
export const LOOP_LABEL = 24; // the room a loop's label takes below the loop, which the next loop of the same item leaves free
export const LOOP_GAP = 6; // and what is left under the lowest loop of an item before the next box of its rank

// A loop beside its box: out of the end edge (the left one on a right-to-left page, where side is -1), around, and back into
// it, with the two ends on that edge. The label sits beyond the loop.
export function loopBeside({ x, y, width, labelWidth = 0, nth = 0, offset = nth * LOOP_STEP, side = 1 }) {
  const edge = x + (side * width) / 2;
  const out = edge + side * LOOP_OUT + side * offset;
  const [ay, by] = [y - LOOP_END / 2, y + LOOP_END / 2];
  return {
    a: { x: edge, y: ay },
    b: { x: edge, y: by },
    c: [{ x: out, y: ay }, { x: out, y: by }],
    away: { x: side, y: 0 },
    label: labelWidth ? { x: out + side * 6 + (side * labelWidth) / 2, y } : null,
    corners: [[out + side * 6 + side * labelWidth, by], [out, ay]],
  };
}

// A loop below its box, for the layouts whose ranks run sideways: out of the bottom edge, down, and back up into it,
// bulging `depth` farther than the first loop. The first end sits on the side where reading starts, and the label is
// centred under the loop.
export function loopBelow({ x, y, height, labelWidth = 0, labelHeight = 18, depth = 0, side = 1 }) {
  const bottom = y + height / 2;
  const out = bottom + LOOP_OUT + depth;
  const [ax, bx] = [x - (side * LOOP_END) / 2, x + (side * LOOP_END) / 2];
  const half = Math.max(LOOP_END / 2, labelWidth / 2);
  return {
    a: { x: ax, y: bottom },
    b: { x: bx, y: bottom },
    c: [{ x: ax, y: out }, { x: bx, y: out }],
    away: { x: 0, y: 1 },
    label: labelWidth ? { x, y: out + 6 + labelHeight / 2 } : null,
    corners: [[x - half, bottom], [x + half, out + (labelWidth ? 6 + labelHeight : 0)]],
  };
}

// The room a loop's label takes below the loop. A one-line label keeps the round figure the constants assume; a taller label
// takes its measured height, so it neither covers its own loop nor the next one.
const labelRoom = (width, height) => (width ? Math.max(LOOP_LABEL, 6 + (height ?? 18)) : 0);

// The space under a box for its loops, in the order they are drawn (see loopBelow): the first one's distance from the box,
// the steps down to the last one, and the label of the last.
export function loopRoom(labelWidths, labelHeights = []) {
  const steps = labelWidths.slice(0, -1).reduce((depth, width, i) => depth + LOOP_STEP + labelRoom(width, labelHeights[i]), 0);
  return LOOP_OUT + steps + labelRoom(labelWidths.at(-1), labelHeights.at(-1)) + LOOP_GAP;
}

// The path of a loop: a cubic from a to b that bulges through the two control points.
export function loopPath({ a, b, c }) {
  return `M${f(a.x)},${f(a.y)} C${f(c[0].x)},${f(c[0].y)} ${f(c[1].x)},${f(c[1].y)} ${f(b.x)},${f(b.y)}`;
}

// The point where the line from the centre of a box towards `toward` leaves the box. A loop reserves room in the dagre node,
// so the edge ends have to be clipped to the smaller drawn box again.
export function clipToBox(centre, box, toward) {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const k = Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
  if (k === 0) return { ...centre };
  return { x: centre.x + dx / k, y: centre.y + dy / k };
}
