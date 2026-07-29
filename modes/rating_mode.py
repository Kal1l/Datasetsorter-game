import csv
import json
import os
import re
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

from .common import collect_images, selected_images, load_prompt_for_image
from .question_sets import load_question_set

SESSION_FILE = '.dataset_game_rating_session.json'

rating_bp = Blueprint('rating_mode', __name__)

state = {
    'images': [],
    'current_index': 0,
    'base_folder': '',
    'selected_paths': [],
    'evaluator': '',
    'question_set_name': '',
    'question_set': None,       # full question set object { name, questions }
    'answered_indices': set(),  # set of int indices already written to disk
    'csv_path': '',             # path to the session CSV file
}


def session_path(folder):
    return os.path.join(folder, SESSION_FILE)


def save_session():
    if not state['base_folder']:
        return
    data = {
        'folder':            state['base_folder'],
        'evaluator':         state['evaluator'],
        'question_set_name': state['question_set_name'],
        'selected_paths':    state['selected_paths'],
        'images':            state['images'],
        'current_index':     state['current_index'],
        'answered_indices':  list(state['answered_indices']),
        'csv_path':          state['csv_path'],
    }
    try:
        with open(session_path(state['base_folder']), 'w', encoding='utf-8') as f:
            json.dump(data, f)
    except OSError:
        pass


def load_session(folder):
    path = session_path(folder)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'images' not in data or 'current_index' not in data:
            return None
        return data
    except (OSError, json.JSONDecodeError):
        return None


def delete_session(folder):
    try:
        os.remove(session_path(folder))
    except OSError:
        pass


def apply_state(data):
    state['images']            = data['images']
    state['current_index']     = data['current_index']
    state['base_folder']       = data['folder']
    state['selected_paths']    = data.get('selected_paths', [])
    state['evaluator']         = data.get('evaluator', '')
    state['question_set_name'] = data.get('question_set_name', '')
    state['question_set']      = load_question_set(state['question_set_name']) if state['question_set_name'] else None
    state['csv_path']          = data.get('csv_path', '')

    # Migrate old format (dict of answers) to new format (list of indices)
    raw = data.get('answered_indices', data.get('answers', {}))
    if isinstance(raw, list):
        state['answered_indices'] = set(raw)
    elif isinstance(raw, dict):
        state['answered_indices'] = {int(k) for k in raw.keys()}
    else:
        state['answered_indices'] = set()


def session_info_for_folder(folder):
    session = load_session(folder)
    if not session:
        return None
    total = len(session['images'])
    raw = session.get('answered_indices', session.get('answers', {}))
    if isinstance(raw, (list, dict)):
        answered = len(raw)
    else:
        answered = 0
    return {
        'current_index':     session['current_index'],
        'total':             total,
        'answered':          answered,
        'selected_paths':    session.get('selected_paths', []),
        'evaluator':         session.get('evaluator', ''),
        'question_set_name': session.get('question_set_name', ''),
    }


def _validate_responses(responses, questions):
    if not isinstance(responses, dict):
        return 'Responses payload must be an object.'
    for q in questions:
        value = responses.get(q['key'])
        if q['type'] == 'likert':
            mn, mx = q.get('min', 1), q.get('max', 5)
            if not isinstance(value, int) or value < mn or value > mx:
                return f'"{q["key"]}" must be an integer from {mn} to {mx}.'
        elif q['type'] == 'ternary':
            valid = [o.lower() for o in q.get('options', [])]
            if value not in valid:
                return f'"{q["key"]}" must be one of: {", ".join(valid)}.'
    return None


def _write_eval_file(idx, responses):
    images    = state['images']
    base      = state['base_folder']
    rel_image = os.path.relpath(images[idx], base)
    csv_path  = state['csv_path']
    prompt    = load_prompt_for_image(images[idx])   # ← novo

    eval_dir      = os.path.join(base, 'evaluations', state['evaluator'])
    norm_eval_dir = os.path.normpath(eval_dir)
    if not os.path.normpath(csv_path).startswith(norm_eval_dir + os.sep):
        raise ValueError('Invalid CSV path.')

    questions  = state['question_set'].get('questions', [])
    # prompt column added between timestamp and answers
    fieldnames = ['image', 'evaluator', 'question_set', 'timestamp', 'prompt'] + [q['key'] for q in questions]

    rows: dict[str, dict] = {}
    if os.path.isfile(csv_path):
        try:
            with open(csv_path, 'r', newline='', encoding='utf-8') as f:
                for r in csv.DictReader(f):
                    rows[r.get('image', '')] = r
        except (OSError, csv.Error):
            pass

    rows[rel_image] = {
        'image':        rel_image,
        'evaluator':    state['evaluator'],
        'question_set': state['question_set_name'],
        'timestamp':    datetime.now().isoformat(timespec='seconds'),
        'prompt':       prompt,                      # ← novo
        **responses,
    }

    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows.values())


# ── Routes ────────────────────────────────────────────────

@rating_bp.route('/api/rating/start', methods=['POST'])
def start():
    data              = request.json or {}
    folder            = data.get('folder', '').strip()
    selected_paths    = data.get('selected_paths')
    evaluator         = (data.get('evaluator') or '').strip()
    question_set_name = (data.get('question_set_name') or '').strip()

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    session = load_session(folder)
    if session:
        apply_state(session)
        if not state['question_set']:
            delete_session(folder)
            return jsonify({'error': 'Saved session references a missing question set. Start fresh.'}), 400
    else:
        if not evaluator:
            return jsonify({'error': 'Evaluator name is required.'}), 400
        if not question_set_name:
            return jsonify({'error': 'Question set name is required.'}), 400

        qs = load_question_set(question_set_name)
        if not qs:
            return jsonify({'error': f'Question set "{question_set_name}" not found.'}), 404

        images = selected_images(folder, selected_paths) if selected_paths else collect_images(folder)
        if not images:
            return jsonify({'error': 'No images found in the selected folders.'}), 400

        qs_slug  = re.sub(r'[^\w]', '_', question_set_name.strip())
        ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
        eval_dir = os.path.join(folder, 'evaluations', evaluator)
        os.makedirs(eval_dir, exist_ok=True)

        state['images']            = images
        state['current_index']     = 0
        state['base_folder']       = folder
        state['selected_paths']    = selected_paths or []
        state['evaluator']         = evaluator
        state['question_set_name'] = question_set_name
        state['question_set']      = qs
        state['answered_indices']  = set()
        state['csv_path']          = os.path.join(eval_dir, f'{qs_slug}_{ts}.csv')
        save_session()

    if not state['images']:
        return jsonify({'error': 'No images found in the selected folders.'}), 400

    return jsonify({
        'total':            len(state['images']),
        'current':          state['current_index'],
        'answered':         len(state['answered_indices']),
        'answered_indices': list(state['answered_indices']),
        'question_set':     state['question_set'],
        'evaluator':        state['evaluator'],
    })


@rating_bp.route('/api/rating/image/<int:idx>')
def get_image(idx):
    images = state.get('images', [])
    if idx < 0 or idx >= len(images):
        return jsonify({'error': 'Index out of range'}), 404
    img_path = images[idx]
    if not os.path.isfile(img_path):
        return jsonify({'error': 'File not found'}), 404
    return send_file(img_path)


@rating_bp.route('/api/rating/submit', methods=['POST'])
def submit():
    data      = request.json or {}
    idx       = data.get('index')
    responses = data.get('responses')
    images    = state.get('images', [])

    if idx is None or not isinstance(idx, int) or idx < 0 or idx >= len(images):
        return jsonify({'error': 'Invalid image index.'}), 400

    if not state.get('question_set'):
        return jsonify({'error': 'No active question set in session.'}), 400

    questions = state['question_set'].get('questions', [])
    error = _validate_responses(responses, questions)
    if error:
        return jsonify({'error': error}), 400

    try:
        _write_eval_file(idx, responses)
    except (OSError, ValueError) as exc:
        return jsonify({'error': f'Could not write evaluation file: {exc}'}), 500

    state['answered_indices'].add(idx)
    state['current_index'] = max(state['current_index'], idx + 1)
    done = len(state['answered_indices']) >= len(images)

    save_session()

    eval_folder = None
    if done:
        eval_folder = os.path.join(state['base_folder'], 'evaluations', state['evaluator'])
        delete_session(state['base_folder'])

    return jsonify({
        'done':        done,
        'next_index':  state['current_index'],
        'total':       len(images),
        'answered':    len(state['answered_indices']),
        'eval_folder': eval_folder,
    })

@rating_bp.route('/api/rating/discard_session', methods=['POST'])
def discard_session():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if folder:
        delete_session(folder)
    return jsonify({'ok': True})

@rating_bp.route('/api/rating/prompt/<int:idx>')
def get_prompt(idx):
    images = state.get('images', [])
    if idx < 0 or idx >= len(images):
        return jsonify({'prompt': ''})
    return jsonify({'prompt': load_prompt_for_image(images[idx])})