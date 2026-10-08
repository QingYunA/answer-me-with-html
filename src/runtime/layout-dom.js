// DOM adapter for the sheet's justified ("photo wall") layout. Not a module: compose.js puts it after src/runtime/layout-plan.js
// (which defines planLayout and the shared STEP, MAX_SCALE, MIN_SCALE) inside one function scope of the page script.
//
// It measures every panel at sampled widths, asks planLayout for rows and column widths, and applies them with flexbox.
// The rendered HTML keeps the plain CSS grid: with JavaScript off, at the single-column breakpoint, or while printing, the grid is what
// shows (the planned widths belong to the screen width, so print never gets a mix of the two); after printing the layout comes back.

const grid = document.querySelector('.am-grid');
const panels = grid ? [...grid.children].filter((el) => el.classList.contains('am-panel')) : [];

if (panels.length > 1) {
  const SINGLE_COLUMN = '(max-width: 760px)'; // the single-column breakpoint in src/themes/base.css
  const TWO_COLUMNS = '(max-width: 1100px)'; // below this the CSS grid has two columns
  const SAMPLE_STEP = 20; // width sampling step, px; the planner interpolates between samples
  const TEXT_MIN = 260; // text keeps at least about 16 CJK characters per line
  const TABLE_COL_MIN = 96; // per table column, px
  const DIAGRAM_MIN = 160;
  const RESIZE_DELAY = 150;
  const OVERFLOWING = '.am-table-wrap, .am-diagram, .am-annot-scroll, pre';

  const original = new Map([grid, ...panels, ...grid.querySelectorAll('.am-diagram > svg')].map((el) => [el, el.getAttribute('style')]));
  const restoreStyle = (el) => (original.get(el) === null ? el.removeAttribute('style') : el.setAttribute('style', original.get(el)));

  // Back to the plain grid markup and styles.
  const restore = () => {
    for (const box of grid.querySelectorAll(':scope > .am-col')) box.replaceWith(...box.children);
    for (const el of original.keys()) restoreStyle(el);
  };

  // The author's width hint, rendered as data-span only when the author wrote one. The inline grid-column is the no-JavaScript fallback
  // and may hold spans the server added, so it is never read here.
  const spanHint = (el) => Number(el.dataset.span) || 1;
  const diagramOnly = (el) => {
    const body = el.querySelector(':scope > .am-panel-body');
    return body && body.children.length === 1 ? body.querySelector(':scope > .am-diagram > svg') : null;
  };
  const naturalWidth = (svg) => Number(svg.getAttribute('width')) || 0;

  // Height (and, for panels with tables or code, the narrowest width without sideways scrolling) at sampled widths.
  // Only one panel is displayed while it is measured, so each width change lays out that panel alone.
  function measure(width) {
    grid.style.display = 'block';
    for (const el of panels) {
      el.style.display = 'none';
      el.style.boxSizing = 'border-box';
      for (const svg of el.querySelectorAll('.am-diagram > svg')) {
        svg.style.width = '100%';
        svg.style.maxWidth = `${naturalWidth(svg) * MAX_SCALE}px`;
      }
    }
    const info = panels.map((el) => {
      const svg = diagramOnly(el);
      const svgs = [...el.querySelectorAll('.am-diagram > svg')];
      const scrollers = el.querySelectorAll(OVERFLOWING);
      const tableCols = Math.max(0, ...[...el.querySelectorAll('table tr:first-child')].map((tr) => tr.children.length));
      el.style.display = '';
      el.style.width = `${width}px`;
      const pad = svg ? el.offsetWidth - svg.parentElement.clientWidth : 0;
      const natural = svg ? naturalWidth(svg) : 0;
      const shrunk = Math.max(0, ...svgs.map((s) => naturalWidth(s) * MIN_SCALE)) + (svg ? pad : 34);
      const floor = svg ? Math.max(DIAGRAM_MIN, natural * MIN_SCALE + pad) : Math.max(TEXT_MIN, shrunk, tableCols * TABLE_COL_MIN + 34);
      const from = Math.min(width, Math.floor(floor / STEP) * STEP);
      const samples = [];
      let fits = null;
      for (let w = from; ; w += SAMPLE_STEP) {
        w = Math.min(w, width);
        el.style.width = `${w}px`;
        if (fits === null && !svg && scrollers.length && ![...scrollers].some((s) => s.scrollWidth > s.clientWidth + 1)) fits = w;
        samples.push({ w, h: el.offsetHeight });
        if (w === width) break;
      }
      el.style.display = 'none';
      return {
        samples,
        minWidth: svg ? floor : Math.max(floor, fits ?? (scrollers.length ? width : 0)),
        maxWidth: svg ? natural * MAX_SCALE + pad : Infinity,
        natural,
        pad,
        span: spanHint(el),
      };
    });
    for (const el of panels) {
      el.style.display = '';
      el.style.width = '';
    }
    return info;
  }

  // Each column gets a fixed width. A row adds up to the full width, so flex-wrap breaks rows by itself.
  // Stacked panels go into a column wrapper whose last panel absorbs the extra height.
  function apply(plan, gap) {
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.alignItems = 'stretch';
    grid.style.gap = `${gap}px`;
    for (const el of panels) {
      el.style.gridColumn = '';
      el.style.gridRow = '';
      el.style.flex = '0 0 auto';
    }
    for (const row of plan.rows) {
      for (const col of row.columns) {
        const width = `${col.width}px`;
        if (col.panels.length === 1) {
          panels[col.panels[0]].style.width = width;
          continue;
        }
        const box = document.createElement('div');
        box.className = 'am-col';
        box.style.cssText = `width:${width};flex:0 0 auto;display:flex;flex-direction:column;gap:${gap}px`;
        panels[col.panels[0]].before(box);
        for (const k of col.panels) {
          panels[k].style.width = '';
          box.append(panels[k]);
        }
        panels[col.panels[col.panels.length - 1]].style.flex = '1 1 auto';
      }
    }
  }

  // Diagram-only panels show their diagram at most at the top of the page's scale band; a wider panel gains empty space instead.
  function capDiagrams(maxScale) {
    for (const el of panels) {
      const svg = diagramOnly(el);
      if (svg) svg.style.maxWidth = `${naturalWidth(svg) * maxScale}px`;
    }
  }

  const containerWidth = () => Math.floor(grid.getBoundingClientRect().width);

  function justify() {
    if (printing || printQuery.matches) return;
    try {
      // A vertical scrollbar can appear or vanish once the rows change height; plan again if the width moved.
      let planned = -1;
      for (let pass = 0; pass < 3 && planned !== containerWidth(); pass++) {
        restore();
        if (matchMedia(SINGLE_COLUMN).matches) return;
        planned = containerWidth();
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        const cols = Math.max(1, Number(getComputedStyle(grid).getPropertyValue('--cols')) || 3);
        const plan = planLayout({ width: planned, gap, cols: matchMedia(TWO_COLUMNS).matches ? Math.min(cols, 2) : cols, panels: measure(planned) });
        apply(plan, gap);
        capDiagrams(plan.maxScale);
      }
      // The width never settled: columns planned for another width would overflow or leave gaps, so show the plain grid.
      if (planned !== containerWidth()) restore();
    } catch {
      restore();
    }
  }

  // Printing: back to the plain grid (spans and all), and the layout again afterwards. Browsers disagree on which of the
  // `beforeprint` event and the print media query change fires first, or at all, so listen to both; both are idempotent.
  // While `printing` is set (beforeprint to afterprint) justify() does nothing, so a late resize cannot bring flex widths into the print layout.
  let printing = false;
  const printQuery = matchMedia('print');
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(justify, RESIZE_DELAY);
  };
  const toPrint = () => {
    clearTimeout(timer);
    restore();
  };
  justify();
  addEventListener('resize', later);
  addEventListener('beforeprint', () => {
    printing = true;
    toPrint();
  });
  addEventListener('afterprint', () => {
    printing = false;
    later();
  });
  printQuery.addEventListener('change', (e) => (e.matches ? toPrint() : later()));
  // Late changes to panel heights: web fonts arriving, and images inside the grid finishing their load (load does not bubble, so capture it).
  document.fonts?.ready.then(later);
  grid.addEventListener('load', later, true);
  // Switching theme changes paddings and fonts, hence panel heights.
  document.querySelector('[data-am="theme"]')?.addEventListener('click', later);
}
