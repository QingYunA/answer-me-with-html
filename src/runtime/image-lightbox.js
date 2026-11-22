// Pages with an image only: src/render.js adds this script after the page script.
// A Markdown image fits its panel; click it, or press Enter / Space, to inspect the full image.
(() => {
  const images = [...document.querySelectorAll('.am-md img, .am-intro img, .am-panel-body img[src]')];
  if (!images.length || !document.body) return;
  const toolbar = document.querySelector('.am-toolbar');
  const closeLabel = toolbar?.getAttribute('data-am-image-close') || 'Close image';
  const openLabel = toolbar?.getAttribute('data-am-image-open') || 'Open image';
  const labelSeparator = toolbar?.getAttribute('data-am-image-sep') || ': ';
  const lightbox = document.createElement('div');
  lightbox.className = 'am-image-lightbox';
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', openLabel);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'am-image-lightbox-close';
  close.setAttribute('aria-label', closeLabel);
  close.textContent = '×';
  const large = document.createElement('img');
  large.alt = '';
  lightbox.append(close, large);
  document.body.append(lightbox);
  let active = null;

  const hide = () => {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.classList.remove('am-image-lightbox-open');
    active?.focus();
    active = null;
  };
  const show = (image) => {
    active = image;
    large.src = image.currentSrc || image.src;
    large.alt = image.alt || '';
    lightbox.setAttribute('aria-label', image.alt || openLabel);
    lightbox.hidden = false;
    document.body.classList.add('am-image-lightbox-open');
    close.focus();
  };

  for (const image of images) {
    image.loading ||= 'lazy';
    image.decoding ||= 'async';
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', image.alt ? `${image.alt}${labelSeparator}${openLabel}` : openLabel);
    image.addEventListener('click', (event) => {
      event.preventDefault();
      show(image);
    });
    image.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      show(image);
    });
  }
  close.addEventListener('click', hide);
  large.addEventListener('click', hide);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) hide();
  });
  lightbox.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    close.focus();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
})();
