// Pages made with the close_after_reply setting only: src/render.js adds this script after the page script. When the reply is copied,
// the reply sheet closes and a popover counts down to closing the tab. Browsers close only a tab no link has moved on, so a tab that
// stays open says it can be closed. A browser without native popovers does nothing.
(() => {
  const ui = JSON.parse(document.querySelector('[data-am="reply"]')?.dataset.ui ?? '{}');
  const after = ui.closeAfter;
  if (!after || !Object.hasOwn(HTMLElement.prototype, 'popover')) return;
  const note = Object.assign(document.createElement('div'), { className: 'am-closing' });
  note.setAttribute('popover', 'manual');
  note.setAttribute('role', 'status');
  const text = document.createElement('span');
  const keep = Object.assign(document.createElement('button'), { type: 'button', className: 'am-btn', textContent: after.keep });
  note.append(text, keep);
  document.body.append(note);

  let timer, check;
  const stop = () => {
    clearInterval(timer);
    clearTimeout(check);
    if (note.matches(':popover-open')) note.hidePopover();
  };
  keep.addEventListener('click', stop);

  document.addEventListener('am-reply-copied', () => {
    stop();
    document.querySelector('dialog.am-reply')?.close();
    let left = after.seconds;
    const show = () => { text.textContent = after.closing.replace('{n}', left); };
    keep.textContent = after.keep;
    show();
    note.showPopover();
    timer = setInterval(() => {
      left -= 1;
      if (left > 0) return show();
      clearInterval(timer);
      window.close();
      // Still here: the browser refused to close the tab.
      check = setTimeout(() => {
        text.textContent = after.closeFailed;
        keep.textContent = ui.close;
      }, 300);
    }, 1000);
  });
})();
