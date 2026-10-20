(() => {
  const root = document.documentElement;
  // A host that serves this page inside its own document leaves the real root without the page's settings. The toolbar keeps a copy;
  // set back what the root lacks, before anything below reads the root. A root's own value, even an empty one, is never replaced.
  const carrier = document.querySelector('.am-toolbar');
  for (const [attr, key] of [['lang', 'data-am-root-lang'], ['dir', 'data-am-root-dir'], ['data-theme', 'data-am-root-theme'], ['data-mode', 'data-am-root-mode'], ['data-style', 'data-am-root-style']]) {
    if (root.getAttribute(attr) === null && carrier?.getAttribute(key) != null) root.setAttribute(attr, carrier.getAttribute(key));
  }
  // Each toolbar list sets one root attribute; its options name the values, so the runtime names no theme or mode.
  for (const [name, attr] of [['theme', 'data-theme'], ['mode', 'data-mode']]) {
    const select = document.querySelector(`select[data-am="${name}"]`);
    if (!select) continue;
    select.value = root.getAttribute(attr);
    select.addEventListener('change', () => root.setAttribute(attr, select.value));
  }

  // ── Text size ─────────────────────────────
  // A− / A+ set --am-scale on the root; every page size and line (src/themes/type-scale.js) follows it, and the drawing boxes grow
  // with it while their viewBox keeps the units Node measured. The buttons carry the range from SCALE, so this script keeps no
  // second copy of the numbers. A reader's choice is remembered in this browser and wins over the page's own scale; where storage
  // is off (am serve, file://) it lasts for this tab, and the click still works.
  const scaleDown = document.querySelector('[data-am="scale-down"]');
  const scaleUp = document.querySelector('[data-am="scale-up"]');
  if (scaleDown && scaleUp) {
    const min = Number(scaleDown.dataset.min);
    const max = Number(scaleDown.dataset.max);
    const step = Number(scaleDown.dataset.step);
    const storeKey = 'am-scale';
    let value;

    const inRange = (n) => Number.isFinite(n) && n >= min && n <= max;
    const savedScale = () => {
      try {
        return Number(localStorage.getItem(storeKey));
      } catch {
        return NaN;
      }
    };
    const saveScale = (n) => {
      try {
        localStorage.setItem(storeKey, String(n));
      } catch {
        // Storage may be off (am serve, file://); the size then lasts until the tab closes.
      }
    };

    const updateButtons = () => {
      const setUnavailable = (btn, unavailable) => {
        if (unavailable) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      };
      setUnavailable(scaleDown, value <= min);
      setUnavailable(scaleUp, value >= max);
    };

    // One step is a multiple of `step`: Math.round first, then two decimals, so 1.1500000000000001 becomes 1.15.
    const setScale = (next, remember = false) => {
      value = Math.min(max, Math.max(min, Number((Math.round(next / step) * step).toFixed(2))));
      root.style.setProperty('--am-scale', String(value));
      for (const svg of document.querySelectorAll('.am-diagram:not(.am-lightbox-canvas) > svg[role="img"]')) {
        const box = svg.viewBox?.baseVal;
        if (!box || !(box.width > 0) || !(box.height > 0)) continue;
        svg.setAttribute('width', String(Math.ceil(box.width * value)));
        svg.setAttribute('height', String(Math.ceil(box.height * value)));
      }
      updateButtons();
      if (remember) saveScale(value);
      window.dispatchEvent(new Event('am-scale'));
    };

    // A page with no stored choice is left exactly as it was rendered: no inline variable, no svg rewrite, no extra layout pass.
    value = parseFloat(getComputedStyle(root).getPropertyValue('--am-scale')) || 1;
    updateButtons();
    const saved = savedScale();
    if (inRange(saved) && saved !== value) setScale(saved);
    scaleDown.hidden = false;
    scaleUp.hidden = false;
    scaleDown.addEventListener('click', () => {
      if (scaleDown.getAttribute('aria-disabled') === 'true') return;
      setScale(value - step, true);
    });
    scaleUp.addEventListener('click', () => {
      if (scaleUp.getAttribute('aria-disabled') === 'true') return;
      setScale(value + step, true);
    });
  }

  // A phone cannot show the whole toolbar. Its end (Reply, Remark, Copy source) is what a phone showed before the text-size
  // buttons, so open at that end: Theme, Mode and A− / A+ are reached by scrolling toward the start. A reader scroll leaves the
  // position we set, so a later resize does not pull the toolbar back.
  if (carrier) {
    const rtl = getComputedStyle(carrier).direction === 'rtl';
    let lastProgrammatic = null;
    let readerScrolled = false;
    const scrollToEnd = () => {
      if (carrier.scrollWidth <= carrier.clientWidth) return;
      // Chrome keeps a right-to-left box's scrollLeft negative; the browser clamps either value to the real end.
      carrier.scrollTo({ left: rtl ? -carrier.scrollWidth : carrier.scrollWidth });
      lastProgrammatic = carrier.scrollLeft;
    };
    carrier.addEventListener('scroll', () => {
      if (Math.abs(carrier.scrollLeft - lastProgrammatic) > 1) readerScrolled = true;
    });
    scrollToEnd();
    addEventListener('resize', () => {
      if (!readerScrolled) scrollToEnd();
    });
  }

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  };
  // A button reads its label from data-done for a moment after a copy, then comes back to the label it started from. That label is
  // read once, here: a second click inside the moment would otherwise read the copied label off the button and restore that instead,
  // and the label would never come back. The moment starts again on each click: the timer of the previous one is left to fire and
  // does nothing (a token, so this needs no timer bookkeeping the page scripts do not already have).
  const flasher = (btn) => {
    const idle = btn.textContent;
    let clicks = 0;
    return () => {
      btn.textContent = btn.dataset.done;
      const mine = ++clicks;
      setTimeout(() => { if (mine === clicks) btn.textContent = idle; }, 1400);
    };
  };

  const copyBtn = document.querySelector('[data-am="copy"]');
  if (copyBtn) {
    const flash = flasher(copyBtn);
    copyBtn.addEventListener('click', async () => {
      const nodes = document.querySelectorAll('#am-source');
      await copyText(nodes[nodes.length - 1]?.value ?? '');
      flash();
    });
  }

  // Each code block copies its own lines, without the line numbers.
  for (const btn of document.querySelectorAll('[data-am="copy-code"]')) {
    const flash = flasher(btn);
    btn.addEventListener('click', async () => {
      const lines = btn.closest('.am-codeblock')?.querySelectorAll('.am-ln') ?? [];
      await copyText([...lines].map((l) => l.textContent).join('\n'));
      flash();
    });
  }

  // ── Diagram Lightbox & Pan-Zoom Viewer ─────────────
  const diagrams = document.querySelectorAll('.am-diagram:not(.am-lightbox-canvas)');
  const lb = document.querySelector('.am-lightbox');
  if (diagrams.length && lb) {
    const backdrop = lb.querySelector('.am-lightbox-backdrop');
    const titleText = lb.querySelector('.am-lightbox-title-text');
    const stage = lb.querySelector('.am-lightbox-stage');
    const canvas = lb.querySelector('.am-lightbox-canvas');
    const closeBtn = lb.querySelector('.am-lightbox-close');
    const expandLabel = lb.getAttribute('data-expand') || 'Expand diagram';

    let scale = 1, x = 0, y = 0, fitScale = 1, curVw = 800, curVh = 600;
    let isDragging = false, activePointerId = null, startX = 0, startY = 0, origX = 0, origY = 0;
    let lastTrigger = null;

    const apply = () => {
      canvas.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    };

    const zoomTo = (newScale, pivotX, pivotY) => {
      newScale = Math.max(0.2, Math.min(6.0, newScale));
      if (Math.abs(newScale - scale) < 0.0001) return;
      const r = newScale / scale;
      x = pivotX - (pivotX - x) * r;
      y = pivotY - (pivotY - y) * r;
      scale = newScale;
      apply();
    };

    const open = (diag, trigger) => {
      const svg = [...diag.children].find((el) => el.tagName.toLowerCase() === 'svg');
      if (!svg) return;
      lastTrigger = trigger;

      const panel = diag.closest('.am-panel');
      const panelTitle = panel?.querySelector('.am-panel-head h2')?.textContent?.trim() || panel?.querySelector('h2')?.textContent?.trim() || lb.getAttribute('aria-label') || 'Diagram viewer';
      if (titleText) titleText.textContent = panelTitle;

      const clone = svg.cloneNode(true);
      const defElements = clone.querySelectorAll('[id]');
      if (defElements.length) {
        const idMap = new Map();
        defElements.forEach((el, i) => {
          const oldId = el.id;
          const newId = `${oldId}-lb-${i}`;
          idMap.set(oldId, newId);
          el.id = newId;
        });
        const urlAttrs = ['marker-start', 'marker-mid', 'marker-end', 'fill', 'stroke', 'filter', 'clip-path', 'mask'];
        clone.querySelectorAll('*').forEach((el) => {
          for (const attr of urlAttrs) {
            const val = el.getAttribute(attr);
            if (val && val.startsWith('url(#')) {
              const id = val.slice(5, -1);
              if (idMap.has(id)) el.setAttribute(attr, `url(#${idMap.get(id)})`);
            }
          }
          const href = el.getAttribute('href') || el.getAttribute('xlink:href');
          if (href && href.startsWith('#')) {
            const id = href.slice(1);
            if (idMap.has(id)) {
              if (el.hasAttribute('href')) el.setAttribute('href', `#${idMap.get(id)}`);
              if (el.hasAttribute('xlink:href')) el.setAttribute('xlink:href', `#${idMap.get(id)}`);
            }
          }
        });
      }

      const vb = svg.viewBox?.baseVal;
      curVw = (vb && vb.width > 0) ? vb.width : (parseFloat(svg.getAttribute('width')) || svg.clientWidth || 800);
      curVh = (vb && vb.height > 0) ? vb.height : (parseFloat(svg.getAttribute('height')) || svg.clientHeight || 600);
      clone.style.width = `${curVw}px`;
      clone.style.height = `${curVh}px`;
      canvas.innerHTML = '';
      canvas.append(clone);
      lb.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';

      const rect = stage.getBoundingClientRect();
      const pad = 48;
      const availW = Math.max(100, rect.width - pad * 2);
      const availH = Math.max(100, rect.height - pad * 2);
      fitScale = Math.min(availW / curVw, availH / curVh, 1.0);
      scale = fitScale;
      x = (rect.width - curVw * scale) / 2;
      y = (rect.height - curVh * scale) / 2;
      apply();
      closeBtn.focus();
    };

    const close = () => {
      if (lb.hasAttribute('hidden')) return;
      lb.setAttribute('hidden', '');
      canvas.innerHTML = '';
      document.body.style.overflow = '';
      lastTrigger?.focus();
    };

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : (e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY);
      const factor = Math.exp(-Math.max(-200, Math.min(200, dy)) * 0.0015);
      zoomTo(scale * factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isDragging) return;
      isDragging = true;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      origX = x;
      origY = y;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('am-panning');
    });

    stage.addEventListener('pointermove', (e) => {
      if (!isDragging || e.pointerId !== activePointerId) return;
      x = origX + (e.clientX - startX);
      y = origY + (e.clientY - startY);
      apply();
    });

    const endDrag = (e) => {
      if (!isDragging || e.pointerId !== activePointerId) return;
      isDragging = false;
      activePointerId = null;
      stage.classList.remove('am-panning');
      try { stage.releasePointerCapture(e.pointerId); } catch {}
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    stage.addEventListener('dblclick', () => {
      const rect = stage.getBoundingClientRect();
      scale = fitScale;
      x = (rect.width - curVw * scale) / 2;
      y = (rect.height - curVh * scale) / 2;
      apply();
    });

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lb.hasAttribute('hidden')) close();
    });

    lb.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = lb.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    const expandSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
    diagrams.forEach((diag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'am-diagram-expand';
      btn.title = expandLabel;
      btn.setAttribute('aria-label', expandLabel);
      btn.innerHTML = expandSvg;
      btn.addEventListener('click', () => open(diag, btn));
      diag.prepend(btn);
    });
  }
})();
