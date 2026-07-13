// ── Shared state ─────────────────────────────────────────
let selectedMode = 'classic';
let folderPath = '';
let subfolderData = [];
let selectedPaths = new Set();
let pendingSessionInfo = null;
let pendingSessionMode = null;

// Classic mode state
let total = 0, currentIndex = 0;
let goodCount = 0, badCount = 0, skipCount = 0;
let isAnimating = false;

// Rating mode state
let ratingTotal = 0;
let ratingIndex = 0;
let ratingResponses = {};
let ratingSubjective = '';
let ratingAnswers = [];

const ratingQuestionConfig = [
  { key: 'do_you_like_this_image', label: '1. Do you like this image?' },
  { key: 'does_this_image_look_ai_generated', label: '2. Do you think this image looks AI generated?' },
  { key: 'is_the_image_visually_clear', label: '3. Is this image visually clear?' },
  { key: 'is_the_content_coherent', label: '4. Is the content coherent?' },
  { key: 'would_you_use_this_image_in_a_dataset', label: '5. Would you use this image in a dataset?' },
];

// ── Screen helpers ───────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Mode selector ────────────────────────────────────────
document.querySelectorAll('#mode-grid .mode-card').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode;
    document.querySelectorAll('#mode-grid .mode-card').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Setup / scan ─────────────────────────────────────────
document.getElementById('scan-btn').addEventListener('click', doScan);
document.getElementById('folder-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doScan();
});

async function doScan() {
  const folder = document.getElementById('folder-input').value.trim();
  document.getElementById('setup-error').textContent = '';

  if (!folder) {
    document.getElementById('setup-error').textContent = 'Please enter a folder path.';
    return;
  }

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder}),
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('setup-error').textContent = data.error || 'Error scanning folder.';
      return;
    }

    folderPath = folder;
    pendingSessionMode = selectedMode;
    pendingSessionInfo = selectedMode === 'classic' ? (data.session || null) : (data.rating_session || null);

    if (pendingSessionInfo) {
      showResumeScreen(pendingSessionInfo, selectedMode);
    } else if (data.subfolders && data.subfolders.length > 0) {
      subfolderData = data.subfolders;
      buildSelectScreen(data.subfolders);
      showScreen('select-screen');
    } else {
      await startSelectedMode(folder, null);
    }
  } catch (err) {
    document.getElementById('setup-error').textContent = 'Could not connect to server.';
  }
}

async function startSelectedMode(folder, selectedPathsList) {
  if (selectedMode === 'rating') {
    await startRatingGame(folder, selectedPathsList);
    return;
  }
  await startClassicGame(folder, selectedPathsList);
}

// ── Resume (classic and rating) ──────────────────────────
function showResumeScreen(info, mode) {
  const isRating = mode === 'rating';
  const totalCount = info.total || 0;
  const doneCount = info.current_index || 0;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  document.getElementById('resume-screen').querySelector('h2').textContent =
    isRating ? 'Resume rating session?' : 'Resume session?';
  document.getElementById('resume-desc').textContent = isRating
    ? `You answered ${info.answered || doneCount} of ${totalCount} images (${pct}% done).`
    : `You were at image ${doneCount} of ${totalCount} (${pct}% done).`;
  document.getElementById('resume-fill').style.width = pct + '%';
  document.getElementById('resume-progress-label').textContent = isRating
    ? `${info.answered || doneCount} / ${totalCount} images answered`
    : `${doneCount} / ${totalCount} images sorted`;

  const firstLabel = document.getElementById('resume-good').parentElement.querySelector('.lbl');
  const secondLabel = document.getElementById('resume-bad').parentElement.querySelector('.lbl');
  const thirdLabel = document.getElementById('resume-skip').parentElement.querySelector('.lbl');

  if (isRating) {
    document.getElementById('resume-good').textContent = String(info.answered || doneCount);
    document.getElementById('resume-bad').textContent = String(totalCount);
    document.getElementById('resume-skip').textContent = String(Math.max(totalCount - (info.answered || doneCount), 0));
    firstLabel.textContent = 'Answered';
    secondLabel.textContent = 'Total';
    thirdLabel.textContent = 'Remaining';
  } else {
    document.getElementById('resume-good').textContent = info.good_count;
    document.getElementById('resume-bad').textContent = info.bad_count;
    document.getElementById('resume-skip').textContent = info.skip_count;
    firstLabel.textContent = 'Good';
    secondLabel.textContent = 'Bad';
    thirdLabel.textContent = 'Skipped';
  }

  document.getElementById('btn-resume').textContent = isRating
    ? '▶ Continue rating where I left off'
    : '▶ Continue where I left off';
  document.getElementById('btn-start-fresh').textContent = isRating
    ? 'Start fresh (lose answers)'
    : 'Start fresh (lose progress)';

  showScreen('resume-screen');
}

document.getElementById('btn-resume').addEventListener('click', async () => {
  if (pendingSessionMode === 'rating') {
    await startRatingGame(folderPath, null);
    return;
  }

  try {
    const res = await fetch('/api/classic/resume', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder: folderPath}),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not resume session.');
      return;
    }

    total = data.total;
    currentIndex = data.current;
    goodCount = data.good_count;
    badCount = data.bad_count;
    skipCount = data.skip_count;
    updateClassicUI();
    showScreen('game-screen');
    loadClassicCard(currentIndex);
  } catch (err) {
    console.error(err);
  }
});

document.getElementById('btn-start-fresh').addEventListener('click', async () => {
  if (pendingSessionMode === 'rating') {
    await fetch('/api/rating/discard_session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder: folderPath}),
    });
  } else {
    await fetch('/api/classic/discard_session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder: folderPath}),
    });
  }

  pendingSessionInfo = null;
  pendingSessionMode = null;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder: folderPath}),
    });
    const data = await res.json();
    if (data.subfolders && data.subfolders.length > 0) {
      subfolderData = data.subfolders;
      buildSelectScreen(data.subfolders);
      showScreen('select-screen');
    } else {
      await startSelectedMode(folderPath, null);
    }
  } catch (err) {
    console.error(err);
  }
});

// ── Select folders (shared) ─────────────────────────────
function buildSelectScreen(subfolders) {
  document.getElementById('select-folder-label').textContent = folderPath;
  document.getElementById('select-error').textContent = '';

  selectedPaths = new Set(subfolders.map(s => s.path));

  const grid = document.getElementById('folder-grid');
  grid.innerHTML = '';

  subfolders.forEach(sf => {
    const card = document.createElement('div');
    card.className = 'folder-card selected';
    card.dataset.path = sf.path;
    card.innerHTML = `
      <div class="folder-icon">📁</div>
      <div class="folder-name">${escHtml(sf.name)}</div>
      <div class="folder-count">${sf.count} image${sf.count !== 1 ? 's' : ''}</div>
      <div class="folder-check">✓</div>
    `;
    card.addEventListener('click', () => toggleFolder(card, sf.path));
    grid.appendChild(card);
  });

  updateStartBtn();
}

function toggleFolder(card, path) {
  if (selectedPaths.has(path)) {
    selectedPaths.delete(path);
    card.classList.remove('selected');
  } else {
    selectedPaths.add(path);
    card.classList.add('selected');
  }
  updateStartBtn();
}

function updateStartBtn() {
  const selectedCount = [...document.querySelectorAll('#folder-grid .folder-card')]
    .filter(c => selectedPaths.has(c.dataset.path))
    .reduce((sum, c) => {
      const sf = subfolderData.find(s => s.path === c.dataset.path);
      return sum + (sf ? sf.count : 0);
    }, 0);

  const btn = document.getElementById('start-selected-btn');
  btn.disabled = selectedPaths.size === 0;
  btn.textContent = selectedPaths.size === 0
    ? 'Select at least one folder'
    : `Start with ${selectedCount} image${selectedCount !== 1 ? 's' : ''} →`;
}

document.getElementById('sel-all-btn').addEventListener('click', () => {
  document.querySelectorAll('#folder-grid .folder-card').forEach(card => {
    selectedPaths.add(card.dataset.path);
    card.classList.add('selected');
  });
  updateStartBtn();
});

document.getElementById('sel-none-btn').addEventListener('click', () => {
  selectedPaths.clear();
  document.querySelectorAll('#folder-grid .folder-card').forEach(card => {
    card.classList.remove('selected');
  });
  updateStartBtn();
});

document.getElementById('start-selected-btn').addEventListener('click', async () => {
  document.getElementById('select-error').textContent = '';
  if (selectedPaths.size === 0) return;
  await startSelectedMode(folderPath, [...selectedPaths]);
});

// ── Classic mode ────────────────────────────────────────
async function startClassicGame(folder, selectedPathsList) {
  try {
    const body = {folder};
    if (selectedPathsList) body.selected_paths = selectedPathsList;

    const res = await fetch('/api/classic/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('select-error').textContent = data.error || 'Error starting game.';
      return;
    }

    total = data.total;
    currentIndex = 0;
    goodCount = 0;
    badCount = 0;
    skipCount = 0;
    updateClassicUI();
    showScreen('game-screen');
    loadClassicCard(0);
  } catch (err) {
    console.error(err);
  }
}

function updateClassicUI() {
  document.getElementById('progress-label').textContent = `${currentIndex} / ${total}`;
  document.getElementById('progress-fill').style.width = total ? `${(currentIndex / total) * 100}%` : '0%';
  document.getElementById('cnt-good').textContent = `✓ ${goodCount}`;
  document.getElementById('cnt-bad').textContent = `✗ ${badCount}`;
  document.getElementById('cnt-skip').textContent = `– ${skipCount}`;
}

function loadClassicCard(idx) {
  const area = document.getElementById('card-area');
  area.innerHTML = '';
  if (idx >= total) {
    showClassicDone();
    return;
  }

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

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.textContent = `Image ${idx + 1} of ${total}`;

  card.appendChild(stampGood);
  card.appendChild(stampBad);
  card.appendChild(img);
  card.appendChild(footer);
  area.appendChild(card);
  initDrag(card, stampGood, stampBad);

  if (idx + 1 < total) {
    const pre = new Image();
    pre.src = `/api/classic/image/${idx + 1}`;
  }
}

const SWIPE_THRESHOLD = 80;
const MAX_ROTATION = 20;

function initDrag(card, stampGood, stampBad) {
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  function onStart(x) {
    if (isAnimating) return;
    startX = x;
    currentX = 0;
    dragging = true;
    card.style.transition = 'none';
  }

  function onMove(x) {
    if (!dragging) return;
    currentX = x - startX;
    const rot = (currentX / window.innerWidth) * MAX_ROTATION;
    card.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;
    const ratio = Math.min(Math.abs(currentX) / SWIPE_THRESHOLD, 1);
    if (currentX > 0) {
      stampGood.style.opacity = ratio;
      stampBad.style.opacity = 0;
    } else {
      stampBad.style.opacity = ratio;
      stampGood.style.opacity = 0;
    }
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(currentX) >= SWIPE_THRESHOLD) {
      flyOut(currentX > 0 ? 'good' : 'bad');
    } else {
      card.style.transition = 'transform 0.35s cubic-bezier(.25,.8,.25,1)';
      card.style.transform = '';
      stampGood.style.opacity = 0;
      stampBad.style.opacity = 0;
    }
  }

  card.addEventListener('mousedown', e => onStart(e.clientX));
  window.addEventListener('mousemove', e => { if (dragging) onMove(e.clientX); });
  window.addEventListener('mouseup', onEnd);
  card.addEventListener('touchstart', e => onStart(e.touches[0].clientX), {passive: true});
  card.addEventListener('touchmove', e => onMove(e.touches[0].clientX), {passive: true});
  card.addEventListener('touchend', onEnd);
}

function flyOut(direction) {
  if (isAnimating) return;
  isAnimating = true;
  const card = document.getElementById('current-card');
  if (!card) return;
  const xDest = direction === 'good' ? window.innerWidth * 1.5 : -window.innerWidth * 1.5;
  const rot = direction === 'good' ? MAX_ROTATION : -MAX_ROTATION;
  card.style.transition = 'transform 0.35s cubic-bezier(.4,0,.2,1), opacity 0.35s';
  card.style.transform = `translateX(${xDest}px) rotate(${rot}deg)`;
  card.style.opacity = '0';
  recordClassicAction(direction);
}

function skipCurrent() {
  if (isAnimating) return;
  isAnimating = true;
  const card = document.getElementById('current-card');
  if (card) {
    card.style.transition = 'transform 0.3s ease, opacity 0.3s';
    card.style.transform = 'translateY(80px)';
    card.style.opacity = '0';
  }
  recordClassicAction('skip');
}

async function recordClassicAction(direction) {
  try {
    const res = await fetch('/api/classic/action', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({direction, index: currentIndex}),
    });
    const data = await res.json();

    goodCount = data.good_count ?? goodCount;
    badCount = data.bad_count ?? badCount;
    skipCount = data.skip_count ?? skipCount;

    if (data.done) {
      setTimeout(() => {
        isAnimating = false;
        showClassicDone();
      }, 380);
      return;
    }

    currentIndex = data.next_index;
    updateClassicUI();
    setTimeout(() => {
      isAnimating = false;
      loadClassicCard(currentIndex);
    }, 380);
  } catch (err) {
    isAnimating = false;
    console.error('Action failed', err);
  }
}

function showClassicDone() {
  document.getElementById('done-good').textContent = goodCount;
  document.getElementById('done-bad').textContent = badCount;
  document.getElementById('done-skip').textContent = skipCount;
  document.getElementById('done-path').innerHTML =
    `Images saved to:<br/><strong>${folderPath}/good</strong> and <strong>${folderPath}/bad</strong>`;
  showScreen('done-screen');
}

document.getElementById('btn-good').addEventListener('click', () => {
  if (!isAnimating) flyOut('good');
});
document.getElementById('btn-bad').addEventListener('click', () => {
  if (!isAnimating) flyOut('bad');
});
document.getElementById('btn-skip').addEventListener('click', () => {
  if (!isAnimating) skipCurrent();
});

document.addEventListener('keydown', e => {
  if (!document.getElementById('game-screen').classList.contains('active')) return;
  if (isAnimating) return;
  if (e.key === 'ArrowRight') flyOut('good');
  else if (e.key === 'ArrowLeft') flyOut('bad');
  else if (e.key === 'ArrowDown' || e.key === ' ') {
    e.preventDefault();
    skipCurrent();
  }
});

// ── Rating mode ─────────────────────────────────────────
function renderLikertQuestions() {
  const container = document.getElementById('likert-list');
  container.innerHTML = '';

  ratingQuestionConfig.forEach(question => {
    const item = document.createElement('div');
    item.className = 'likert-item';

    const title = document.createElement('h4');
    title.textContent = question.label;

    const row = document.createElement('div');
    row.className = 'likert-row';

    for (let value = 1; value <= 5; value += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn likert-btn';
      btn.dataset.question = question.key;
      btn.dataset.value = String(value);
      btn.textContent = String(value);
      btn.addEventListener('click', () => {
        ratingResponses[question.key] = value;
        updateRatingChoiceUI();
      });
      row.appendChild(btn);
    }

    item.appendChild(title);
    item.appendChild(row);
    container.appendChild(item);
  });
}

function updateRatingChoiceUI() {
  document.querySelectorAll('#likert-list .likert-btn').forEach(btn => {
    const q = btn.dataset.question;
    const val = Number(btn.dataset.value);
    btn.classList.toggle('active', ratingResponses[q] === val);
  });

  ratingSubjective = document.getElementById('subjective-input').value.trim();
  const allAnswered = ratingQuestionConfig.every(q => Number.isInteger(ratingResponses[q.key]));
  document.getElementById('rating-next-btn').disabled = !(allAnswered && ratingSubjective);
}

async function startRatingGame(folder, selectedPathsList) {
  try {
    const body = {folder};
    if (selectedPathsList) body.selected_paths = selectedPathsList;

    const res = await fetch('/api/rating/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('select-error').textContent = data.error || 'Error starting rating mode.';
      return;
    }

    ratingTotal = data.total;
    ratingIndex = data.current ?? 0;
    ratingResponses = {};
    ratingSubjective = '';
    ratingAnswers = [];
    renderLikertQuestions();
    loadRatingQuestion(ratingIndex);
    showScreen('rating-screen');
  } catch (err) {
    console.error(err);
  }
}

function loadRatingQuestion(idx) {
  document.getElementById('rating-error').textContent = '';
  document.getElementById('rating-progress-label').textContent = `Image ${idx + 1} / ${ratingTotal}`;
  document.getElementById('rating-progress-fill').style.width = `${((idx + 1) / ratingTotal) * 100}%`;
  document.getElementById('rating-image').src = `/api/rating/image/${idx}`;
  document.getElementById('subjective-input').value = '';
  ratingResponses = {};
  ratingSubjective = '';
  updateRatingChoiceUI();
}

document.getElementById('subjective-input').addEventListener('input', updateRatingChoiceUI);

document.getElementById('rating-next-btn').addEventListener('click', async () => {
  document.getElementById('rating-error').textContent = '';

  const allAnswered = ratingQuestionConfig.every(q => Number.isInteger(ratingResponses[q.key]));
  ratingSubjective = document.getElementById('subjective-input').value.trim();

  if (!allAnswered || !ratingSubjective) {
    document.getElementById('rating-error').textContent = 'Answer all 5 Likert questions and the descriptive question.';
    return;
  }

  try {
    const res = await fetch('/api/rating/submit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        index: ratingIndex,
        responses: ratingResponses,
        subjective: ratingSubjective,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('rating-error').textContent = data.error || 'Could not save answers.';
      return;
    }

    ratingAnswers.push({ ...ratingResponses, subjective: ratingSubjective });

    if (data.done) {
      document.getElementById('rating-answered').textContent = String(data.answered ?? ratingAnswers.length);
      document.getElementById('rating-average').textContent = data.average || '0.0';
      document.getElementById('rating-mode-total').textContent = String(ratingTotal);
      document.getElementById('rating-csv-path').innerHTML =
        `CSV saved at:<br/><strong>${escHtml(data.csv_path)}</strong>`;
      showScreen('rating-done-screen');
    } else {
      ratingIndex = data.next_index;
      loadRatingQuestion(ratingIndex);
    }
  } catch (err) {
    document.getElementById('rating-error').textContent = 'Could not connect to server.';
  }
});

// ── Restart handlers ────────────────────────────────────
function resetToSetup() {
  subfolderData = [];
  selectedPaths = new Set();
  pendingSessionInfo = null;
  pendingSessionMode = null;
  ratingAnswers = [];
  document.getElementById('folder-input').value = '';
  document.getElementById('setup-error').textContent = '';
  showScreen('setup-screen');
}

document.getElementById('restart-btn').addEventListener('click', resetToSetup);
document.getElementById('rating-restart-btn').addEventListener('click', resetToSetup);

// ── Util ─────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
