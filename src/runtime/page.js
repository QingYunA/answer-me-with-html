(() => {
  const root = document.documentElement;
  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
  // The button's data-labels lists every value in cycle order, so the runtime names no theme or mode.
  const bind = (name, attr) => {
    const btn = document.querySelector(`[data-am="${name}"]`);
    if (!btn) return;
    const labels = JSON.parse(btn.dataset.labels || '{}');
    const show = (value) => { btn.textContent = labels[value] || value; };
    show(root.getAttribute(attr));
    btn.addEventListener('click', () => {
      const next = cycle(Object.keys(labels), root.getAttribute(attr));
      root.setAttribute(attr, next);
      show(next);
    });
  };
  bind('theme', 'data-theme');
  bind('mode', 'data-mode');

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
