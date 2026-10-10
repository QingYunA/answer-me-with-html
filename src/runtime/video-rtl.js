// Right-to-left video pages carry this after video.js (src/video/render.js); a left-to-right page does not.
// video.js scrolls the chapter strip with a left offset measured from the strip's left edge. A right-to-left strip starts at its
// right edge and scrolls with negative offsets, so the active chip stayed out of view. Here the strip centres the active chip
// by where the chip is on screen, which holds for either direction.
(() => {
  const bar = document.querySelector('.amv-chapters');
  bar.scrollTo = (options) => {
    const chip = bar.querySelector('[aria-current]');
    if (!chip) return;
    const b = bar.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    bar.scrollBy({ left: c.left + c.width / 2 - (b.left + b.width / 2), behavior: options?.behavior });
  };
})();
