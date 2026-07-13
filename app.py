import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from modes.classic_mode import classic_bp, session_info_for_folder
from modes.common import IMAGE_EXTENSIONS, count_images
from modes.rating_mode import rating_bp

app = Flask(__name__)
app.register_blueprint(classic_bp)
app.register_blueprint(rating_bp)

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/scan', methods=['POST'])
def scan():
    data = request.json or {}
    folder = data.get('folder', '').strip()

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    skip_dirs = {'good', 'bad'}
    subfolders = []
    for name in sorted(os.listdir(folder)):
        if name in skip_dirs:
            continue
        path = os.path.join(folder, name)
        if os.path.isdir(path):
            count = count_images(path)
            if count > 0:
                subfolders.append({'name': name, 'path': path, 'count': count})

    direct = sum(
        1 for f in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, f))
        and Path(f).suffix.lower() in IMAGE_EXTENSIONS
    )

    session_info = session_info_for_folder(folder)

    return jsonify({
        'subfolders': subfolders,
        'direct_images': direct,
        'session': session_info,
    })
if __name__ == '__main__':
    print("Dataset Game running at http://localhost:5000")
    app.run(debug=False, port=5000)
