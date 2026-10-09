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
  const TABLE_COL_COMFORT = 220; // a table column this wide reads three or four words per line
  const KV_COL_MIN = 120; // per key-value column, px: a value of two short words stays on one line
  const TIMELINE_ITEM_MIN = 120; // per horizontal timeline item, px: the time, title and note stay readable
  const DIAGRAM_MIN = 160;
  const RESIZE_DELAY = 150;
  const OVERFLOWING = '.am-table-wrap, .am-diagram, .am-annot-scroll, pre';

  // The first-row cells of each table carry the column widths fitTables() sets, so restore() resets them too.
  const tables = [...grid.querySelectorAll('.am-table-wrap > table')];
  const headCells = (table) => [...(table.rows[0]?.cells ?? [])];
  const original = new Map([grid, ...panels, ...grid.querySelectorAll('.am-diagram > svg'), ...tables.flatMap(headCells)].map((el) => [el, el.getAttribute('style')]));
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

  // The width each column of a table reads well at: its natural width, but no wider than TABLE_COL_COMFORT unless its longest word
  // needs more. Below it the cells wrap one word per line, so a panel with a table is not planned narrower than the sum, and
  // fitTables() keeps each column at its share (the browser would otherwise give the room to the longest column).
  const columnWidths = new Map();
  function comfortableWidth(table) {
    const saved = table.getAttribute('style');
    const columns = (width) => {
      table.style.width = width;
      return headCells(table).map((cell) => cell.getBoundingClientRect().width);
    };
    const most = columns('max-content');
    const least = columns('min-content');
    if (saved === null) table.removeAttribute('style');
    else table.setAttribute('style', saved);
    // A max-content column comes out a fraction under its text in Chrome, enough to wrap the last word, so it gets one pixel more.
    const want = most.map((w, i) => Math.min(Math.ceil(w) + 1, Math.max(least[i], TABLE_COL_COMFORT)));
    columnWidths.set(table, { least, want });
    return want.reduce((sum, w) => sum + w, 0);
  }

  // After the layout: each column gets at least its comfortable width, scaled down toward its longest word when the panel came out
  // narrower than planned (a page narrower than the table), so a table scrolls sideways only when even its longest words do not fit.
  function fitTables() {
    for (const [table, { least, want }] of columnWidths) {
      // Each width is rounded up to a whole pixel (a column a fraction too narrow wraps its last word), so keep a pixel per column spare.
      const room = table.parentElement.clientWidth - want.length;
      const low = least.reduce((s, w) => s + w, 0);
      const high = want.reduce((s, w) => s + w, 0);
      const k = high > room ? Math.max(0, (room - low) / (high - low || 1)) : 1;
      headCells(table).forEach((cell, i) => { cell.style.minWidth = `${Math.ceil(least[i] + (want[i] - least[i]) * k)}px`; });
    }
  }

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
      const tableFloors = [...el.querySelectorAll('.am-table-wrap > table')].map((t) => comfortableWidth(t) + el.offsetWidth - t.parentElement.clientWidth);
      // A key-value grid gets the same care: the room a table gains must not squeeze a neighbouring grid to one word per line.
      const kvs = [...el.querySelectorAll('.am-kv')].map((kv) => (Number(kv.style.getPropertyValue('--kv-cols')) || 1) * KV_COL_MIN + el.offsetWidth - kv.clientWidth);
      // A horizontal timeline is not a scroller: its items share the width, so the floor is what keeps the labels apart.
      const timelines = [...el.querySelectorAll('.am-timeline--h')].map((tl) => (Number(tl.style.getPropertyValue('--n')) || 1) * TIMELINE_ITEM_MIN + el.offsetWidth - tl.clientWidth);
      const floor = svg ? Math.max(DIAGRAM_MIN, natural * MIN_SCALE + pad) : Math.max(TEXT_MIN, shrunk, tableCols * TABLE_COL_MIN + 34, ...tableFloors, ...kvs, ...timelines);
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
        fitTables();
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
