// ── Classic mode ──────────────────────────────────────────
import { showScreen }      from './utils.js';
import { openLightbox }    from './lightbox.js';
import { createNavigation } from './navigation.js';

// ── State ─────────────────────────────────────────────────
let _folder   = '';
let total     = 0;
let currentIndex = 0;
let goodCount = 0, badCount = 0;
let judgments = {};   // { Number(idx): 'good'|'bad' }
let isAnimating = false;
let currentCard  = null;
let currentRatio = 1;
let nav = null;

// ── Navigation controller ─────────────────────────────────
function buildNav() {
  nav = createNavigation({
    filmstripEl:        document.getElementById('filmstrip'),
    filmstripPrevBtn:   document.getElementById('filmstrip-prev-btn'),
    filmstripNextBtn:   document.getElementById('filmstrip-next-btn'),
    filmstripPageLabel: document.getElementById('filmstrip-page-label'),
    prevBtn: document.getElementById('btn-prev'),
    nextBtn: document.getElementById('btn-next'),
    getTotal:        () => total,
    getCurrentIndex: () => currentIndex,
    getStatus:       idx => judgments[idx] ?? null,
    onNavigate:      navigateTo,
  });
}

function navigateTo(idx) {
  if (isAnimating) return;
  currentIndex = idx;
  updateUI();
  loadCard(idx);
}

// ── UI helpers ────────────────────────────────────────────
function updateUI() {
  const judged = Object.keys(judgments).length;
  document.getElementById('progress-label').textContent = `${judged} / ${total}`;
  document.getElementById('progress-fill').style.width = total ? `${(judged / total) * 100}%` : '0%';
  document.getElementById('cnt-good').textContent = `✓ ${goodCount}`;
  document.getElementById('cnt-bad').textContent  = `✗ ${badCount}`;
  if (nav) nav.update();
}

function fitCard() {
  if (!currentCard) return;
  const area = document.getElementById('card-area');
  const w = area.clientWidth, h = area.clientHeight;
  if (!w || !h) return;
  currentCard.style.width  = `${Math.min(w, Math.max(240, Math.round(h * currentRatio)))}px`;
  currentCard.style.height = `${h}px`;
}

// ── Card loading ──────────────────────────────────────────
function loadCard(idx) {
  const area = document.getElementById('card-area');
  area.innerHTML = '';
  currentCard = null;
  currentRatio = 1;
  if (idx < 0 || idx >= total) return;

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'current-card';

  const stampGood = document.createElement('div');
  stampGood.className = 'stamp stamp-good';
  stampGood.textContent = 'GOOD';

  const stampBad = document.createElement('div');
  stampBad.className = 'stamp stamp-bad';
  stampBad.textContent = 'BAD';

  const img = document.createElement('img');
  img.src = `/api/classic/image/${idx}`;
  img.alt = 'dataset image';
  img.draggable = false;

  // Faint indicator for already-judged images
  const existing = judgments[idx];
  if (existing === 'good') stampGood.style.opacity = '0.28';
  else if (existing === 'bad')  stampBad.style.opacity  = '0.28';

  card.appendChild(stampGood);
  card.appendChild(stampBad);
  card.appendChild(img);
  area.appendChild(card);
  currentCard = card;

  const applyFit = () => {
    if (img.naturalWidth && img.naturalHeight) currentRatio = img.naturalWidth / img.naturalHeight;
    fitCard();
  };
  if (img.complete) applyFit();
  else img.addEventListener('load', applyFit, { once: true });

  initDrag(card, stampGood, stampBad);

  // Preload next
  if (idx + 1 < total) { const pre = new Image(); pre.src = `/api/classic/image/${idx + 1}`; }
}

// ── Swipe / drag ──────────────────────────────────────────
const SWIPE_RATIO = 0.18;
const MAX_ROT     = 20;

function initDrag(card, stampGood, stampBad) {
  let startX = 0, currentX = 0, dragging = false;

  function onStart(x) {
    if (isAnimating) return;
    startX = x; currentX = 0; dragging = true;
    card.style.transition = 'none';
  }
  function onMove(x) {
    if (!dragging) return;
    currentX = x - startX;
    const rot   = (currentX / window.innerWidth) * MAX_ROT;
    const ratio = Math.min(Math.abs(currentX) / (window.innerWidth * SWIPE_RATIO), 1);
    card.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;
    if (currentX > 0) { stampGood.style.opacity = ratio; stampBad.style.opacity = 0; }
    else              { stampBad.style.opacity  = ratio; stampGood.style.opacity = 0; }
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    const dist = Math.abs(currentX);
    if (dist < 6) {
      card.style.transition = '';
      card.style.transform  = '';
      const img = card.querySelector('img');
      if (img) openLightbox(img.src);
      return;
    }
    if (dist >= window.innerWidth * SWIPE_RATIO) {
      flyOut(currentX > 0 ? 'good' : 'bad');
    } else {
      card.style.transition = 'transform 0.35s cubic-bezier(.25,.8,.25,1)';
      card.style.transform  = '';
      stampGood.style.opacity = 0;
      stampBad.style.opacity  = 0;
    }
  }

  card.addEventListener('mousedown', e => onStart(e.clientX));
  window.addEventListener('mousemove', e => { if (dragging) onMove(e.clientX); });
  window.addEventListener('mouseup', onEnd);
  card.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  card.addEventListener('touchmove',  e => onMove(e.touches[0].clientX),  { passive: true });
  card.addEventListener('touchend', onEnd);
}

function flyOut(direction) {
  if (isAnimating) return;
  isAnimating = true;
  const card = document.getElementById('current-card');
  if (!card) return;
  const x   = direction === 'good' ? window.innerWidth * 1.5 : -window.innerWidth * 1.5;
  const rot = direction === 'good' ? MAX_ROT : -MAX_ROT;
  card.style.transition = 'transform 0.35s cubic-bezier(.4,0,.2,1), opacity 0.35s';
  card.style.transform  = `translateX(${x}px) rotate(${rot}deg)`;
  card.style.opacity    = '0';
  recordAction(direction);
}

// ── Action recording ──────────────────────────────────────
async function recordAction(direction) {
  try {
    const res = await fetch('/api/classic/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, index: currentIndex }),
    });
    const data = await res.json();

    goodCount = data.good_count ?? goodCount;
    badCount  = data.bad_count  ?? badCount;
    judgments[currentIndex] = direction;

    if (data.done) {
      updateUI();
      setTimeout(() => { isAnimating = false; showDone(); }, 380);
      return;
    }

    const next = findNextUnclassified(currentIndex);
    currentIndex = next;
    updateUI();
    setTimeout(() => { isAnimating = false; loadCard(currentIndex); }, 380);
  } catch (err) {
    isAnimating = false;
    console.error('Action failed', err);
  }
}

function findNextUnclassified(from) {
  for (let i = from + 1; i < total; i++) { if (!judgments[i]) return i; }
  for (let i = 0; i < from; i++)         { if (!judgments[i]) return i; }
  return from;
}

function showDone() {
  document.getElementById('done-good').textContent = goodCount;
  document.getElementById('done-bad').textContent  = badCount;
  document.getElementById('done-path').innerHTML   =
    `Images saved to:<br/><strong>${_folder}/good</strong> and <strong>${_folder}/bad</strong>`;
  showScreen('done-screen');
}

// ── Public API ────────────────────────────────────────────
export async function startClassicGame(folder, selectedPaths) {
  try {
    const body = { folder };
    if (selectedPaths) body.selected_paths = selectedPaths;
    const res  = await fetch('/api/classic/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('select-error').textContent = data.error || 'Error starting game.';
      return;
    }
    _folder = folder;
    total = data.total; currentIndex = 0;
    goodCount = 0; badCount = 0; judgments = {};
    buildNav();
    updateUI();
    showScreen('game-screen');
    nav.build();
    loadCard(0);
  } catch (err) { console.error(err); }
}

export async function resumeClassicGame(folder) {
  try {
    const res  = await fetch('/api/classic/resume', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not resume session.'); return; }
    _folder = folder;
    total = data.total; currentIndex = data.current;
    goodCount = data.good_count; badCount = data.bad_count;
    judgments = data.judgments || {};
    buildNav();
    updateUI();
    showScreen('game-screen');
    nav.build();
    loadCard(currentIndex);
  } catch (err) { console.error(err); }
}

export function initClassicListeners() {
  document.getElementById('btn-good').addEventListener('click', () => { if (!isAnimating) flyOut('good'); });
  document.getElementById('btn-bad').addEventListener('click',  () => { if (!isAnimating) flyOut('bad');  });

  document.addEventListener('keydown', e => {
    if (!document.getElementById('game-screen').classList.contains('active')) return;
    if (e.key === 'ArrowRight')      { if (!isAnimating) flyOut('good'); }
    else if (e.key === 'ArrowLeft')  { if (!isAnimating) flyOut('bad');  }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); if (nav) nav.prev(); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); if (nav) nav.next(); }
  });

  window.addEventListener('resize', () => {
    if (document.getElementById('game-screen').classList.contains('active')) fitCard();
  });
}
