// Colors for am theme check: parse hex / rgb() / hsl() into [r, g, b, a] and measure WCAG contrast.

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN = /^(rgba?|hsla?)\(\s*([^)]*)\)$/i;

// Returns [r, g, b, a] with r, g, b in 0–255 and a in 0–1, or null when the value is not a color this check reads.
export function parseColor(value) {
  const v = String(value).trim();
  const hex = v.match(HEX);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2) || 'ff', 16));
    return [n[0], n[1], n[2], n[3] / 255];
  }
  const fn = v.match(FN);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (s, scale) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (fn[1].toLowerCase().startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((s) => num(s, 255));
    return [...rgb, alpha].some(Number.isNaN) ? null : [...rgb, alpha];
  }
  const [h, s, l] = [parseFloat(parts[0]), num(parts[1], 1), num(parts[2], 1)];
  if ([h, s, l, alpha].some(Number.isNaN)) return null;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255, alpha];
}

// A translucent color as seen over an opaque background.
const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];

const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

// Contrast of fg on bg; a translucent bg is first laid over base (the page paper).
export function contrast(fg, bg, base = [255, 255, 255, 1]) {
  const back = over(bg, base);
  const [x, y] = [luminance(over(fg, back)), luminance(back)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
