import { esc } from '../svg/text.js';

// `hints.span` is the span the author wrote; it becomes data-span for the layout script. The inline grid styles come from `panel.attrs`
// (which may include spans added by the server) and are only the fallback without JavaScript. `rows` is not a hint for the layout
// script: it only shapes the plain grid.
export function panelHtml(panel, { cols = 3, grid = true, hints = {} } = {}) {
  const { attrs } = panel;
  const span = Math.min(Number(attrs.span) || 1, cols);
  const rows = Number(attrs.rows) || 1;
  const layout = [
    grid && span > 1 ? `grid-column: span ${span}` : '',
    grid && rows > 1 ? `grid-row: span ${rows}` : '',
  ].filter(Boolean).join('; ');
  const style = layout ? ` style="${layout}"` : '';
  const hinted = Math.floor(Number(hints.span));
  const data = grid && hinted >= 1 ? ` data-span="${Math.min(hinted, cols)}"` : '';
  const cls = `${span > 1 ? ' am-span-wide' : ''}${attrs.bare ? ' am-panel--bare' : ''}`;
  const meta = attrs.meta ? `<span class="am-panel-meta">${esc(attrs.meta)}</span>` : '';
  const head = attrs.bare
    ? ''
    : `<header class="am-panel-head"><span class="am-panel-id">${esc(panel.id)}</span><h2>${esc(panel.title)}</h2>${meta}</header>\n`;
  return `<section class="am-panel${cls}" id="panel-${esc(panel.id)}"${style}${data}>
${head}<div class="am-panel-body">${panel.html}</div>
</section>`;
}

const RESERVED = new Set(['template', 'theme', 'style', 'mode', 'cols', 'title', 'subtitle', 'lang']);

// language: the page language. Its metaKeys name common keys in the page language (author in Hebrew). On a right-to-left page the value
// sits in its own <bdi>, so a key and a value of different directions do not run together ("date7.10.2026").
export function headHtml(meta, introHtml, language = {}) {
  const extras = Object.entries(meta).filter(([k, v]) => !RESERVED.has(k) && v !== '');
  const names = language.metaKeys ?? {};
  const value = (v) => (language.dir === 'rtl' ? `<bdi>${esc(v)}</bdi>` : esc(v));
  const metaRow = extras.length
    ? `<div class="am-head-meta">${extras.map(([k, v]) => `<span><b>${esc(names[k.toLowerCase()] ?? k)}</b>${value(v)}</span>`).join('')}</div>`
    : '';
  const sub = meta.subtitle ? `<p class="am-sub">${esc(meta.subtitle)}</p>` : '';
  const intro = introHtml ? `<div class="am-intro am-md">${introHtml}</div>` : '';
  return `<header class="am-head"><h1>${esc(meta.title || 'Untitled')}</h1>${sub}${metaRow}${intro}</header>`;
}
