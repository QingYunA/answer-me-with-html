// Pages with a new-version button only: src/render.js adds this script after the page script.
// The button shows where the browser has native popovers (they open and close the popover with no script). A page that am serve
// sends to another device has no button (src/serve.js), so this script does not look at the address.
(() => {
  const button = document.querySelector('[data-am="update"]');
  if (!button || !Object.hasOwn(HTMLElement.prototype, 'popover')) return;
  button.hidden = false;
  // Each copy button copies its data-text and reads data-done for a moment.
  for (const copy of document.querySelectorAll('[data-am="copy-text"]')) {
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.text);
      } catch {
        return;
      }
      const label = copy.textContent;
      copy.textContent = copy.dataset.done;
      setTimeout(() => { copy.textContent = label; }, 1400);
    });
  }
})();
