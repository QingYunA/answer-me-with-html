// A host can serve a page inside its own document, so the real <html> has none of the page's settings (lang, theme, mode, style).
// The page then must restore them from the carrier attributes on its toolbar before the runtime reads the root.
// These tests parse the rendered markup into a small fake DOM and run the page's own emitted script against it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderDoc } from '../src/render.js';

const ROOT_ATTRS = ['lang', 'data-theme', 'data-mode', 'data-style'];
const carrier = (attr) => (attr === 'lang' ? 'data-am-root-lang' : attr.replace(/^data-/, 'data-am-root-'));

// ── Fake DOM: a markup parser plus the few element methods the page runtime uses ──────────────────────────────

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'col', 'source', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.text = '';
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this._value = '';
  }
  get id() { return this.attrs.get('id') ?? ''; }
  set id(v) { this.attrs.set('id', v); }
  set className(v) { this.attrs.set('class', v); }
  get className() { return this.attrs.get('class') ?? ''; }
  set title(v) { this.attrs.set('title', v); }
  set type(v) { this.attrs.set('type', v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { el.className = [...new Set([...list(), c])].join(' '); },
      remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
    };
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  prepend(n) { n.parent = this; this.children.unshift(n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.text = String(v); this.children = []; }
  set innerHTML(html) { this.children = []; this.text = ''; parseInto(this, String(html)); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  dispatch(type) { for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this }); }
  focus() {}
  closest(sel) { for (let e = this; e; e = e.parent) if (matchesCompound(e, sel)) return e; return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  cloneNode() { return Object.assign(new El(this.tagName), { attrs: new Map(this.attrs) }); }
  // A <select> value follows the real DOM: it is the selected option's value, and a value no option has selects nothing.
  get value() {
    if (this.tagName !== 'SELECT') return this._value;
    const options = this.querySelectorAll('option');
    if (this._picked !== undefined) return this._picked;
    return (options.find((o) => o.hasAttribute('selected')) ?? options[0])?.getAttribute('value') ?? '';
  }
  set value(v) {
    if (this.tagName !== 'SELECT') { this._value = String(v); return; }
    this._picked = this.querySelectorAll('option').some((o) => o.getAttribute('value') === String(v)) ? String(v) : '';
  }
  querySelectorAll(sel) {
    const out = new Set();
    for (const group of sel.split(',')) {
      let scope = [this];
      for (const part of group.trim().split(/\s+/)) {
        const next = [];
        for (const s of scope) walk(s, (e) => { if (matchesCompound(e, part)) next.push(e); });
        scope = next;
      }
      for (const e of scope) out.add(e);
    }
    return [...out];
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

function walk(el, fn) { for (const c of el.children) { fn(c); walk(c, fn); } }

// tag, #id, .class and [attr] / [attr="value"] in any combination. Anything else is an error, so a new selector fails loudly here.
function matchesCompound(el, sel) {
  const re = /^([a-z0-9-]+|\*)?((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i;
  const m = sel.match(re);
  assert.ok(m, `fake DOM does not support selector ${sel}`);
  if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
  for (const [, kind, name, val] of m[2].matchAll(/([.#]|\[)([\w-]+)(?:="([^"]*)")?\]?/g)) {
    if (kind === '.' && !el.classList.contains(name)) return false;
    if (kind === '#' && el.id !== name) return false;
    if (kind === '[' && (!el.hasAttribute(name) || (val !== undefined && el.getAttribute(name) !== val))) return false;
  }
  return true;
}

function parseInto(parent, html) {
  const tok = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/gi;
  let cur = parent;
  for (let m; (m = tok.exec(html));) {
    if (m[1]) {
      for (let e = cur; e && e !== parent; e = e.parent) if (e.tagName === m[1].toUpperCase()) { cur = e.parent; break; }
    } else if (m[2]) {
      const el = new El(m[2]);
      let rawAttrs = m[3];
      const selfClosed = /\/\s*$/.test(rawAttrs);
      if (selfClosed) rawAttrs = rawAttrs.replace(/\/\s*$/, '');
      for (const a of rawAttrs.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
      cur.append(el);
      const tag = m[2].toLowerCase();
      if (RAW.has(tag) && !selfClosed) {
        const end = html.toLowerCase().indexOf(`</${tag}`, tok.lastIndex);
        el.text = html.slice(tok.lastIndex, end);
        tok.lastIndex = html.indexOf('>', end) + 1;
      } else if (!VOID.has(tag) && !selfClosed) cur = el;
    } else if (m[4]) cur.text += m[4];
  }
}

// The document as a host-less browser would build it from the page markup, plus the one place the runtime is run.
function load(html) {
  const holder = new El('#document');
  parseInto(holder, html);
  const root = holder.children[0];
  assert.equal(root.tagName, 'HTML');
  const body = root.children.find((c) => c.tagName === 'BODY');
  const document = {
    documentElement: root,
    body,
    createElement: (tag) => new El(tag),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  const window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const script = root.querySelectorAll('script').at(-1).text;
  return {
    root,
    document,
    toolbar: root.querySelector('.am-toolbar'),
    select: (name) => root.querySelector(`select[data-am="${name}"]`),
    run: () => vm.runInNewContext(script, { document, window, console, Math, parseFloat, Number, Map, setTimeout }),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────

const FLOW = '```flow LR\nA -> B: go\nB -> *C: done\n```\n';
// The sheet has one panel: with two or more, the layout planner runs and needs a real browser's measurements.
const draftOf = (template, head) => `---\ntemplate: ${template}\n${head}\n---\nIntro text.\n\n## A Flow\n${FLOW}`;
const NON_DEFAULT = 'lang: ja\ntheme: blueprint\nmode: dark\nstyle: off';
const NON_DEFAULT_VALUES = { lang: 'ja', 'data-theme': 'blueprint', 'data-mode': 'dark', 'data-style': 'off' };
const ENGLISH = 'lang: en';

const page = (template, head) => renderDoc(draftOf(template, head)).html;
const stripRoot = (p) => { for (const a of ROOT_ATTRS) p.root.removeAttribute(a); };

for (const template of ['sheet', 'doc']) {
  test(`${template}: the toolbar carries the root settings written on <html>`, () => {
    const p = load(page(template, NON_DEFAULT));
    assert.ok(p.toolbar, 'a real .am-toolbar element is in the markup');
    for (const attr of ROOT_ATTRS) {
      assert.equal(p.root.getAttribute(attr), NON_DEFAULT_VALUES[attr], `<html ${attr}>`);
      assert.equal(p.toolbar.getAttribute(carrier(attr)), p.root.getAttribute(attr), carrier(attr));
    }
  });

  test(`${template}: the runtime restores all four settings on a root without them, and the pickers show them`, () => {
    const p = load(page(template, NON_DEFAULT));
    stripRoot(p);
    for (const a of ROOT_ATTRS) assert.equal(p.root.hasAttribute(a), false);
    p.run();
    for (const attr of ROOT_ATTRS) assert.equal(p.root.getAttribute(attr), NON_DEFAULT_VALUES[attr], attr);
    assert.equal(p.select('theme').value, 'blueprint');
    assert.equal(p.select('mode').value, 'dark');
  });

  test(`${template}: after the restore, the pickers drive the root`, () => {
    const p = load(page(template, NON_DEFAULT));
    stripRoot(p);
    p.run();
    p.select('theme').value = 'paper';
    p.select('theme').dispatch('change');
    assert.equal(p.root.getAttribute('data-theme'), 'paper');
    p.select('mode').value = 'light';
    p.select('mode').dispatch('change');
    assert.equal(p.root.getAttribute('data-mode'), 'light');
  });

  for (const kept of ROOT_ATTRS) {
    const conflict = { lang: 'fr', 'data-theme': 'paper', 'data-mode': 'light', 'data-style': '80' }[kept];
    test(`${template}: an existing root ${kept} is kept, the other three are filled`, () => {
      const p = load(page(template, NON_DEFAULT));
      stripRoot(p);
      p.root.setAttribute(kept, conflict);
      p.run();
      for (const attr of ROOT_ATTRS) {
        assert.equal(p.root.getAttribute(attr), attr === kept ? conflict : NON_DEFAULT_VALUES[attr], attr);
      }
    });

    test(`${template}: an existing empty root ${kept} counts as present and is kept`, () => {
      const p = load(page(template, NON_DEFAULT));
      stripRoot(p);
      p.root.setAttribute(kept, '');
      p.run();
      for (const attr of ROOT_ATTRS) {
        assert.equal(p.root.getAttribute(attr), attr === kept ? '' : NON_DEFAULT_VALUES[attr], attr);
      }
    });
  }

  test(`${template}: a standalone page with a full root is unchanged by the runtime`, () => {
    const p = load(page(template, NON_DEFAULT));
    const before = [...p.root.attrs];
    p.run();
    assert.deepEqual([...p.root.attrs], before);
    assert.equal(p.select('theme').value, 'blueprint');
    assert.equal(p.select('mode').value, 'dark');
  });

  test(`${template}: a full root that differs from the carriers keeps its own values`, () => {
    const p = load(page(template, NON_DEFAULT));
    const other = { lang: 'fr', 'data-theme': 'paper', 'data-mode': 'light', 'data-style': '80' };
    for (const [a, v] of Object.entries(other)) p.root.setAttribute(a, v);
    p.run();
    for (const [a, v] of Object.entries(other)) assert.equal(p.root.getAttribute(a), v, a);
  });

  test(`${template}: the diagram labels are in the page language even when the root lost its lang`, () => {
    const p = load(page(template, ENGLISH));
    stripRoot(p);
    p.run();
    const expand = p.root.querySelector('.am-diagram-expand');
    assert.ok(expand, 'the diagram has an expand button');
    assert.equal(expand.getAttribute('aria-label'), 'Expand diagram');
    assert.equal(p.root.querySelector('.am-lightbox').getAttribute('aria-label'), 'Diagram Viewer');
  });

  test(`${template}: an older page without carrier attributes runs and leaves the root alone`, () => {
    const p = load(page(template, NON_DEFAULT));
    for (const attr of ROOT_ATTRS) p.toolbar.removeAttribute(carrier(attr));
    stripRoot(p);
    assert.doesNotThrow(() => p.run());
    for (const attr of ROOT_ATTRS) assert.equal(p.root.hasAttribute(attr), false, attr);
  });

  test(`${template}: a page with no toolbar runs and leaves the root alone`, () => {
    const p = load(page(template, NON_DEFAULT));
    p.toolbar.remove();
    stripRoot(p);
    assert.doesNotThrow(() => p.run());
    for (const attr of ROOT_ATTRS) assert.equal(p.root.hasAttribute(attr), false, attr);
  });
}
