// Pages with a new-version button only: src/render.js adds this script after the page script.
// The button shows where the browser has native popovers (they open and close the popover with no script). A page that am serve
// sends to another device has no button (src/serve.js), so this script does not look at the address.
(() => {
  const button = document.querySelector('[data-am="update"]');
  if (!button || !Object.hasOwn(HTMLElement.prototype, 'popover')) return;
  button.hidden = false;
  // Each copy button copies its data-text and reads data-done for a moment, then comes back to the label it started from. That
  // label is read once, here: a second click inside the moment would otherwise read the copied label off the button and restore
  // that instead, and the label would never come back. The moment starts again on each click: the timer of the previous one is
  // left to fire and does nothing.
  for (const copy of document.querySelectorAll('[data-am="copy-text"]')) {
    const idle = copy.textContent;
    let clicks = 0;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.text);
      } catch {
        return;
      }
      copy.textContent = copy.dataset.done;
      const mine = ++clicks;
      setTimeout(() => { if (mine === clicks) copy.textContent = idle; }, 1400);
    });
  }
})();
