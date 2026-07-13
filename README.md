# Dataset Game

A fast image labeling tool with two modes:

- `Classic Sort`: keyboard & swipe-driven sorting into `good/` and `bad/`
- `Rating Survey`: for each image, answer 5 Likert-scale questions (`1` to `5`) plus 1 descriptive question, saved to CSV

## Setup

### 1. Create and activate a virtual environment

**Windows (recommended — just run the scripts):**

```bat
setup.bat   # creates venv and installs dependencies
run.bat     # starts the app
```

**Manual steps (Windows):**

```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

**macOS / Linux:**

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

### 2. Open the app

Go to **http://localhost:5000** in your browser.

> The `venv/` folder is already listed in `.gitignore` and will not be committed.

## How to use

1. Enter the path to your dataset folder (e.g. `C:\Users\you\my-dataset`).
2. The app scans all subfolders for images (`.jpg`, `.png`, `.gif`, `.bmp`, `.webp`, `.tiff`).
3. Choose your game mode before selecting folders.
4. If using Classic Sort, sort each image:

| Action | Key / Gesture |
|--------|--------------|
| ✓ Good | `→` arrow, right-swipe, or green button |
| ✗ Bad  | `←` arrow, left-swipe, or red button |
| – Skip | `↓` / `Space`, or yellow button |

5. When finished in Classic Sort, sorted copies appear in:
   - `<your-folder>/good/`
   - `<your-folder>/bad/`

   Original files are **never moved or deleted**.

6. If using Rating Survey:
  - Each image is shown with all 6 questions on the same page.
  - The image stays visible while answering.
  - You answer 5 Likert-scale questions (`1` to `5`) and 1 descriptive question for each image.
  - Results are appended to `<your-folder>/rating_results.csv` with columns:
    - `image`
    - `do_you_like_this_image`
    - `does_this_image_look_ai_generated`
    - `is_the_image_visually_clear`
    - `is_the_content_coherent`
    - `would_you_use_this_image_in_a_dataset`
    - `subjective`

## Folder structure

```
my-dataset/
  cats/
    img1.jpg
    img2.jpg
  dogs/
    img1.jpg
  good/          ← created by the app
    cats/
      img1.jpg
  bad/           ← created by the app
    cats/
      img2.jpg
```

Subfolder structure is preserved inside `good/` and `bad/`.
