// The theme wall (/themes/): each card shows the sample page the build already rendered in the theme, in a small frame.
// Hover or focus on a card shows the frame in dark; leaving it shows light again. This page loads no renderer.
import { copyText, track } from './main.js';

for (const card of document.querySelectorAll('.tcard')) {
  const frame = card.querySelector('iframe');
  const link = card.querySelector('.tcard-link');
  let mode = 'light';
  // The frame is a page of this site, so its root can be reached. A frame that has not loaded yet (it loads lazily) takes the mode when it does.
  const apply = () => {
    try { frame.contentDocument?.documentElement.setAttribute('data-mode', mode); } catch { /* another origin (a file:// preview): leave it */ }
  };
  const show = (next) => { mode = next; apply(); };
  frame.addEventListener('load', apply);
  card.addEventListener('pointerenter', () => show('dark'));
  card.addEventListener('pointerleave', () => show('light'));
  link.addEventListener('focus', () => show('dark'));
  link.addEventListener('blur', () => show('light'));
  const open = () => track('theme-open', { theme: card.dataset.theme });
  link.addEventListener('click', open);
  link.addEventListener('auxclick', (e) => { if (e.button === 1) open(); });
}

document.getElementById('submit-theme')?.addEventListener('click', () => track('editor-open', { from: 'wall' }));

// The prompt that hands making a theme to the user's agent (it points the agent at /themes/make.md).
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    track('theme-make-copy');
    const text = document.getElementById(btn.dataset.copy).textContent;
    dispatchEvent(new CustomEvent('site:copied', { detail: { button: btn, ok: await copyText(text) } }));
  });
}
