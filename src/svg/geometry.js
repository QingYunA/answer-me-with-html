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

// The points along the edge smoothPath (src/svg/shapes.js) draws: a line to the middle of the first segment, a quadratic curve
// around each bend from one segment middle to the next, and a line to the end. A chord of a quadratic curve cut into n equal steps
// lies at most |from - 2c + to| / (4n²) from it, so each bend gets enough steps to stay within tolerance px.
export function curvePoints(points, tolerance = 0.25) {
  if (points.length < 3) return points;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const out = [points[0]];
  let from = mid(points[0], points[1]);
  for (let i = 1; i < points.length - 1; i++) {
    const to = mid(points[i], points[i + 1]);
    const c = points[i];
    const bend = Math.hypot(from.x - 2 * c.x + to.x, from.y - 2 * c.y + to.y);
    const steps = Math.max(1, Math.ceil(Math.sqrt(bend / (4 * tolerance))));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y });
    }
    from = to;
  }
  out.push(points.at(-1));
  return out;
}
