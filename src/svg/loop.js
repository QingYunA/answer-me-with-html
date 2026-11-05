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
export function loopBeside({ x, y, width, labelWidth = 0, nth = 0, side = 1 }) {
  const edge = x + (side * width) / 2;
  const out = edge + side * LOOP_OUT + side * nth * LOOP_STEP;
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
export function loopBelow({ x, y, height, labelWidth = 0, depth = 0, side = 1 }) {
  const bottom = y + height / 2;
  const out = bottom + LOOP_OUT + depth;
  const [ax, bx] = [x - (side * LOOP_END) / 2, x + (side * LOOP_END) / 2];
  const half = Math.max(LOOP_END / 2, labelWidth / 2);
  return {
    a: { x: ax, y: bottom },
    b: { x: bx, y: bottom },
    c: [{ x: ax, y: out }, { x: bx, y: out }],
    away: { x: 0, y: 1 },
    label: labelWidth ? { x, y: out + 6 + 9 } : null,
    corners: [[x - half, bottom], [x + half, out + (labelWidth ? 6 + 18 : 0)]],
  };
}

// The space under a box for its loops, in the order they are drawn (see loopBelow): the first one's distance from the box,
// the steps down to the last one, and the label of the last.
export function loopRoom(labelWidths) {
  const steps = labelWidths.slice(0, -1).reduce((depth, width) => depth + LOOP_STEP + (width ? LOOP_LABEL : 0), 0);
  return LOOP_OUT + steps + (labelWidths.at(-1) ? LOOP_LABEL : 0) + LOOP_GAP;
}

// The path of a loop: a cubic from a to b that bulges through the two control points.
export function loopPath({ a, b, c }) {
  return `M${f(a.x)},${f(a.y)} C${f(c[0].x)},${f(c[0].y)} ${f(c[1].x)},${f(c[1].y)} ${f(b.x)},${f(b.y)}`;
}
