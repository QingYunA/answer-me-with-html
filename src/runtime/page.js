(() => {
  const root = document.documentElement;
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
})();
