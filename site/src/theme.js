// The page of one catalog theme (/themes/<name>/). The TCP sample is already rendered in the page (preview.html, made at build time).
// Another sample loads the renderer (engine.js, once) and draws that draft with the theme file; light and dark flip data-mode on the frame's root.
import { copyText, track } from './main.js';
import { UI, BASE, siteMode, engine, presets, pick, renderDraft } from './live.js';
import { PREVIEW_CSS } from './chrome.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));

const view = $('.tview');
const { theme: name, label, file } = view.dataset;
const box = $('.tview-box', view);
const frame = $('iframe', box);
const status = $('.tview-status', view);
const PREVIEW = frame.getAttribute('src');
const state = { mode: 'light', run: 0 };

// ── The frame: hide the page's own chrome (the build did it for preview.html), set its mode, and size the box to the page ──
function fit() {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc?.body) return;
  const h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
  if (h < 100) return;
  frame.style.height = `${h}px`;
  box.style.aspectRatio = `${frame.offsetWidth} / ${h}`;
}
function settle() {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc?.getElementById('am-source')) return;
  if (!doc.getElementById('site-frame-css')) {
    doc.head.append(Object.assign(doc.createElement('style'), { id: 'site-frame-css', textContent: PREVIEW_CSS }));
  }
  doc.documentElement.setAttribute('data-mode', state.mode);
  fit();
}
frame.addEventListener('load', settle);
if ('ResizeObserver' in window) new ResizeObserver(fit).observe(box);

// ── The two switches: sample and mode ──
function radio(group, onChoose) {
  const buttons = $$('[role="radio"]', $(`[data-group="${group}"]`, view));
  const mark = (value) => {
    for (const b of buttons) {
      const on = b.dataset.v === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (button) => {
    if (button.getAttribute('aria-checked') === 'true') return;
    mark(button.dataset.v);
    onChoose(button.dataset.v);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => choose(b));
    b.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = buttons[(i + step + buttons.length) % buttons.length];
      next.focus();
      choose(next);
    });
  });
  return mark;
}

const markMode = radio('mode', (mode) => {
  track('theme-mode', { theme: name, mode });
  setMode(mode);
});
radio('sample', (sample) => {
  track('theme-sample', { theme: name, sample });
  showSample(sample);
});

function setMode(mode) {
  state.mode = mode;
  markMode(mode);
  try { frame.contentDocument?.documentElement.setAttribute('data-mode', mode); } catch { /* another origin */ }
}

// ── Samples ──
let themePromise = null;
function loadTheme() {
  themePromise ??= (async () => {
    const [{ themeFromFile }, res] = await Promise.all([engine(), fetch(`${BASE}${file}`)]);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const { theme, errors } = themeFromFile(name, await res.json());
    if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
    return theme;
  })();
  return themePromise;
}

async function showSample(sample) {
  const run = ++state.run;
  const sampleName = $(`[data-group="sample"] [data-v="${sample}"]`, view).textContent;
  frame.title = fill(box.dataset.frameTitle, { label, sample: sampleName });
  view.setAttribute('aria-busy', 'true');
  try {
    if (sample === 'tcp') {
      frame.removeAttribute('srcdoc');
      frame.src = PREVIEW;
      status.textContent = UI.themePre;
      return;
    }
    status.textContent = UI.loading;
    const theme = await loadTheme();
    const res = await renderDraft(pick(await presets(), sample), { theme: name, mode: state.mode }, { extra: [theme] });
    if (run !== state.run) return;
    if (!res.ok) throw new Error(res.error.message);
    frame.srcdoc = res.html;
    status.textContent = fill(UI.liveMs, { ms: fmtMs(res.ms) });
  } catch (err) {
    if (run !== state.run) return;
    console.error(`sample ${sample} of ${name} failed`, err);
    status.textContent = UI.catFailed;
  } finally {
    if (run === state.run) view.removeAttribute('aria-busy');
  }
}

setMode(siteMode());
settle();
status.textContent = UI.themePre;
// The site's own light or dark switch moves the preview too.
addEventListener('site:mode', (e) => setMode(e.detail));

// ── Copy buttons: the primary one copies the text for an agent, the others one command each ──
for (const btn of $$('[data-copy]')) {
  btn.addEventListener('click', async () => {
    track('theme-copy', { theme: name, method: btn.dataset.method });
    const text = document.getElementById(btn.dataset.copy).textContent;
    dispatchEvent(new CustomEvent('site:copied', { detail: { button: btn, ok: await copyText(text) } }));
  });
}
const older = $('.tolder');
older.addEventListener('toggle', () => { if (older.open) track('theme-older', { theme: name }); });

$('#start-from')?.addEventListener('click', () => track('editor-open', { from: 'theme', theme: name }));
