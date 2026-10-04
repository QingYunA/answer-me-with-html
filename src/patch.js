// 在源稿里替换一个 ## 面板。源稿由 page.js 的 readPage 从页面取回；写回由 CLI 覆盖原路径。

import { parseDoc } from './parse.js';

const ATTR_BLOCK = /\s*\{([^{}]*)\}\s*$/;

export class PatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchError';
  }
}

export function normalizePanelQuery(query) {
  let q = String(query ?? '').trim();
  if (q.startsWith('##')) q = q.replace(/^##\s*/, '');
  q = q.replace(ATTR_BLOCK, '').trim();
  return q;
}

function panelKeys(panel) {
  const title = panel.title.trim();
  const id = String(panel.id || '').trim();
  const keys = new Set([title]);
  if (id) {
    keys.add(id);
    if (title) keys.add(`${id} ${title}`);
  }
  return keys;
}

export function findPanel(doc, query) {
  const q = normalizePanelQuery(query);
  if (!q) throw new PatchError('缺少 --panel 标题');
  const matches = doc.panels.filter((p) => panelKeys(p).has(q));
  if (matches.length === 0) throw new PatchError(`没有找到标题为 "${query}" 的面板`);
  if (matches.length > 1) throw new PatchError(`标题 "${query}" 匹配到多个面板`);
  return matches[0];
}

function asSinglePanelMarkdown(replacement) {
  const text = String(replacement).replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new PatchError('新面板稿件为空');
  const looksLikeHeading = /^\s*##\s+/.test(text);
  const doc = parseDoc(looksLikeHeading ? text : `## _\n${text}`);
  if (doc.panels.length !== 1) throw new PatchError('新面板稿件必须只包含一个 ## 面板');
  return { text, looksLikeHeading };
}

export function replacePanel(source, query, replacement) {
  const doc = parseDoc(source);
  const panel = findPanel(doc, query);
  const idx = doc.panels.indexOf(panel);
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const start = panel.line - 1;
  const end = doc.panels[idx + 1] ? doc.panels[idx + 1].line - 1 : lines.length;

  const { text, looksLikeHeading } = asSinglePanelMarkdown(replacement);
  const section = looksLikeHeading ? text : `${lines[start]}\n${text.replace(/^\n+/, '')}`;
  const newLines = section.replace(/\n$/, '').split('\n');
  return [...lines.slice(0, start), ...newLines, ...lines.slice(end)].join('\n');
}
