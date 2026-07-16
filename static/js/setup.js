// ── Entry point — setup / scan / select / restart ──────────
import { showScreen, escHtml }                       from './utils.js';
import { initLightbox }                              from './lightbox.js';
import { startClassicGame, resumeClassicGame,
         initClassicListeners }                      from './classic.js';
import { startRatingGame, initRatingListeners }      from './rating.js';

// ── Initialise sub-modules ────────────────────────────────
initLightbox();
initClassicListeners();
initRatingListeners();

// ── Shared app state ──────────────────────────────────────
let selectedMode      = 'classic';
let folderPath        = '';
let subfolderData     = [];
let selectedPaths     = new Set();
let pendingSessionInfo = null;
let pendingSessionMode = null;

// ── Mode selector ─────────────────────────────────────────
document.querySelectorAll('#mode-grid .mode-card').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode;
    document.querySelectorAll('#mode-grid .mode-card').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Browse folder ─────────────────────────────────────────
document.getElementById('browse-btn').addEventListener('click', async () => {
  document.getElementById('setup-error').textContent = '';
  try {
    const res  = await fetch('/api/browse', { method: 'POST' });
    const data = await res.json();
    if (data.folder) {
      document.getElementById('folder-input').value = data.folder;
      document.getElementById('folder-input').focus();
    } else if (data.error) {
      document.getElementById('setup-error').textContent = data.error;
    }
  } catch {
    document.getElementById('setup-error').textContent = 'Could not open folder picker.';
  }
});

// ── Setup / scan ──────────────────────────────────────────
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
    const res  = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('setup-error').textContent = data.error || 'Error scanning folder.';
      return;
    }
    folderPath         = folder;
    subfolderData      = data.subfolders || [];
    pendingSessionMode = selectedMode;
    pendingSessionInfo = selectedMode === 'classic'
      ? (data.session || null) : (data.rating_session || null);

    if (pendingSessionInfo) {
      showResumeScreen(pendingSessionInfo, selectedMode);
    } else if (subfolderData.length > 0) {
      buildSelectScreen(subfolderData);
      showScreen('select-screen');
    } else {
      await startMode(folder, null);
    }
  } catch {
    document.getElementById('setup-error').textContent = 'Could not connect to server.';
  }
}

async function startMode(folder, selectedPathsList) {
  if (selectedMode === 'rating') await startRatingGame(folder, selectedPathsList);
  else await startClassicGame(folder, selectedPathsList);
}

// ── Resume screen ─────────────────────────────────────────
function showResumeScreen(info, mode) {
  const isRating   = mode === 'rating';
  const totalCount = info.total || 0;
  const doneCount  = isRating
    ? (info.answered || info.current_index || 0)
    : ((info.good_count || 0) + (info.bad_count || 0));
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  document.getElementById('resume-screen').querySelector('h2').textContent =
    isRating ? 'Resume rating session?' : 'Resume session?';
  document.getElementById('resume-desc').textContent = isRating
    ? `You answered ${doneCount} of ${totalCount} images (${pct}% done).`
    : `You judged ${doneCount} of ${totalCount} images (${pct}% done).`;
  document.getElementById('resume-fill').style.width = pct + '%';
  document.getElementById('resume-progress-label').textContent = isRating
    ? `${doneCount} / ${totalCount} images answered`
    : `${doneCount} / ${totalCount} images judged`;

  const fl = document.getElementById('resume-good').parentElement.querySelector('.lbl');
  const sl = document.getElementById('resume-bad').parentElement.querySelector('.lbl');
  const tl = document.getElementById('resume-skip').parentElement.querySelector('.lbl');

  if (isRating) {
    document.getElementById('resume-good').textContent = String(doneCount);
    document.getElementById('resume-bad').textContent  = String(totalCount);
    document.getElementById('resume-skip').textContent = String(Math.max(0, totalCount - doneCount));
    fl.textContent = 'Answered'; sl.textContent = 'Total'; tl.textContent = 'Remaining';
  } else {
    document.getElementById('resume-good').textContent = info.good_count;
    document.getElementById('resume-bad').textContent  = info.bad_count;
    document.getElementById('resume-skip').textContent =
      String(Math.max(0, totalCount - (info.good_count || 0) - (info.bad_count || 0)));
    fl.textContent = 'Good'; sl.textContent = 'Bad'; tl.textContent = 'Remaining';
  }

  document.getElementById('btn-resume').textContent = isRating
    ? '▶ Continue rating where I left off' : '▶ Continue where I left off';
  document.getElementById('btn-start-fresh').textContent = isRating
    ? 'Start fresh (lose answers)' : 'Start fresh (lose progress)';

  showScreen('resume-screen');
}

document.getElementById('btn-resume').addEventListener('click', async () => {
  if (pendingSessionMode === 'rating') await startRatingGame(folderPath, null);
  else await resumeClassicGame(folderPath);
});

document.getElementById('btn-start-fresh').addEventListener('click', async () => {
  const url = pendingSessionMode === 'rating'
    ? '/api/rating/discard_session' : '/api/classic/discard_session';
  await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderPath }),
  }).catch(() => {});

  pendingSessionInfo = null;
  pendingSessionMode = null;
  try {
    const res  = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderPath }),
    });
    const data = await res.json();
    if (data.subfolders && data.subfolders.length > 0) {
      subfolderData = data.subfolders;
      buildSelectScreen(data.subfolders);
      showScreen('select-screen');
    } else {
      await startMode(folderPath, null);
    }
  } catch { console.error('Error after discard'); }
});

// ── Select screen ─────────────────────────────────────────
function buildSelectScreen(subfolders) {
  document.getElementById('select-folder-label').textContent = folderPath;
  document.getElementById('select-error').textContent = '';
  selectedPaths = new Set();   // nothing pre-selected — user clicks to pick

  const grid = document.getElementById('folder-grid');
  grid.innerHTML = '';
  subfolders.forEach(sf => {
    const card = document.createElement('div');
    card.className = 'folder-card';   // unselected by default
    card.dataset.path = sf.path;
    card.innerHTML = `
      <div class="folder-icon">📁</div>
      <div class="folder-name">${escHtml(sf.name)}</div>
      <div class="folder-count">${sf.count} image${sf.count !== 1 ? 's' : ''}</div>
      <div class="folder-check">✓</div>
    `;
    card.addEventListener('click', () => {
      if (selectedPaths.has(sf.path)) {
        selectedPaths.delete(sf.path);
        card.classList.remove('selected');
      } else {
        selectedPaths.add(sf.path);
        card.classList.add('selected');
      }
      updateStartBtn();
    });
    grid.appendChild(card);
  });
  updateStartBtn();
}

function updateStartBtn() {
  const count = [...document.querySelectorAll('#folder-grid .folder-card')]
    .filter(c => selectedPaths.has(c.dataset.path))
    .reduce((sum, c) => {
      const sf = subfolderData.find(s => s.path === c.dataset.path);
      return sum + (sf ? sf.count : 0);
    }, 0);
  const btn = document.getElementById('start-selected-btn');
  btn.disabled  = selectedPaths.size === 0;
  btn.textContent = selectedPaths.size === 0
    ? 'Select at least one folder'
    : `Start with ${count} image${count !== 1 ? 's' : ''} →`;
}

document.getElementById('sel-all-btn').addEventListener('click', () => {
  document.querySelectorAll('#folder-grid .folder-card').forEach(card => {
    selectedPaths.add(card.dataset.path); card.classList.add('selected');
  });
  updateStartBtn();
});
document.getElementById('sel-none-btn').addEventListener('click', () => {
  selectedPaths.clear();
  document.querySelectorAll('#folder-grid .folder-card').forEach(card => card.classList.remove('selected'));
  updateStartBtn();
});
document.getElementById('start-selected-btn').addEventListener('click', async () => {
  document.getElementById('select-error').textContent = '';
  if (selectedPaths.size === 0) return;
  await startMode(folderPath, [...selectedPaths]);
});

// ── Restart / navigation ──────────────────────────────────
function resetToSetup() {
  subfolderData  = [];
  selectedPaths  = new Set();
  pendingSessionInfo = null;
  pendingSessionMode = null;
  folderPath     = '';
  document.getElementById('folder-input').value = '';
  document.getElementById('setup-error').textContent = '';
  showScreen('setup-screen');
}

async function goToSelectScreen() {
  try {
    const res  = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderPath }),
    });
    const data = await res.json();
    if (!res.ok || !data.subfolders || data.subfolders.length === 0) { resetToSetup(); return; }
    subfolderData = data.subfolders;
    buildSelectScreen(subfolderData);
    showScreen('select-screen');
  } catch { resetToSetup(); }
}

document.getElementById('sort-another-btn').addEventListener('click', goToSelectScreen);
document.getElementById('new-dataset-btn').addEventListener('click', resetToSetup);
document.getElementById('rating-another-btn').addEventListener('click', goToSelectScreen);
document.getElementById('rating-new-dataset-btn').addEventListener('click', resetToSetup);
document.getElementById('change-dataset-btn').addEventListener('click', resetToSetup);
