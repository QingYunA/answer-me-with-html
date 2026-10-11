// How a formula reads in a quote. MathML has no plain text, so src/math.js writes the formula as the draft wrote it, delimiters included, in
// data-am-tex on the <math> element, and the Remark and Reply scripts read page text through this file. On a page without math there is no
// such element, so formulaOf is null and every text comes out as it did before.
// A plain ES module for tests; the page gets it with its `export` keyword dropped (src/runtime/compose.js).

const TEX = 'data-am-tex';

// The formula that holds a node, or null.
export const formulaOf = (node) => node.parentElement?.closest(`[${TEX}]`) ?? null;

const firstText = (el) => {
  for (const child of el.childNodes) {
    const found = child.nodeType === 3 ? child : firstText(child);
    if (found) return found;
  }
  return null;
};

// What a text node adds to a quote: its data. The first text node of a formula adds the formula, and the others add nothing.
// (A formula in an error style is plain text with its delimiters, not a <math>, so it comes out once.)
export function nodeText(node) {
  const math = formulaOf(node);
  if (!math) return node.data;
  return firstText(math) === node ? math.getAttribute(TEX) : '';
}

// The text of a node as textContent reads it, but with each formula as written.
export const textWithMath = (node) => (node.nodeType === 3 ? nodeText(node) : [...node.childNodes].map(textWithMath).join(''));
