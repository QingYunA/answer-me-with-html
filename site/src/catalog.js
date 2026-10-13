// The theme gallery (/themes/): each card draws the sample draft with the real engine and the card's theme file,
// in light or dark, when it comes into view. The cards, install commands and facts are already in the page (site/catalog.mjs).
import { copyText, track } from './main.js';
import { UI, BASE, siteMode, whenNear, engine, presets, pick, renderDraft, HIDE_CHROME, framed, scaleToBox } from './live.js';

// The sample draft is the preset the hero uses. The preview page is drawn this wide and scaled down to the card;
// on a phone it is drawn at the width of a phone, so the text stays readable.
const SAMPLE = 'tcp';
const previewSize = (box) => (box.clientWidth < 520 ? { w: 480, h: 760 } : { w: 900, h: 780 });
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));

// Each theme file is fetched once and read the way the CLI reads it from the themes folder.
const themeFiles = new Map();
function loadTheme(name, file) {
  if (!themeFiles.has(name)) {
    themeFiles.set(name, (async () => {
      const [{ themeFromFile }, res] = await Promise.all([engine(), fetch(`${BASE}${file}`)]);
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      const { theme, errors } = themeFromFile(name, await res.json());
      if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
      return theme;
    })());
  }
  return themeFiles.get(name);
}

// The page also ends in a toolbar and a colophon; a preview shows only the page itself.
const PREVIEW_CSS = `${HIDE_CHROME}html,body{overflow:hidden!important}`;

async function render(card) {
  const { theme: name, file } = card.dataset;
  const box = $('.tcard-box', card);
  const mode = card.dataset.mode;
  try {
    const theme = await loadTheme(name, file);
    const res = await renderDraft(pick(await presets(), SAMPLE), { theme: name, mode }, { extra: [theme] });
    if (!res.ok) throw new Error(res.error.message);
    let frame = $('iframe', box);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('tabindex', '-1');
      frame.title = box.dataset.frameTitle;
      const { w, h } = previewSize(box);
      frame.style.width = `${w}px`;
      box.style.aspectRatio = `${w} / ${h}`;
      box.append(frame);
      scaleToBox(frame, box, w);
    }
    frame.classList.add('is-swapping');
    frame.onload = () => {
      frame.classList.remove('is-swapping');
      box.classList.add('is-ready');
    };
    frame.srcdoc = framed(res.html, { id: `theme-${name}`, css: PREVIEW_CSS });
    $('.tcard-ms', card).textContent = fill(UI.ms, { n: fmtMs(res.ms) });
  } catch (err) {
    console.error(`preview of ${name} failed`, err);
    $('.tcard-wait', box).textContent = UI.catFailed;
    box.classList.add('is-failed');
  }
}

function setMode(card, mode) {
  card.dataset.mode = mode;
  for (const b of $$('[role="radio"]', card)) {
    const on = b.dataset.v === mode;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

function wireMode(card) {
  const buttons = $$('[role="radio"]', card);
  const choose = (button) => {
    if (button.dataset.v === card.dataset.mode) return;
    setMode(card, button.dataset.v);
    track('theme-preview', { theme: card.dataset.theme, mode: button.dataset.v });
    render(card);
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
}

function wireCopy(card) {
  for (const btn of $$('.tcopy-btn', card)) {
    btn.addEventListener('click', async () => {
      track('theme-copy', { theme: card.dataset.theme, method: btn.dataset.method });
      const ok = await copyText(btn.parentElement.querySelector('pre').textContent);
      dispatchEvent(new CustomEvent('site:copied', { detail: { button: btn, ok } }));
    });
  }
}

const cards = $$('.tcard');
for (const card of cards) {
  setMode(card, siteMode());
  wireMode(card);
  wireCopy(card);
  whenNear(card, () => render(card), '300px');
}
// The site's own light or dark switch moves every card that already shows a preview.
addEventListener('site:mode', (e) => {
  for (const card of cards) {
    setMode(card, e.detail);
    if ($('iframe', card)) render(card);
  }
});
