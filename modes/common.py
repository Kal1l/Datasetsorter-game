import os
from pathlib import Path

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}


def collect_images(folder):
    images = []
    skip_dirs = {'good', 'bad'}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file_name in sorted(files):
            if Path(file_name).suffix.lower() in IMAGE_EXTENSIONS:
                images.append(os.path.normpath(os.path.join(root, file_name)))
    return images


def count_images(folder):
    total = 0
    skip_dirs = {'good', 'bad'}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file_name in files:
            if Path(file_name).suffix.lower() in IMAGE_EXTENSIONS:
                total += 1
    return total
