// Remark mode: highlight a block, tag it, add a note. Marks live in localStorage like panel comments,
// and the Reply button carries them next to the decisions and comments (remarkText in reply-text.js).
(() => {
  const btn = document.querySelector('[data-am="remark"]');
  if (!btn) return;
  const ui = JSON.parse(btn.dataset.ui);
  const KINDS = ['suggestion', 'keep', 'question', 'concern'];
  const storeKey = `am-remark:${location.pathname}`;
  // Annotatable content: the direct children a reader can point at. Deeper elements are reached through them.
  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,dd,dt,figure';
  const root = document.documentElement;
  const pop = document.createElement('div');
  pop.className = 'am-remark-pop';
  pop.hidden = true;
  document.body.append(pop);

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(storeKey)) || [];
    } catch {
      return [];
    }
  };
  const save = (marks) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(marks));
    } catch {
      // Storage may be off; marks then last until the page closes.
    }
  };

  const panelOf = (el) => el.closest('.am-panel')?.id.replace(/^panel-/, '') ?? '';
  // Identity of a block: panel, tag, and the text fingerprint — no index, so edits around it do not detach it.
  const keyOf = (el) => `${panelOf(el)}|${el.tagName}|${fingerprint(el.textContent)}`;
  const marks = new Map(load().map((m) => [m.key, m]));
  const persist = () => save([...marks.values()]);

  const chip = (mark) => {
    const aside = document.createElement('aside');
    aside.className = 'am-mark-note';
    aside.dataset.kind = mark.kind;
    if (mark.note) aside.textContent = mark.note;
    else aside.textContent = ui.remark.kinds[mark.kind];
    return aside;
  };
  const paint = (el, mark) => {
    el.classList.add('am-mark');
    el.dataset.kind = mark.kind;
    const old = el.nextElementSibling;
    if (old?.classList.contains('am-mark-note')) old.remove();
    el.after(chip(mark));
  };
  const unpaint = (el) => {
    el.classList.remove('am-mark');
    delete el.dataset.kind;
    const old = el.nextElementSibling;
    if (old?.classList.contains('am-mark-note')) old.remove();
  };

  // Re-apply saved marks. A mark whose text is gone stays stored (it may return with `am patch`), just not painted.
  const repaint = () => {
    for (const el of document.querySelectorAll('.am-panel-body ' + BLOCK + ', main ' + BLOCK)) {
      const mark = marks.get(keyOf(el));
      if (mark) paint(el, mark);
    }
  };
  repaint();

  // The popover edits one block; Save writes the mark, Remove clears it.
  let target = null;
  const close = () => {
    pop.hidden = true;
    target = null;
  };
  const open = (el) => {
    target = el;
    const mark = marks.get(keyOf(el));
    pop.innerHTML = '';
    const row = Object.assign(document.createElement('div'), { className: 'am-remark-kinds' });
    for (const kind of KINDS) {
      const chipBtn = Object.assign(document.createElement('button'), {
        type: 'button', className: 'am-remark-kind', dataset: { kind },
        textContent: ui.remark.kinds[kind], title: ui.remark.kinds[kind],
      });
      if (mark?.kind === kind) chipBtn.classList.add('is-on');
      chipBtn.addEventListener('click', () => {
        pop.querySelectorAll('.am-remark-kind').forEach((b) => b.classList.remove('is-on'));
        chipBtn.classList.add('is-on');
      });
      row.append(chipBtn);
    }
    const note = Object.assign(document.createElement('textarea'), {
      rows: 2, placeholder: ui.remark.hint, value: mark?.note ?? '',
    });
    const actions = Object.assign(document.createElement('div'), { className: 'am-remark-actions' });
    const keep = Object.assign(document.createElement('button'), { type: 'button', className: 'am-btn', textContent: ui.remark.save });
    keep.addEventListener('click', () => {
      const kind = pop.querySelector('.am-remark-kind.is-on')?.dataset.kind;
      if (!kind) { close(); return; }
      const key = keyOf(target);
      marks.set(key, { key, panel: panelOf(target), quote: fingerprint(target.textContent, 60), kind, note: note.value });
      persist();
      paint(target, marks.get(key));
      close();
    });
    const drop = Object.assign(document.createElement('button'), { type: 'button', className: 'am-btn', textContent: ui.remark.remove });
    drop.addEventListener('click', () => {
      if (target) { marks.delete(keyOf(target)); persist(); unpaint(target); }
      close();
    });
    actions.append(keep, drop);
    pop.append(row, note, actions);
    pop.hidden = false;
    const rect = target.getBoundingClientRect();
    pop.style.top = `${Math.max(8, window.scrollY + rect.bottom + 6)}px`;
    pop.style.left = `${Math.min(window.innerWidth - 280, window.scrollX + rect.left)}px`;
  };

  // Picking only while remark mode is on; a click on a marked block edits it, on a plain block starts one.
  const pick = (e) => {
    const el = e.target.closest(BLOCK);
    if (!el || !el.closest('.am-panel-body, main') || e.target.closest('.am-remark-pop, .am-toolbar, a, button, input, textarea, select')) return;
    e.preventDefault();
    open(el);
  };
  const setMode = (on) => {
    root.dataset.remark = on ? 'on' : 'off';
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? ui.remark.on : ui.remark.off;
    document.body.removeEventListener('click', pick);
    if (on) document.body.addEventListener('click', pick);
  };
  btn.addEventListener('click', () => setMode(root.dataset.remark !== 'on'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); }, true);
  setMode(false);

  // The Reply button adds the marks after the comments (src/runtime/reply.js reads this when present).
  window.__amRemarkData = () => {
    const live = [];
    for (const el of document.querySelectorAll('.am-mark')) {
      const mark = marks.get(keyOf(el));
      if (mark) live.push(mark);
    }
    return live;
  };
  window.__amRemarkText = () => {
    const data = window.__amRemarkData();
    return data.length ? `\n\n## ${ui.remark.section}\n${remarkText(data, ui)}` : '';
  };
})();
