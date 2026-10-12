// am serve only: src/serve.js adds this script to the page it sends (never to the file on disk), with the page's event link and the
// labels in the page language. When the page file changes, the server sends one "changed" event. A served page is sandboxed and has
// no localStorage, so Reply answers, comments and remarks live only in this tab: a reader who has answered, commented or marked
// anything gets a notice and reloads when ready; otherwise the page reloads by itself.
(() => {
  const { url, ui } = JSON.parse(document.currentScript.dataset.live);
  if (!window.EventSource) return;
  // history.state survives a reload, so the page comes back where the reader was.
  try {
    const y = history.state?.amScrollY;
    if (Number.isFinite(y)) addEventListener('load', () => scrollTo(0, y), { once: true });
  } catch {
    // No history state in this browser: the page opens at the top.
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
    try {
      history.replaceState({ ...history.state, amScrollY: scrollY }, '');
    } catch {
      // Without history state the page reloads at the top.
    }
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
