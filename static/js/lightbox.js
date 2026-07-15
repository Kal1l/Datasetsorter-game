// ── Lightbox ──────────────────────────────────────────────
const LB_ZOOM_MIN = 1, LB_ZOOM_MAX = 5, LB_ZOOM_STEP = 0.5;
let lbZoom = 1, lbPanX = 0, lbPanY = 0;
let lbDragging = false, lbDragStartX = 0, lbDragStartY = 0;
let lbDidDrag = false, lbMouseDownTarget = null;

const lbEl = document.getElementById('lightbox');

export function openLightbox(src) {
  const img = document.getElementById('lightbox-img');
  img.src = src;
  lbZoom = 1; lbPanX = 0; lbPanY = 0; lbDidDrag = false;
  lbEl.style.cursor = '';
  applyTransform(img);
  updateButtons();
  lbEl.classList.add('open');
}

export function closeLightbox() {
  lbEl.classList.remove('open');
  lbDragging = false;
}

function applyTransform(img) {
  img.style.transform = `scale(${lbZoom}) translate(${lbPanX / lbZoom}px, ${lbPanY / lbZoom}px)`;
}

function clampPan() {
  const img = document.getElementById('lightbox-img');
  const maxX = (img.offsetWidth  * (lbZoom - 1)) / 2;
  const maxY = (img.offsetHeight * (lbZoom - 1)) / 2;
  lbPanX = Math.max(-maxX, Math.min(maxX, lbPanX));
  lbPanY = Math.max(-maxY, Math.min(maxY, lbPanY));
}

function setZoom(v) {
  lbZoom = Math.min(LB_ZOOM_MAX, Math.max(LB_ZOOM_MIN, v));
  if (lbZoom === LB_ZOOM_MIN) { lbPanX = 0; lbPanY = 0; } else clampPan();
  applyTransform(document.getElementById('lightbox-img'));
  updateButtons();
  lbEl.style.cursor = lbZoom > LB_ZOOM_MIN ? 'grab' : '';
}

function updateButtons() {
  document.getElementById('lb-zoom-out').disabled   = lbZoom <= LB_ZOOM_MIN;
  document.getElementById('lb-zoom-in').disabled    = lbZoom >= LB_ZOOM_MAX;
  document.getElementById('lb-zoom-label').textContent = `${Math.round(lbZoom * 100)}%`;
}

export function initLightbox() {
  document.getElementById('lb-zoom-in').addEventListener('click',    () => setZoom(lbZoom + LB_ZOOM_STEP));
  document.getElementById('lb-zoom-out').addEventListener('click',   () => setZoom(lbZoom - LB_ZOOM_STEP));
  document.getElementById('lb-zoom-reset').addEventListener('click', () => setZoom(1));
  document.getElementById('lb-close').addEventListener('click', closeLightbox);

  lbEl.addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(lbZoom + (e.deltaY < 0 ? LB_ZOOM_STEP : -LB_ZOOM_STEP));
  }, { passive: false });

  lbEl.addEventListener('mousedown', e => {
    lbMouseDownTarget = e.target;
    lbDidDrag = false;
    if (e.target.closest('.lightbox-controls') || lbZoom <= LB_ZOOM_MIN) return;
    e.preventDefault();
    lbDragging = true;
    lbDragStartX = e.clientX - lbPanX;
    lbDragStartY = e.clientY - lbPanY;
    document.getElementById('lightbox-img').style.transition = 'none';
    lbEl.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!lbDragging) return;
    lbDidDrag = true;
    lbPanX = e.clientX - lbDragStartX;
    lbPanY = e.clientY - lbDragStartY;
    clampPan();
    applyTransform(document.getElementById('lightbox-img'));
  });

  window.addEventListener('mouseup', () => {
    if (lbDragging) {
      lbDragging = false;
      document.getElementById('lightbox-img').style.transition = '';
      lbEl.style.cursor = lbZoom > LB_ZOOM_MIN ? 'grab' : '';
    }
    if (!lbDidDrag && lbMouseDownTarget?.classList.contains('lightbox-backdrop')) closeLightbox();
    lbMouseDownTarget = null;
  });

  lbEl.addEventListener('touchstart', e => {
    if (e.target.closest('.lightbox-controls') || lbZoom <= LB_ZOOM_MIN || e.touches.length !== 1) return;
    lbDidDrag = false; lbDragging = true;
    lbDragStartX = e.touches[0].clientX - lbPanX;
    lbDragStartY = e.touches[0].clientY - lbPanY;
    document.getElementById('lightbox-img').style.transition = 'none';
  }, { passive: true });

  lbEl.addEventListener('touchmove', e => {
    if (!lbDragging || e.touches.length !== 1) return;
    e.preventDefault();
    lbDidDrag = true;
    lbPanX = e.touches[0].clientX - lbDragStartX;
    lbPanY = e.touches[0].clientY - lbDragStartY;
    clampPan();
    applyTransform(document.getElementById('lightbox-img'));
  }, { passive: false });

  lbEl.addEventListener('touchend', () => {
    if (!lbDragging) return;
    lbDragging = false;
    document.getElementById('lightbox-img').style.transition = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lbEl.classList.contains('open')) closeLightbox();
  });
}
