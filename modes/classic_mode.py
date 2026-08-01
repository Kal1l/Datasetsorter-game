import json
import os
import shutil

from flask import Blueprint, jsonify, request, send_file

from .common import collect_images, selected_images

SESSION_FILE = '.dataset_game_session.json'

classic_bp = Blueprint('classic_mode', __name__)

state = {
    'images': [],
    'current_index': 0,
    'base_folder': '',
    'good_folder': '',
    'bad_folder': '',
    'good_count': 0,
    'bad_count': 0,
    'judgments': {},      # {str(idx): 'good'|'bad'}
    'selected_paths': [],
}


def session_path(folder):
    """Return the session file path for a dataset folder."""
    return os.path.join(folder, SESSION_FILE)


def save_session():
    """Persist in-memory state for classic mode resume."""
    if not state['base_folder']:
        return
    data = {
        'folder': state['base_folder'],
        'selected_paths': state['selected_paths'],
        'images': state['images'],
        'current_index': state['current_index'],
        'good_count': state['good_count'],
        'bad_count': state['bad_count'],
        'judgments': state['judgments'],
    }
    try:
        with open(session_path(state['base_folder']), 'w', encoding='utf-8') as handle:
            json.dump(data, handle)
    except OSError:
        pass


def load_session(folder):
    """Load a classic mode session from disk if available."""
    path = session_path(folder)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
        if 'images' not in data or 'current_index' not in data:
            return None
        return data
    except (OSError, json.JSONDecodeError):
        return None


def delete_session(folder):
    """Delete the saved classic mode session file, if present."""
    try:
        os.remove(session_path(folder))
    except OSError:
        pass


def apply_state(data):
    """Apply loaded session data to the in-memory runtime state."""
    folder = data['folder']
    state['images'] = data['images']
    state['current_index'] = data['current_index']
    state['base_folder'] = folder
    state['good_folder'] = os.path.join(folder, 'good')
    state['bad_folder'] = os.path.join(folder, 'bad')
    state['good_count'] = data.get('good_count', 0)
    state['bad_count'] = data.get('bad_count', 0)
    state['judgments'] = data.get('judgments', {})
    state['selected_paths'] = data.get('selected_paths', [])
    os.makedirs(state['good_folder'], exist_ok=True)
    os.makedirs(state['bad_folder'], exist_ok=True)


def session_info_for_folder(folder):
    """Return lightweight session status used by the setup screen."""
    session = load_session(folder)
    if not session:
        return None

    total = len(session['images'])
    return {
        'current_index': session['current_index'],
        'total': total,
        'good_count': session.get('good_count', 0),
        'bad_count': session.get('bad_count', 0),
        'judgments': session.get('judgments', {}),
        'selected_paths': session.get('selected_paths', []),
    }


@classic_bp.route('/api/classic/resume', methods=['POST'])
def resume():
    """Resume a previously saved classic sorting session."""
    data = request.json or {}
    folder = data.get('folder', '').strip()

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid folder.'}), 400

    session = load_session(folder)
    if not session:
        return jsonify({'error': 'No saved session found.'}), 404

    apply_state(session)

    return jsonify({
        'total': len(state['images']),
        'current': state['current_index'],
        'good_count': state['good_count'],
        'bad_count': state['bad_count'],
        'judgments': state['judgments'],
    })


@classic_bp.route('/api/classic/start', methods=['POST'])
def start():
    """Initialize a new classic sorting session for selected images."""
    data = request.json or {}
    folder = data.get('folder', '').strip()
    selected_paths = data.get('selected_paths')

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    images = selected_images(folder, selected_paths)

    if not images:
        return jsonify({'error': 'No images found in the specified folder.'}), 400

    state['images'] = images
    state['current_index'] = 0
    state['base_folder'] = folder
    state['good_folder'] = os.path.join(folder, 'good')
    state['bad_folder'] = os.path.join(folder, 'bad')
    state['good_count'] = 0
    state['bad_count'] = 0
    state['judgments'] = {}
    state['selected_paths'] = selected_paths or []

    os.makedirs(state['good_folder'], exist_ok=True)
    os.makedirs(state['bad_folder'], exist_ok=True)

    delete_session(folder)
    save_session()

    return jsonify({'total': len(images), 'current': 0})


@classic_bp.route('/api/classic/image/<int:idx>')
def get_image(idx):
    """Serve one image by index from the active classic session."""
    images = state.get('images', [])
    if idx < 0 or idx >= len(images):
        return jsonify({'error': 'Index out of range'}), 404

    img_path = images[idx]
    if not os.path.isfile(img_path):
        return jsonify({'error': 'File not found'}), 404

    return send_file(img_path)


@classic_bp.route('/api/classic/action', methods=['POST'])
def action():
    """Apply a good/bad judgment and update progress counters."""
    data = request.json or {}
    direction = data.get('direction')
    idx = data.get('index')

    images = state.get('images', [])

    if idx is None or idx < 0 or idx >= len(images):
        return jsonify({'error': 'Invalid index'}), 400

    if direction not in ('good', 'bad'):
        return jsonify({'error': 'Invalid direction'}), 400

    img_path = images[idx]
    base = state['base_folder']
    rel_path = os.path.relpath(img_path, base)
    str_idx = str(idx)
    old_judgment = state['judgments'].get(str_idx)

    if old_judgment != direction:
        # Remove old copy when re-judging
        if old_judgment == 'good':
            try:
                os.remove(os.path.join(state['good_folder'], rel_path))
            except OSError:
                pass
            state['good_count'] -= 1
        elif old_judgment == 'bad':
            try:
                os.remove(os.path.join(state['bad_folder'], rel_path))
            except OSError:
                pass
            state['bad_count'] -= 1

        # Copy to new destination
        if direction == 'good':
            dest = os.path.join(state['good_folder'], rel_path)
            state['good_count'] += 1
        else:
            dest = os.path.join(state['bad_folder'], rel_path)
            state['bad_count'] += 1

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(img_path, dest)
        state['judgments'][str_idx] = direction

    # Advance sequential position for session resume
    state['current_index'] = max(state['current_index'], idx + 1)
    done = len(state['judgments']) >= len(images)

    save_session()
    if done:
        delete_session(state['base_folder'])

    return jsonify({
        'done': done,
        'good_count': state['good_count'],
        'bad_count': state['bad_count'],
        'judged_count': len(state['judgments']),
    })


@classic_bp.route('/api/classic/discard_session', methods=['POST'])
def discard_session():
    """Discard a saved classic mode session for a folder."""
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if folder:
        delete_session(folder)
    return jsonify({'ok': True})
