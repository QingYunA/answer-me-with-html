// ── Steps block: the bar, the boxes and the clicks ─────────────
// The markup already carries every step (a number on its item and its first line, a list under the pair), so a page with no script still reads.
// This script makes the block live: a bar with Previous, Next and the step count; a click on an item or on a line number boxes the lines of its
// step and shows the note above them; the arrow keys move and Esc clears. The css hides the static numbers and the list while am-steps--live is on,
// on screen only, so print and image export show the numbers. The block can take focus (tabindex -1), so a click on a line number leaves the keys working.
// Explain mode (data-mode="explain", no code): the list stays on the page and is the other side of the pair. Its entries become buttons, the
// selected step marks its entry (aria-current="step"), and there is no note. The page is not scrolled to the entry; focus() scrolls it when a key moved the focus.
(() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));

  for (const root of document.querySelectorAll('.am-steps')) {
    const total = Number(root.dataset.steps);
    const linked = [...root.querySelectorAll('[data-link]')].filter((el) => !el.closest('.am-steps-list'));
    const lines = linked.filter((el) => el.classList.contains('am-ln'));
    const items = linked.filter((el) => !el.classList.contains('am-ln'));
    const entries = [...root.querySelectorAll('.am-steps-entry[data-link]')];
    for (const entry of entries) {
      entry.setAttribute('role', 'button');
      entry.tabIndex = 0;
    }
    const groups = [...root.querySelectorAll('g[data-ends]')].map((g) => ({ ends: g.dataset.ends.split(' '), edge: g.querySelector('.am-edge') }));

    const button = (kind, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'am-btn';
      b.dataset.steps = kind;
      b.textContent = label;
      b.setAttribute('aria-label', label.replace(/[←→]/g, '').trim());
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
    const hint = document.createElement('span');
    hint.className = 'am-steps-hint';
    hint.textContent = root.dataset.hint;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', root.dataset.bar);
    bar.append(prev, count, next, hint);
    root.tabIndex = -1;
    root.prepend(bar);
    root.classList.add('am-steps--live');

    let current = -1;
    let note = null;
    const of = (list, i) => list.filter((el) => el.dataset.link === String(i));
    const listed = (i, part) => root.querySelector(`.am-steps-list [data-link="${i}"] .am-steps-${part}`);

    // A button that has the focus keeps the keys of the block only while it is enabled: the browser moves the focus of a disabled one out of the block.
    const enable = (button, on) => {
      if (!on && document.activeElement === button) root.focus({ preventScroll: true });
      button.disabled = !on;
    };

    function select(i, { scroll = true } = {}) {
      for (const el of root.querySelectorAll('.am-step-on')) el.classList.remove('am-step-on', 'am-step-first', 'am-step-last');
      for (const el of items) el.classList.remove('am-step-sel');
      for (const el of entries) {
        el.classList.remove('am-step-current');
        el.removeAttribute('aria-current');
      }
      for (const { edge } of groups) edge?.classList.remove('am-step-edge');
      note?.remove();
      note = null;
      current = i;
      enable(prev, i > 0);
      enable(next, i < total - 1);
      if (i < 0) {
        count.textContent = root.dataset.idle;
        return;
      }
      count.textContent = fill(root.dataset.count, { n: i + 1, m: total, item: listed(i, 'item')?.textContent ?? '' });
      const boxed = of(lines, i);
      for (const l of boxed) l.classList.add('am-step-on');
      boxed[0]?.classList.add('am-step-first');
      boxed.at(-1)?.classList.add('am-step-last');
      for (const el of of(items, i)) el.classList.add('am-step-sel');
      for (const el of of(entries, i)) {
        el.classList.add('am-step-current');
        el.setAttribute('aria-current', 'step');
      }
      for (const { ends, edge } of groups) if (ends.includes(String(i))) edge?.classList.add('am-step-edge');
      if (boxed[0]) {
        note = document.createElement('span');
        note.className = 'am-steps-note';
        note.dataset.exportSkip = '';
        const head = document.createElement('strong');
        head.append(`${i + 1}. `, ...listed(i, 'item').cloneNode(true).childNodes);
        note.append(head);
        const text = listed(i, 'text');
        if (text) note.append(' ', ...text.cloneNode(true).childNodes);
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
      if (!el || (el.closest('.am-steps-list') && !el.classList.contains('am-steps-entry')) || e.target.closest('a')) return;
      const isLine = el.classList.contains('am-ln');
      if (isLine && !inGutter(el, e)) return;
      select(Number(el.dataset.link), { scroll: !isLine });
      if (isLine) root.focus({ preventScroll: true });
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target.closest('[data-link]');
      const pickable = el && !el.classList.contains('am-ln') && (!el.closest('.am-steps-list') || el.classList.contains('am-steps-entry'));
      const item = pickable && !e.target.closest('a') ? el : null;
      if (item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        select(Number(item.dataset.link));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const rtl = getComputedStyle(root).direction === 'rtl';
        step((e.key === 'ArrowRight') !== rtl ? 1 : -1);
        if (item) (item.classList.contains('am-steps-entry') ? of(entries, current) : of(items, current))[0]?.focus();
      } else if (e.key === 'Escape') {
        select(-1);
      }
    });
    select(-1);
  }
})();
