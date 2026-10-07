(() => {
  const root = document.documentElement;
  // A host that serves this page inside its own document leaves the real root without the page's settings. The toolbar keeps a copy;
  // set back what the root lacks, before anything below reads the root. A root's own value, even an empty one, is never replaced.
  const carrier = document.querySelector('.am-toolbar');
  for (const [attr, key] of [['lang', 'data-am-root-lang'], ['data-theme', 'data-am-root-theme'], ['data-mode', 'data-am-root-mode'], ['data-style', 'data-am-root-style']]) {
    if (root.getAttribute(attr) === null && carrier?.getAttribute(key) != null) root.setAttribute(attr, carrier.getAttribute(key));
  }
  // Each toolbar list sets one root attribute; its options name the values, so the runtime names no theme or mode.
  for (const [name, attr] of [['theme', 'data-theme'], ['mode', 'data-mode']]) {
    const select = document.querySelector(`select[data-am="${name}"]`);
    if (!select) continue;
    select.value = root.getAttribute(attr);
    select.addEventListener('change', () => root.setAttribute(attr, select.value));
  }

  const copyBtn = document.querySelector('[data-am="copy"]');
  copyBtn?.addEventListener('click', async () => {
    const nodes = document.querySelectorAll('#am-source');
    const text = nodes[nodes.length - 1]?.value ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const original = copyBtn.textContent;
    copyBtn.textContent = copyBtn.dataset.done;
    setTimeout(() => { copyBtn.textContent = original; }, 1400);
  });

  // ── Diagram Lightbox & Pan-Zoom Viewer ─────────────
  const diagrams = document.querySelectorAll('.am-diagram');
  if (diagrams.length) {
    const lang = (root.getAttribute('lang') || 'zh').slice(0, 2);
    const I18N = {
      zh: { expand: '展开查看图表', close: '关闭', diagram: '图表查看' }, // lang-ok: viewer UI labels
      en: { expand: 'Expand diagram', close: 'Close', diagram: 'Diagram Viewer' },
      ja: { expand: '拡大表示', close: '閉じる', diagram: 'ダイアグラム' }, // lang-ok: viewer UI labels
    };
    const t = I18N[lang] || I18N.zh;

    const lb = document.createElement('div');
    lb.className = 'am-lightbox';
    lb.setAttribute('hidden', '');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-label', t.diagram);
    lb.innerHTML = `
      <div class="am-lightbox-backdrop"></div>
      <div class="am-lightbox-header">
        <div class="am-lightbox-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          <span class="am-lightbox-title-text"></span>
        </div>
        <div class="am-lightbox-actions">
          <button class="am-lightbox-close" data-action="close" title="${t.close}" aria-label="${t.close}">✕</button>
        </div>
      </div>
      <div class="am-lightbox-stage">
        <div class="am-lightbox-canvas am-diagram"></div>
      </div>
    `;
    document.body.append(lb);

    const backdrop = lb.querySelector('.am-lightbox-backdrop');
    const titleText = lb.querySelector('.am-lightbox-title-text');
    const stage = lb.querySelector('.am-lightbox-stage');
    const canvas = lb.querySelector('.am-lightbox-canvas');
    const closeBtn = lb.querySelector('.am-lightbox-close');

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
      const panelTitle = panel?.querySelector('.am-panel-head h2')?.textContent?.trim() || panel?.querySelector('h2')?.textContent?.trim() || t.diagram;
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
      btn.title = t.expand;
      btn.setAttribute('aria-label', t.expand);
      btn.innerHTML = expandSvg;
      btn.addEventListener('click', () => open(diag, btn));
      diag.prepend(btn);
    });
  }
})();
