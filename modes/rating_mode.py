import csv
import json
import os
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

from .common import collect_images, selected_images

RATING_RESULTS_FILE = 'rating_results.csv'
SESSION_FILE = '.dataset_game_rating_session.json'
LIKERT_QUESTIONS = [
    'do_you_like_this_image',
    'does_this_image_look_ai_generated',
    'is_the_image_visually_clear',
    'is_the_content_coherent',
    'would_you_use_this_image_in_a_dataset',
]

rating_bp = Blueprint('rating_mode', __name__)

state = {
    'images': [],
    'current_index': 0,
    'base_folder': '',
    'selected_paths': [],
    'answers': [],
}


def session_path(folder):
    return os.path.join(folder, SESSION_FILE)


def save_session():
    if not state['base_folder']:
        return

    data = {
        'folder': state['base_folder'],
        'selected_paths': state['selected_paths'],
        'images': state['images'],
        'current_index': state['current_index'],
        'answers': state['answers'],
    }
    try:
        with open(session_path(state['base_folder']), 'w', encoding='utf-8') as handle:
            json.dump(data, handle)
    except OSError:
        pass


def load_session(folder):
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
    try:
        os.remove(session_path(folder))
    except OSError:
        pass


def apply_state(data):
    folder = data['folder']
    state['images'] = data['images']
    state['current_index'] = data['current_index']
    state['base_folder'] = folder
    state['selected_paths'] = data.get('selected_paths', [])
    state['answers'] = data.get('answers', [])


def session_info_for_folder(folder):
    session = load_session(folder)
    if not session:
        return None

    total = len(session['images'])
    done = session['current_index']
    return {
        'current_index': done,
        'total': total,
        'answered': len(session.get('answers', [])),
        'selected_paths': session.get('selected_paths', []),
    }


def _selected_images(folder, selected_paths):
    return selected_images(folder, selected_paths)


def _validate_responses(responses):
    if not isinstance(responses, dict):
        return 'Responses payload must be an object.'

    for question in LIKERT_QUESTIONS:
        value = responses.get(question)
        if not isinstance(value, int) or value < 1 or value > 5:
            return f'{question} must be an integer from 1 to 5.'

    return None


def _write_results_csv():
    if not state['base_folder']:
        raise ValueError('No active rating session.')

    csv_path = os.path.join(state['base_folder'], RATING_RESULTS_FILE)
    exists = os.path.isfile(csv_path)
    fieldnames = ['timestamp', 'image', *LIKERT_QUESTIONS, 'subjective']

    with open(csv_path, 'a', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if not exists:
            writer.writeheader()

        for answer in state['answers']:
            row = {
                'timestamp': datetime.now().isoformat(timespec='seconds'),
                'image': answer['image'],
                'subjective': answer['subjective'],
            }
            for question in LIKERT_QUESTIONS:
                row[question] = answer[question]
            writer.writerow(row)

    return csv_path


def _session_average():
    if not state['answers']:
        return '0.0'

    total_points = 0
    total_values = len(state['answers']) * len(LIKERT_QUESTIONS)
    for answer in state['answers']:
        for question in LIKERT_QUESTIONS:
            total_points += answer[question]

    return f'{(total_points / total_values):.1f}'


@rating_bp.route('/api/rating/start', methods=['POST'])
def start():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    selected_paths = data.get('selected_paths')

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    session = load_session(folder)
    if session:
        apply_state(session)
    else:
        images = _selected_images(folder, selected_paths)
        if not images:
            return jsonify({'error': 'No images found in the selected folders.'}), 400

        state['images'] = images
        state['current_index'] = 0
        state['base_folder'] = folder
        state['selected_paths'] = selected_paths or []
        state['answers'] = []
        save_session()

    if not state['images']:
        return jsonify({'error': 'No images found in the selected folders.'}), 400

    return jsonify({
        'total': len(state['images']),
        'current': state['current_index'],
        'answered': len(state['answers']),
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
    data = request.json or {}
    idx = data.get('index')
    responses = data.get('responses')
    subjective = (data.get('subjective') or '').strip()

    images = state.get('images', [])

    if idx is None or not isinstance(idx, int) or idx < 0 or idx >= len(images):
        return jsonify({'error': 'Invalid image index.'}), 400

    if idx != state['current_index']:
        return jsonify({'error': 'Out-of-order answer.'}), 400

    validation_error = _validate_responses(responses)
    if validation_error:
        return jsonify({'error': validation_error}), 400

    if not subjective:
        return jsonify({'error': 'Subjective answer is required for each image.'}), 400

    rel_image = os.path.relpath(images[idx], state['base_folder'])
    answer = {
        'image': rel_image,
        'subjective': subjective,
    }
    for question in LIKERT_QUESTIONS:
        answer[question] = responses[question]
    state['answers'].append(answer)

    state['current_index'] = idx + 1
    done = state['current_index'] >= len(images)

    save_session()

    csv_path = None
    average = None
    if done:
        try:
            csv_path = _write_results_csv()
            average = _session_average()
            delete_session(state['base_folder'])
        except OSError:
            return jsonify({'error': 'Could not write CSV results.'}), 500

    return jsonify({
        'done': done,
        'next_index': state['current_index'],
        'total': len(images),
        'answered': len(state['answers']),
        'csv_path': csv_path,
        'average': average,
    })


@rating_bp.route('/api/rating/discard_session', methods=['POST'])
def discard_session():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if folder:
        delete_session(folder)
    return jsonify({'ok': True})
