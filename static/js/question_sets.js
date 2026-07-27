// ── Question set management ───────────────────────────────
import { showScreen, escHtml } from './utils.js';

let _editingName   = null;   // null = new, string = editing existing
let _returnScreen  = 'setup-screen';
let _onReturn = null;

// ── Helpers ───────────────────────────────────────────────
function _slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ── Public API ────────────────────────────────────────────
export async function showQuestionSets(returnScreen = 'setup-screen', onReturn = null) {
  _returnScreen = returnScreen;
  _onReturn = onReturn;
  document.getElementById('qs-error').textContent = '';
  await _loadList();
  showScreen('question-sets-screen');
}

// ── List ──────────────────────────────────────────────────
async function _loadList() {
  const container = document.getElementById('qs-list');
  container.innerHTML = '<p class="muted-text">Loading…</p>';
  try {
    const res  = await fetch('/api/question_sets');
    const data = await res.json();
    _renderList(data.sets || []);
  } catch {
    container.innerHTML = '<p class="error-msg">Could not load question sets.</p>';
  }
}

function _renderList(sets) {
  const container = document.getElementById('qs-list');
  container.innerHTML = '';
  if (sets.length === 0) {
    container.innerHTML = '<p class="muted-text">No question sets yet. Create one to get started.</p>';
    return;
  }
  sets.forEach(set => {
    const row = document.createElement('div');
    row.className = 'qs-row';
    row.innerHTML = `
      <div class="qs-info">
        <span class="qs-name">${escHtml(set.name)}</span>
        <span class="qs-meta">${set.question_count} question${set.question_count !== 1 ? 's' : ''}</span>
      </div>
      <div class="qs-actions">
        <button class="btn-sm" data-action="edit"   data-name="${escHtml(set.name)}">Edit</button>
        <button class="btn-sm" data-action="export" data-name="${escHtml(set.name)}">Export</button>
        <button class="btn-sm btn-danger-sm" data-action="delete" data-name="${escHtml(set.name)}">Delete</button>
      </div>
    `;
    container.appendChild(row);
  });
}

// ── Editor ────────────────────────────────────────────────
function _openEditor(setData = null) {
  _editingName = setData ? setData.name : null;
  document.getElementById('qs-editor-title').textContent =
    setData ? 'Edit Question Set' : 'New Question Set';
  document.getElementById('qs-editor-name').value  = setData?.name  ?? '';
  document.getElementById('qs-editor-error').textContent = '';

  const list = document.getElementById('qs-questions-list');
  list.innerHTML = '';
  if (setData?.questions?.length) {
    setData.questions.forEach(q => _addQuestionRow(q));
  } else {
    _addQuestionRow();
  }
  showScreen('question-set-editor-screen');
}

function _addQuestionRow(q = null) {
  const list = document.getElementById('qs-questions-list');
  const n    = list.children.length + 1;

  const row = document.createElement('div');
  row.className = 'qs-question-row';
  row.innerHTML = `
    <div class="qs-q-header">
      <span class="qs-q-number">Q${n}</span>
      <button type="button" class="btn-sm btn-danger-sm qs-remove-btn">Remove</button>
    </div>
    <div class="qs-q-fields">
      <input class="qs-q-label" type="text" placeholder="Question label shown to evaluator"
             value="${escHtml(q?.label ?? '')}" autocomplete="off" />
      <input class="qs-q-key" type="hidden"
             value="${escHtml(q?.key ?? '')}"
             data-auto="${q?.key ? 'false' : 'true'}" />
      <div class="qs-q-row">
        <label class="qs-inline-label">Type</label>
        <select class="qs-q-type">
          <option value="likert"  ${!q || q.type === 'likert'  ? 'selected' : ''}>Likert (1–5)</option>
          <option value="ternary" ${q?.type === 'ternary'      ? 'selected' : ''}>Ternary (Yes / No / Maybe)</option>
        </select>
      </div>
      <div class="qs-q-row">
        <label class="qs-inline-label">Hint</label>
        <input class="qs-q-hint" type="text" placeholder="Optional hint text"
               value="${escHtml(q?.hint ?? '')}" autocomplete="off" />
      </div>
    </div>
  `;

  const labelInput = row.querySelector('.qs-q-label');
  const keyInput   = row.querySelector('.qs-q-key');

  labelInput.addEventListener('input', () => {
    if (keyInput.dataset.auto === 'true') {
      keyInput.value = _slugify(labelInput.value);
    }
  });

  keyInput.addEventListener('input', () => {
    keyInput.dataset.auto = 'false';
  });

  row.querySelector('.qs-remove-btn').addEventListener('click', () => {
    row.remove();
    _renumber();
  });
  list.appendChild(row);
}

function _renumber() {
  document.querySelectorAll('#qs-questions-list .qs-q-number').forEach((el, i) => {
    el.textContent = `Q${i + 1}`;
  });
}

function _collectEditorData() {
  const name = document.getElementById('qs-editor-name').value.trim();
  const questions = [];
  document.querySelectorAll('#qs-questions-list .qs-question-row').forEach(row => {
    const key   = row.querySelector('.qs-q-key').value.trim();
    const label = row.querySelector('.qs-q-label').value.trim();
    const type  = row.querySelector('.qs-q-type').value;
    const hint  = row.querySelector('.qs-q-hint').value.trim();
    const q = { key, label, type };
    if (hint)               q.hint    = hint;
    if (type === 'likert')  { q.min = 1; q.max = 5; }
    if (type === 'ternary') q.options = ['Yes', 'No', 'Maybe'];
    questions.push(q);
  });
  return { name, questions };
}

async function _saveSet() {
  document.getElementById('qs-editor-error').textContent = '';
  const data   = _collectEditorData();
  const isEdit = _editingName !== null;
  const url    = isEdit
    ? `/api/question_sets/${encodeURIComponent(_editingName)}`
    : '/api/question_sets';

  try {
    const res  = await fetch(url, {
      method:  isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) {
      document.getElementById('qs-editor-error').textContent = json.error || 'Could not save.';
      return;
    }
    await _loadList();
    showScreen('question-sets-screen');
  } catch {
    document.getElementById('qs-editor-error').textContent = 'Could not connect to server.';
  }
}

// ── Event wiring ──────────────────────────────────────────
export function initQuestionSetListeners() {
  // List: delegated row actions
  document.getElementById('qs-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, name } = btn.dataset;
    document.getElementById('qs-error').textContent = '';

    if (action === 'edit') {
      try {
        const res  = await fetch(`/api/question_sets/${encodeURIComponent(name)}`);
        const data = await res.json();
        if (!res.ok) { document.getElementById('qs-error').textContent = data.error; return; }
        _openEditor(data);
      } catch {
        document.getElementById('qs-error').textContent = 'Could not load question set.';
      }
    } else if (action === 'export') {
      window.location.href = `/api/question_sets/${encodeURIComponent(name)}/export`;
    } else if (action === 'delete') {
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      try {
        const res  = await fetch(`/api/question_sets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) { document.getElementById('qs-error').textContent = data.error; return; }
        await _loadList();
      } catch {
        document.getElementById('qs-error').textContent = 'Could not connect to server.';
      }
    }
  });

  // New set
  document.getElementById('qs-new-btn').addEventListener('click', () => _openEditor(null));

  // Import
  document.getElementById('qs-import-btn').addEventListener('click', () => {
    document.getElementById('qs-import-input').click();
  });
  document.getElementById('qs-import-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    document.getElementById('qs-error').textContent = '';
    const body = new FormData();
    body.append('file', file);
    try {
      const res  = await fetch('/api/question_sets/import', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) { document.getElementById('qs-error').textContent = data.error; return; }
      await _loadList();
    } catch {
      document.getElementById('qs-error').textContent = 'Could not connect to server.';
    }
  });

  // Back from list
  document.getElementById('qs-return-btn').addEventListener('click', async () => {
    const cb = _onReturn;
    _onReturn = null;
    if (cb) await cb();
    showScreen(_returnScreen || 'setup-screen');
  });

  // Editor: add question
  document.getElementById('qs-add-question-btn').addEventListener('click', () => _addQuestionRow());

  // Editor: save
  document.getElementById('qs-save-btn').addEventListener('click', _saveSet);

  // Editor: back to list
  document.getElementById('qs-editor-back-btn').addEventListener('click', () => showScreen('question-sets-screen'));
}