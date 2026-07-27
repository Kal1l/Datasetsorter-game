// ── Review mode ───────────────────────────────────────────
import { showScreen, escHtml } from './utils.js';
import { openLightbox }        from './lightbox.js';

// ── State ─────────────────────────────────────────────────
let _folder              = '';
let _reviewTotal         = 0;
let _reviewIndex         = 0;
let _evaluatorIndex      = 0;
let _currentEvaluator    = null;   // name — preserved across image navigation
let _currentEntry        = null;   // response from /api/review/entry/<idx>

// ── Setup screen ──────────────────────────────────────────
export function showReviewSetup() {
  document.getElementById('review-setup-error').textContent = '';
  document.getElementById('review-evaluators-section').style.display = 'none';
  showScreen('review-setup-screen');
}

async function _scanFolder() {
  const folder = document.getElementById('review-folder-input').value.trim();
  document.getElementById('review-setup-error').textContent = '';
  if (!folder) {
    document.getElementById('review-setup-error').textContent = 'Please enter a folder path.';
    return;
  }
  _folder = folder;
  try {
    const res  = await fetch('/api/review/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('review-setup-error').textContent = data.error || 'Error scanning folder.';
      return;
    }
    _renderEvaluatorList(data.evaluators || []);
  } catch {
    document.getElementById('review-setup-error').textContent = 'Could not connect to server.';
  }
}

function _renderEvaluatorList(evaluators) {
  const list    = document.getElementById('review-evaluators-list');
  const section = document.getElementById('review-evaluators-section');
  list.innerHTML = '';

  if (evaluators.length === 0) {
    list.innerHTML = '<p class="muted-text">No evaluations found in this folder.</p>';
    document.getElementById('review-load-btn').disabled = true;
  } else {
    evaluators.forEach(ev => {
      const label = document.createElement('label');
      label.className = 'evaluator-checkbox-row';
      label.innerHTML = `
        <input type="checkbox" value="${escHtml(ev.name)}" checked />
        <span class="evaluator-name">${escHtml(ev.name)}</span>
        <span class="qs-meta">${ev.count} file${ev.count !== 1 ? 's' : ''}</span>
      `;
      list.appendChild(label);
    });
    document.getElementById('review-load-btn').disabled = false;
  }
  section.style.display = '';
}

async function _loadReview() {
  document.getElementById('review-setup-error').textContent = '';
  const selected = [...document.querySelectorAll('#review-evaluators-list input:checked')]
    .map(cb => cb.value);
  if (selected.length === 0) {
    document.getElementById('review-setup-error').textContent = 'Select at least one evaluator.';
    return;
  }
  try {
    const res  = await fetch('/api/review/load', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: _folder, evaluators: selected }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('review-setup-error').textContent = data.error || 'Error loading evaluations.';
      return;
    }
    if (data.total === 0) {
      document.getElementById('review-setup-error').textContent = 'No evaluations found for the selected evaluators.';
      return;
    }
    _reviewTotal      = data.total;
    _reviewIndex      = 0;
    _currentEvaluator = null;
    showScreen('review-screen');
    await _loadEntry(0);
  } catch {
    document.getElementById('review-setup-error').textContent = 'Could not connect to server.';
  }
}

// ── Review screen ─────────────────────────────────────────
async function _loadEntry(imageIdx) {
  _reviewIndex = imageIdx;
  document.getElementById('review-image').src = `/api/review/image/${imageIdx}`;
  try {
    const res  = await fetch(`/api/review/entry/${imageIdx}`);
    const data = await res.json();
    if (!res.ok) return;
    _currentEntry = data;
    // Preserve current evaluator across image navigation when possible
    const available = data.evaluators_with_data || [];
    const savedIdx  = _currentEvaluator ? available.indexOf(_currentEvaluator) : -1;
    _evaluatorIndex  = savedIdx >= 0 ? savedIdx : 0;
    _currentEvaluator = available[_evaluatorIndex] ?? null;
    _render();
  } catch { /* silently skip */ }
}

function _render() {
  if (!_currentEntry) return;
  const { image, evaluations, evaluators_with_data: available } = _currentEntry;

  // Image info
  document.getElementById('review-image-path').textContent    = image;
  document.getElementById('review-image-counter').textContent = `${_reviewIndex + 1} / ${_reviewTotal}`;

  // Evaluator info
  const evaluatorName = available[_evaluatorIndex] ?? null;
  document.getElementById('review-evaluator-label').textContent   = evaluatorName || '—';
  document.getElementById('review-evaluator-counter').textContent =
    available.length > 0 ? `${_evaluatorIndex + 1} / ${available.length}` : '—';

  // Navigation buttons
  document.getElementById('review-prev-image-btn').disabled     = _reviewIndex <= 0;
  document.getElementById('review-next-image-btn').disabled     = _reviewIndex >= _reviewTotal - 1;
  document.getElementById('review-prev-evaluator-btn').disabled = _evaluatorIndex <= 0;
  document.getElementById('review-next-evaluator-btn').disabled = _evaluatorIndex >= available.length - 1;

  // Answers panel
  const container = document.getElementById('review-answers-container');
  container.innerHTML = '';

  if (!evaluatorName) {
    container.innerHTML = '<p class="muted-text">No evaluations for this image.</p>';
    return;
  }

  const evalData  = evaluations[evaluatorName];
  const questions = evalData?.questions  ?? [];
  const answers   = evalData?.answers    ?? {};

  // Metadata row
  const meta = document.createElement('div');
  meta.className = 'review-meta';
  meta.innerHTML =
    `<span>Set: <strong>${escHtml(evalData?.question_set || '—')}</strong></span>` +
    `<span>Date: <strong>${escHtml(evalData?.timestamp   || '—')}</strong></span>`;
  container.appendChild(meta);

  if (questions.length > 0) {
    questions.forEach(q => {
      const val = answers[q.key];
      const row = document.createElement('div');
      row.className = 'review-answer-row';

      let valueHtml = '';
      if (q.type === 'likert') {
        const pips = [];
        for (let v = (q.min ?? 1); v <= (q.max ?? 5); v++) {
          pips.push(`<span class="review-pip${v === val ? ' active' : ''}">${v}</span>`);
        }
        valueHtml = `<div class="review-pip-row">${pips.join('')}</div>`;
      } else {
        const display = val !== undefined && val !== null ? String(val) : '—';
        valueHtml = `<span class="review-text-value">${escHtml(display)}</span>`;
      }

      row.innerHTML = `<div class="review-q-label">${escHtml(q.label)}</div>${valueHtml}`;
      container.appendChild(row);
    });
  } else {
    // Fallback: render raw key/value pairs
    Object.entries(answers).forEach(([key, val]) => {
      const row = document.createElement('div');
      row.className = 'review-answer-row';
      row.innerHTML =
        `<div class="review-q-label">${escHtml(key)}</div>` +
        `<span class="review-text-value">${escHtml(String(val ?? '—'))}</span>`;
      container.appendChild(row);
    });
  }
}

// ── Event wiring ──────────────────────────────────────────
export function initReviewListeners() {
  // Setup: browse
  document.getElementById('review-browse-btn').addEventListener('click', async () => {
    try {
      const res  = await fetch('/api/browse', { method: 'POST' });
      const data = await res.json();
      if (data.folder) document.getElementById('review-folder-input').value = data.folder;
    } catch { /* ignore */ }
  });

  // Setup: scan
  document.getElementById('review-scan-btn').addEventListener('click', _scanFolder);
  document.getElementById('review-folder-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') _scanFolder();
  });

  // Setup: load
  document.getElementById('review-load-btn').addEventListener('click', _loadReview);

  // Setup: back to main setup
  document.getElementById('review-back-btn').addEventListener('click', () => showScreen('setup-screen'));

  // Review: image navigation
  document.getElementById('review-prev-image-btn').addEventListener('click', () => {
    if (_reviewIndex > 0) _loadEntry(_reviewIndex - 1);
  });
  document.getElementById('review-next-image-btn').addEventListener('click', () => {
    if (_reviewIndex < _reviewTotal - 1) _loadEntry(_reviewIndex + 1);
  });

  // Review: evaluator navigation
  document.getElementById('review-prev-evaluator-btn').addEventListener('click', () => {
    if (_evaluatorIndex > 0) {
      _evaluatorIndex--;
      _currentEvaluator = _currentEntry?.evaluators_with_data[_evaluatorIndex] ?? null;
      _render();
    }
  });
  document.getElementById('review-next-evaluator-btn').addEventListener('click', () => {
    const available = _currentEntry?.evaluators_with_data ?? [];
    if (_evaluatorIndex < available.length - 1) {
      _evaluatorIndex++;
      _currentEvaluator = available[_evaluatorIndex] ?? null;
      _render();
    }
  });

  // Review: lightbox
  document.getElementById('review-image').addEventListener('click', () => {
    const src = document.getElementById('review-image').src;
    if (src) openLightbox(src);
  });

  // Review: done
  document.getElementById('review-new-btn').addEventListener('click', () => showScreen('setup-screen'));

  // Keyboard: ←/→ = image, ↑/↓ = evaluator
  document.addEventListener('keydown', e => {
    if (!document.getElementById('review-screen').classList.contains('active')) return;
    const available = _currentEntry?.evaluators_with_data ?? [];
    if (e.key === 'ArrowRight' && _reviewIndex < _reviewTotal - 1) {
      e.preventDefault(); _loadEntry(_reviewIndex + 1);
    } else if (e.key === 'ArrowLeft' && _reviewIndex > 0) {
      e.preventDefault(); _loadEntry(_reviewIndex - 1);
    } else if (e.key === 'ArrowDown' && _evaluatorIndex < available.length - 1) {
      e.preventDefault();
      _evaluatorIndex++;
      _currentEvaluator = available[_evaluatorIndex] ?? null;
      _render();
    } else if (e.key === 'ArrowUp' && _evaluatorIndex > 0) {
      e.preventDefault();
      _evaluatorIndex--;
      _currentEvaluator = available[_evaluatorIndex] ?? null;
      _render();
    }
  });
}