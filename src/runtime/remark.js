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
  // A $$ block on its own is a div; a $$ formula inside a sentence is a span of its paragraph.
  const BLOCK = 'main :is(h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,dd,dt,figure,div.am-math-block):not(.am-head *, .am-panel-head *, .am-toc *)';
  // A click on these does what it always did.
  const LIVE = '.am-remark-pop, .am-toolbar, a, button, input, textarea, select, label';
  const blockAt = (target) => (target.closest(LIVE) ? null : target.closest(BLOCK));

  const WJ = new RegExp(String.fromCharCode(0x2060), 'g'); // word joiners of a right-to-left page (src/bidi.js); not part of the draft's text
  // A narrow horizontal timeline shows its date and title inline (src/themes/base.css). They stay parts of their own, so a block key
  // does not change with the width of the window (#194).
  const OWN_BOX = '.am-timeline--h .am-tl-when, .am-timeline--h .am-tl-title';
  const inlineBox = new WeakMap();
  const isInline = (el) => {
    if (!inlineBox.has(el)) inlineBox.set(el, !el.matches(OWN_BOX) && getComputedStyle(el).display.startsWith('inline'));
    return inlineBox.get(el);
  };
  // The text of a block as the reader sees it: separate lines, cells and timeline parts are joined by a space (textContent would run
  // "2026" and "Ship" together), and the note chip is not part of it. A formula is one box and reads as the TeX the draft wrote
  // (src/runtime/math-text.js), not as the MathML tokens.
  const blockText = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('.am-mark-note')) continue;
      let box = formulaOf(node) ?? node.parentElement;
      while (box !== el && isInline(box)) box = box.parentElement;
      if (last && box !== last) text += ' ';
      text += nodeText(node).replace(WJ, '');
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
  // Kind and note of a popover closed without Save, by block key, until the page reloads (see open below).
  const drafts = new Map();
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'am-btn am-btn--remark-clear';
  clearBtn.textContent = ui.clear;
  // Clear all drops saved marks and drafts, so it shows while either exists.
  const toClear = () => marks.size + drafts.size;
  const showClear = () => { clearBtn.hidden = toClear() === 0; };
  btn.insertAdjacentElement('afterend', clearBtn);
  let clearTimer = null;
  let clearArmed = false;
  const resetClear = () => {
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = null;
    clearArmed = false;
    clearBtn.classList.remove('is-armed');
    clearBtn.textContent = ui.clear;
    showClear();
  };
  const armClear = () => {
    clearArmed = true;
    clearBtn.classList.add('is-armed');
    clearBtn.textContent = ui.clearConfirm.replace('{n}', toClear());
    clearTimer = setTimeout(resetClear, 4000);
  };
  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      armClear();
      return;
    }
    for (const el of document.querySelectorAll('.am-mark')) unpaint(el);
    marks.clear();
    // A draft is a remark the reader has not saved yet; Clear all drops it too, so no block reopens with an old kind.
    drafts.clear();
    try {
      localStorage.removeItem(storeKey);
    } catch {
      // Storage may be off (private window, a sandboxed page); the in-memory marks still clear.
    }
    resetClear();
    document.dispatchEvent(new Event('am-remark-change'));
  });
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify([...marks.values()]));
    } catch {
      // Storage may be off (private window, a sandboxed page); marks then last until the page closes.
    }
    // The reply bar (reply.js) shows the number of marks.
    document.dispatchEvent(new Event('am-remark-change'));
    showClear();
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
  showClear();
  if (marks.size) for (const [el, key] of keyMap()) if (marks.has(key)) paint(el, marks.get(key));

  // The popover edits one block. Save stays off until a kind is picked, and a hint says so. 1–4 pick a kind from the keyboard and
  // move to the note; Ctrl / Cmd + Enter saves. A popover closed without Save keeps its kind and note as a draft for that block until the page reloads.
  const pop = document.createElement('div');
  pop.className = 'am-remark-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', ui.button);
  document.body.append(pop);
  let opener = null;
  let anchor = null;
  let keepDraft = null;
  const close = (restoreFocus) => {
    if (pop.hidden) return;
    keepDraft?.();
    keepDraft = null;
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
    const draft = drafts.get(key);
    let kind = draft?.kind ?? mark?.kind ?? '';
    opener = document.activeElement;
    anchor = el;

    const note = make('textarea', { rows: 2, placeholder: ui.hint, value: draft?.note ?? mark?.note ?? '' });
    note.setAttribute('aria-label', ui.hint);
    const keep = make('button', { type: 'button', className: 'am-btn', textContent: ui.save, disabled: !kind });
    const need = make('span', { className: 'am-remark-need', textContent: ui.need, hidden: Boolean(kind) });
    keepDraft = () => {
      if (kind || note.value.trim()) drafts.set(key, { kind, note: note.value });
      else drafts.delete(key);
      showClear();
    };
    const done = () => { drafts.delete(key); keepDraft = null; showClear(); };
    keep.addEventListener('click', () => {
      done();
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
        done();
        marks.delete(key);
        save();
        unpaint(el);
        close(true);
      });
      actions.append(drop);
    }
    const choose = (k) => {
      kind = k;
      for (const other of kindBtns) other.setAttribute('aria-pressed', String(other.dataset.kind === k));
      keep.disabled = false;
      need.hidden = true;
    };
    const kindBtns = KINDS.map((k, i) => {
      const kb = make('button', { type: 'button', className: 'am-remark-kind', textContent: ui.kinds[k] });
      kb.dataset.kind = k;
      kb.dataset.n = i + 1;
      kb.setAttribute('aria-pressed', String(k === kind));
      kb.addEventListener('click', () => choose(k));
      return kb;
    });
    // Ctrl / Cmd + Enter presses Save (nothing while Save waits for a kind). A digit types into the note, so it picks a kind
    // only while the focus is outside the note.
    pop.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        if (!keep.disabled) keep.click();
        return;
      }
      if (e.target === note || e.ctrlKey || e.metaKey || e.altKey || !/^[1-4]$/.test(e.key)) return;
      e.preventDefault();
      choose(KINDS[Number(e.key) - 1]);
      note.focus();
    };
    actions.append(need);
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
  // The keyboard picks too: while the mode is on, every block takes focus with Tab, and Enter or Space opens its popover. A block
  // that already had a tabindex keeps it; only the ones the mode added lose it again.
  const pickKey = (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey || !e.target.hasAttribute?.('data-am-pick')) return;
    e.preventDefault();
    open(e.target);
  };
  const focusable = (on) => {
    if (!on && !keys) return; // the mode starts off: a page nobody marked builds no block keys
    for (const el of keyMap().keys()) {
      if (on && !el.hasAttribute('tabindex')) {
        el.tabIndex = 0;
        el.setAttribute('data-am-pick', '');
      } else if (!on && el.hasAttribute('data-am-pick')) {
        el.removeAttribute('tabindex');
        el.removeAttribute('data-am-pick');
      }
    }
  };
  const setMode = (on) => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    const toggle = on ? 'addEventListener' : 'removeEventListener';
    document.body[toggle]('click', pick);
    document.body[toggle]('mouseover', track);
    document.body[toggle]('mouseout', track);
    document.body[toggle]('keydown', pickKey);
    focusable(on);
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
