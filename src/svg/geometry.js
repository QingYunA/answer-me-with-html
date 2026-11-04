// Box and segment tests for diagram layout. A box is [x0, y0, x1, y1]; a point is { x, y }.

export const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// Does the segment p-q cross the box [x0, y0, x1, y1]? Liang-Barsky clipping.
export function segmentHits(p, q, [x0, y0, x1, y1]) {
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
