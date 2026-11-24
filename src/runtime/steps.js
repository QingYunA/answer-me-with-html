// ── Steps block: the bar, the boxes and the clicks ─────────────
// The markup already carries every step (a number on its item and its first line, a list under the pair), so a page with no script still reads.
// This script makes the block live: a bar with Previous, Next and the step count; a click on an item or on a line number boxes the lines of its
// step and shows the note above them; the arrow keys move and Esc clears. The css hides the static numbers and the list while am-steps--live is on,
// on screen only, so print and image export show the numbers.
(() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));

  for (const root of document.querySelectorAll('.am-steps')) {
    const total = Number(root.dataset.steps);
    const linked = [...root.querySelectorAll('[data-link]')].filter((el) => !el.closest('.am-steps-list'));
    const lines = linked.filter((el) => el.classList.contains('am-ln'));
    const items = linked.filter((el) => !el.classList.contains('am-ln'));
    const groups = [...root.querySelectorAll('g[data-ends]')].map((g) => ({ ends: g.dataset.ends.split(' '), edge: g.querySelector('.am-edge') }));

    const button = (kind, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'am-btn';
      b.dataset.steps = kind;
      b.textContent = label;
      return b;
    };
    const bar = document.createElement('div');
    bar.className = 'am-steps-bar';
    bar.dataset.exportSkip = '';
    const prev = button('prev', root.dataset.prev);
    const next = button('next', root.dataset.next);
    const count = document.createElement('span');
    count.className = 'am-steps-count';
    count.setAttribute('aria-live', 'polite');
    bar.append(prev, count, next);
    root.prepend(bar);
    root.classList.add('am-steps--live');

    let current = -1;
    let note = null;
    const of = (list, i) => list.filter((el) => el.dataset.link === String(i));

    function select(i, { scroll = true } = {}) {
      for (const el of root.querySelectorAll('.am-step-on')) el.classList.remove('am-step-on', 'am-step-first', 'am-step-last');
      for (const el of items) el.classList.remove('am-step-sel');
      for (const { edge } of groups) edge?.classList.remove('am-step-edge');
      note?.remove();
      note = null;
      current = i;
      prev.disabled = i <= 0;
      next.disabled = i >= total - 1;
      if (i < 0) {
        count.textContent = root.dataset.idle;
        return;
      }
      count.textContent = fill(root.dataset.count, { n: i + 1, m: total });
      const boxed = of(lines, i);
      for (const l of boxed) l.classList.add('am-step-on');
      boxed[0]?.classList.add('am-step-first');
      boxed.at(-1)?.classList.add('am-step-last');
      for (const el of of(items, i)) el.classList.add('am-step-sel');
      for (const { ends, edge } of groups) if (ends.includes(String(i))) edge?.classList.add('am-step-edge');
      const text = root.querySelector(`.am-steps-list li[data-link="${i}"] .am-steps-text`);
      if (text && boxed[0]) {
        note = document.createElement('span');
        note.className = 'am-steps-note';
        note.dataset.exportSkip = '';
        note.append(...text.cloneNode(true).childNodes);
        boxed[0].before(note);
      }
      if (scroll) (note ?? boxed[0])?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }
    const step = (by) => { if (by > 0 || current >= 0) select(Math.min(total - 1, Math.max(0, current + by))); };

    // The number sits in the start padding of its line; a click on the code text is left to text selection.
    const inGutter = (line, e) => {
      const style = getComputedStyle(line);
      const rect = line.getBoundingClientRect();
      const x = style.direction === 'rtl' ? rect.right - e.clientX : e.clientX - rect.left;
      return x <= parseFloat(style.paddingInlineStart) - 6;
    };

    root.addEventListener('click', (e) => {
      const pressed = e.target.closest('.am-steps-bar button');
      if (pressed) return step(pressed.dataset.steps === 'next' ? 1 : -1);
      const el = e.target.closest('[data-link]');
      if (!el || el.closest('.am-steps-list')) return;
      const isLine = el.classList.contains('am-ln');
      if (isLine && !inGutter(el, e)) return;
      select(Number(el.dataset.link), { scroll: !isLine });
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target.closest('[data-link]');
      const item = el && !el.classList.contains('am-ln') && !el.closest('.am-steps-list') ? el : null;
      if (item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        select(Number(item.dataset.link));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const rtl = getComputedStyle(root).direction === 'rtl';
        step((e.key === 'ArrowRight') !== rtl ? 1 : -1);
        if (item) of(items, current)[0]?.focus();
      } else if (e.key === 'Escape') {
        select(-1);
      }
    });
    select(-1);
  }
})();
