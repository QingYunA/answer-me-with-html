
// ── Change markers: the Before / Changes / After switch ─────────────
// The switch starts hidden because it needs this script. It sets data-delta-view on its diagram; the delta styles hide the items that do not exist in that view.
(() => {
  for (const bar of document.querySelectorAll('.am-delta-bar')) {
    const view = bar.closest('[data-delta-view]');
    const group = bar.querySelector('.am-delta-switch');
    if (!view || !group) continue;
    group.hidden = false;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      view.dataset.deltaView = btn.dataset.view;
      for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
    });
  }
  // The expand button copies only the drawing into the viewer; the viewer shows the view the diagram is in.
  document.addEventListener('click', (e) => {
    const view = e.target.closest?.('.am-diagram-expand')?.closest('[data-delta-view]');
    const canvas = document.querySelector('.am-lightbox-canvas');
    if (view && canvas) canvas.dataset.deltaView = view.dataset.deltaView;
  });
})();
