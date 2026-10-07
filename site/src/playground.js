// Everything on the site that runs the real renderer (engine.js): the hero draft → page demo, the measured sizes,
// the playground, the component gallery, the theme comparison and the STE writing check.
import { copyText } from './main.js';

const root = document.documentElement;
const UI = JSON.parse(document.getElementById('site-ui').textContent);
const BASE = root.dataset.base || '';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kb = (n) => (n / 1024).toFixed(1);
const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));
const siteMode = () => (root.dataset.mode === 'dark' ? 'dark' : 'light');
const toast = (text) => dispatchEvent(new CustomEvent('site:toast', { detail: text }));
const whenNear = (el, fn, margin = '400px') => {
  if (!el) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: `${margin} 0px` });
  io.observe(el);
};

// ── Engine and presets, each loaded once ──
let enginePromise = null;
const engine = () => (enginePromise ??= import('./engine.js'));
let presetsPromise = null;
const presets = () => (presetsPromise ??= fetch(`${BASE}presets/index.json`).then((r) => {
  if (!r.ok) throw new Error(`presets/index.json: HTTP ${r.status}`);
  return r.json();
}));
// The Chinese page uses a <name>.zh variant when there is one.
const pick = (all, key) => (UI.lang === 'zh' && all[`${key}.zh`]) || all[key] || '';

// render() never throws for draft errors; a bug in the renderer becomes an error result too.
async function renderDraft(source, overrides) {
  const { render } = await engine();
  try {
    return render(source, overrides);
  } catch (err) {
    return { ok: false, ms: 0, error: { name: 'Error', message: String(err?.message || err) } };
  }
}

// ── Frames: rendered pages go into sandboxed srcdoc iframes. A small script reports the page height and scroll. ──
// Scaled previews hide the page's own toolbar and scrollbars, so the page fills its frame edge to edge.
const HIDE_CHROME = '.am-toolbar,.am-colophon{display:none!important}html{scrollbar-width:none}::-webkit-scrollbar{display:none}';

// ── Writing-check messages: the CLI writes them in English; the ui dictionary may give a translation. ──
// Each pattern reads the dynamic parts out of one message format of src/lint/ste.js; a message that matches none stays as it is.
const LINT_FORMATS = [
  ['sentence-length', /^(step|sentence) has (\d+) (words|characters) \(max (\d+)\): "([\s\S]*)"$/, (t, m) => fill(t.sentence, { kind: t.kinds[m[1]], count: m[2], unit: t.units[m[3]], limit: m[4], preview: m[5] })],
  ['paragraph-length', /^paragraph has (\d+) sentences \(max (\d+)\)$/, (t, m) => fill(t.paragraph, { count: m[1], max: m[2] })],
  ['passive', /^possible passive voice: "([\s\S]*)"$/, (t, m) => fill(t.passive, { x: m[1] })],
  ['word', /^not recommended: "([\s\S]*)"$/, (t, m) => fill(t.word, { x: m[1] })],
  ['word', /^light verb "([\s\S]*)" \(([^)]*)\)$/, (t, m) => fill(t.lightVerb, { x: m[1], label: m[2] })],
  ['de-chain', /^chained "的": ([\s\S]*)$/, (t, m) => fill(t.deChain, { s: m[1] })],
  ['cliche', /^cliché "([\s\S]*)"$/, (t, m) => fill(t.cliche, { x: m[1] })],
];
function localizeWarning(w) {
  const t = UI.lint;
  if (!t) return w;
  const format = LINT_FORMATS.find(([rule, re]) => rule === w.rule && re.test(w.message));
  const message = format ? format[2](t, w.message.match(format[1])) : w.message;
  let suggestion = w.suggestion;
  if (suggestion && t.suggestions[suggestion]) suggestion = t.suggestions[suggestion];
  else if (suggestion && w.rule === 'word') {
    const use = suggestion.match(/^use "([^"]+)"$/);
    suggestion = use ? fill(t.useWord, { x: use[1] }) : fill(t.replaceWith, { x: suggestion });
  }
  return { ...w, message, suggestion };
}
function framed(html, { id, css = '', scroll = 0 }) {
  const reporter = `<script>(function(){var id=${JSON.stringify(id)};var y=${Math.round(scroll)};` +
    'function s(){parent.postMessage({amFrame:id,h:Math.ceil(document.documentElement.scrollHeight),y:scrollY},"*")}' +
    'addEventListener("load",function(){if(y)scrollTo(0,y);s();setTimeout(s,300)});' +
    'addEventListener("scroll",function(){clearTimeout(window.__t);window.__t=setTimeout(s,120)},{passive:true});' +
    'if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)})()</script>';
  const style = css ? `<style>${css}</style>` : '';
  return html.replace('</head>', `${style}</head>`).replace(/<\/body>\s*<\/html>\s*$/, `${reporter}</body></html>`);
}
const frameListeners = new Map();
addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data.amFrame !== 'string') return;
  const fn = frameListeners.get(data.amFrame);
  if (fn) fn(data, e.source);
});

// Scale a fixed-width iframe to the width of its box.
function scaleToBox(frame, box, width) {
  const set = () => frame.style.setProperty('--s', String(box.clientWidth / width));
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(box);
}

// ── Light draft highlighting for the hero editor ──
function highlight(src) {
  let fence = false;
  let front = false;
  return src.split('\n').map((raw, i) => {
    const t = esc(raw);
    if (/^```/.test(raw)) { fence = !fence; return `<span class="hl-f">${t}</span>`; }
    if (/^---\s*$/.test(raw) && (i === 0 || front)) { front = !front; return `<span class="hl-m">${t}</span>`; }
    if (front) return t.replace(/^([\w-]+):/, '<span class="hl-k">$1</span>:');
    if (/^## /.test(raw)) return `<span class="hl-h">${t.replace(/(\{[^}]*\})/, '<span class="hl-a">$1</span>')}</span>`;
    if (fence) return t.replace(/(--?&gt;)/g, '<span class="hl-o">$1</span>').replace(/^(note|participants|group)\b/, '<span class="hl-k">$1</span>');
    return t;
  }).join('\n');
}

/* ════════════════ Hero: draft types itself, the engine renders it, the page plots in, then it loops ════════════════ */
// One run at a time: every run owns an AbortController, and every wait inside a run (animation frame, timer, iframe load)
// rejects as soon as that run is aborted, so Replay, the loop and visibility changes never leave a second run or a timer behind.
const TYPE_MS = 3200; // typing time, by the clock (not per frame), so the speed is the same at 60 and 120 Hz
const PLOT_MS = 1000;
const HOLD_MS = 5500;
const FADE_MS = 380;
const aborted = () => new DOMException('run aborted', 'AbortError');
function nextFrame(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const onAbort = () => { cancelAnimationFrame(id); reject(aborted()); };
    const id = requestAnimationFrame((now) => { signal.removeEventListener('abort', onAbort); resolve(now); });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const onAbort = () => { clearTimeout(id); reject(aborted()); };
    const id = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const hero = {
  el: $('#hero-demo'),
  draft: '',
  ctrl: null, // the AbortController of the run in progress
  phase: 'idle', // idle | type | render | plot | hold | clear | static | fallback
  visible: false,
  failed: false,
  async start() {
    const el = this.el;
    if (!el) return;
    this.code = $('.demo-code code', el);
    this.pre = $('.demo-code', el);
    this.gutter = $('.demo-gutter', el);
    this.status = $('.demo-status', el);
    this.frame = $('.demo-frame:not(.demo-frame--static)', el);
    scaleToBox(this.frame, $('.demo-page', el), 1280);
    $('#demo-replay')?.addEventListener('click', () => this.replay());
    $('#demo-edit')?.addEventListener('click', () => playground.loadPreset('tcp'));
    addEventListener('site:mode', () => { if (this.phase === 'hold') this.refreshPage(); });
    // Off screen or in a hidden tab, the run stops; it starts clean when the demo is back in view.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].intersectionRatio >= 0.2;
        this.sync();
      }, { threshold: [0, 0.2, 0.5] }).observe(el);
    } else {
      this.visible = true;
    }
    document.addEventListener('visibilitychange', () => this.sync());
    try {
      this.draft = pick(await presets(), 'tcp');
    } catch {
      this.fallback();
      return;
    }
    engine().catch(() => {});
    this.sync();
  },
  canRun() {
    return !this.failed && !!this.draft && this.visible && !document.hidden;
  },
  // Start a run when one may run and none does; stop the run when it may not.
  sync() {
    if (this.canRun()) { if (!this.ctrl) this.begin(); } else this.stop();
  },
  stop() {
    this.ctrl?.abort();
    this.ctrl = null;
  },
  begin() {
    this.stop();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.loop(ctrl.signal).catch((err) => {
      if (err?.name !== 'AbortError') console.error('hero demo failed', err);
    }).finally(() => { if (this.ctrl === ctrl) this.ctrl = null; });
  },
  replay() {
    if (this.failed) return;
    this.stop();
    if (this.canRun()) this.begin();
  },
  async loop(signal) {
    for (;;) {
      this.reset();
      await this.type(signal);
      const res = await this.render(signal);
      if (!res) return; // the engine is not there: the prerendered page is shown and nothing loops
      await this.plot(signal);
      await this.hold(signal);
      await this.clear(signal);
    }
  },
  // Wait for `ms`, frame by frame; onTick gets the progress 0..1 each frame. A long gap between frames
  // (a throttled tab) counts as at most 100 ms, so the demo never jumps ahead.
  async elapse(ms, signal, onTick) {
    let done = 0;
    let last = await nextFrame(signal);
    while (done < ms) {
      const now = await nextFrame(signal);
      done += Math.min(now - last, 100);
      last = now;
      onTick?.(Math.min(1, done / ms));
    }
  },
  // Light up every step up to and including this one.
  step(name) {
    const order = ['draft', 'cli', 'page'];
    $$('.demo-step', this.el).forEach((s) => s.classList.toggle('is-on', order.indexOf(s.dataset.step) <= order.indexOf(name)));
  },
  // follow: keep the last line in view (while typing); otherwise show the top of the draft.
  showText(text, follow = true) {
    const lines = text ? text.split('\n').length : 1;
    this.code.innerHTML = `${highlight(text)}<span class="caret"></span>`;
    this.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    const lh = parseFloat(getComputedStyle(this.pre).lineHeight) || 20;
    const over = follow ? Math.max(0, lines * lh + 70 - this.pre.clientHeight) : 0;
    this.code.style.transform = `translateY(${-over}px)`;
    this.gutter.style.transform = `translateY(${-over}px)`;
  },
  setStatus(text, ok = false) {
    this.status.textContent = text;
    this.status.classList.toggle('ok', ok);
  },
  reset() {
    this.el.classList.remove('is-plotted', 'is-plotting', 'is-done', 'is-static', 'is-holding', 'is-clearing');
    this.step('draft');
    this.showText('');
    this.setStatus('');
  },
  async type(signal) {
    this.phase = 'type';
    const text = this.draft;
    const bytes = new TextEncoder().encode(text).length;
    let shown = -1;
    await this.elapse(TYPE_MS, signal, (p) => {
      const n = Math.round(p * text.length);
      if (n === shown) return;
      shown = n;
      this.showText(text.slice(0, n));
      this.setStatus(fill(UI.typing, { n: new TextEncoder().encode(text.slice(0, n)).length, total: bytes }));
    });
  },
  // Render with the real engine and load the page into the frame. Returns the result, or null after falling back.
  async render(signal) {
    this.phase = 'render';
    this.el.classList.add('is-done');
    this.step('cli');
    this.setStatus(UI.rendering);
    let res = null;
    try {
      await Promise.race([engine(), sleep(15000, signal).then(() => { throw new Error('timeout'); })]);
      res = await renderDraft(this.draft, { mode: siteMode() });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
    if (signal.aborted) throw aborted();
    if (!res?.ok) { this.fallback(); return null; }
    await this.load(res.html, signal);
    this.step('page');
    this.setStatus(fill(UI.rendered, { ms: fmtMs(res.ms), kb: kb(new Blob([res.html]).size) }), true);
    return res;
  },
  load(html, signal) {
    const frame = this.frame;
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); frame.onload = null; resolve(); };
      const onAbort = () => { clearTimeout(timer); frame.onload = null; reject(aborted()); };
      const timer = setTimeout(done, 1500);
      frame.onload = done;
      signal?.addEventListener('abort', onAbort, { once: true });
      frame.srcdoc = framed(html, { id: 'hero', css: HIDE_CHROME });
    });
  },
  async plot(signal) {
    this.phase = 'plot';
    const el = this.el;
    el.classList.remove('is-plotting', 'is-plotted');
    void el.offsetWidth; // restart the plot animation and transition from the hidden state
    el.classList.add('is-plotting');
    await nextFrame(signal);
    el.classList.add('is-plotted');
    await sleep(PLOT_MS, signal);
  },
  async hold(signal) {
    this.phase = 'hold';
    // While the page is on show, the editor glides back to the top of the draft.
    this.el.classList.add('is-holding');
    this.showText(this.draft, false);
    await this.elapse(HOLD_MS, signal);
  },
  async clear(signal) {
    this.phase = 'clear';
    this.el.classList.add('is-clearing');
    await sleep(FADE_MS, signal);
  },
  // The colors changed while the page is on show: render it again in place.
  async refreshPage() {
    const res = await renderDraft(this.draft, { mode: siteMode() });
    if (res.ok && this.phase === 'hold') this.frame.srcdoc = framed(res.html, { id: 'hero', css: HIDE_CHROME });
  },
  fallback() {
    const el = this.el;
    this.failed = true;
    this.phase = 'fallback';
    this.stop();
    el.classList.remove('is-plotting', 'is-holding', 'is-clearing');
    this.showText(this.draft || '', false);
    this.frame.removeAttribute('srcdoc');
    this.frame.src = `${BASE}prerender/${UI.lang === 'zh' ? 'tcp-zh.html' : 'tcp-en.html'}`;
    el.classList.add('is-done', 'is-plotted', 'is-static');
    this.step('page');
    this.setStatus(UI.fallback);
    $('.demo-note', el).innerHTML = UI.fallbackNote;
  },
};

/* ════════════════ Sheet 03: measure the page the CLI writes for the TCP draft ════════════════ */
function composition(html) {
  const bytes = (s) => new Blob([s]).size;
  const total = bytes(html);
  const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].reduce((n, m) => n + bytes(m[1]), 0);
  const svgs = [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  const svg = svgs.reduce((n, s) => n + bytes(s), 0);
  const geo = [...svgs.join('').matchAll(/\s(?:x|y|x1|y1|x2|y2|cx|cy|width|height|d|points|rx)="([^"]*)"/g)].map((m) => m[1]).join(' ');
  const coords = geo.match(/-?\d+(?:\.\d+)?/g)?.length ?? 0;
  const css = bytes(style);
  return { total, css, js, svg, html: total - css - js - svg, coords, rules: (style.match(/\{/g) ?? []).length };
}
async function measure() {
  const box = $('#sizes');
  if (!box) return;
  const draft = pick(await presets(), 'tcp');
  const res = await renderDraft(draft, { mode: siteMode() });
  if (!res.ok) return;
  const c = composition(res.html);
  const d = new Blob([draft]).size;
  const set = (key, value) => $$(`[data-measure="${key}"]`).forEach((el) => { el.textContent = value; });
  set('draft', kb(d));
  set('page', kb(c.total));
  set('css', kb(c.css));
  set('js', kb(c.js));
  set('svg', kb(c.svg));
  set('html', kb(c.html));
  set('ratio', `${Math.round(c.total / d)}×`);
  set('coords', String(c.coords));
  set('rules', String(c.rules));
  const pct = (n) => `${((n / c.total) * 100).toFixed(1)}%`;
  $('.bar-accent', box).style.setProperty('--w', pct(d));
  $('.seg-css', box).style.setProperty('--w', pct(c.css));
  $('.seg-js', box).style.setProperty('--w', pct(c.js));
  $('.seg-svg', box).style.setProperty('--w', pct(c.svg));
  $('.seg-html', box).style.setProperty('--w', pct(c.html));
  const note = $('[data-measure-note]');
  if (note) note.textContent = fill(UI.measured, { file: UI.heroFile, lines: draft.trimEnd().split('\n').length, ms: fmtMs(res.ms) });
}

/* ════════════════ Playground ════════════════ */
const LINE_H = 21;
// "Break it": change one line of the first component the way models often get it wrong.
const MISTAKES = [
  ['sequence', (l) => /^\s*[^:]+?\s->\s/.test(l) && !/^\s*(note|participants)\b/.test(l), (l) => l.replace(' -> ', ' => ')],
  ['flow', (l) => /\s->\s/.test(l) && !/^\s*group\b/.test(l), (l) => l.replace(/(\s->\s).*$/, '$1')],
  ['timeline', (l) => l.includes('|'), (l) => l.replace(/\s*\|\s*/, ' ')],
  ['ask', (l) => /^\s*\*\s/.test(l), (l) => l.replace(/^(\s*)\*/, '$1-')],
  ['kv', (l) => /:/.test(l), (l) => l.replace(/\s*:\s*/, ' ')],
  ['limits', (l) => /\|\s*[\d.]+\s*\/\s*[\d.]+/.test(l), (l) => l.replace(/\|\s*[\d.]+\s*\/\s*[\d.]+/, '| lots')],
];
function breakDraft(text) {
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^```(\w+)/);
    if (!fence && open) { fence = MISTAKES.find(([name]) => name === open[1]) ?? 'other'; continue; }
    if (fence && /^```\s*$/.test(lines[i])) { fence = null; continue; }
    if (fence && fence !== 'other' && fence[1](lines[i])) {
      const next = [...lines];
      next[i] = fence[2](lines[i]);
      return { text: next.join('\n'), line: i + 1 };
    }
  }
  return null;
}

const playground = {
  el: $('#pg'),
  key: 'tcp',
  file: 'tcp.md',
  last: null,
  backup: null,
  timer: 0,
  seq: 0,
  async start() {
    const el = this.el;
    if (!el) return;
    this.input = $('#pg-input');
    this.gutter = $('.gutter-in', el);
    this.marks = $('.editor-marks', el);
    this.liveText = $('#pg-live-text');
    this.errBox = $('#pg-error');
    this.frames = this.makeFrames();
    this.bind();
    let all;
    try {
      all = await presets();
    } catch {
      this.engineFailed();
      return;
    }
    this.all = all;
    this.setText(pick(all, 'tcp'), 'tcp.md');
    this.updateGutter();
    try {
      const eng = await engine();
      const themeSel = $('#pg-theme');
      for (const name of eng.THEMES) themeSel.append(new Option(name, name));
    } catch {
      this.engineFailed();
      return;
    }
    this.renderNow();
  },
  engineFailed() {
    this.el.dataset.state = 'error';
    this.liveText.textContent = UI.engineFailed;
    $('.pg-loading span', this.el).textContent = UI.engineFailed;
  },
  // Two iframes take turns, so a new render never flashes a blank page.
  makeFrames() {
    const front = $('#pg-frame');
    const back = front.cloneNode();
    back.removeAttribute('id');
    back.setAttribute('aria-hidden', 'true');
    back.tabIndex = -1;
    back.style.cssText = 'position:absolute;inset:0;visibility:hidden';
    front.after(back);
    const state = { front, back, scroll: 0 };
    const main = $('.pg-main', this.el);
    frameListeners.set('pg', (data, source) => {
      if (source === state.front.contentWindow && typeof data.y === 'number') state.scroll = data.y;
      // Fit the preview (and the editor beside it) to the page, between a floor and a ceiling; taller pages scroll inside.
      if ((source === state.front.contentWindow || source === state.back.contentWindow) && data.h > 0) {
        main.style.setProperty('--pg-h', `${Math.max(440, Math.min(780, data.h))}px`);
      }
    });
    return state;
  },
  show(html) {
    const f = this.frames;
    const target = f.back;
    target.onload = () => {
      target.style.cssText = '';
      target.removeAttribute('aria-hidden');
      target.removeAttribute('tabindex');
      f.front.style.cssText = 'position:absolute;inset:0;visibility:hidden';
      f.front.setAttribute('aria-hidden', 'true');
      f.front.tabIndex = -1;
      f.front.removeAttribute('id');
      target.id = 'pg-frame';
      f.back = f.front;
      f.front = target;
    };
    target.srcdoc = framed(html, { id: 'pg', scroll: f.scroll });
  },
  bind() {
    const ta = this.input;
    let escaped = false;
    ta.addEventListener('input', () => { this.updateGutter(); this.schedule(); });
    ta.addEventListener('scroll', () => this.syncScroll(), { passive: true });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { escaped = true; return; }
      if (e.key === 'Tab' && !escaped && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: end } = ta;
        if (e.shiftKey) {
          const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
          if (ta.value.startsWith('  ', lineStart)) ta.setRangeText('', lineStart, lineStart + 2, 'preserve');
        } else {
          ta.setRangeText('  ', s, end, 'end');
        }
        ta.dispatchEvent(new Event('input'));
        return;
      }
      escaped = false;
    });
    ta.addEventListener('blur', () => { escaped = false; });
    for (const tab of $$('[data-preset]', this.el)) {
      tab.addEventListener('click', () => this.loadPreset(tab.dataset.preset, false));
      tab.addEventListener('keydown', (e) => {
        const tabs = $$('[data-preset]', this.el);
        const i = tabs.indexOf(tab);
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus();
        next.click();
      });
    }
    $('#pg-theme').addEventListener('change', () => this.renderNow());
    $('#pg-mode').addEventListener('change', () => this.renderNow());
    addEventListener('site:mode', () => { if ($('#pg-mode').value === 'auto' && this.all) this.renderNow(); });
    $('#pg-break').addEventListener('click', () => this.breakIt());
    $('#err-undo').addEventListener('click', () => this.undo());
    $('#pg-copy').addEventListener('click', async (e) => {
      dispatchEvent(new CustomEvent('site:copied', { detail: { button: e.currentTarget, ok: await copyText(ta.value) } }));
    });
    $('#pg-download').addEventListener('click', () => this.download());
  },
  loadPreset(key, scroll = true) {
    if (!this.all) return;
    const isComponent = key.startsWith('components/');
    this.key = key;
    for (const t of $$('[data-preset]', this.el)) {
      const on = t.dataset.preset === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on || (isComponent && t === $('[data-preset]', this.el)) ? 0 : -1;
    }
    const name = key.split('/').pop();
    this.setText(pick(this.all, key), `${name}.md`);
    this.frames.scroll = 0;
    this.renderNow();
    if (scroll) {
      document.getElementById('playground').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => this.input.focus({ preventScroll: true }), reduced ? 0 : 600);
    }
  },
  setText(text, file) {
    this.input.value = text;
    this.input.scrollTop = 0;
    this.file = file;
    this.backup = null;
    $('#pg-file').textContent = file;
    $('#err-undo').hidden = true;
    this.updateGutter();
    this.syncScroll();
  },
  updateGutter(marks = this.lineMarks || {}) {
    const n = this.input.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= n; i++) html += `<span${marks[i] ? ` class="${marks[i]}"` : ''}>${i}</span>`;
    this.gutter.innerHTML = html;
    this.marks.innerHTML = Object.entries(marks).map(([line, kind]) => `<i class="${kind}" style="top:${12 + (line - 1) * LINE_H}px"></i>`).join('');
    $('#pg-lines').textContent = `${fill(UI.lines, { n })} · ${fill(UI.bytes, { n: new Blob([this.input.value]).size })}`;
    this.syncScroll();
  },
  syncScroll() {
    const y = this.input.scrollTop;
    this.gutter.style.transform = `translateY(${-y}px)`;
    this.marks.style.transform = `translateY(${-y}px)`;
  },
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renderNow(), 120);
  },
  overrides() {
    const theme = $('#pg-theme').value;
    const mode = $('#pg-mode').value;
    return { theme: theme === 'auto' ? undefined : theme, mode: mode === 'auto' ? siteMode() : mode };
  },
  async renderNow() {
    clearTimeout(this.timer);
    const seq = ++this.seq;
    const res = await renderDraft(this.input.value, this.overrides());
    if (seq !== this.seq) return;
    if (res.ok) this.ok(res); else this.fail(res);
  },
  ok(res) {
    this.last = res;
    this.el.dataset.state = 'ok';
    this.errBox.hidden = true;
    this.show(res.html);
    const size = new Blob([res.html]).size;
    this.liveText.textContent = fill(UI.liveMs, { ms: fmtMs(res.ms) });
    $('#st-ms').textContent = fill(UI.ms, { n: fmtMs(res.ms) });
    $('#st-size').textContent = fill(UI.kb, { n: kb(size) });
    $('#st-panels').textContent = String(res.stats?.panels ?? '—');
    const comps = Object.entries(res.stats?.components ?? {});
    $('#st-comps').textContent = comps.length ? comps.map(([k, v]) => `${k}×${v}`).join(' ') : UI.none;
    const warnings = [...(res.warnings ?? []), ...(res.stats?.codeWarnings ?? []).map((w) => ({ rule: 'code', ...w })), ...(res.stats?.htmlWarnings ?? []).map((w) => ({ rule: 'html', ...w }))];
    const ste = $('#st-ste');
    ste.textContent = warnings.length ? (warnings.length === 1 ? UI.steOne : fill(UI.steN, { n: warnings.length })) : UI.steOk;
    ste.className = warnings.length ? 'warn' : 'ok';
    this.lineMarks = Object.fromEntries(warnings.filter((w) => w.line).map((w) => [w.line, 'warn']));
    this.updateGutter();
    this.listWarnings(warnings);
  },
  fail(res) {
    const e = res.error || {};
    this.el.dataset.state = 'error';
    // The numbers below belonged to the last page that rendered; with no page now, show none.
    for (const id of ['st-ms', 'st-size', 'st-panels', 'st-comps', 'st-ste']) $(`#${id}`).textContent = '—';
    $('#st-ste').className = '';
    this.liveText.textContent = e.name || 'Error';
    this.errBox.hidden = false;
    $('#err-where').textContent = e.line ? fill(UI.errWhere, { line: e.line, component: e.component || UI.errDraft }) : fill(UI.errWhereNoLine, { component: e.component || UI.errDraft });
    $('#err-msg').textContent = e.message || '';
    const ex = $('.err-ex', this.errBox);
    ex.hidden = !e.example;
    $('#err-example').innerHTML = e.example ? highlight(String(e.example).trim()) : '';
    $('#err-undo').hidden = !this.backup;
    this.lineMarks = e.line ? { [e.line]: 'err' } : {};
    this.updateGutter();
    this.listWarnings(e.warnings ?? []);
    if (!this.last) $('.pg-loading', this.el).style.opacity = '0';
  },
  listWarnings(warnings) {
    const list = $('#pg-warnings');
    list.innerHTML = '';
    for (const w of warnings.map(localizeWarning)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      if (w.line) b.setAttribute('aria-label', `${fill(UI.jump, { n: w.line })}: ${w.message}`);
      b.innerHTML = `<span class="wl">${w.line ? esc(fill(UI.warnLine, { n: w.line })) : ''}</span><span class="wr">${esc(UI.rules[w.rule] || w.rule || '')}</span>` +
        `<span class="wm">${esc(w.message)}${w.suggestion ? ` <span class="ws">→ ${esc(w.suggestion)}</span>` : ''}</span>`;
      if (w.line) b.addEventListener('click', () => this.jump(w.line));
      li.append(b);
      list.append(li);
    }
  },
  jump(line) {
    const ta = this.input;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 1) * LINE_H - ta.clientHeight / 3);
    this.syncScroll();
    const mark = document.createElement('i');
    mark.className = 'flash';
    mark.style.top = `${12 + (line - 1) * LINE_H}px`;
    this.marks.append(mark);
    setTimeout(() => mark.remove(), 1400);
    if (innerWidth < 1025) $('.editor', this.el).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  },
  breakIt() {
    const broken = breakDraft(this.input.value);
    if (!broken) { toast(UI.brokeNothing); return; }
    const backup = this.backup ?? this.input.value;
    this.input.value = broken.text;
    this.backup = backup;
    this.updateGutter();
    this.renderNow().then(() => {
      this.jump(broken.line);
      this.input.blur();
      toast(fill(UI.broken, { n: broken.line }));
    });
  },
  undo() {
    if (this.backup == null) return;
    const scroll = this.input.scrollTop;
    this.input.value = this.backup;
    this.backup = null;
    $('#err-undo').hidden = true;
    this.input.scrollTop = scroll;
    this.updateGutter();
    this.renderNow();
    toast(UI.restored);
  },
  download() {
    if (!this.last) return;
    const title = String(this.last.meta?.title || this.file.replace(/\.md$/, ''));
    const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
    const name = `${slug}.html`;
    const url = URL.createObjectURL(new Blob([this.last.html], { type: 'text/html' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(fill(UI.downloaded, { name }));
  },
};

/* ════════════════ Component gallery: each card renders its own tiny draft when it comes into view ════════════════ */
const THUMB_W = 720;
const THUMB_CSS = `${HIDE_CHROME}.am-head{display:none!important}html,body{overflow:hidden!important}.am-sheet{padding:16px!important;width:100%}body{display:grid!important;min-height:100vh;align-content:center}`;
const gallery = {
  start() {
    const cards = $$('#cards .card[data-comp]');
    for (const card of cards) {
      $('.card-btn', card).addEventListener('click', () => playground.loadPreset(`components/${card.dataset.comp}`));
      whenNear(card, () => this.render(card), '200px');
    }
    addEventListener('site:mode', () => cards.filter((c) => c.dataset.mode).forEach((c) => this.render(c)));
  },
  async render(card) {
    const thumb = $('.thumb', card);
    const all = await presets();
    const mode = siteMode();
    card.dataset.mode = mode;
    const res = await renderDraft(pick(all, `components/${card.dataset.comp}`), { mode });
    if (!res.ok) return;
    let frame = $('iframe', thumb);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('aria-hidden', 'true');
      frame.title = card.dataset.comp;
      frame.style.width = `${THUMB_W}px`;
      thumb.append(frame);
      scaleToBox(frame, thumb, THUMB_W);
      frame.addEventListener('load', () => thumb.classList.add('is-ready'));
    }
    frame.srcdoc = framed(res.html, { id: `card-${card.dataset.comp}`, css: THUMB_CSS });
  },
};

/* ════════════════ Themes: one draft, three themes × light / dark ════════════════ */
const themes = {
  cache: new Map(),
  theme: 'blueprint',
  mode: null,
  start() {
    const frame = $('#th-frame');
    if (!frame) return;
    this.frame = frame;
    this.mode = siteMode();
    scaleToBox(frame, $('.themes-box'), 1180);
    for (const group of ['#th-theme', '#th-mode']) {
      const buttons = $$('[role="radio"]', $(group));
      buttons.forEach((b, i) => {
        b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
        b.addEventListener('click', () => this.choose(group, b));
        b.addEventListener('keydown', (e) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const next = buttons[(i + step + buttons.length) % buttons.length];
          next.focus();
          this.choose(group, next);
        });
      });
    }
    this.mark('#th-mode', this.mode);
    whenNear(frame, () => this.render());
  },
  mark(group, value) {
    for (const b of $$('[role="radio"]', $(group))) {
      const on = b.dataset.v === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  },
  choose(group, button) {
    this.mark(group, button.dataset.v);
    if (group === '#th-theme') this.theme = button.dataset.v; else this.mode = button.dataset.v;
    this.render();
  },
  async render() {
    const key = `${this.theme}|${this.mode}`;
    let res = this.cache.get(key);
    if (!res) {
      res = await renderDraft(pick(await presets(), 'tcp'), { theme: this.theme, mode: this.mode });
      if (!res.ok) return;
      this.cache.set(key, res);
    }
    $('#th-label').textContent = fill(UI.themeLabel, { theme: this.theme, mode: UI.modes[this.mode] || this.mode });
    $('#th-ms').textContent = fill(UI.ms, { n: fmtMs(res.ms) });
    const frame = this.frame;
    frame.classList.add('is-swapping');
    frame.onload = () => frame.classList.remove('is-swapping');
    frame.srcdoc = framed(res.html, { id: 'themes', css: HIDE_CHROME });
  },
};

/* ════════════════ STE writing check ════════════════ */
const QUOTED = /"([^"]+)"/;
function locate(finding, line) {
  const lower = line.toLowerCase();
  const find = (term) => {
    const at = lower.indexOf(term.toLowerCase());
    return at < 0 ? null : [at, at + term.length];
  };
  const quoted = finding.message.match(QUOTED)?.[1];
  if (finding.rule === 'sentence-length' && quoted) {
    const head = find(quoted.replace(/…$/, ''));
    if (!head) return null;
    const end = line.slice(head[0]).search(/[.!?。！？；;](\s|$)|[。！？；]/);
    return { range: [head[0], end < 0 ? line.length : head[0] + end + 1], kind: 'len' };
  }
  if (finding.rule === 'de-chain') {
    const sentence = finding.message.replace(/^chained "的":\s*/, '');
    const r = find(sentence);
    return r ? { range: r, kind: 'len' } : null;
  }
  if (finding.rule === 'paragraph-length') return null;
  if (!quoted) return null;
  const r = find(quoted);
  return r ? { range: r, kind: finding.rule === 'passive' ? 'passive' : 'word' } : null;
}
function markLine(line, marks) {
  // Per character: the sentence-level mark (background) and the word-level mark (underline) it belongs to.
  const len = Array(line.length).fill(-1);
  const word = Array(line.length).fill(-1);
  marks.forEach((m, idx) => {
    const target = m.kind === 'len' ? len : word;
    for (let i = m.range[0]; i < m.range[1]; i++) if (target[i] === -1) target[i] = idx;
  });
  // Every mark gets its number right after its last character.
  const sups = (end) => marks.filter((m) => m.range[1] === end)
    .map((m) => `<sup class="${m.kind}">${m.n}</sup>`).join('');
  const ends = new Set(marks.map((m) => m.range[1]));
  let out = '';
  let i = 0;
  while (i < line.length) {
    let j = i + 1;
    while (j < line.length && !ends.has(j) && len[j] === len[i] && word[j] === word[i]) j++;
    let chunk = esc(line.slice(i, j));
    if (word[i] >= 0) chunk = `<mark class="${marks[word[i]].kind}">${chunk}</mark>`;
    chunk += sups(j);
    out += len[i] >= 0 ? `<span class="seg-len">${chunk}</span>` : chunk;
    i = j;
  }
  return out;
}
const ste = {
  start() {
    this.input = $('#ste-input');
    if (!this.input) return;
    this.sample = this.input.defaultValue;
    let t = 0;
    this.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.check(), 120); });
    $('#ste-reset').addEventListener('click', () => { this.input.value = this.sample; this.check(); });
    $('#ste-fix').addEventListener('click', () => this.fix());
    this.check();
  },
  async check() {
    const { lint } = await engine();
    const text = this.input.value;
    const started = performance.now();
    let raw = [];
    try { raw = lint(text); } catch { raw = []; }
    $('#ste-ms').textContent = fill(UI.ms, { n: fmtMs(performance.now() - started) });
    const lines = text.split('\n');
    // Number the findings in reading order: by line, then by where each one starts.
    const findings = raw
      .map((f) => ({ ...f, at: locate(f, lines[(f.line || 1) - 1] ?? '') }))
      .sort((a, b) => (a.line || 1) - (b.line || 1) || (a.at?.range[0] ?? 1e9) - (b.at?.range[0] ?? 1e9))
      .map((f, idx) => ({ ...f, n: idx + 1 }));
    this.findings = findings;
    const perLine = lines.map((_, i) => findings.filter((f) => f.at && (f.line || 1) - 1 === i).map((f) => ({ ...f.at, n: f.n })));
    $('#ste-text').innerHTML = lines.map((l, i) => markLine(l, perLine[i]) || '&nbsp;').join('<br>');
    const list = $('#ste-list');
    list.innerHTML = findings.map(localizeWarning).map((f) => {
      const kind = f.rule === 'passive' ? 'passive' : (f.rule === 'sentence-length' || f.rule === 'de-chain' || f.rule === 'paragraph-length') ? 'len' : '';
      return `<li><span class="n ${kind}">${f.n}</span><span class="r">${esc(UI.rules[f.rule] || f.rule)}</span><span class="m">${esc(f.message)}${f.suggestion ? `<span class="sg">${esc(f.suggestion)}</span>` : ''}</span></li>`;
    }).join('');
    const count = $('#ste-count');
    count.innerHTML = findings.length
      ? esc(findings.length === 1 ? UI.steOne1 : fill(UI.steFindings, { n: findings.length }))
      : `<span class="ste-ok">✓ ${esc(UI.steClean)}</span>`;
  },
  // Replace the words the check names with the approved word it suggests, where the suggestion is a word and not advice.
  fix() {
    let text = this.input.value;
    let changed = 0;
    for (const f of this.findings ?? []) {
      if (f.rule !== 'word' || !f.suggestion) continue;
      const from = f.message.match(QUOTED)?.[1];
      const light = f.suggestion.match(/^use "([^"]+)"$/);
      const to = light ? light[1] : (/^[a-z ]+$/.test(f.suggestion) && f.suggestion.split(' ').length <= 2 && /^not recommended/.test(f.message)) || /^[一-鿿]+$/.test(f.suggestion) ? f.suggestion : null;
      if (!from || !to) continue;
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const m = text.match(re);
      if (!m) continue;
      const cased = /^[A-Z]/.test(m[0]) ? to[0].toUpperCase() + to.slice(1) : to;
      text = text.replace(re, cased);
      changed++;
    }
    if (changed) {
      this.input.value = text;
      this.check();
      toast(fill(UI.steFixed, { n: changed }));
    } else {
      toast(UI.steNoFix);
    }
  },
};

/* ════════════════ Start ════════════════ */
hero.start();
playground.start();
gallery.start();
themes.start();
whenNear($('#sizes'), () => measure().catch(() => {}), '300px');
whenNear($('#ste-box'), () => ste.start(), '300px');
engine().catch((err) => {
  console.error('engine failed to load', err);
  playground.engineFailed?.call(playground);
});
