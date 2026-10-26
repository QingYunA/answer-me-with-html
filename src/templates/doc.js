// doc: linear explanation. Single-column reading; with 3 or more panels an outline rail (one tick per section) sits beside the body.
import { panelHtml, headHtml } from './panel.js';
import { esc } from '../svg/text.js';

// The rail is native markup: <details> opens the list and the links jump with no script; src/runtime/outline.js only enhances it.
// "left" and "right" are the inline-start and inline-end side of the body, so they mirror on a right-to-left page.
function outlineRail(panels, where, label) {
  const name = esc(label);
  const ticks = panels.map((p) => `<i class="am-tick" data-id="${esc(p.id)}" data-title="${esc(p.id)} · ${esc(p.title)}"></i>`).join('');
  const links = panels.map((p) => `<li><a href="#panel-${esc(p.id)}">${esc(p.id)} · ${esc(p.title)}</a></li>`).join('');
  return `<nav class="am-toc" aria-label="${name}" data-side="${where}" data-flow="in"><details class="am-outline"><summary aria-label="${name}"><span class="am-ticks" aria-hidden="true">${ticks}</span></summary><ol class="am-outline-list">${links}</ol></details></nav>\n`;
}

export function doc({ meta, introHtml, panels, ui, language }) {
  const withToc = panels.length >= 3;
  const where = meta.outline === 'left' ? 'start' : 'end';
  const toc = withToc ? outlineRail(panels, where, ui?.toc ?? 'Contents') : '';
  return `<main class="am-doc">
${headHtml(meta, introHtml, language)}
<div class="am-doc-layout${withToc ? ` am-doc-layout--rail-${where}` : ''}">
${toc}<div class="am-doc-body">
${panels.map((p) => panelHtml(p, { grid: false })).join('\n')}
</div>
</div>
</main>`;
}
