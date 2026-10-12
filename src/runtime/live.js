// am serve only: src/serve.js adds this script to the page it sends (never to the file on disk), with the page's event link and the
// labels in the page language. When the page file changes, the server sends one "changed" event. A served page is sandboxed and has
// no localStorage, so Reply answers, comments and remarks live only in this tab: a reader who has answered, commented or marked
// anything gets a notice and reloads when ready; otherwise the page reloads by itself.
(() => {
  const { url, ui } = JSON.parse(document.currentScript.dataset.live);
  if (!window.EventSource) return;
  // The page comes back where the reader was. A sandboxed page has an opaque origin, and Chrome drops its history.state on reload,
  // so the position goes in window.name, which a reload keeps. It is read once and cleared, so the next page in this tab never sees it.
  const SCROLL = /^am-scroll:(\d+)$/;
  const saved = SCROLL.exec(window.name);
  if (saved) {
    window.name = '';
    // Otherwise the browser's own restore runs after load and puts the page back at the top.
    try {
      history.scrollRestoration = 'manual';
    } catch {
      // Not settable here: the restore below may lose to the browser's.
    }
    // The sheet grid lays itself out again after load and the page can shrink for a moment, which drops the position to the top.
    // So hold it for a second after load, and let go as soon as the reader scrolls, clicks or types.
    const y = Number(saved[1]);
    const READER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    let until = 0;
    const stop = () => { until = 0; };
    const hold = () => {
      if (Date.now() > until) return READER.forEach((type) => removeEventListener(type, stop, true));
      if (Math.abs(scrollY - y) > 1) scrollTo(0, y);
      requestAnimationFrame(hold);
    };
    addEventListener('load', () => {
      until = Date.now() + 1000;
      READER.forEach((type) => addEventListener(type, stop, { capture: true, passive: true }));
      hold();
    }, { once: true });
  }
  // Theme and mode are page settings, not the reader's input.
  let input = false;
  const typed = (e) => { if (!e.target.closest?.('.am-toolbar')) input = true; };
  document.addEventListener('input', typed, true);
  document.addEventListener('change', typed, true);
  // A click on the option that is already picked confirms the suggestion (src/runtime/reply.js) without a change event.
  document.addEventListener('click', (e) => { if (e.target.closest?.('.am-ask input')) input = true; }, true);
  const hasInput = () => input || Boolean(window.__amRemarkData?.().length);

  const reload = () => {
    if (!window.name || SCROLL.test(window.name)) window.name = `am-scroll:${Math.round(scrollY)}`;
    location.reload();
  };
  let notice = null;
  new EventSource(url).addEventListener('changed', () => {
    if (!hasInput()) return reload();
    if (notice) return;
    notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;inset-block-end:16px;inset-inline-start:50%;translate:-50% 0;z-index:1000;display:flex;align-items:center;gap:10px;'
      + 'padding:8px 12px;font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line-2);border-radius:var(--radius);box-shadow:0 8px 30px rgba(0,0,0,.2)';
    if (document.documentElement.dir === 'rtl') notice.style.translate = '50% 0';
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'am-btn', textContent: ui.reload });
    button.addEventListener('click', reload);
    notice.append(`${ui.updated} ·`, button);
    document.body.append(notice);
  });
})();
