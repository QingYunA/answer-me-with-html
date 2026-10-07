// Structure tree (figure A): indentation shows hierarchy. A single root with 2–4 children draws an org chart; otherwise an indented list with connectors.
import { mdInline } from '../markdown.js';
import { ComponentError, fields } from './error.js';
import { esc } from '../svg/text.js';
import { splitMarker, markState, deltaAttr, deltaBadge, withDelta } from './delta.js';

export default {
  name: 'tree',
  summary: 'Hierarchy tree (org chart / indented list)',
  syntax: `\`\`\`tree [list]
Root | subtitle
  Child
    Grandchild | one-line note
  *Highlighted child
\`\`\`
- Indentation (spaces or tabs) sets the level; "label | note" adds a gray note.
- One root with 2 to 4 children → org chart; more children or the list argument → indented list; several roots → side by side.
- Labels support inline Markdown, such as \`Section 1\` Words.
- Change markers show what a plan adds, removes and changes. A line can start with + (added), - (removed) or ~ (changed), followed by a space, after the indentation:
\`\`\`tree list
src/
  components/
    + delta.js | parses change markers
    ~ flow.js
    ~ tree.js
  - legacy/
    old-flow.js
\`\`\`
  - Indentation still sets the level. The children of a + or - node inherit it; a child that carries a different marker is an error. ~ marks one node and is not inherited.
  - Added is drawn in the theme's ok color, removed faded with a struck-through label, changed with a warn outline, and each marked node gets a +, − or ~ badge. A count row and a Before / Changes / After switch sit under the tree.
  - A line that starts with a marker and a space is always read as a marker. To keep a label that starts with "- ", write \\- item.`,
  example: '```tree\nASD-STE100 | Simplified Technical English\n  Part 1: Writing rules\n    `Section 1` Words\n  Part 2: Dictionary\n    Approved words | one word, one meaning\n```',
  render(text, { args, ui, video }) {
    const roots = buildTree(text);
    if (!roots.length) throw new ComponentError('tree needs at least one node', 1);
    return withDelta(treeHtml(roots, /\blist\b/.test(args), ui), statesOf(roots), { ui, video });
  },
};

function treeHtml(roots, listMode, ui) {
  if (roots.length === 1) {
    const [root] = roots;
    const n = root.children.length;
    if (!listMode && n >= 2 && n <= 4) return orgHtml(root, ui);
    return `<div class="am-tree">${rootBox(root, ui, true)}${listHtml(root.children, ui)}</div>`;
  }
  if (!listMode && roots.length <= 4) {
    return `<div class="am-tree"><div class="am-tree-cols am-tree-cols--free" style="--n: ${roots.length}">${roots.map((n) => colHtml(n, ui)).join('')}</div></div>`;
  }
  return `<div class="am-tree">${listHtml(roots, ui)}</div>`;
}

const statesOf = (nodes) => nodes.flatMap((n) => [n.state, ...statesOf(n.children)]);

function buildTree(text) {
  const roots = [];
  const stack = [];
  let step = 0;
  String(text).split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const indent = raw.replace(/\t/g, '  ').match(/^ */)[0].length;
    const node = { ...parseLabel(raw.trim()), indent, step: step++, line: i + 1, children: [] };
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    (stack.length ? stack.at(-1).children : roots).push(node);
    stack.push(node);
  });
  return roots.map((root) => settle(root, null));
}

// The state of a node: its own marker, or the + or - of the node above it. A marker that contradicts an inherited one is an error.
// Only + and - are inherited; ~ marks one node.
function settle(node, inherited) {
  const own = markState(node.mark);
  if (inherited && own && own !== inherited) {
    throw new ComponentError(`tree: "${node.mark}" under a ${inherited} node contradicts it. The children of a ${inherited} node are ${inherited} too; remove the marker or move the node`, node.line);
  }
  const state = inherited ?? own;
  const below = state === 'added' || state === 'removed' ? state : null;
  return { ...node, state, children: node.children.map((child) => settle(child, below)) };
}

// A backslash in front of a marker (\\- item) keeps it as text; a marker without a following space is text already.
function parseLabel(t) {
  const escaped = /^\\[+\-~] /.test(t);
  const { mark, text } = escaped ? { mark: null, text: t.slice(1) } : splitMarker(t);
  const hi = text.startsWith('*');
  const [label, sub = ''] = fields(hi ? text.slice(1) : text);
  return { label, sub, hi, mark };
}

// When a label starts with inline code followed by text (e.g. `Section 1` Words), the code part becomes a grey number tag.
const labelHtml = (label) => mdInline(label).replace(/^<code>([^<]*)<\/code>(?=\s*\S)/, '<span class="am-tree-tag">$1</span>');

// data-key / data-step are for video mode: same-named nodes morph across scenes, appearing step by step by source line.
// data-delta is the node's change state; the root wrapper and the column carry it too, so a view can hide their connector lines with the node.
const vattrs = (n) => ` data-key="${esc(n.label)}" data-step="${n.step}"${deltaAttr(n.state)}`;

const boxInner = (n, ui) => `${deltaBadge(n.state, ui)}${labelHtml(n.label)}${n.sub ? `<small>${mdInline(n.sub)}</small>` : ''}`;

function rootBox(root, ui, solo = false) {
  return `<div class="am-tree-root${solo ? ' am-tree-root--solo' : ''}"${deltaAttr(root.state)}><div class="am-tree-box am-tree-box--root"${vattrs(root)}>${boxInner(root, ui)}</div></div>`;
}

function colHtml(node, ui) {
  const children = node.children.length ? listHtml(node.children, ui) : '';
  return `<div class="am-tree-col"${deltaAttr(node.state)}><div class="am-tree-box${node.hi ? ' am-tree-box--hi' : ''}"${vattrs(node)}>${boxInner(node, ui)}</div>${children}</div>`;
}

function orgHtml(root, ui) {
  return `<div class="am-tree">${rootBox(root, ui)}<div class="am-tree-cols" style="--n: ${root.children.length}">${root.children.map((n) => colHtml(n, ui)).join('')}</div></div>`;
}

function listHtml(nodes, ui) {
  return `<ul class="am-tree-list">${nodes.map((n) => liHtml(n, ui)).join('')}</ul>`;
}

function liHtml(n, ui) {
  const sub = n.sub ? `<span class="am-tree-sub">${mdInline(n.sub)}</span>` : '';
  const kids = n.children.length ? `<ul>${n.children.map((c) => liHtml(c, ui)).join('')}</ul>` : '';
  return `<li${n.hi ? ' class="am-tree-hi"' : ''}${vattrs(n)}><span class="am-tree-label">${deltaBadge(n.state, ui)}${labelHtml(n.label)}</span>${sub}${kids}</li>`;
}
