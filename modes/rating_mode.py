import csv
import os
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

from .common import collect_images

RATING_RESULTS_FILE = 'rating_results.csv'
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


def _selected_images(folder, selected_paths):
    if selected_paths:
        images = []
        for path in selected_paths:
            if os.path.isdir(path):
                images.extend(collect_images(path))
        return images
    return collect_images(folder)


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


@rating_bp.route('/api/rating/start', methods=['POST'])
def start():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    selected_paths = data.get('selected_paths')

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    images = _selected_images(folder, selected_paths)
    if not images:
        return jsonify({'error': 'No images found in the selected folders.'}), 400

    state['images'] = images
    state['current_index'] = 0
    state['base_folder'] = folder
    state['selected_paths'] = selected_paths or []
    state['answers'] = []

    return jsonify({'total': len(images), 'current': 0})


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

    csv_path = None
    if done:
        try:
            csv_path = _write_results_csv()
        except OSError:
            return jsonify({'error': 'Could not write CSV results.'}), 500

    return jsonify({
        'done': done,
        'next_index': state['current_index'],
        'total': len(images),
        'answered': len(state['answers']),
        'csv_path': csv_path,
    })
