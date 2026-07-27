import json
import os

from flask import Blueprint, jsonify, request, send_file

from .question_sets import load_question_set

review_bp = Blueprint('review_mode', __name__)

_state: dict = {
    'base_folder': '',
    'evaluators': [],
    'image_map': {},   # { rel_image: { evaluator: eval_data } }
    'images': [],      # sorted list of rel_paths with at least one evaluation
}


def _is_within(path: str, base: str) -> bool:
    try:
        resolved = os.path.normpath(os.path.abspath(path))
        resolved_base = os.path.normpath(os.path.abspath(base))
        return resolved == resolved_base or resolved.startswith(resolved_base + os.sep)
    except (OSError, ValueError):
        return False


@review_bp.route('/api/review/scan', methods=['POST'])
def scan():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    evaluations_dir = os.path.join(folder, 'evaluations')
    if not os.path.isdir(evaluations_dir):
        return jsonify({'evaluators': []})

    evaluators = []
    for name in sorted(os.listdir(evaluations_dir)):
        path = os.path.join(evaluations_dir, name)
        if not os.path.isdir(path):
            continue
        count = sum(
            1 for _, _, files in os.walk(path)
            for f in files if f.endswith('.json')
        )
        if count > 0:
            evaluators.append({'name': name, 'count': count})

    return jsonify({'evaluators': evaluators})


@review_bp.route('/api/review/load', methods=['POST'])
def load():
    data = request.json or {}
    folder = data.get('folder', '').strip()
    selected = data.get('evaluators', [])

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400
    if not isinstance(selected, list) or not selected:
        return jsonify({'error': 'Select at least one evaluator.'}), 400

    evaluations_dir = os.path.join(folder, 'evaluations')
    image_map: dict[str, dict] = {}

    for evaluator in selected:
        # Block path traversal
        if os.sep in evaluator or '..' in evaluator or '/' in evaluator:
            continue
        eval_folder = os.path.join(evaluations_dir, evaluator)
        if not os.path.isdir(eval_folder):
            continue
        for root, _, files in os.walk(eval_folder):
            for fname in sorted(files):
                if not fname.endswith('.json'):
                    continue
                fpath = os.path.join(root, fname)
                if not _is_within(fpath, eval_folder):
                    continue
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        eval_data = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                rel_image = eval_data.get('image', '')
                if not rel_image:
                    continue
                if rel_image not in image_map:
                    image_map[rel_image] = {}
                image_map[rel_image][evaluator] = eval_data

    images = sorted(image_map.keys())
    _state['base_folder'] = folder
    _state['evaluators']  = selected
    _state['image_map']   = image_map
    _state['images']      = images

    return jsonify({
        'total': len(images),
        'evaluators': selected,
        'image_evaluators': {img: list(evals.keys()) for img, evals in image_map.items()},
    })


@review_bp.route('/api/review/image/<int:idx>')
def get_image(idx):
    images = _state.get('images', [])
    if idx < 0 or idx >= len(images):
        return jsonify({'error': 'Index out of range.'}), 404

    rel_path = images[idx]
    abs_path = os.path.normpath(os.path.join(_state['base_folder'], rel_path))

    if not _is_within(abs_path, _state['base_folder']):
        return jsonify({'error': 'Forbidden.'}), 403
    if not os.path.isfile(abs_path):
        return jsonify({'error': 'Image file not found.'}), 404

    return send_file(abs_path)


@review_bp.route('/api/review/entry/<int:idx>')
def get_entry(idx):
    images = _state.get('images', [])
    if idx < 0 or idx >= len(images):
        return jsonify({'error': 'Index out of range.'}), 404

    rel_path   = images[idx]
    raw_evals  = _state['image_map'].get(rel_path, {})

    # Enrich each evaluation with question definitions from the stored set
    enriched: dict[str, dict] = {}
    for evaluator, eval_data in raw_evals.items():
        entry = dict(eval_data)
        qs_name = entry.get('question_set', '')
        if qs_name and 'questions' not in entry:
            qs = load_question_set(qs_name)
            if qs:
                entry['questions'] = qs.get('questions', [])
        enriched[evaluator] = entry

    return jsonify({
        'index': idx,
        'image': rel_path,
        'total': len(images),
        'evaluations': enriched,
        'evaluators_with_data': list(enriched.keys()),
    })