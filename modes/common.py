import os
import json
from pathlib import Path

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}


def _is_within_base(path, base_folder):
    """Return True when path resolves inside base_folder."""
    try:
        resolved_path = Path(path).resolve()
        resolved_base = Path(base_folder).resolve()
        return os.path.commonpath([resolved_path, resolved_base]) == str(resolved_base)
    except (OSError, RuntimeError, ValueError):
        return False


def selected_images(folder, selected_paths=None):
    """Collect images from selected subpaths or from the full folder."""
    if selected_paths:
        images = []
        for path in selected_paths:
            if os.path.isdir(path) and _is_within_base(path, folder):
                images.extend(collect_images(path))
        return images
    return collect_images(folder)


def collect_images(folder):
    """Recursively collect image files while skipping output folders."""
    images = []
    skip_dirs = {'good', 'bad'}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file_name in sorted(files):
            if Path(file_name).suffix.lower() in IMAGE_EXTENSIONS:
                images.append(os.path.normpath(os.path.join(root, file_name)))
    return images


def count_images(folder):
    """Count images recursively while skipping output folders."""
    total = 0
    skip_dirs = {'good', 'bad'}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file_name in files:
            if Path(file_name).suffix.lower() in IMAGE_EXTENSIONS:
                total += 1
    return total

def load_metadata_for_image(img_abs_path: str) -> dict:
    """Load prompt/technique/scenario metadata for a specific image."""
    folder    = os.path.dirname(img_abs_path)
    meta_path = os.path.join(folder, 'metadata.json')
    result    = {'prompt': '', 'technique': '', 'scenario': ''}
    if not os.path.isfile(meta_path):
        return result
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        entry = meta.get(os.path.basename(img_abs_path), {})
        if isinstance(entry, str):
            result['prompt'] = entry
        elif isinstance(entry, dict):
            result['prompt']    = entry.get('prompt', '')
            result['technique'] = entry.get('technique', '')
            result['scenario']  = entry.get('scenario', '')
    except (OSError, json.JSONDecodeError):
        pass
    return result

def load_prompt_for_image(img_abs_path: str) -> str:
    """Return only the prompt field from image metadata."""
    return load_metadata_for_image(img_abs_path)['prompt']