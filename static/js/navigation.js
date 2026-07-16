// ── Shared navigation controller ──────────────────────────
// Used by both Classic and Rating modes.
// Pass in DOM element references + callbacks; zero direct ID queries here.

export const FILMSTRIP_PAGE_SIZE = 10;

/**
 * @param {object} cfg
 * @param {HTMLElement}   cfg.filmstripEl
 * @param {HTMLElement}   cfg.filmstripPrevBtn
 * @param {HTMLElement}   cfg.filmstripNextBtn
 * @param {HTMLElement}   cfg.filmstripPageLabel
 * @param {HTMLElement}   cfg.prevBtn          - prev-image button (may be null)
 * @param {HTMLElement}   cfg.nextBtn          - next-image button (may be null)
 * @param {()=>number}    cfg.getTotal
 * @param {()=>number}    cfg.getCurrentIndex
 * @param {(idx:number)=>'good'|'bad'|'answered'|null} cfg.getStatus
 * @param {(idx:number)=>void} cfg.onNavigate  - called for all navigation
 */
export function createNavigation(cfg) {
  const { filmstripEl, filmstripPrevBtn, filmstripNextBtn, filmstripPageLabel,
          prevBtn, nextBtn, getTotal, getCurrentIndex, getStatus, onNavigate } = cfg;

  let page = 0;

  function pageCount() {
    return Math.max(1, Math.ceil(getTotal() / FILMSTRIP_PAGE_SIZE));
  }

  function renderPage() {
    filmstripEl.innerHTML = '';
    const start = page * FILMSTRIP_PAGE_SIZE;
    const end   = Math.min(start + FILMSTRIP_PAGE_SIZE, getTotal());
    for (let i = start; i < end; i++) {
      const tile = document.createElement('button');
      tile.className    = 'filmstrip-tile';
      tile.dataset.idx  = String(i);
      tile.title        = `Image ${i + 1}`;
      tile.addEventListener('click', () => onNavigate(i));
      filmstripEl.appendChild(tile);
    }
    updateTileStyles();
    updateArrows();
  }

  function updateTileStyles() {
    filmstripEl.querySelectorAll('.filmstrip-tile').forEach(tile => {
      const idx    = Number(tile.dataset.idx);
      const status = getStatus(idx);
      tile.className = 'filmstrip-tile';
      if (idx === getCurrentIndex())  tile.classList.add('current');
      if (status === 'good')          tile.classList.add('good');
      else if (status === 'bad')      tile.classList.add('bad');
      else if (status === 'answered') tile.classList.add('answered');
    });
  }

  function updateArrows() {
    if (filmstripPrevBtn) filmstripPrevBtn.disabled = page <= 0;
    if (filmstripNextBtn) filmstripNextBtn.disabled = page >= pageCount() - 1;
    if (filmstripPageLabel) filmstripPageLabel.textContent = String(page + 1);
  }

  function build() {
    page = Math.floor(getCurrentIndex() / FILMSTRIP_PAGE_SIZE);
    renderPage();
  }

  function update() {
    const needed = Math.floor(getCurrentIndex() / FILMSTRIP_PAGE_SIZE);
    if (needed !== page) { page = needed; renderPage(); }
    else { updateTileStyles(); updateArrows(); }
  }

  function prev() {
    const idx = getCurrentIndex();
    if (idx > 0) onNavigate(idx - 1);
  }

  function next() {
    const idx = getCurrentIndex();
    if (idx < getTotal() - 1) onNavigate(idx + 1);
  }

  // Wire filmstrip page arrows (use onclick to avoid stacking listeners on re-init)
  if (filmstripPrevBtn) {
    filmstripPrevBtn.onclick = () => {
      if (page > 0) { page--; renderPage(); }
    };
  }
  if (filmstripNextBtn) {
    filmstripNextBtn.onclick = () => {
      if (page < pageCount() - 1) { page++; renderPage(); }
    };
  }
  // Wire image prev/next buttons (use onclick to avoid stacking listeners on re-init)
  if (prevBtn) prevBtn.onclick = prev;
  if (nextBtn) nextBtn.onclick = next;

  return { build, update, prev, next };
}
