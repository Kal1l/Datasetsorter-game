import json
import os
import re
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

QUESTION_SETS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'question_sets'
)

question_sets_bp = Blueprint('question_sets', __name__)


def _ensure_dir():
    os.makedirs(QUESTION_SETS_DIR, exist_ok=True)


def _safe_filename(name: str) -> str:
    return re.sub(r'[^\w\-]', '_', name.strip()).strip('_') or 'unnamed'


def _set_path(name: str) -> str:
    return os.path.join(QUESTION_SETS_DIR, f'{_safe_filename(name)}.json')


def load_question_set(name: str) -> dict | None:
    """Load a question set by display name. Returns None if not found."""
    path = _set_path(name)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _validate(data: dict) -> str | None:
    if not isinstance(data.get('name'), str) or not data['name'].strip():
        return 'Question set must have a non-empty name.'
    questions = data.get('questions')
    if not isinstance(questions, list) or len(questions) == 0:
        return 'Question set must have at least one question.'
    keys_seen: set[str] = set()
    for i, q in enumerate(questions):
        n = i + 1
        if not isinstance(q.get('key'), str) or not q['key'].strip():
            return f'Question {n}: missing key.'
        key = q['key'].strip()
        if key in keys_seen:
            return f'Duplicate question key: "{key}".'
        keys_seen.add(key)
        if not isinstance(q.get('label'), str) or not q['label'].strip():
            return f'Question {n}: missing label.'
        qtype = q.get('type')
        if qtype not in ('likert', 'ternary'):
            return f'Question {n}: invalid type "{qtype}".'
        if qtype == 'likert':
            mn, mx = q.get('min', 1), q.get('max', 5)
            if not isinstance(mn, int) or not isinstance(mx, int) or mn >= mx:
                return f'Question {n}: likert min must be < max.'
        if qtype == 'ternary':
            opts = q.get('options')
            if not isinstance(opts, list) or len(opts) < 2:
                return f'Question {n}: ternary needs at least 2 options.'
            if not all(isinstance(o, str) and o.strip() for o in opts):
                return f'Question {n}: ternary options must be non-empty strings.'
    return None


@question_sets_bp.route('/api/question_sets', methods=['GET'])
def list_sets():
    _ensure_dir()
    sets = []
    for fname in sorted(os.listdir(QUESTION_SETS_DIR)):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(QUESTION_SETS_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            sets.append({
                'name': data.get('name', fname[:-5]),
                'question_count': len(data.get('questions', [])),
                'created_at': data.get('created_at', ''),
            })
        except (OSError, json.JSONDecodeError):
            pass
    return jsonify({'sets': sets})


@question_sets_bp.route('/api/question_sets/import', methods=['POST'])
def import_set():
    _ensure_dir()
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No file uploaded.'}), 400
    try:
        data = json.load(file)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return jsonify({'error': 'Invalid JSON file.'}), 400
    error = _validate(data)
    if error:
        return jsonify({'error': error}), 400
    name = data['name'].strip()
    path = _set_path(name)
    if os.path.isfile(path):
        return jsonify({'error': f'A set named "{name}" already exists.'}), 409
    if 'created_at' not in data:
        data['created_at'] = datetime.now().isoformat(timespec='seconds')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return jsonify({'ok': True, 'name': name}), 201


@question_sets_bp.route('/api/question_sets/<name>', methods=['GET'])
def get_set(name):
    data = load_question_set(name)
    if data is None:
        return jsonify({'error': 'Question set not found.'}), 404
    return jsonify(data)


@question_sets_bp.route('/api/question_sets/<name>/export')
def export_set(name):
    path = _set_path(name)
    if not os.path.isfile(path):
        return jsonify({'error': 'Question set not found.'}), 404
    return send_file(
        path,
        as_attachment=True,
        download_name=f'{_safe_filename(name)}.json',
        mimetype='application/json',
    )


@question_sets_bp.route('/api/question_sets', methods=['POST'])
def create_set():
    _ensure_dir()
    data = request.json or {}
    error = _validate(data)
    if error:
        return jsonify({'error': error}), 400
    name = data['name'].strip()
    path = _set_path(name)
    if os.path.isfile(path):
        return jsonify({'error': f'A set named "{name}" already exists.'}), 409
    payload = {
        'name': name,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'questions': data['questions'],
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return jsonify({'ok': True, 'name': name}), 201


@question_sets_bp.route('/api/question_sets/<name>', methods=['PUT'])
def update_set(name):
    _ensure_dir()
    data = request.json or {}
    error = _validate(data)
    if error:
        return jsonify({'error': error}), 400
    old_path = _set_path(name)
    if not os.path.isfile(old_path):
        return jsonify({'error': 'Question set not found.'}), 404
    try:
        with open(old_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except (OSError, json.JSONDecodeError):
        existing = {}
    new_name = data['name'].strip()
    new_path = _set_path(new_name)
    if new_path != old_path and os.path.isfile(new_path):
        return jsonify({'error': f'A set named "{new_name}" already exists.'}), 409
    payload = {
        'name': new_name,
        'created_at': existing.get('created_at', datetime.now().isoformat(timespec='seconds')),
        'questions': data['questions'],
    }
    if new_path != old_path:
        os.remove(old_path)
    with open(new_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return jsonify({'ok': True, 'name': new_name})


@question_sets_bp.route('/api/question_sets/<name>', methods=['DELETE'])
def delete_set(name):
    path = _set_path(name)
    if not os.path.isfile(path):
        return jsonify({'error': 'Question set not found.'}), 404
    os.remove(path)
    return jsonify({'ok': True})