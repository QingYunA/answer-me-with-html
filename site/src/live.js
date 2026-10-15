// What the pages that run the real renderer share (playground.js on the home page, theme.js on a theme page):
// the engine and the preset drafts, each loaded once, and the sandboxed iframes that show a rendered page.
const root = document.documentElement;
export const UI = JSON.parse(document.getElementById('site-ui').textContent);
export const BASE = root.dataset.base || '';
export const siteMode = () => (root.dataset.mode === 'dark' ? 'dark' : 'light');

export const whenNear = (el, fn, margin = '400px') => {
  if (!el) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: `${margin} 0px` });
  io.observe(el);
};

// ── Engine and presets, each loaded once ──
let enginePromise = null;
let loaded = null;
export const engine = () => (enginePromise ??= import('./engine.js').then((m) => (loaded = m)));
let presetsPromise = null;
export const presets = () => (presetsPromise ??= fetch(`${BASE}presets/index.json`).then((r) => {
  if (!r.ok) throw new Error(`presets/index.json: HTTP ${r.status}`);
  return r.json();
}));
// The Chinese page uses a <name>.zh variant when there is one.
export const pick = (all, key) => (UI.lang === 'zh' && all[`${key}.zh`]) || all[key] || '';

// render() never throws for draft errors; a bug in the renderer becomes an error result too.
// options.extra: theme definitions (themeFromFile in engine.js) the draft may use besides the built-in ones.
export async function renderDraft(source, overrides, options) {
  const { render, prepare } = await engine();
  try {
    await prepare(source);
    return render(source, overrides, options);
  } catch (err) {
    return { ok: false, ms: 0, error: { name: 'Error', message: String(err?.message || err) } };
  }
}

// ── Frames: rendered pages go into sandboxed srcdoc iframes. A small script reports the page height and scroll. ──
// Scaled previews hide the page's own toolbar and scrollbars, so the page fills its frame edge to edge.
export { HIDE_CHROME } from './chrome.js';

export function framed(html, { id, css = '', scroll = 0 }) {
  const body = `(function(){var id=${JSON.stringify(id)};var y=${Math.round(scroll)};` +
    'function s(){parent.postMessage({amFrame:id,h:Math.ceil(document.documentElement.scrollHeight),y:scrollY},"*")}' +
    'addEventListener("load",function(){if(y)scrollTo(0,y);s();setTimeout(s,300)});' +
    'addEventListener("scroll",function(){clearTimeout(window.__t);window.__t=setTimeout(s,120)},{passive:true});' +
    'if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)})()';
  const reporter = `<script>${body}</script>`;
  // The page the engine renders only runs scripts its policy lists, so the reporter is listed too.
  if (loaded) html = loaded.pinScript(html, body);
  const style = css ? `<style>${css}</style>` : '';
  return html.replace('</head>', `${style}</head>`).replace(/<\/body>\s*<\/html>\s*$/, `${reporter}</body></html>`);
}
export const frameListeners = new Map();
addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data.amFrame !== 'string') return;
  const fn = frameListeners.get(data.amFrame);
  if (fn) fn(data, e.source);
});

// Scale a fixed-width iframe to the width of its box.
export function scaleToBox(frame, box, width) {
  const set = () => frame.style.setProperty('--s', String(box.clientWidth / width));
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(box);
}
