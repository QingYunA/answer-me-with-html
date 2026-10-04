// SVG 布局在 Node 端完成，拿不到真实字体度量，只能按字符类别估算宽度。
// 估算偏宽比偏窄安全：宁可节点留白，也不要文字溢出边框。

const CJK_RE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯　-〿]/;
const NARROW = new Set([...'iljtfrI.,:;|!\'`()[]{}']);
const WIDE = new Set([...'mwMWOQGD@%&']);

// 平假名、片假名。
export const KANA_RE = /[\u3040-\u30ff]/;
// 判断日文看平假名：日文句子几乎都带平假名助词与词尾（の、は、を、です），
// 中文引用外来词时出现的基本只有片假名（如《ワンピース》），不能据此判为日文。
const HIRAGANA_RE = /[\u3040-\u309f]/;
const HIRAGANA_SHARE = 0.05; // 片假名为主的日文短标题（TCP の3ウェイ…）也能认出

export function isJapanese(text) {
  let hira = 0;
  let cjk = 0;
  for (const ch of String(text)) {
    if (HIRAGANA_RE.test(ch)) hira++;
    if (CJK_RE.test(ch)) cjk++;
  }
  return hira > 0 && hira / cjk >= HIRAGANA_SHARE;
}

export function isCJK(ch) {
  return CJK_RE.test(ch);
}

function charWidth(ch, mono) {
  if (isCJK(ch)) return 1;
  if (mono) return 0.6;
  if (ch === ' ') return 0.3;
  if (NARROW.has(ch)) return 0.32;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.56;
}

export function measure(str, size = 13, { mono = false } = {}) {
  let units = 0;
  for (const ch of String(str ?? '')) units += charWidth(ch, mono);
  return Math.round(units * size * 100) / 100;
}

// 切成不可再分的排版单元：一个汉字是一个单元，一段连续的非空白拉丁字符是一个单元。
function tokenize(str) {
  return String(str).match(/[⺀-鿿가-힯豈-﫿︰-﹏＀-￯　-〿]|[^\s⺀-鿿가-힯豈-﫿︰-﹏＀-￯　-〿]+|\s+/g) ?? [];
}

export function wrap(str, maxWidth, size = 13, opts = {}) {
  const lines = [];
  let line = '';
  for (const tok of tokenize(str)) {
    if (/^\s+$/.test(tok)) {
      if (line) line += ' ';
      continue;
    }
    const candidate = line + tok;
    if (line.trim() && measure(candidate, size, opts) > maxWidth) {
      lines.push(line.trimEnd());
      line = tok;
    } else {
      line = candidate;
    }
  }
  lines.push(line.trimEnd());
  return lines;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}
