// Copy the page as a PNG image onto the clipboard. The button shows on every page with a sheet or doc, and this script explains why
// it cannot copy where the browser lacks the pieces: no canvas rasterizer, a preview frame whose feature policy forbids clipboard-write,
// or no async Clipboard API / secure context. Firefox can rasterize the page as of version 160, so the button is enabled there and in
// Chromium; Safari and unknown browsers keep a usable button but carry a note that the effect is not guaranteed. A failed copy shows
// the failure and never falls back to downloading the PNG.
//
// Pipeline: clone the page body → inline every computed style (CSS variables are resolved there, so a clone keeps theme colours and
// sizes) and the ::before / ::after decorations → wrap it in an SVG foreignObject → draw that image on a canvas → toBlob('image/png')
// → navigator.clipboard.write(new ClipboardItem(...)), passing the blob as a promise so the write keeps the user's click activation.
(() => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const SVG = 'http://www.w3.org/2000/svg';
  const MAX_DIM = 16384;        // Chrome refuses a canvas wider or taller than this
  const MAX_AREA = 268435456;   // and one with more pixels than this (16384 * 16384)

  const btn = document.querySelector('[data-am="copy-image"]');
  if (!btn) return;
  const main = document.querySelector('main.am-sheet, main.am-doc');
  if (!main) return;

  const canRasterize = typeof XMLSerializer !== 'undefined' && typeof document.createElement('canvas').getContext === 'function';
  const canCopy = window.isSecureContext && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  // Chromium (including an embedded Chromium without navigator.userAgentData, whose UA still names Chrome/) and Firefox can rasterize
  // the page. Safari and unknown browsers are not rejected outright: their button stays usable but carries a note that the effect is
  // not guaranteed.
  const brands = navigator.userAgentData?.brands;
  const chromium = brands ? brands.some((b) => /Chromium/.test(b.brand)) : /\bChrome\//.test(navigator.userAgent);
  const gecko = /\bFirefox\//.test(navigator.userAgent);
  btn.hidden = false;

  const idle = btn.textContent;
  // When the button can copy, its aria-label stays "Copy as image", so a screen reader hears each result through a hidden live region
  // beside it. aria-live, not role="status": the live-update notice owns role="status" (src/runtime/page.js), and the two must stay apart.
  const status = document.createElement('span');
  status.setAttribute('aria-live', 'polite');
  status.dataset.am = 'copy-image-status';
  status.className = 'am-visually-hidden';
  btn.after(status);
  const say = (text, restore) => {
    btn.textContent = text;
    status.textContent = text;
    clearTimeout(say.timer);
    if (restore) say.timer = setTimeout(() => { btn.textContent = idle; }, 1800);
  };

  // A disabled button says why, in the order of the conditions the page can act on: no rasterizer, a preview frame's feature policy
  // forbidding clipboard-write, then a missing async Clipboard API or secure context. The reason fills the button, its title, its
  // accessible name, and the hidden live region; no click handler is registered.
  let unavailable = null;
  if (!canRasterize) unavailable = btn.dataset.unavailableBrowser;
  else if (document.featurePolicy && document.featurePolicy.allowsFeature('clipboard-write') === false) unavailable = btn.dataset.unavailablePolicy;
  else if (!canCopy) unavailable = btn.dataset.unavailableClipboard;
  if (unavailable) {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = unavailable;
    btn.title = unavailable;
    btn.setAttribute('aria-label', unavailable);
    status.textContent = unavailable;
    return;
  }

  // Safari and unknown browsers can draw the page often enough to keep the button, but the result is not guaranteed: say so in the
  // title and the accessible name, and keep the original button text.
  if (!chromium && !gecko) {
    const unverified = btn.dataset.unverifiedEffect;
    btn.title = unverified;
    btn.setAttribute('aria-label', unverified);
  }

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

  // A canvas may not exceed the browser's dimension or area limit: shrink the pixels rather than fail on a long page.
  const pixelScale = (width, height) => {
    const wanted = Math.min(2, window.devicePixelRatio || 1);
    return Math.max(0.05, Math.min(wanted, MAX_DIM / width, MAX_DIM / height, Math.sqrt(MAX_AREA / (width * height))));
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

  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.setAttribute('aria-disabled', 'true');
    say(btn.dataset.working, false);
    try {
      // Start rasterizing, then hand the pending blob to ClipboardItem and write within the same click task so the browser keeps the
      // user's activation. Awaiting the raster first would spend it, and the write would be rejected.
      const blobPromise = rasterize();
      const item = new ClipboardItem({ 'image/png': blobPromise });
      await navigator.clipboard.write([item]);
      say(btn.dataset.done, true);
    } catch (e) {
      console.error('[am] copy image failed', e);
      say(btn.dataset.failed, true);
    } finally {
      busy = false;
      btn.removeAttribute('aria-disabled');
    }
  });
})();
