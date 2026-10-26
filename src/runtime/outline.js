// The outline rail of a doc page (src/templates/doc.js): the markup already works without a script, <details> opens the list and the
// links jump. This adds the hover dwell, the open direction, the keys, the tap outside and the marking of the current section.
(() => {
  const nav = document.querySelector('nav.am-toc');
  const box = nav && nav.querySelector('details.am-outline');
  if (!box) return;
  const sum = box.querySelector('summary');
  const links = Array.from(box.querySelectorAll('.am-outline-list a'));
  const ticks = Array.from(box.querySelectorAll('.am-tick'));
  const LIST_W = 240; // keep in step with .am-outline-list in src/themes/base.css
  const EDGE = 10; // the 6px gap to the rail plus a margin to the viewport edge
  let current = '';
  let byHover = false;
  let dwell = 0;
  let leave = 0;

  // Open away from the body when the room outside the rail fits the list; otherwise over the body. Never past the viewport.
  const place = () => {
    const r = sum.getBoundingClientRect();
    const right = r.left + r.width / 2 > innerWidth / 2;
    const room = right ? innerWidth - r.right : r.left;
    nav.dataset.flow = room >= Math.min(LIST_W, innerWidth - 48) + EDGE ? 'out' : 'in';
  };
  const setOpen = (open) => {
    if (open) place();
    box.open = open;
    if (!open) byHover = false;
  };
  const peek = (tick) => ticks.forEach((t) => t.classList.toggle('is-peek', t === tick));
  const currentLink = () => links.find((a) => a.getAttribute('aria-current') === 'true') || links[0];

  const mark = (id) => {
    current = id;
    ticks.forEach((t) => t.classList.toggle('is-current', t.dataset.id === id));
    links.forEach((a) => {
      if (a.getAttribute('href') === `#panel-${id}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  };
  const sections = ticks.map((t) => document.getElementById(`panel-${t.dataset.id}`)).filter(Boolean);
  if (sections.length) mark(sections[0].id.slice(6));
  if (sections.length && 'IntersectionObserver' in window) {
    // A thin band a third of the way down the viewport: the section across it is the one being read.
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
      const hit = sections.filter((s) => seen.has(s)).pop();
      if (hit && hit.id.slice(6) !== current) mark(hit.id.slice(6));
    }, { rootMargin: '-30% 0px -65% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  place();
  addEventListener('resize', place);

  // Mouse: dwelling on the rail opens the list, leaving it closes a list opened that way. A tap or click opens it for good.
  box.addEventListener('pointerenter', (e) => {
    clearTimeout(leave);
    if (e.pointerType !== 'mouse' || box.open) return;
    dwell = setTimeout(() => { setOpen(true); byHover = true; }, 300);
  });
  box.addEventListener('pointerleave', () => {
    clearTimeout(dwell);
    // A link the keyboard moved into keeps the list open; focusout closes it once the focus leaves the nav.
    if (byHover) leave = setTimeout(() => { if (!nav.contains(document.activeElement)) setOpen(false); }, 250);
  });
  sum.addEventListener('click', (e) => {
    clearTimeout(dwell);
    if (box.open && byHover) { e.preventDefault(); byHover = false; return; }
    place();
  });
  box.addEventListener('toggle', () => { if (box.open) peek(null); });

  // Keyboard: the summary opens with Enter or Space (native); arrows move through the links; Esc closes and returns to the rail.
  sum.addEventListener('focus', () => {
    if (sum.matches(':focus-visible')) peek(ticks.find((t) => t.dataset.id === current));
  });
  sum.addEventListener('blur', () => peek(null));
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.open) {
      e.preventDefault();
      setOpen(false);
      sum.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const at = links.indexOf(document.activeElement);
    if (at < 0 && e.target !== sum) return;
    e.preventDefault();
    if (!box.open) setOpen(true);
    let next;
    if (e.key === 'Home') next = links[0];
    else if (e.key === 'End') next = links[links.length - 1];
    else if (at < 0) next = e.key === 'ArrowDown' ? currentLink() : links[links.length - 1];
    else next = links[Math.min(links.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
  });
  nav.addEventListener('focusout', (e) => {
    if (box.open && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false);
  });

  // Choosing a section or tapping outside closes the list.
  links.forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('pointerdown', (e) => { if (box.open && !nav.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.open && !nav.contains(e.target)) setOpen(false); });
})();
