// The toolbar's Export menu: Copy as image, Download PNG and Save as PDF. The menu is a native popover that src/render.js writes next to
// the toolbar (a click on the button, Esc and a click outside open and close it with no script); this script shows the button, moves
// focus with the arrow keys, says why an item cannot run, and does the work. A browser without popovers gets the same menu from a class
// toggle instead of losing it.
//
// Copy and Download share one rasterizer. An item that cannot run is marked aria-disabled and carries the reason as its muted second
// line (also its accessible description), never as the toolbar button's text: no rasterizer disables both; a preview frame whose feature
// policy forbids clipboard-write, or a missing async Clipboard API / secure context, disables only Copy. Chromium and Firefox (as of
// version 160) can rasterize the page; Safari and unknown browsers keep both items but carry a note that the effect is not guaranteed.
// A refused copy reports a failure and never falls back to downloading. Save as PDF is the browser's print dialog and always works
// (the page's print CSS hides the toolbar and the menu).
//
// Pipeline: clone the page body → inline every computed style (CSS variables are resolved there, so a clone keeps theme colours and
// sizes) and the ::before / ::after decorations → wrap it in an SVG foreignObject → draw that image on a canvas → toBlob('image/png')
// → navigator.clipboard.write(new ClipboardItem(...)), passing the blob as a promise so the write keeps the user's click activation,
// or a download through <a download>.
(() => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const SVG = 'http://www.w3.org/2000/svg';
  const MAX_DIM = 16384;        // Chrome refuses a canvas wider or taller than this
  const MAX_AREA = 268435456;   // and one with more pixels than this (16384 * 16384)

  const btn = document.querySelector('[data-am="export"]');
  const menu = document.getElementById('am-export');
  if (!btn || !menu) return;
  const main = document.querySelector('main.am-sheet, main.am-doc');
  if (!main) return;
  const items = [...menu.querySelectorAll('[data-export]')];
  const item = (kind) => menu.querySelector(`[data-export="${kind}"]`);
  const [copyItem, downloadItem, pdfItem] = ['copy', 'download', 'pdf'].map(item);
  const note = (el) => document.getElementById(el.getAttribute('aria-describedby'));
  const text = menu.dataset;

  const canRasterize = typeof XMLSerializer !== 'undefined' && typeof document.createElement('canvas').getContext === 'function';
  const canCopy = window.isSecureContext && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  // Chromium (including an embedded Chromium without navigator.userAgentData, whose UA still names Chrome/) and Firefox can rasterize
  // the page. Safari and unknown browsers are not rejected outright: their items stay usable but carry a note that the effect is not
  // guaranteed.
  const brands = navigator.userAgentData?.brands;
  const chromium = brands ? brands.some((b) => /Chromium/.test(b.brand)) : /\bChrome\//.test(navigator.userAgent);
  const gecko = /\bFirefox\//.test(navigator.userAgent);
  const native = Object.hasOwn(HTMLElement.prototype, 'popover') && typeof menu.showPopover === 'function';
  btn.hidden = false;

  const idle = btn.textContent;
  // The button keeps its name ("Export") while its text shows progress, so a screen reader hears each result through a hidden live
  // region beside it. aria-live, not
  // role="status": the live-update notice owns role="status" (src/runtime/page.js), and the two must stay apart.
  const status = document.createElement('span');
  status.setAttribute('aria-live', 'polite');
  status.dataset.am = 'export-status';
  status.className = 'am-visually-hidden';
  btn.after(status);
  btn.setAttribute('aria-label', idle);
  // Short feedback on the button itself, restored after a moment; the live region carries the same words.
  const say = (message, restore) => {
    btn.textContent = message;
    status.textContent = message;
    clearTimeout(say.timer);
    if (restore) say.timer = setTimeout(() => { btn.textContent = idle; }, 1800);
  };

  // An item that can never run here (aria-disabled, reason as its second line), in the order of the conditions the page can act on.
  const unavailable = new Map();
  if (!canRasterize) {
    unavailable.set(copyItem, text.unavailableBrowser);
    unavailable.set(downloadItem, text.unavailableBrowser);
  } else {
    if (document.featurePolicy && document.featurePolicy.allowsFeature('clipboard-write') === false) unavailable.set(copyItem, text.unavailablePolicy);
    else if (!canCopy) unavailable.set(copyItem, text.unavailableClipboard);
    // Safari and unknown browsers can draw the page often enough to keep the items, but the result is not guaranteed.
    if (!chromium && !gecko) for (const el of [copyItem, downloadItem]) if (!unavailable.has(el)) note(el).textContent = text.unverifiedEffect;
  }
  for (const [el, reason] of unavailable) note(el).textContent = reason;

  // A running export blocks the next copy or download (a second full-page rasterization beside the first); Save as PDF stays free.
  let busy = false;
  const sync = () => {
    for (const el of items) {
      const off = unavailable.has(el) || (busy && el !== pdfItem);
      if (off) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    }
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  };
  sync();

  // A stylesheet of only the local font declarations, so a font a theme embeds still draws inside the SVG.
  const fontFaceCss = () => {
    let css = '';
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // a cross-origin sheet has no readable rules; pages never carry one
      for (const rule of rules) {
        if (rule.type === 5 /* CSSRule.FONT_FACE_RULE */) css += `${rule.cssText}\n`;
      }
    }
    return css;
  };

  // Copy every computed declaration of src onto dst. The clone then needs no page stylesheet: var() is already resolved.
  const inlineStyle = (src, dst) => {
    const cs = getComputedStyle(src);
    let css = '';
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      const value = cs.getPropertyValue(name);
      if (value) css += `${name}:${value};`;
    }
    dst.style.cssText = css;
  };

  // A ::before / ::after box exists only while the rule applies, so copy its computed declarations into a rule of its own. Each element
  // that has one gets a data-cp marker; the marker keeps the rule from touching any other node in the picture.
  let cpSeq = 0;
  const pseudoRule = (src, dst, pseudo) => {
    const cs = getComputedStyle(src, pseudo);
    const content = cs.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') return '';
    let css = '';
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      const value = cs.getPropertyValue(name);
      if (value) css += `${name}:${value};`;
    }
    if (!css) return '';
    const mark = dst.getAttribute('data-cp') ?? String(++cpSeq);
    dst.setAttribute('data-cp', mark);
    return `[data-cp="${mark}"]${pseudo}{${css}}\n`;
  };

  // The page's chrome means nothing in a picture: remove the controls and the navigational rail from the clone.
  const CHROME = '.am-code-copy, .am-diagram-expand, .am-table-controls, [class*="delta-switch"], .am-toc, .am-remark-hover, .am-mark-note';

  function buildSvg(width, height) {
    const clone = main.cloneNode(true);
    // The clone has the same node order as the original, so one index walks both trees.
    const srcNodes = [main, ...main.querySelectorAll('*')];
    const dstNodes = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < srcNodes.length; i++) {
      inlineStyle(srcNodes[i], dstNodes[i]);
    }
    let pseudoCss = '';
    for (let i = 0; i < srcNodes.length; i++) {
      pseudoCss += pseudoRule(srcNodes[i], dstNodes[i], '::before');
      pseudoCss += pseudoRule(srcNodes[i], dstNodes[i], '::after');
    }
    for (const node of clone.querySelectorAll(CHROME)) node.remove();
    // A rasterized image is a static snapshot, not a scrollable viewport. Inlined computed styles turn auto heights
    // into fixed fractional heights on scrolling containers (.am-table-wrap, .am-diagram, .am-annot-scroll, .am-math-block, pre),
    // and subpixel rounding inside the foreignObject can trigger unwanted scrollbars. Reset unconstrained containers to visible and auto.
    // For containers with an author-specified finite max-height, keep inlined height and max-height, and hide overflow.
    for (const scroller of clone.querySelectorAll('.am-table-wrap, .am-diagram, .am-annot-scroll, .am-math-block, pre')) {
      const maxH = parseFloat(scroller.style.maxHeight || scroller.style.getPropertyValue('max-height'));
      if (Number.isFinite(maxH) && maxH >= 0) {
        scroller.style.setProperty('overflow', 'hidden', 'important');
      } else {
        scroller.style.setProperty('overflow', 'visible', 'important');
        scroller.style.setProperty('height', 'auto', 'important');
        scroller.style.setProperty('max-height', 'none', 'important');
      }
    }
    clone.style.margin = '0';
    clone.style.width = `${width}px`;
    clone.style.maxWidth = 'none';

    const wrap = document.createElementNS(XHTML, 'div');
    wrap.setAttribute('xmlns', XHTML);
    const body = getComputedStyle(document.body);
    wrap.style.cssText = `width:${width}px;height:${height}px;margin:0;padding:0;box-sizing:border-box;color:${body.color};font-family:${body.fontFamily};font-size:${body.fontSize};line-height:${body.lineHeight};background-color:${body.backgroundColor};background-image:${body.backgroundImage};`;

    const style = document.createElementNS(XHTML, 'style');
    style.textContent = `${fontFaceCss()}\n${pseudoCss}`;
    wrap.append(style, clone);

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('xmlns', SVG);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const foreign = document.createElementNS(SVG, 'foreignObject');
    foreign.setAttribute('x', '0');
    foreign.setAttribute('y', '0');
    foreign.setAttribute('width', String(width));
    foreign.setAttribute('height', String(height));
    foreign.append(wrap);
    svg.append(foreign);
    return new XMLSerializer().serializeToString(svg);
  }

  // A canvas may not exceed the browser's dimension or area limit: shrink the pixels rather than fail on a long page. No lower bound:
  // one would let a very long page exceed the limits again.
  const pixelScale = (width, height) => {
    const wanted = Math.min(2, window.devicePixelRatio || 1);
    return Math.min(wanted, MAX_DIM / width, MAX_DIM / height, Math.sqrt(MAX_AREA / (width * height)));
  };

  async function rasterize() {
    await document.fonts?.ready;
    const rect = main.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(Math.max(rect.width, main.scrollWidth)));
    const height = Math.max(1, Math.ceil(Math.max(rect.height, main.scrollHeight)));
    const svg = buildSvg(width, height);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('the browser cannot draw the page as an SVG image'));
      image.src = url;
    });
    const scale = pixelScale(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the browser could not encode the image');
    return blob;
  }

  // The PNG is saved under the page title (letters and digits of any script, joined by dashes).
  const fileName = () => {
    const slug = (document.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40).replace(/^-+|-+$/g, '');
    return `${slug || 'page'}.png`;
  };
  const download = (blob) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  };

  // Start rasterizing, then hand the pending blob to ClipboardItem and write within the same click task so the browser keeps the
  // user's activation. Awaiting the raster first would spend it, and the write would be rejected. The write can be refused at once
  // while the page is still being drawn; wait for both to settle, so a retry cannot start a second rasterization beside the first.
  const copy = async () => {
    const blobPromise = rasterize();
    const written = (async () => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    })();
    const [write] = await Promise.allSettled([written, blobPromise]);
    if (write.status === 'rejected') throw write.reason;
  };
  const save = async () => { download(await rasterize()); };

  async function run(work, done) {
    busy = true;
    sync();
    say(text.working, false);
    try {
      await work();
      say(done, true);
    } catch (e) {
      console.error('[am] export failed', e);
      say(text.failed, true);
    } finally {
      busy = false;
      sync();
    }
  }

  // The menu. Native: the popover opens and closes itself and tells us through toggle events. Fallback: the same menu toggled by a
  // class, with Esc and a click outside handled here.
  const isOpen = () => (native ? menu.matches(':popover-open') : menu.classList.contains('is-open'));
  // Under the button, aligned to its inline-end edge, and inside the viewport (the toolbar scrolls sideways on a phone, so the button
  // can sit near an edge). On a short viewport the menu is cut to the space below the button and scrolls, so every item stays reachable.
  const place = () => {
    const r = btn.getBoundingClientRect();
    // clientWidth, not 100vw: the viewport width in CSS includes a classic scrollbar, so a menu sized from it can stick out.
    const room = document.documentElement.clientWidth - 16;
    menu.style.maxWidth = `${room}px`;
    menu.style.minWidth = `${Math.min(200, room)}px`;
    const width = menu.offsetWidth;
    const rtl = getComputedStyle(btn).direction === 'rtl';
    const left = Math.max(8, Math.min(rtl ? r.left : r.right - width, document.documentElement.clientWidth - 8 - width));
    const top = r.bottom + 6;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.maxHeight = `${Math.max(48, document.documentElement.clientHeight - 8 - top)}px`;
  };
  const firstEnabled = () => items.find((el) => el.getAttribute('aria-disabled') !== 'true');
  const opened = () => {
    btn.setAttribute('aria-expanded', 'true');
    place();
    menu.style.visibility = '';
    firstEnabled()?.focus();
  };
  const closed = (restoreFocus) => {
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus || menu.contains(document.activeElement)) btn.focus();
  };
  const close = (restoreFocus = true) => {
    if (!isOpen()) return;
    if (native) menu.hidePopover();
    else { menu.classList.remove('is-open'); closed(restoreFocus); }
  };

  if (native) {
    // Place the box before it is first drawn, so it never flashes in the wrong spot.
    menu.addEventListener('beforetoggle', (e) => {
      btn.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState === 'open') menu.style.visibility = 'hidden';
    });
    menu.addEventListener('toggle', (e) => { if (e.newState === 'open') opened(); else closed(false); });
  } else {
    // No popover: the browser must not half-handle the attributes, and the button toggles the class itself.
    menu.removeAttribute('popover');
    btn.removeAttribute('popovertarget');
    btn.addEventListener('click', () => {
      if (isOpen()) close();
      else { menu.classList.add('is-open'); opened(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(); } });
    document.addEventListener('pointerdown', (e) => { if (isOpen() && !menu.contains(e.target) && !btn.contains(e.target)) close(false); });
  }
  window.addEventListener('resize', () => { if (isOpen()) place(); });

  menu.addEventListener('keydown', (e) => {
    const at = items.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    } else if (e.key === 'Tab') {
      close(true); // focus goes back to the button and Tab then moves on from there
    }
  });

  menu.addEventListener('click', (e) => {
    const el = e.target.closest('[data-export]');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    close();
    if (el === pdfItem) window.print();
    else if (el === copyItem) run(copy, text.copied);
    else run(save, text.saved);
  });
})();
