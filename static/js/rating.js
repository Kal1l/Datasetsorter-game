// ── Rating mode ───────────────────────────────────────────
import { showScreen, escHtml } from './utils.js';
import { openLightbox }        from './lightbox.js';
import { createNavigation }    from './navigation.js';

// ── State ─────────────────────────────────────────────────
let _folder          = '';
let _gameToken       = '';
let _evaluator       = '';
let _questionSet     = null;   // { name, questions: [...] }
let ratingTotal      = 0;
let ratingIndex      = 0;
let ratingAnswers    = {};     // { String(idx): true } — answered status only
let ratingResponses  = {};
let nav              = null;

// ── Navigation controller ─────────────────────────────────
function buildNav() {
  nav = createNavigation({
    filmstripEl:        document.getElementById('rating-filmstrip'),
    filmstripPrevBtn:   document.getElementById('rating-filmstrip-prev-btn'),
    filmstripNextBtn:   document.getElementById('rating-filmstrip-next-btn'),
    filmstripPageLabel: document.getElementById('rating-filmstrip-page-label'),
    prevBtn:            document.getElementById('rating-btn-prev'),
    nextBtn:            document.getElementById('rating-btn-next'),
    getTotal:           () => ratingTotal,
    getCurrentIndex:    () => ratingIndex,
    getStatus:          idx => ratingAnswers[String(idx)] ? 'answered' : null,
    onNavigate:         navigateTo,
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
  if (!_questionSet?.questions?.length) return;

  _questionSet.questions.forEach(q => {
    const item = document.createElement('div');
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
      for (let v = (q.min ?? 1); v <= (q.max ?? 5); v++) {
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
      (q.options ?? []).forEach(opt => {
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
    btn.classList.toggle('active', stored !== undefined && String(stored) === btn.dataset.value);
  });
  const questions   = _questionSet?.questions ?? [];
  const allAnswered = questions.every(q => ratingResponses[q.key] !== undefined);
  document.getElementById('rating-next-btn').disabled = !allAnswered;
}

// ── Question loading ──────────────────────────────────────
function loadQuestion(idx) {
  document.getElementById('rating-error').textContent = '';
  document.getElementById('rating-image').src = `/api/rating/image/${idx}?s=${_gameToken}`;
  ratingResponses = {};
  updateChoiceUI();
  const content = document.querySelector('.rating-content');
  if (content) content.scrollTop = 0;
}

// ── Answer submission ─────────────────────────────────────
async function submitAnswer() {
  document.getElementById('rating-error').textContent = '';
  const questions   = _questionSet?.questions ?? [];
  const allAnswered = questions.every(q => ratingResponses[q.key] !== undefined);
  if (!allAnswered) {
    document.getElementById('rating-error').textContent =
      `Please answer all ${questions.length} question${questions.length !== 1 ? 's' : ''}.`;
    return;
  }

  try {
    const res = await fetch('/api/rating/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ index: ratingIndex, responses: ratingResponses }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('rating-error').textContent = data.error || 'Could not save answers.';
      return;
    }

    ratingAnswers[String(ratingIndex)] = true;

    if (data.done) {
      document.getElementById('rating-done-path').innerHTML =
        `Evaluations saved to:<br/><strong>${escHtml(data.eval_folder)}</strong>`;
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
export async function startRatingGame(folder, selectedPaths, evaluator = null, questionSetName = null) {
  try {
    const body = { folder };
    if (selectedPaths)   body.selected_paths    = selectedPaths;
    if (evaluator)       body.evaluator         = evaluator;
    if (questionSetName) body.question_set_name = questionSetName;

    const res  = await fetch('/api/rating/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      // Try visible error elements in likely-visible screens
      for (const id of ['rating-config-error', 'select-error', 'setup-error']) {
        const el = document.getElementById(id);
        if (el) { el.textContent = data.error || 'Error starting rating mode.'; break; }
      }
      return;
    }

    _folder      = folder;
    _evaluator   = data.evaluator;
    _questionSet = data.question_set;
    _gameToken   = Date.now().toString(36);
    ratingTotal  = data.total;
    ratingIndex  = data.current ?? 0;

    ratingAnswers = {};
    (data.answered_indices || []).forEach(i => { ratingAnswers[String(i)] = true; });

    const evalLabel = document.getElementById('rating-evaluator-label');
    if (evalLabel) evalLabel.textContent = _evaluator;

    renderLikertQuestions();
    buildNav();
    updateProgressUI();
    showScreen('rating-screen');
    nav.build();
    loadQuestion(ratingIndex);
  } catch (err) {
    console.error(err);
  }
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