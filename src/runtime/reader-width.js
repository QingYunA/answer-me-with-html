(() => {
  const box = document.querySelector('main[data-am-resizable]');
  const panel = document.querySelector('.am-width-panel'), handles = [...document.querySelectorAll('.am-width-handle')];
  if (!box || !panel || !handles.length) return;
  const cards = [...box.querySelectorAll('.am-panel')].filter(card => !card.parentElement.closest('.am-panel'));
  let frame = 0;
  function positionHandles() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const outer = box.getBoundingClientRect();
      const rects = cards.map(card => card.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      if (!rects.length) rects.push(box.querySelector('.am-frame, .am-doc-body')?.getBoundingClientRect() ?? outer);
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      for (const handle of handles) {
        const x = handle.dataset.side === 'left' ? Math.min(...rects.map(rect => rect.left)) : Math.max(...rects.map(rect => rect.right));
        handle.style.left = `${x - outer.left - box.clientLeft}px`;
        handle.style.top = `${top - outer.top - box.clientTop}px`;
        handle.style.height = `${bottom - top}px`;
      }
    });
  }
  if (typeof ResizeObserver === 'function') {
    const borders = new ResizeObserver(positionHandles);
    for (const element of [box, ...cards]) borders.observe(element);
  }
  const range = panel.querySelector('[type=range]'), number = panel.querySelector('[type=number]');
  const key = 'am:reader-width:v1:' + location.origin + location.pathname;
  const max = () => Math.max(1, document.documentElement.clientWidth);
  const min = () => Math.max(1, Math.min(320, Math.floor(max() * 0.75)));
  const clamp = n => Math.min(max(), Math.max(min(), n));
  let state = null, drag = null, focusState = null;
  const save = () => { try { if (state === null) localStorage.removeItem(key); else localStorage.setItem(key, String(state)); } catch {} };
  function apply(value) {
    state = value;
    box.toggleAttribute('data-am-width-full', value === 'full');
    if (typeof value === 'number') box.style.setProperty('--am-reader-width', clamp(value) + 'px');
    else box.style.removeProperty('--am-reader-width');
    if (box.classList.contains('am-sheet')) dispatchEvent(new Event('am-reader-width'));
    positionHandles();
    const width = typeof value === 'number' ? Math.round(clamp(value)) : Math.round(box.getBoundingClientRect().width);
    for (const input of [range, number]) { input.min = min(); input.max = max(); input.value = clamp(width); }
    for (const h of handles) { h.hidden = max() < 344; h.setAttribute('aria-valuemin', min()); h.setAttribute('aria-valuemax', max()); h.setAttribute('aria-valuenow', clamp(width)); }
  }
  try { const v = localStorage.getItem(key); if (v === 'full') state = v; else if (v && Number.isFinite(Number(v)) && Number(v) > 0) state = Number(v); } catch {}
  apply(state);
  addEventListener('resize', () => apply(state));
  range.addEventListener('input', () => apply(Number(range.value))); range.addEventListener('change', save);
  number.addEventListener('change', () => { if (Number.isFinite(number.valueAsNumber)) { apply(clamp(number.valueAsNumber)); save(); } });
  panel.querySelector('[data-width=full]').addEventListener('click', () => { apply('full'); save(); });
  panel.querySelector('[data-width=reset]').addEventListener('click', () => { apply(null); save(); });
  const end = cancel => {
    if (!drag) return;
    const old = drag.old;
    drag = null;
    document.body.classList.remove('am-width-drag');
    if (cancel) apply(old); else save();
  };
  window.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.pointerId) apply(clamp(drag.width + 2 * drag.direction * (e.clientX - drag.x)));
  });
  window.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pointerId) end(false); });
  window.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pointerId) end(true); });
  window.addEventListener('blur', () => end(true));
  for (const h of handles) {
    h.addEventListener('pointerdown', e => {
      if (drag || e.button !== 0) return;
      e.preventDefault();
      h.focus({ preventScroll: true });
      drag = { pointerId: e.pointerId, old: state, x: e.clientX, width: box.getBoundingClientRect().width, direction: h.dataset.side === 'right' ? 1 : -1 };
      h.setPointerCapture(e.pointerId);
      document.body.classList.add('am-width-drag');
    });
    h.addEventListener('focus', () => { focusState = state; });
    h.addEventListener('keydown', e => { if (e.key === 'Escape') { if (drag) end(true); else { apply(focusState); save(); } return; } let n = box.getBoundingClientRect().width; if (e.key === 'Home') n = min(); else if (e.key === 'End') n = max(); else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') n += (e.key === 'ArrowRight' ? 1 : -1) * (h.dataset.side === 'right' ? 1 : -1) * (e.shiftKey ? 64 : 16); else return; e.preventDefault(); apply(clamp(n)); save(); });
  }
})();
