// Type scale: one source of truth for every text size a page uses. Page CSS reads --am-fs-* (page text) and --am-ln-* (a length a line
// of text sets); --am-scale scales both, and is 1 unless the reader sets a scale (the `scale` setting). Drawing text stays in viewBox units under --am-fs-d-*,
// because Node measures the diagram at those sizes; the whole drawing box takes the factor instead.

export const SCALE = Object.freeze({ min: 0.8, max: 1.5, step: 0.05 });

// Page (HTML) text sizes in px at scale 1, one entry per distinct size page CSS uses, named by role.
export const SIZES = Object.freeze({
  title: 24,
  stat: 17,
  lead: 15.5,
  heading: 15,
  body: 14,
  text: 13,
  code: 12.5,
  small: 12,
  fine: 11.5,
  label: 11,
  tick: 10,
});

// Text inside SVG diagrams and charts, in viewBox units: never scaled by --am-scale, so the layout Node measured stays exact.
export const DRAWING = Object.freeze({
  node: SIZES.text,
  field: SIZES.small,
  edge: SIZES.fine,
  cluster: SIZES.label,
  step: SIZES.tick,
  note: SIZES.small,
  badge: SIZES.label,
  chartCat: SIZES.small,
  chartTick: SIZES.label,
  chartVal: SIZES.label,
  chartLegend: SIZES.small,
  totalMin: 10,
  totalMax: 22,
  totalFit: 18,
  totalUnit: SIZES.small,
});

// px lengths a line of text sets: they grow with the text they hold.
export const LINES = Object.freeze({
  annotPad: 14,
  segLine: 16,
  whenHeight: 24,
  limitsTick: 16,
  treeBadge: 15,
});

const scaled = (name, value) => `  --${name}: calc(${value}px * var(--am-scale, 1));`;
const fixed = (name, value) => `  --${name}: ${value}px;`;

// The page variables at scale 1, and the same page table fixed on the chrome that never grows.
export function typeScaleCss() {
  const html = [
    ...Object.entries(SIZES).map(([role, value]) => scaled(`am-fs-${role}`, value)),
    ...Object.entries(DRAWING).map(([role, value]) => fixed(`am-fs-d-${role}`, value)),
    ...Object.entries(LINES).map(([role, value]) => scaled(`am-ln-${role}`, value)),
  ].join('\n');
  const chrome = Object.entries(SIZES).map(([role, value]) => fixed(`am-fs-${role}`, value)).join('\n');
  return `html {\n${html}\n}\n.am-toolbar, .am-lightbox-header {\n${chrome}\n}`;
}
