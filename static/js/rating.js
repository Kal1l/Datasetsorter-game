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
let nav = null;

const QUESTION_CONFIG = [
  {
    key:   'match_description',
    label: '1. How well does the image match the description?',
    hint:  'Very Bad [1] — Very Well [5]',
    type:  'likert',
  },
  {
    key:   'originality',
    label: '2. How original is the image, given it was created with the prompt?',
    hint:  'Extremely Not Original [1] — Extremely Original [5]',
    type:  'likert',
  },
  {
    key:   'visual_discomfort',
    label: '3. To what extent does this image cause you visual discomfort or unease?',
    hint:  'No Discomfort [1] — Extremely Discomfort [5]',
    type:  'likert',
  },
  {
    key:   'aesthetic_pleasing',
    label: '4. How aesthetically pleasing is the image?',
    hint:  'Extremely Not Pleasing [1] — Extremely Pleasing [5]',
    type:  'likert',
  },
  {
    key:     'clear_subject',
    label:   '5. Is it clear who the subject(s) of the image is?',
    type:    'ternary',
    options: ['Yes', 'No', 'Maybe'],
  },
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
    item.appendChild(title);

    if (q.hint) {
      const hint = document.createElement('p');
      hint.className = 'likert-hint';
      hint.textContent = q.hint;
      item.appendChild(hint);
    }

    const row = document.createElement('div');
    row.className = 'likert-row';

    if (q.type === 'likert') {
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
    } else if (q.type === 'ternary') {
      q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn ternary-btn';
        btn.dataset.question = q.key;
        btn.dataset.value    = opt.toLowerCase();
        btn.textContent      = opt;
        btn.addEventListener('click', () => { ratingResponses[q.key] = opt.toLowerCase(); updateChoiceUI(); });
        row.appendChild(btn);
      });
    }

    item.appendChild(row);
    container.appendChild(item);
  });
}

function updateChoiceUI() {
  document.querySelectorAll('#likert-list .choice-btn').forEach(btn => {
    const stored = ratingResponses[btn.dataset.question];
    // universal comparison: convert stored value to string to match dataset.value
    btn.classList.toggle('active', stored !== undefined && String(stored) === btn.dataset.value);
  });
  const allAnswered = QUESTION_CONFIG.every(q => ratingResponses[q.key] !== undefined);
  document.getElementById('rating-next-btn').disabled = !allAnswered;
}

// ── Question loading ──────────────────────────────────────
function loadQuestion(idx) {
  document.getElementById('rating-error').textContent = '';
  document.getElementById('rating-image').src = `/api/rating/image/${idx}?s=${_gameToken}`;

  const existing = ratingAnswers[String(idx)];
  ratingResponses = {};
  if (existing) {
    QUESTION_CONFIG.forEach(q => { ratingResponses[q.key] = existing[q.key]; });
  }
  updateChoiceUI();

  // Scroll the form back to the top on every image switch
  const content = document.querySelector('.rating-content');
  if (content) content.scrollTop = 0;
}

// ── Answer submission ─────────────────────────────────────
async function submitAnswer() {
  document.getElementById('rating-error').textContent = '';
  const allAnswered = QUESTION_CONFIG.every(q => ratingResponses[q.key] !== undefined);
  if (!allAnswered) {
    document.getElementById('rating-error').textContent = 'Please answer all 5 questions.';
    return;
  }

  try {
    const res = await fetch('/api/rating/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: ratingIndex, responses: ratingResponses }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('rating-error').textContent = data.error || 'Could not save answers.';
      return;
    }

    ratingAnswers[String(ratingIndex)] = { ...ratingResponses };

    if (data.done) {
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
  document.getElementById('rating-image').addEventListener('click', () => {
    const src = document.getElementById('rating-image').src;
    if (src) openLightbox(src);
  });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('rating-screen').classList.contains('active')) return;
    if (e.key === 'ArrowUp')        { e.preventDefault(); if (nav) nav.prev(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (nav) nav.next(); }
  });
}
