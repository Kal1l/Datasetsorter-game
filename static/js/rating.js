// ── Rating mode ───────────────────────────────────────────
import { showScreen, escHtml } from './utils.js';
import { openLightbox }        from './lightbox.js';
import { createNavigation }    from './navigation.js';

// ── State ─────────────────────────────────────────────────
let _folder       = '';
let _gameToken    = '';
let ratingTotal   = 0;
let ratingIndex   = 0;
let ratingAnswers = {};   // { String(idx): answer }
let ratingResponses  = {};
let ratingSubjective = '';
let nav = null;

const QUESTION_CONFIG = [
  { key: 'do_you_like_this_image',              label: '1. Do you like this image?' },
  { key: 'does_this_image_look_ai_generated',   label: '2. Do you think this image looks AI generated?' },
  { key: 'is_the_image_visually_clear',         label: '3. Is this image visually clear?' },
  { key: 'is_the_content_coherent',             label: '4. Is the content coherent?' },
  { key: 'would_you_use_this_image_in_a_dataset', label: '5. Would you use this image in a dataset?' },
];

// ── Navigation controller ─────────────────────────────────
function buildNav() {
  nav = createNavigation({
    filmstripEl:        document.getElementById('rating-filmstrip'),
    filmstripPrevBtn:   document.getElementById('rating-filmstrip-prev-btn'),
    filmstripNextBtn:   document.getElementById('rating-filmstrip-next-btn'),
    filmstripPageLabel: document.getElementById('rating-filmstrip-page-label'),
    prevBtn: document.getElementById('rating-btn-prev'),
    nextBtn: document.getElementById('rating-btn-next'),
    getTotal:        () => ratingTotal,
    getCurrentIndex: () => ratingIndex,
    getStatus:       idx => ratingAnswers[String(idx)] ? 'answered' : null,
    onNavigate:      navigateTo,
  });
}

function navigateTo(idx) {
  ratingIndex = idx;
  updateProgressUI();
  loadQuestion(idx);
}

// ── UI helpers ────────────────────────────────────────────
function updateProgressUI() {
  const answered = Object.keys(ratingAnswers).length;
  document.getElementById('rating-progress-label').textContent = `${answered} / ${ratingTotal} answered`;
  document.getElementById('rating-progress-fill').style.width  = ratingTotal
    ? `${(answered / ratingTotal) * 100}%` : '0%';
  if (nav) nav.update();
}

function renderLikertQuestions() {
  const container = document.getElementById('likert-list');
  container.innerHTML = '';
  QUESTION_CONFIG.forEach(q => {
    const item  = document.createElement('div');
    item.className = 'likert-item';
    const title = document.createElement('h4');
    title.textContent = q.label;
    const row   = document.createElement('div');
    row.className = 'likert-row';
    for (let v = 1; v <= 5; v++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn likert-btn';
      btn.dataset.question = q.key;
      btn.dataset.value    = String(v);
      btn.textContent      = String(v);
      btn.addEventListener('click', () => { ratingResponses[q.key] = v; updateChoiceUI(); });
      row.appendChild(btn);
    }
    item.appendChild(title);
    item.appendChild(row);
    container.appendChild(item);
  });
}

function updateChoiceUI() {
  document.querySelectorAll('#likert-list .likert-btn').forEach(btn => {
    btn.classList.toggle('active', ratingResponses[btn.dataset.question] === Number(btn.dataset.value));
  });
  ratingSubjective = document.getElementById('subjective-input').value.trim();
  const allAnswered = QUESTION_CONFIG.every(q => Number.isInteger(ratingResponses[q.key]));
  document.getElementById('rating-next-btn').disabled = !(allAnswered && ratingSubjective);
}

// ── Question loading ──────────────────────────────────────
function loadQuestion(idx) {
  document.getElementById('rating-error').textContent = '';
  document.getElementById('rating-image').src = `/api/rating/image/${idx}?s=${_gameToken}`;

  const existing = ratingAnswers[String(idx)];
  if (existing) {
    ratingResponses = {};
    QUESTION_CONFIG.forEach(q => { ratingResponses[q.key] = existing[q.key]; });
    document.getElementById('subjective-input').value = existing.subjective || '';
  } else {
    ratingResponses = {};
    document.getElementById('subjective-input').value = '';
  }
  ratingSubjective = document.getElementById('subjective-input').value.trim();
  updateChoiceUI();
}

// ── Answer submission ─────────────────────────────────────
async function submitAnswer() {
  document.getElementById('rating-error').textContent = '';
  const allAnswered = QUESTION_CONFIG.every(q => Number.isInteger(ratingResponses[q.key]));
  ratingSubjective = document.getElementById('subjective-input').value.trim();
  if (!allAnswered || !ratingSubjective) {
    document.getElementById('rating-error').textContent =
      'Answer all 5 Likert questions and the descriptive question.';
    return;
  }

  try {
    const res = await fetch('/api/rating/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index: ratingIndex, responses: ratingResponses, subjective: ratingSubjective,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('rating-error').textContent = data.error || 'Could not save answers.';
      return;
    }

    // Cache locally so navigation can pre-fill the form
    ratingAnswers[String(ratingIndex)] = { ...ratingResponses, subjective: ratingSubjective };

    if (data.done) {
      document.getElementById('rating-answered').textContent   = String(data.answered ?? Object.keys(ratingAnswers).length);
      document.getElementById('rating-average').textContent    = data.average || '0.0';
      document.getElementById('rating-mode-total').textContent = String(ratingTotal);
      document.getElementById('rating-csv-path').innerHTML     =
        `CSV saved at:<br/><strong>${escHtml(data.csv_path)}</strong>`;
      showScreen('rating-done-screen');
    } else {
      navigateTo(findNextUnanswered(ratingIndex));
    }
  } catch {
    document.getElementById('rating-error').textContent = 'Could not connect to server.';
  }
}

function findNextUnanswered(from) {
  for (let i = from + 1; i < ratingTotal; i++) { if (!ratingAnswers[String(i)]) return i; }
  for (let i = 0; i < from; i++)               { if (!ratingAnswers[String(i)]) return i; }
  return from;
}

// ── Public API ────────────────────────────────────────────
export async function startRatingGame(folder, selectedPaths) {
  try {
    const body = { folder };
    if (selectedPaths) body.selected_paths = selectedPaths;
    const res  = await fetch('/api/rating/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('select-error').textContent = data.error || 'Error starting rating mode.';
      return;
    }
    _folder       = folder;
    _gameToken    = Date.now().toString(36);
    ratingTotal   = data.total;
    ratingIndex   = data.current ?? 0;
    ratingAnswers = data.answers  || {};
    renderLikertQuestions();
    buildNav();
    updateProgressUI();
    showScreen('rating-screen');
    nav.build();
    loadQuestion(ratingIndex);
  } catch (err) { console.error(err); }
}

export function initRatingListeners() {
  document.getElementById('rating-next-btn').addEventListener('click', submitAnswer);
  document.getElementById('subjective-input').addEventListener('input', updateChoiceUI);
  document.getElementById('rating-image').addEventListener('click', () => {
    const src = document.getElementById('rating-image').src;
    if (src) openLightbox(src);
  });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('rating-screen').classList.contains('active')) return;
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (nav) nav.prev(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (nav) nav.next(); }
  });
}
