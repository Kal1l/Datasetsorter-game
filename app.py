import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from modes.classic_mode import classic_bp, session_info_for_folder as classic_session_info_for_folder
from modes.common import IMAGE_EXTENSIONS, count_images
from modes.rating_mode import rating_bp, session_info_for_folder as rating_session_info_for_folder
from modes.question_sets import question_sets_bp
from modes.review_mode import review_bp

app = Flask(__name__)
app.register_blueprint(classic_bp)
app.register_blueprint(rating_bp)
app.register_blueprint(question_sets_bp)
app.register_blueprint(review_bp)

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/scan', methods=['POST'])
def scan():
    data = request.json or {}
    folder = data.get('folder', '').strip()

    if not folder or not os.path.isdir(folder):
        return jsonify({'error': 'Invalid or non-existent folder path.'}), 400

    skip_dirs = {'good', 'bad', 'evaluations'}
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

    session_info = classic_session_info_for_folder(folder)
    rating_session_info = rating_session_info_for_folder(folder)

    return jsonify({
        'subfolders': subfolders,
        'direct_images': direct,
        'session': session_info,
        'rating_session': rating_session_info,
    })
@app.route('/api/browse', methods=['POST'])
def browse_folder():
    # Try tkinter first (requires Tcl/Tk)
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', 1)
        folder = filedialog.askdirectory(title='Select Dataset Folder')
        root.destroy()
        if folder:
            return jsonify({'folder': os.path.normpath(folder)})
        return jsonify({'folder': None})
    except Exception:
        pass

    # Fallback: PowerShell FolderBrowserDialog (Windows, no extra dependencies)
    try:
        import subprocess
        ps_script = (
            'Add-Type -AssemblyName System.Windows.Forms;'
            '$d = New-Object System.Windows.Forms.FolderBrowserDialog;'
            '$d.Description = "Select Dataset Folder";'
            'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }'
        )
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps_script],
            capture_output=True, text=True, timeout=60,
        )
        folder = result.stdout.strip()
        if folder:
            return jsonify({'folder': os.path.normpath(folder)})
        return jsonify({'folder': None})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Dataset Game running at http://localhost:5000")
    app.run(debug=False, port=5000)
