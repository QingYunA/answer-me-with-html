// Shared helpers for SVG fragments: number formatting, smooth polylines, arrow markers, multi-line text.
import { esc } from './text.js';

export const f = (n) => String(Math.round(n * 10) / 10);

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Quadratic curves through the midpoints of each bend: straight segments at both ends, smooth corners.
export function smoothPath(points) {
  const [first, ...rest] = points;
  if (rest.length === 1) return `M${f(first.x)},${f(first.y)} L${f(rest[0].x)},${f(rest[0].y)}`;
  const parts = [`M${f(first.x)},${f(first.y)}`];
  const m0 = mid(points[0], points[1]);
  parts.push(`L${f(m0.x)},${f(m0.y)}`);
  for (let i = 1; i < points.length - 1; i++) {
    const m = mid(points[i], points[i + 1]);
    parts.push(`Q${f(points[i].x)},${f(points[i].y)} ${f(m.x)},${f(m.y)}`);
  }
  const last = points.at(-1);
  parts.push(`L${f(last.x)},${f(last.y)}`);
  return parts.join(' ');
}

// variants: extra arrowheads, "added" and "removed" for change markers; each one is a marker named <uid>-arrow-<variant>.
export function arrowDefs(uid, variants = []) {
  const marker = (name, cls) => `<marker id="${uid}-arrow${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="am-arrow${cls}" d="M0,0 L10,5 L0,10 z"/></marker>`;
  return `<defs>${[marker('', ''), ...variants.map((v) => marker(`-${v}`, ` am-arrow--${v}`))].join('')}</defs>`;
}

// Lay out multi-line text vertically centred on (cx, cy).
export function textLines(lines, cx, cy, lineHeight, attrs = '') {
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  return lines
    .map((line, i) => `<text x="${f(cx)}" y="${f(top + i * lineHeight)}" text-anchor="middle" dominant-baseline="central"${attrs}>${esc(line)}</text>`)
    .join('');
}

// "Flowchart: A, B": the page language's name for the diagram, then the node names. Without a context (component unit tests) it falls back to English.
const EN_LABELS = { flow: 'Flowchart', sequence: 'Sequence diagram', colon: ': ', sep: ', ' };

export function diagramLabel(ui, kind, names) {
  const u = { ...EN_LABELS, ...ui };
  return `${u[kind]}${u.colon}${names.join(u.sep)}`;
}

export function svgOpen(width, height, label) {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">`;
}
