// STE 受控写作检查（只约束稿件里的说明文字）。
// 规则：句长、段长、非推荐词、英文被动语态、中文虚动词 / "的"字连用 / 套话。全部为警告，严格度由 style 决定。
// 含假名的日文只查句长与段长：日文的"的"是后缀（基本的、具体的），不是中文的结构助词。
// 跳过：代码与行内代码、~~删除线~~（反例展示）、含 no 状态的表格行、标题、除 callout 外的组件。

import { EN_WORDS } from './wordlist.en.js';
import { ZH_LIGHT_VERBS, ZH_CLICHES } from './wordlist.zh.js';
import { isCJK, isJapanese } from '../svg/text.js';

const LIMITS = { zh: { procedural: 35, descriptive: 45 }, en: { procedural: 20, descriptive: 25 } };
const MAX_SENTENCES = 6;
const ABBR = /\b(e\.g|i\.e|etc|vs|cf|approx|Fig|No)\./gi;
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|known|done|made|given|taken|seen|written|built|shown|sent|kept|held|found|set|put|run|begun|chosen|driven|broken)\b/i;
const EN_RE = Object.entries(EN_WORDS)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([word, suggestion]) => ({ re: new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'gi'), word, suggestion }));

export function splitSentences(text) {
  const masked = text.replace(ABBR, (m) => m.replace(/\./g, '\u0000'));
  const parts = masked.match(/[^。！？；!?;]+?(?:[。！？；!?;]+|\.(?=\s|$)|$)|[^.]+?\.(?=\s|$)/g) ?? [];
  return parts.map((s) => s.replace(/\u0000/g, '.').trim()).filter(Boolean);
}

export function sentenceLength(sentence) {
  const cjk = [...sentence].filter(isCJK).filter((c) => !/[，。！？；：、（）「」『』“”‘’《》]/.test(c)).length;
  const words = sentence.match(/[A-Za-z0-9][\w'’-]*/g)?.length ?? 0;
  return cjk >= 4 || cjk > words ? { lang: 'zh', count: cjk + words } : { lang: 'en', count: words };
}

export function formatWarning(w) {
  return `L${w.line} [${w.rule}] ${w.message}${w.suggestion ? ` → ${w.suggestion}` : ''}`;
}

export function lintDoc(doc) {
  const warnings = [];
  const blocks = [...doc.intro, ...doc.panels.flatMap((p) => p.blocks)];
  for (const b of blocks) {
    if (b.type === 'md') lintMarkdown(b.text, b.line, warnings);
    else if (b.lang === 'callout') lintMarkdown(b.text, b.line + 1, warnings);
  }
  return warnings;
}

function clean(text) {
  return text
    .replace(/~~[^~]*~~/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_]{1,3}/g, '');
}

function lintMarkdown(text, startLine, out) {
  let para = null;
  const flush = () => {
    if (para && para.count > MAX_SENTENCES) {
      out.push({ line: para.line, rule: 'paragraph-length', message: `段落 ${para.count} 句（上限 ${MAX_SENTENCES}）` });
    }
    para = null;
  };
  let inHtml = false;
  text.split('\n').forEach((raw, i) => {
    const line = startLine + i;
    const t = raw.trim();
    if (/^<(div|svg|table|details|figure)/i.test(t)) inHtml = true;
    if (inHtml) {
      if (/<\/(div|svg|table|details|figure)>\s*$/i.test(t)) inHtml = false;
      return flush();
    }
    if (!t || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t)) return flush();
    if (t.startsWith('|')) {
      flush();
      if (/^\|?[\s:|-]+\|?$/.test(t)) return;
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.some((c) => /^(no|✗|✘)(\s|$)/.test(c))) return;
      cells.forEach((c) => checkUnit(clean(c.replace(/^(ok|warn|✓|✔|⚠)(\s|$)/, '')), line, 'descriptive', out));
      return;
    }
    const list = t.match(/^(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (list) {
      flush();
      checkUnit(clean(list[3]), line, list[2] ? 'procedural' : 'descriptive', out);
      return;
    }
    const body = clean(t.replace(/^>\s*/, ''));
    const n = checkUnit(body, line, 'descriptive', out);
    if (!para) para = { line, count: 0 };
    para.count += n;
  });
  flush();
}

// 检查一段文字（列表项 / 单元格 / 段落中的一行），返回句子数。
function checkUnit(text, line, kind, out) {
  const sentences = splitSentences(text);
  const ja = isJapanese(text);
  for (const s of sentences) {
    const { lang, count } = sentenceLength(s);
    const limit = LIMITS[lang][kind];
    if (count > limit) {
      const unit = lang === 'zh' ? '字' : 'words';
      const preview = s.length > 24 ? `${s.slice(0, 24)}…` : s;
      out.push({ line, rule: 'sentence-length', message: `${kind === 'procedural' ? '步骤' : '句子'} ${count} ${unit}（上限 ${limit}）："${preview}"` });
    }
    if (lang === 'en' && PASSIVE.test(s)) {
      out.push({ line, rule: 'passive', message: `疑似被动语态："${s.match(PASSIVE)[0]}"`, suggestion: '改为主动语态' });
    }
  }
  const lexical = [
    ...EN_RE.flatMap(({ re, suggestion }) => [...text.matchAll(re)].map((m) => ({ index: m.index, rule: 'word', message: `不推荐 "${m[0]}"`, suggestion }))),
    ...(ja ? [] : ZH_LIGHT_VERBS).flatMap(({ re, label }) => [...text.matchAll(re)].map((m) => ({ index: m.index, rule: 'word', message: `虚动词 "${m[0]}"（${label}）`, suggestion: `直接用「${m[1]}」` }))),
  ];
  out.push(...lexical.sort((a, b) => a.index - b.index).map(({ index, ...w }) => ({ line, ...w })));
  for (const s of sentences) {
    if (isJapanese(s)) continue;
    if ((s.match(/的/g) ?? []).length >= 3) out.push({ line, rule: 'de-chain', message: `"的"字连用：${s}`, suggestion: '拆句或删去多余的"的"' });
  }
  for (const c of ja ? [] : ZH_CLICHES) {
    if (text.includes(c)) out.push({ line, rule: 'cliche', message: `套话 "${c}"`, suggestion: '删除，或换成具体事实' });
  }
  return sentences.length;
}
