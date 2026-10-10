// Remark mode: the reader turns it on, clicks a block, tags it (suggestion, keep, question, concern) and may add a note.
// A mark shows as a bar and a note chip inside the block, lives in localStorage like panel comments, and the Reply button carries it
// back to the agent: reply.js calls window.__amRemarkData, and replyText (reply-text.js) writes the Remarks section.
(() => {
  const btn = document.querySelector('[data-am="remark"]');
  if (!btn) return;
  const ui = JSON.parse(btn.dataset.ui);
  const KINDS = ['suggestion', 'keep', 'question', 'concern'];
  const storeKey = `am-remark:${location.pathname}`;
  // The one definition of a block a reader can mark: the content under <main>. The page and panel titles are left out, because the
  // reply reads them as text; a panel has its Comment button.
  const BLOCK = 'main :is(h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,dd,dt,figure):not(.am-head *, .am-panel-head *)';
  // A click on these does what it always did.
  const LIVE = '.am-remark-pop, .am-toolbar, a, button, input, textarea, select, label';
  const blockAt = (target) => (target.closest(LIVE) ? null : target.closest(BLOCK));

  const WJ = new RegExp(String.fromCharCode(0x2060), 'g'); // word joiners of a right-to-left page (src/bidi.js); not part of the draft's text
  const inlineBox = new WeakMap();
  const isInline = (el) => {
    if (!inlineBox.has(el)) inlineBox.set(el, getComputedStyle(el).display.startsWith('inline'));
    return inlineBox.get(el);
  };
  // The text of a block as the reader sees it: separate lines, cells and timeline parts are joined by a space (textContent would run
  // "2026" and "Ship" together), and the note chip is not part of it.
  const blockText = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('.am-mark-note')) continue;
      let box = node.parentElement;
      while (box !== el && isInline(box)) box = box.parentElement;
      if (last && box !== last) text += ' ';
      text += node.data.replace(WJ, '');
      last = box;
    }
    return text;
  };

  const panelOf = (el) => el.closest('.am-panel')?.id.replace(/^panel-/, '') ?? '';
  // Block keys, in page order. Built when first needed: a page nobody marked pays nothing.
  let keys = null;
  const keyMap = () => {
    if (!keys) {
      const blocks = [...document.querySelectorAll(BLOCK)];
      const ids = occurrenceKeys(blocks.map((el) => `${panelOf(el)}|${el.localName}|${fingerprint(blockText(el))}`));
      keys = new Map(blocks.map((el, i) => [el, ids[i]]));
    }
    return keys;
  };

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey));
      return Array.isArray(saved) ? saved.filter((m) => typeof m?.key === 'string' && KINDS.includes(m.kind)) : [];
    } catch {
      return [];
    }
  };
  // A mark whose block is gone from the page stays stored (it may return with `am patch`); it is neither painted nor sent.
  const marks = new Map(load().map((m) => [m.key, { key: m.key, kind: m.kind, note: String(m.note ?? '') }]));
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify([...marks.values()]));
    } catch {
      // Storage may be off (private window, a sandboxed page); marks then last until the page closes.
    }
  };

  const chip = (el, mark) => {
    const note = document.createElement(el.localName === 'table' ? 'caption' : 'span');
    note.className = 'am-mark-note';
    const kind = document.createElement('b');
    kind.textContent = ui.kinds[mark.kind];
    note.append(kind, mark.note ? ` ${mark.note}` : '');
    return note;
  };
  const clearChip = (el) => el.querySelector(':scope > .am-mark-note')?.remove();
  const paint = (el, mark) => {
    clearChip(el);
    el.classList.add('am-mark');
    el.dataset.kind = mark.kind;
    // Inside the block, so a list item stays a child of its list. A table takes it as its caption; a list item with a sub-list shows
    // it under its own text, before the sub-list.
    const sub = el.querySelector(':scope > ul, :scope > ol');
    if (el.localName === 'table') el.prepend(chip(el, mark));
    else if (sub) sub.before(chip(el, mark));
    else el.append(chip(el, mark));
  };
  const unpaint = (el) => {
    clearChip(el);
    el.classList.remove('am-mark');
    delete el.dataset.kind;
  };
  if (marks.size) for (const [el, key] of keyMap()) if (marks.has(key)) paint(el, marks.get(key));

  // The popover edits one block. Save stays off until a kind is picked.
  const pop = document.createElement('div');
  pop.className = 'am-remark-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', ui.button);
  document.body.append(pop);
  let opener = null;
  let anchor = null;
  const close = (restoreFocus) => {
    if (pop.hidden) return;
    pop.hidden = true;
    if (restoreFocus) (opener?.isConnected && opener !== document.body ? opener : btn).focus();
  };
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const x = rtl ? rect.right - pop.offsetWidth : rect.left;
    // Under the block; a block taller than the window gets the popover at the bottom of the window instead.
    const y = Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8);
    pop.style.left = `${window.scrollX + Math.min(Math.max(8, x), window.innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = `${window.scrollY + Math.max(8, y)}px`;
  };
  const make = (tag, props) => Object.assign(document.createElement(tag), props);
  const open = (el) => {
    const key = keyMap().get(el);
    const mark = marks.get(key);
    let kind = mark?.kind ?? '';
    opener = document.activeElement;
    anchor = el;

    const note = make('textarea', { rows: 2, placeholder: ui.hint, value: mark?.note ?? '' });
    note.setAttribute('aria-label', ui.hint);
    const keep = make('button', { type: 'button', className: 'am-btn', textContent: ui.save, disabled: !kind });
    keep.addEventListener('click', () => {
      const saved = { key, kind, note: note.value.trim() };
      marks.set(key, saved);
      save();
      paint(el, saved);
      close(true);
    });
    const actions = make('div', { className: 'am-remark-actions' });
    actions.append(keep);
    if (mark) {
      const drop = make('button', { type: 'button', className: 'am-btn', textContent: ui.remove });
      drop.addEventListener('click', () => {
        marks.delete(key);
        save();
        unpaint(el);
        close(true);
      });
      actions.append(drop);
    }
    const kindBtns = KINDS.map((k) => {
      const kb = make('button', { type: 'button', className: 'am-remark-kind', textContent: ui.kinds[k] });
      kb.dataset.kind = k;
      kb.setAttribute('aria-pressed', String(k === kind));
      kb.addEventListener('click', () => {
        kind = k;
        for (const other of kindBtns) other.setAttribute('aria-pressed', String(other === kb));
        keep.disabled = false;
      });
      return kb;
    });
    pop.replaceChildren(make('div', { className: 'am-remark-kinds' }), note, actions);
    pop.firstChild.append(...kindBtns);
    pop.hidden = false;
    place();
    (kindBtns.find((b) => b.dataset.kind === kind) ?? kindBtns[0]).focus({ preventScroll: true });
  };

  // Picking works only while remark mode is on. A click on a marked block edits its mark, on a plain block starts one.
  // The block under the pointer gets an outline: the same blockAt decides what is outlined and what a click picks.
  let hover = null;
  const track = (e) => {
    const el = e.type === 'mouseout' && e.relatedTarget === null ? null : blockAt(e.target);
    if (el === hover) return;
    hover?.classList.remove('am-remark-hover');
    hover = el;
    hover?.classList.add('am-remark-hover');
  };
  const pick = (e) => {
    const el = blockAt(e.target);
    if (el) open(el);
  };
  const setMode = (on) => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    const toggle = on ? 'addEventListener' : 'removeEventListener';
    document.body[toggle]('click', pick);
    document.body[toggle]('mouseover', track);
    document.body[toggle]('mouseout', track);
    if (!on) {
      track({ type: 'mouseout', relatedTarget: null });
      close(false);
    }
  };
  btn.addEventListener('click', () => setMode(btn.getAttribute('aria-pressed') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(true);
  });
  // A click outside the popover closes it; the same click may then start another mark.
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target)) close(false);
  }, true);
  setMode(false);

  // What the Reply button reads: the marked blocks that are on the page, in page order.
  window.__amRemarkData = () => {
    if (!marks.size) return [];
    const live = [];
    for (const [el, key] of keyMap()) {
      const mark = marks.get(key);
      if (mark) live.push({ panel: panelOf(el), quote: quote(blockText(el)), kind: mark.kind, note: mark.note });
    }
    return live;
  };
})();
