// Text helpers for remark mode (src/runtime/remark.js): how a marked block is named and quoted.
// A plain ES module for tests; the page gets it with its `export` keyword dropped (src/runtime/compose.js).
// A block keeps its mark across `am patch` because the key is its panel, its tag and the start of its text, not its position.

const collapse = (text) => String(text).replace(/\s+/g, ' ').trim();

// The start of a block's text with whitespace collapsed: the readable identity of the block.
export function fingerprint(text, len = 80) {
  return collapse(text).slice(0, len);
}

// What the reply quotes of a block: the start of its text, with an ellipsis when it is cut.
export function quote(text, len = 60) {
  const t = collapse(text);
  return t.length > len ? `${t.slice(0, len).trimEnd()}…` : t;
}

// Two blocks with the same text (two identical list items) get the same base key. The n-th one in the page gets "\t<n>" added;
// a tab cannot be in a fingerprint, which has its whitespace collapsed, so the new key never meets another base key.
export function occurrenceKeys(bases) {
  const seen = new Map();
  return bases.map((base) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}\t${n}` : base;
  });
}
