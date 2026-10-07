// Site chrome and motion: color mode, language choice, sheet rulers, nav state, draw-on lines, count-ups,
// the hero crosshair, copy buttons, install tabs, the figure lightbox. The playground loads later from playground.js.
const root = document.documentElement;
const UI = JSON.parse(document.getElementById('site-ui')?.textContent || '{}');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ── Toast: any script can show one with a 'site:toast' event ──
const toastEl = $('#toast');
let toastTimer = 0;
function toast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2200);
}
addEventListener('site:toast', (e) => toast(e.detail));

// ── Color mode: follows the system until the visitor picks one ──
function setMode(mode, lock) {
  root.dataset.mode = mode;
  if (lock) {
    root.setAttribute('data-mode-locked', '');
    try { localStorage.setItem('am-site-mode', mode); } catch { /* storage off: the choice lasts for this page */ }
  }
  dispatchEvent(new CustomEvent('site:mode', { detail: mode }));
}
$('#mode-toggle')?.addEventListener('click', () => setMode(root.dataset.mode === 'dark' ? 'light' : 'dark', true));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!root.hasAttribute('data-mode-locked')) setMode(e.matches ? 'dark' : 'light', false);
});

// ── Language switch: remember the choice so the English page stops redirecting ──
$('.lang-switch')?.addEventListener('click', (e) => {
  try { localStorage.setItem('am-site-lang', e.currentTarget.dataset.lang); } catch { /* no storage */ }
  e.currentTarget.href = e.currentTarget.getAttribute('href') + location.hash;
});

// ── Home and the logo go to the very top of the page (an anchor jump would stop below the sticky bar's padding) ──
for (const a of $$('a[href="#top"]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#top');
  });
}

// ── Star count: 1234 → 1,234 ──
for (const el of $$('.stars')) {
  const n = Number(el.dataset.stars);
  if (el.dataset.stars && Number.isFinite(n)) el.textContent = n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US');
}

// ── Sheet rulers: 1–8 across, A–D down (decoration; hidden on phones by CSS) ──
const ruler = (side, labels) => {
  const el = document.createElement('div');
  el.className = `ruler ruler--${side}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = labels.map((l) => `<span>${l}</span>`).join('');
  return el;
};
const COLS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const ROWS = ['A', 'B', 'C', 'D'];
for (const sheet of $$('.sheet')) {
  sheet.prepend(ruler('top', COLS), ruler('bottom', COLS), ruler('left', ROWS), ruler('right', ROWS));
}

// ── Nav: mark the section in view ──
const navLinks = $$('.nav a');
const navTargets = navLinks.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
if (navTargets.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of navLinks) {
        if (a.hash === `#${e.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  navTargets.forEach((t) => io.observe(t));
}

// ── Reveal: draw lines on, grow bars, count numbers up ──
function prepareDraw(group) {
  $$('.draw', group).forEach((path, i) => {
    let len = 1200;
    try { len = Math.ceil(path.getTotalLength()) + 2; } catch { /* not rendered yet */ }
    path.style.setProperty('--len', len);
    path.style.setProperty('--d', `${0.12 + i * 0.12}s`);
  });
  $$('.pn', group).forEach((node, i) => node.style.setProperty('--d', `${i * 0.08}s`));
}
function countUp(el) {
  const target = Number(el.dataset.count);
  const dec = Number(el.dataset.dec || 0);
  const fmt = (v) => (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
  if (reducedMotion.matches || !Number.isFinite(target)) { el.textContent = fmt(target); return; }
  const start = performance.now();
  const dur = 1100;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = fmt(target * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const revealTargets = $$('.pipeline, .metrics, .sizes');
revealTargets.forEach(prepareDraw);
$$('.metrics .metric').forEach((m, i) => $$('.bar i', m).forEach((b, j) => b.style.setProperty('--d', `${i * 0.12 + j * 0.08}s`)));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      $$('[data-count]', e.target).forEach(countUp);
      io.unobserve(e.target);
    }
  }, { threshold: 0.25 });
  revealTargets.forEach((t) => io.observe(t));
} else {
  revealTargets.forEach((t) => t.classList.add('in'));
}

// ── Hero crosshair: a coordinate readout in drawing terms (row letter, column number, x / y) ──
const hero = $('.hero');
if (hero && matchMedia('(pointer: fine)').matches) {
  const read = $('.ch-read', hero);
  let frame = 0;
  hero.addEventListener('pointermove', (e) => {
    if (reducedMotion.matches) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = hero.getBoundingClientRect();
      const x = Math.max(0, Math.round(e.clientX - r.left));
      const y = Math.max(0, Math.round(e.clientY - r.top));
      hero.style.setProperty('--x', `${x}px`);
      hero.style.setProperty('--y', `${y}px`);
      const col = COLS[Math.min(7, Math.floor((x / r.width) * 8))];
      const row = ROWS[Math.min(3, Math.floor((y / r.height) * 4))];
      read.textContent = `${row}${col} · X ${String(x).padStart(4, '0')} · Y ${String(y).padStart(4, '0')}`;
      hero.classList.add('has-cursor');
    });
  });
  hero.addEventListener('pointerleave', () => hero.classList.remove('has-cursor'));
}

// ── Copy buttons ──
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
function flash(btn, ok) {
  const label = btn.dataset.label ?? (btn.dataset.label = btn.textContent);
  btn.textContent = ok ? btn.dataset.done : '✗';
  btn.classList.toggle('is-done', ok);
  setTimeout(() => { btn.textContent = label; btn.classList.remove('is-done'); }, 1600);
  toast(ok ? UI.copied : UI.copyFailed);
}
for (const btn of $$('.copy-btn')) {
  btn.addEventListener('click', async () => flash(btn, await copyText(btn.parentElement.querySelector('pre').textContent)));
}
addEventListener('site:copied', (e) => flash(e.detail.button, e.detail.ok));

// ── Tabs (install): arrow keys move between tabs ──
for (const list of $$('.tabs [role="tablist"]')) {
  const tabs = $$('[role="tab"]', list);
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}

// ── Lightbox for the comparison figure ──
const box = $('#lightbox');
let lastFocus = null;
function closeBox() {
  box.hidden = true;
  box.classList.remove('is-full');
  document.body.style.overflow = '';
  lastFocus?.focus();
}
for (const btn of $$('[data-zoom]')) {
  btn.addEventListener('click', () => {
    lastFocus = btn;
    const img = $('img', box);
    img.src = btn.dataset.zoom;
    img.alt = btn.dataset.zoomAlt || '';
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.lightbox-close', box).focus();
  });
}
if (box) {
  $('.lightbox-close', box).addEventListener('click', closeBox);
  $('img', box).addEventListener('click', () => box.classList.toggle('is-full'));
  box.addEventListener('click', (e) => { if (e.target === box || e.target.classList.contains('lightbox-stage')) closeBox(); });
  addEventListener('keydown', (e) => { if (!box.hidden && e.key === 'Escape') closeBox(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); $('.lightbox-close', box).focus(); } });
}

// ── Video player: load when near, keep its colors in step with the site ──
const video = $('#video-frame');
function syncFrameMode(frame) {
  try {
    const doc = frame.contentDocument;
    if (doc?.documentElement) doc.documentElement.setAttribute('data-mode', root.dataset.mode);
  } catch { /* another origin: leave it */ }
}
if (video) {
  video.addEventListener('load', () => syncFrameMode(video));
  addEventListener('site:mode', () => syncFrameMode(video));
  const load = () => { if (!video.src) video.src = video.dataset.src; };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { load(); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(video);
  } else load();
}

// ── The playground and the live demos load once the page is idle ──
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
// If the scripts cannot load, the hero shows the page the build prerendered.
function heroFallback() {
  const demo = $('#hero-demo');
  const frame = demo && $('.demo-frame', demo);
  if (!frame) return;
  frame.src = `${root.dataset.base || ''}prerender/${UI.lang === 'zh' ? 'tcp-zh.html' : 'tcp-en.html'}`;
  frame.style.setProperty('--s', String($('.demo-page', demo).clientWidth / 1280));
  demo.classList.add('is-done', 'is-plotted', 'is-static');
  $('.demo-status', demo).textContent = UI.fallback;
  $('.demo-note', demo).innerHTML = UI.fallbackNote;
}
idle(() => import('./playground.js').catch((err) => {
  console.error('playground failed to load', err);
  heroFallback();
}), { timeout: 900 });
