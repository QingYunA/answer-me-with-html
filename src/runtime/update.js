// Pages with a new-version button only: src/render.js adds this script after the page script.
// The button is for the person who made the page: it shows on a page opened from disk or from this computer, and only where the
// browser has native popovers (they open and close the popover with no script). A page shared with am serve --lan or --public-url
// keeps it hidden.
(() => {
  const button = document.querySelector('[data-am="update"]');
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!button || !local || !Object.hasOwn(HTMLElement.prototype, 'popover')) return;
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
