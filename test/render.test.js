import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderDoc, RenderError } from '../src/render.js';
import { ParseError } from '../src/parse.js';
import { getTheme } from '../src/themes/registry.js';
import { COMPONENTS } from '../src/components/index.js';
import { md } from '../src/markdown.js';

const SRC = `---
title: 测试页
subtitle: 副标题
source: example.org
---
导语 **加粗**。

## A 表格 {span=2 meta="Section 3"}
| 形式 | 状态 |
|---|---|
| 命令式 | ok 已批准 |
| 进行时 | no |

## 原始块
\`\`\`html
<div class="raw-x">raw</div>
\`\`\`
\`\`\`python
print("<x>")
\`\`\`
`;

test('render: outputs a complete single-file HTML with theme attributes and viewport', () => {
  const { html, meta } = renderDoc(SRC);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="zh-CN" data-theme="blueprint" data-mode="auto" data-style="80">/);
  assert.match(html, /name="viewport"/);
  assert.equal(meta.template, 'sheet');
});

test('render: zero external dependencies, no scripts, styles or fonts loaded over http(s)', () => {
  const { html } = renderDoc(SRC);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.doesNotMatch(html, /@import|url\(\s*['"]?https?:/);
});

test('render: flow / sequence SVG styles have fallbacks when the theme context is lost', () => {
  const { html } = renderDoc('## 图\n```flow\nA -> *B: 请求\ngroup 服务: B\n```\n```sequence num\nA -> B: 请求\nnote A, B: 校验\n```');
  // After a previewer extracts the body, html[data-theme] no longer matches. Check every embedded SVG style rule
  // so no variable is missed in highlight, arrow, label, group or shared sequence styles.
  const selectors = [
    '.am-diagram svg', '.am-diagram text', '.am-node-shape',
    '.am-node--hi .am-node-shape', '.am-node--hi text', '.am-edge', '.am-arrow',
    '.am-edge-label rect', '.am-diagram .am-edge-label text', '.am-cluster',
    '.am-diagram .am-cluster-label', '.am-lifeline', '.am-actor', '.am-note',
    '.am-diagram .am-step',
  ];
  const { common, light } = getTheme('blueprint').tokens;
  const tokens = { ...common, ...light };
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = html.match(new RegExp(`${escaped} \\{([^}]+)\\}`))?.[1];
    assert.ok(rule, `${selector} style is embedded`);
    const vars = [...rule.matchAll(/var\(([^)]+)\)/g)];
    assert.ok(vars.length > 0);
    for (const [, value] of vars) {
      assert.match(value, /^--[\w-]+,\s*\S/, `${selector} ${value} needs a fallback`);
      // Color and stroke-width fallbacks are copied from the blueprint light theme; update them here when its tokens change.
      const [name, fallback] = value.split(/,\s*/);
      if (/^[#\d]/.test(fallback)) assert.equal(fallback, tokens[name], `${selector} ${name} fallback must equal the blueprint light token`);
    }
  }
});

test('render: panel ID, title, meta and span take effect', () => {
  const { html } = renderDoc(SRC);
  assert.match(html, /id="panel-A" style="grid-column: span 2"/);
  assert.match(html, /<span class="am-panel-meta">Section 3<\/span>/);
  assert.match(html, /<h2>原始块<\/h2>/);
});

test('render: the header has title, subtitle, extra meta and intro', () => {
  const { html } = renderDoc(SRC);
  assert.match(html, /<h1>测试页<\/h1>/);
  assert.match(html, /am-sub">副标题/);
  assert.match(html, /<b>source<\/b>example.org/);
  assert.match(html, /<strong>加粗<\/strong>/);
});

test('render: status words in tables render as badges', () => {
  const { html } = renderDoc(SRC);
  assert.match(html, /am-status--ok"><span class="am-status-icon" aria-hidden="true">✓<\/span>已批准/);
  assert.match(html, /am-status--no/);
  assert.match(html, /am-table-wrap/);
});

test('render: a status word may be followed by inline HTML; only a leading word is a status', () => {
  const html = md('| a | b |\n|---|---|\n| ok shared with `page.js` | warn **slow** and *rare* |\n| no see [docs](https://x.org) | noted `x` |\n| uses ok `y` | ✓ |');
  assert.match(html, /<td><span class="am-status am-status--ok"><span class="am-status-icon" aria-hidden="true">✓<\/span>shared with <code>page.js<\/code><\/span><\/td>/);
  assert.match(html, /am-status--warn"><span class="am-status-icon" aria-hidden="true">!<\/span><strong>slow<\/strong> and <em>rare<\/em><\/span><\/td>/);
  assert.match(html, /am-status--no"><span class="am-status-icon" aria-hidden="true">✗<\/span>see <a href="https:\/\/x.org">docs<\/a><\/span><\/td>/);
  assert.match(html, /<td>noted <code>x<\/code><\/td>/);
  assert.match(html, /<td>uses ok <code>y<\/code><\/td>/);
  assert.equal(html.match(/am-status--/g).length, 4);
});

test('render: html fences embed as is; unknown languages become escaped code blocks', () => {
  const { html } = renderDoc(SRC);
  assert.match(html, /<div class="raw-x">raw<\/div>/);
  assert.match(html, /<pre class="am-code"><code data-lang="python"><span class="am-ln">print\(&quot;&lt;x&gt;&quot;\)<\/span><\/code><\/pre>/);
});

test('render: the escaped source is embedded in a hidden textarea and reads back unchanged', () => {
  const src = '## A\n```html\n<script>x</script></textarea>\n```';
  const { html } = renderDoc(src);
  const embedded = html.match(/<textarea id="am-source" hidden readonly aria-hidden="true">([\s\S]*?)<\/textarea>/)[1];
  assert.doesNotMatch(embedded, /<\/?(script|textarea)/);
  const unescaped = embedded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal(unescaped, src);
});

test('render: the footer colophon links to the project and has the version, render time and a star link', () => {
  assert.match(renderDoc('## A\nx').html, /<footer class="am-colophon">Generated by <a href="https:\/\/github\.com\/QingYunA\/answer-me-with-html" target="_blank" rel="noopener">Answer me with HTML<\/a> \d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · <a href="https:\/\/github\.com\/QingYunA\/answer-me-with-html" target="_blank" rel="noopener">★ Star on GitHub<\/a><\/footer>/);
});

test('render: CLI overrides take effect and are validated', () => {
  const { html } = renderDoc(SRC, { theme: 'shadcn', template: 'doc' });
  assert.match(html, /data-theme="shadcn"/);
  assert.match(html, /class="am-doc"/);
  assert.throws(() => renderDoc(SRC, { theme: 'x' }), ParseError);
});

test('render: the doc template builds a table of contents with 3 or more panels', () => {
  const { html } = renderDoc('---\ntemplate: doc\n---\n## 一\na\n## 二\nb\n## 三\nc');
  assert.match(html, /<nav class="am-toc"/);
  assert.match(html, /href="#panel-C">C · 三/);
});

test('render: English drafts use English UI labels', () => {
  const { html } = renderDoc('# Hello world\n## A Overview\nThis is a plain English page about things.');
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Copy source/);
});

// Diagrams and the table of contents are named for screen readers in the page's language (#47).
const A11Y_DRAFT = (a, b, c) => `---\ntemplate: doc\n---\n## A ${a}\n\`\`\`flow\nClient -> Server\n\`\`\`\n## B ${b}\n\`\`\`sequence\nClient -> Server: hello\n\`\`\`\n## C ${c}\nx`;

test('render: aria-labels of diagrams and the table of contents follow the page language', () => {
  const en = renderDoc(A11Y_DRAFT('The request path', 'The handshake between them', 'Notes on what happens')).html;
  assert.match(en, /<nav class="am-toc" aria-label="Contents">/);
  assert.match(en, /aria-label="Flowchart: Client, Server"/);
  assert.match(en, /aria-label="Sequence diagram: Client, Server"/);

  const zh = renderDoc(A11Y_DRAFT('请求从客户端发出的路径', '客户端和服务器之间的握手过程', '关于整个过程的补充说明和注意事项')).html;
  assert.match(zh, /<nav class="am-toc" aria-label="目录">/);
  assert.match(zh, /aria-label="流程图：Client、Server"/);
  assert.match(zh, /aria-label="时序图：Client、Server"/);

  const ja = renderDoc(A11Y_DRAFT('クライアントから出るリクエストの流れ', 'クライアントとサーバーのあいだのハンドシェイクの手順', 'この流れについてのほかのメモと注意点')).html;
  assert.match(ja, /<html lang="ja"/);
  assert.match(ja, /<nav class="am-toc" aria-label="目次">/);
  assert.match(ja, /aria-label="フローチャート：Client、Server"/);
  assert.match(ja, /aria-label="シーケンス図：Client、Server"/);
});

test('render: a diagram rendered without a page context is named in English', () => {
  const uid = () => 'am1';
  assert.match(COMPONENTS.get('flow').render('A -> B', { args: '', uid }), /aria-label="Flowchart: A, B"/);
  assert.match(COMPONENTS.get('sequence').render('A -> B: hi', { args: '', uid }), /aria-label="Sequence diagram: A, B"/);
});

test('render: Japanese drafts use Japanese UI labels and lang="ja"', () => {
  const { html } = renderDoc('# TCP の接続\n## A 概要\n接続は3回のやりとりで行う。');
  assert.match(html, /<html lang="ja"/);
  assert.match(html, /原稿をコピー/);
  assert.match(html, /<label class="am-pick">テーマ<select data-am="theme">.*>図面<\/option>/);
  assert.doesNotMatch(html, /复制源稿/);
});

test('render: Japanese pages list Japanese fonts before Chinese fonts', () => {
  const { html } = renderDoc('# TCP の接続\n## A 概要\n接続は3回のやりとりで行う。');
  const rule = html.match(/html:lang\(ja\)\[data-theme\]\[data-mode\] \{[^}]*\}/)?.[0];
  assert.ok(rule, 'has a Japanese font rule');
  const fonts = rule.match(/--font-sans: ([^;]*);/)[1];
  assert.ok(fonts.indexOf('"Hiragino Sans"') < fonts.indexOf('"PingFang SC"'));
  assert.ok(fonts.indexOf('"Yu Gothic"') < fonts.indexOf('"Microsoft YaHei"'));
});

test('render: counts panels and components', () => {
  const { stats } = renderDoc(SRC);
  assert.equal(stats.panels, 2);
});

test('RenderError: the type exists', () => {
  assert.equal(new RenderError('x', { line: 3 }).line, 3);
});

test('render: the rows attribute spans rows; the bare attribute removes the panel title bar', () => {
  const { html } = renderDoc('## A 高面板 {rows=2 span=2}\nx\n## B {bare}\ny');
  assert.match(html, /id="panel-A" style="grid-column: span 2; grid-row: span 2"/);
  assert.match(html, /<section class="am-panel am-panel--bare" id="panel-B">\n<div class="am-panel-body">/);
});

test('sheet: when the next panel does not fit, the current row is filled with no gap', async () => {
  const { fillRows } = await import('../src/templates/sheet.js');
  const P = (span) => ({ attrs: span ? { span } : {} });
  // cols=2: A(2) | B(1) C(2): C does not fit after B, so B grows to 2
  assert.deepEqual(fillRows([P(2), P(), P(2), P()], 2), [2, 2, 2, 2]);
  // cols=3: A(1) B(1) C(2): A B take 2, C does not fit, B grows to 2; C(2) is the last row and grows to 3
  assert.deepEqual(fillRows([P(), P(), P(2)], 3), [1, 2, 3]);
  // Unchanged when the row is exactly full
  assert.deepEqual(fillRows([P(), P(2), P(3)], 3), [1, 2, 3]);
  // No adjustment when rows spans rows: keep the author's layout
  assert.deepEqual(fillRows([{ attrs: { rows: 2 } }, P(), P(2)], 3), [1, 1, 2]);
});

test('sheet: the automatic widening shows in the rendered output', () => {
  const { html } = renderDoc('---\ncols: 2\n---\n## A {span=2}\nx\n## B\ny\n## C {span=2}\nz');
  assert.match(html, /id="panel-B" style="grid-column: span 2"/);
});

test('isJapanese: a short Chinese sentence with only katakana is not Japanese; a short Japanese sentence with hiragana is', async () => {
  const { isJapanese } = await import('../src/svg/text.js');
  assert.equal(isJapanese('我们的项目的《ワンピース》很重要。'), false);
  assert.equal(isJapanese('今日は天気がいいです。'), true);
  assert.equal(isJapanese('東京へ行く。'), true);
});

test('table: headers of right-aligned / centered columns follow align instead of the th default left alignment (#28)', () => {
  const { html } = renderDoc('## A\n| 名 | 数 | 中 |\n| :--- | ---: | :---: |\n| a | 1 | x |\n');
  assert.match(html, /<th align="right">数<\/th>/);
  assert.match(html, /<th align="center">中<\/th>/);
  assert.match(html, /\.am-md th\[align="right"\] \{ text-align: right; \}/);
  assert.match(html, /\.am-md th\[align="center"\] \{ text-align: center; \}/);
});

test('render: diagram lightbox and pan-zoom viewer has complete styles, runtime, print rules and zero external deps', () => {
  const src = `---
title: Diagram test
---
## Flow
\`\`\`flow LR
(Client) -> (Gateway): request
(Gateway) -> (Service): forward
\`\`\`

## Sequence
\`\`\`sequence
Alice -> Bob: hello
Bob --> Alice: reply
\`\`\`
`;
  const { html } = renderDoc(src);
  assert.match(html, /\.am-diagram-expand\b/);
  assert.match(html, /\.am-lightbox\b/);
  assert.match(html, /\.am-lightbox-stage\b/);
  assert.doesNotMatch(html, /\.am-lightbox-bar\b/);
  assert.doesNotMatch(html, /\.am-lightbox-scale\b/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.match(html, /@media print\s*\{[^}]*\.am-diagram-expand/);
  assert.match(html, /@media print\s*\{[^}]*\.am-lightbox/);
  assert.match(html, /display:\s*none\s*!important/);
  assert.match(html, /am-diagram-expand/);
  assert.match(html, /am-lightbox-stage/);
  assert.match(html, /setPointerCapture/);
});

test('render: diagram viewer labels follow the resolved page language and fallback', () => {
  const diagDraft = (lang) => `${lang ? `---\nlang: ${lang}\n---\n` : ''}## Diagram\n\`\`\`flow\nA -> B\n\`\`\`\n`;

  const zh = renderDoc(diagDraft('zh-CN')).html;
  assert.match(zh, /<div class="am-lightbox"[^>]*aria-label="图表查看"[^>]*data-expand="展开查看图表"/);
  assert.match(zh, /class="am-lightbox-close"[^>]*title="关闭"[^>]*aria-label="关闭"/);

  const hant = renderDoc(diagDraft('zh-TW')).html;
  assert.match(hant, /<div class="am-lightbox"[^>]*aria-label="圖表檢視"[^>]*data-expand="展開查看圖表"/);
  assert.match(hant, /class="am-lightbox-close"[^>]*title="關閉"[^>]*aria-label="關閉"/);

  const ja = renderDoc(diagDraft('ja')).html;
  assert.match(ja, /<div class="am-lightbox"[^>]*aria-label="ダイアグラム"[^>]*data-expand="拡大表示"/);
  assert.match(ja, /class="am-lightbox-close"[^>]*title="閉じる"[^>]*aria-label="閉じる"/);

  const en = renderDoc(diagDraft('en')).html;
  assert.match(en, /<div class="am-lightbox"[^>]*aria-label="Diagram viewer"[^>]*data-expand="Expand diagram"/);
  assert.match(en, /class="am-lightbox-close"[^>]*title="Close"[^>]*aria-label="Close"/);

  const fr = renderDoc(diagDraft('fr')).html;
  assert.match(fr, /<div class="am-lightbox"[^>]*aria-label="Diagram viewer"[^>]*data-expand="Expand diagram"/);
  assert.match(fr, /class="am-lightbox-close"[^>]*title="Close"[^>]*aria-label="Close"/);

  const noDiag = renderDoc('## Plain\nNo diagrams here.\n').html;
  assert.doesNotMatch(noDiag, /<div class="am-lightbox"/);
});


test('render: diagram lightbox behavior — expand opens dialog, Esc, close button and backdrop close it', () => {
  const code = readFileSync(new URL('../src/runtime/page.js', import.meta.url), 'utf8');

  class MockClassList {
    constructor(el) { this.el = el; }
    add(c) {
      const list = this.values();
      if (!list.includes(c)) list.push(c);
      this.el.setAttribute('class', list.join(' '));
    }
    remove(c) {
      const list = this.values().filter((x) => x !== c);
      this.el.setAttribute('class', list.join(' '));
    }
    contains(c) { return this.values().includes(c); }
    values() { return (this.el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean); }
  }

  class MockElement {
    constructor(tagName = 'div', doc) {
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = doc;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.classList = new MockClassList(this);
      this._textContent = '';
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(val) { this.setAttribute('class', val); }
    get id() { return this.getAttribute('id') || ''; }
    set id(val) { this.setAttribute('id', val); }
    get textContent() {
      if (this._textContent) return this._textContent;
      return this.children.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      this.children = [];
      this._textContent = val;
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    setAttribute(name, val) { this.attributes.set(name, String(val)); }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(fn);
    }
    removeEventListener(ev, fn) {
      const list = this.listeners.get(ev);
      if (list) this.listeners.set(ev, list.filter((f) => f !== fn));
    }
    dispatchEvent(event) {
      event.target = this;
      for (const fn of this.listeners.get(event.type) || []) fn(event);
      return true;
    }
    click() {
      this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
    }
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') continue;
        n.parentElement = this;
        this.children.push(n);
      }
    }
    prepend(...nodes) {
      for (const n of nodes) {
        n.parentElement = this;
        this.children.unshift(n);
      }
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
    }
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    matches(sel) {
      if (sel.includes(':not(')) {
        const [base, notPart] = sel.split(':not(');
        const inner = notPart.replace(/\)$/, '');
        return (base ? this.matches(base) : true) && !this.matches(inner);
      }
      if (sel === '*') return true;
      if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
      if (sel.startsWith('#')) return this.id === sel.slice(1);
      if (sel.startsWith('[')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)(?:([*~|^$]?=)"?([^"]*)"?)?\]/);
        if (m) {
          const val = this.getAttribute(m[1]);
          if (val === null) return false;
          const op = m[2];
          const expected = m[3];
          if (!op) return true;
          if (op === '=') return val === expected;
          if (op === '*=') return val.includes(expected);
          if (op === '^=') return val.startsWith(expected);
          if (op === '$=') return val.endsWith(expected);
        }
      }
      return this.tagName.toLowerCase() === sel.toLowerCase();
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      if (sel.includes(',')) {
        const subSelectors = sel.split(',').map((s) => s.trim());
        const set = new Set();
        for (const sub of subSelectors) {
          for (const el of this.querySelectorAll(sub)) set.add(el);
        }
        return [...set];
      }
      const parts = sel.trim().split(/\s+/);
      if (parts.length > 1) {
        let current = [this];
        for (const part of parts) {
          const next = [];
          for (const el of current) next.push(...el.querySelectorAll(part));
          current = next;
        }
        return current;
      }
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.matches(sel)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    cloneNode(deep) {
      const clone = new MockElement(this.tagName, this.ownerDocument);
      for (const [k, v] of this.attributes) clone.setAttribute(k, v);
      if (deep) {
        for (const child of this.children) clone.append(child.cloneNode(true));
      }
      return clone;
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    set innerHTML(html) {
      this.children = [];
      if (!html) return;
      const re = /<([a-z0-9_-]+)([^>]*)>(?:([\s\S]*?)<\/\1>)?|<([a-z0-9_-]+)([^>]*)\/>/gi;
      let match;
      while ((match = re.exec(html)) !== null) {
        const tag = match[1] || match[4];
        const rawAttrs = match[2] || match[5] || '';
        const content = match[3] || '';
        const child = new MockElement(tag, this.ownerDocument);
        const attrRe = /([a-z0-9_-]+)(?:="([^"]*)")?/gi;
        let amatch;
        while ((amatch = attrRe.exec(rawAttrs)) !== null) {
          child.setAttribute(amatch[1], amatch[2] !== undefined ? amatch[2] : '');
        }
        if (content) child.innerHTML = content;
        this.append(child);
      }
    }
  }

  const doc = {
    activeElement: null,
    body: null,
    documentElement: null,
    createElement(tag) { return new MockElement(tag, doc); },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
  };
  doc.documentElement = new MockElement('html', doc);
  doc.body = new MockElement('body', doc);
  doc.documentElement.append(doc.body);

  const win = {
    listeners: new Map(),
    addEventListener(ev, fn) {
      if (!win.listeners.has(ev)) win.listeners.set(ev, []);
      win.listeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      const list = win.listeners.get(ev);
      if (list) win.listeners.set(ev, list.filter((f) => f !== fn));
    },
    dispatchEvent(event) {
      for (const fn of win.listeners.get(event.type) || []) fn(event);
      return true;
    },
  };

  const panel = doc.createElement('div');
  panel.className = 'am-panel';
  const panelHead = doc.createElement('div');
  panelHead.className = 'am-panel-head';
  const h2 = doc.createElement('h2');
  h2.textContent = 'Architecture Flow';
  panelHead.append(h2);
  panel.append(panelHead);

  const diag = doc.createElement('div');
  diag.className = 'am-diagram';
  const svg = doc.createElement('svg');
  svg.setAttribute('viewBox', '0 0 400 200');
  const marker = doc.createElement('marker');
  marker.id = 'arrow';
  const path = doc.createElement('path');
  path.setAttribute('marker-end', 'url(#arrow)');
  svg.append(marker);
  svg.append(path);
  diag.append(svg);
  panel.append(diag);
  doc.body.append(panel);

  const lb = doc.createElement('div');
  lb.className = 'am-lightbox';
  lb.setAttribute('hidden', '');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-label', 'Diagram viewer');
  lb.setAttribute('data-expand', 'Expand diagram');
  lb.innerHTML = `
    <div class="am-lightbox-backdrop"></div>
    <div class="am-lightbox-header">
      <div class="am-lightbox-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
        <span class="am-lightbox-title-text"></span>
      </div>
      <div class="am-lightbox-actions">
        <button class="am-lightbox-close" data-action="close" title="Close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="am-lightbox-stage">
      <div class="am-lightbox-canvas am-diagram"></div>
    </div>
  `;
  doc.body.append(lb);

  const sandbox = { document: doc, window: win, root: doc.documentElement, console, parseFloat, Math };
  vm.runInNewContext(code, sandbox);

  const expandBtn = diag.querySelector('.am-diagram-expand');
  assert.ok(expandBtn, 'expand button was appended to diagram');
  assert.equal(lb.querySelector('.am-lightbox-canvas .am-diagram-expand'), null, 'canvas has no expand button');
  assert.equal(lb.hasAttribute('hidden'), true, 'lightbox starts hidden');

  // 1. Click expand -> opens lightbox and clones SVG with deduplicated marker IDs
  expandBtn.click();
  assert.equal(lb.hasAttribute('hidden'), false, 'lightbox opens after clicking expand');
  assert.equal(doc.activeElement?.className, 'am-lightbox-close', 'focus moves to close button');
  const clonedSvg = lb.querySelector('.am-lightbox-canvas svg');
  assert.ok(clonedSvg, 'svg is cloned into lightbox canvas');
  const clonedMarker = clonedSvg.querySelector('[id*="-lb-"]');
  assert.ok(clonedMarker, 'marker ID was deduplicated to avoid collisions');
  assert.match(clonedSvg.querySelector('path').getAttribute('marker-end'), /url\(#arrow-lb-\d+\)/);

  // 2. Wheel zoom scales continuously based on deltaY
  const stage = lb.querySelector('.am-lightbox-stage');
  const canvas = lb.querySelector('.am-lightbox-canvas');
  const initTransform = canvas.style.transform;
  stage.dispatchEvent({ type: 'wheel', deltaY: 80, deltaMode: 0, clientX: 400, clientY: 300, preventDefault() {} });
  const zoomedOutTransform = canvas.style.transform;
  assert.notEqual(initTransform, zoomedOutTransform, 'canvas scale changes on wheel');

  // 3. Pointer drag pans canvas, second pointer is ignored
  stage.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  assert.ok(stage.classList.contains('am-panning'), 'panning class added during drag');
  stage.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 2, clientX: 200, clientY: 200 });
  stage.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 130, clientY: 140 });
  assert.match(canvas.style.transform, /translate3d\(.*px,.*px, 0\)/);
  stage.dispatchEvent({ type: 'pointerup', pointerId: 1 });
  assert.equal(stage.classList.contains('am-panning'), false, 'panning class removed after pointerup');

  // 4. Focus trap keeps Tab inside modal
  const closeBtn = lb.querySelector('.am-lightbox-close');
  closeBtn.focus();
  let defaultPrevented = false;
  lb.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true, 'Tab default is prevented when focus would escape');

  // 5. Press Escape -> closes lightbox
  win.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(lb.hasAttribute('hidden'), true, 'lightbox closes on Escape');

  // 6. Click expand again, then close button -> closes
  expandBtn.click();
  assert.equal(lb.hasAttribute('hidden'), false);
  closeBtn.click();
  assert.equal(lb.hasAttribute('hidden'), true, 'lightbox closes on close button click');

  // 7. Click expand again, then backdrop -> closes
  expandBtn.click();
  assert.equal(lb.hasAttribute('hidden'), false);
  const backdrop = lb.querySelector('.am-lightbox-backdrop');
  backdrop.click();
  assert.equal(lb.hasAttribute('hidden'), true, 'lightbox closes on backdrop click');
});
