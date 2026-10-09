// doc: linear explanation. Single-column reading, with a table of contents on the left when there are 3 or more panels.
import { panelHtml, headHtml } from './panel.js';
import { esc } from '../svg/text.js';

export function doc({ meta, introHtml, panels, ui, language }) {
  const withToc = panels.length >= 3;
  const toc = withToc
    ? `<nav class="am-toc" aria-label="${esc(ui?.toc ?? 'Contents')}">${panels.map((p) => `<a href="#panel-${esc(p.id)}">${esc(p.id)} · ${esc(p.title)}</a>`).join('')}</nav>`
    : '';
  return `<main class="am-doc">
${headHtml(meta, introHtml, language)}
<div class="am-doc-layout${withToc ? '' : ' am-doc-layout--notoc'}">
${toc}<div class="am-doc-body">
${panels.map((p) => panelHtml(p, { grid: false })).join('\n')}
</div>
</div>
</main>`;
}
