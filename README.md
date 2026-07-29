# Dataset Game

A fast image labeling tool with two modes:

- **Classic Sort** — keyboard & swipe-driven sorting into `good/` and `bad/`
- **Rating Survey** — rate each image using a customizable question set; results saved per evaluator to CSV

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

> `venv/` and `question_sets/` are listed in `.gitignore` and will not be committed.

---

## Classic Sort

1. Select **Classic Sort** on the setup screen.
2. Enter (or browse to) your dataset folder and click **Next**.
3. Select the subfolders you want to sort and click **Start**.
4. Sort each image:

| Action | Key / Gesture |
|--------|---------------|
| ✓ Good | `→` arrow, right-swipe, or green button |
| ✗ Bad  | `←` arrow, left-swipe, or red button |
| Navigate | `↑` / `↓` arrows or filmstrip |

Sorted **copies** appear in:
- `<your-folder>/good/`
- `<your-folder>/bad/`

Original files are **never moved or deleted**. Subfolder structure is preserved.

---

## Rating Survey

### 1. Create a Question Set

Before rating, you need at least one question set.

- On the setup screen, select **Rating Survey** and click **Next**.
- On the **Rating Survey Setup** screen, click **Manage Sets → + New Set**.
- Give the set a name and add questions. Each question has:
  - **Label** — the text shown to the evaluator
  - **Key** — the CSV column name (e.g. `image_quality`)
  - **Type**:
    - `likert` — numeric scale (configurable min/max, default 1–5)
    - `ternary` — three custom text options (e.g. Yes / No / Unsure)
  - **Hint** (optional) — small description shown below the label
- Click **Save Set**.

Question sets are saved as JSON files in the `question_sets/` folder and can also be imported from existing JSON files.

### 2. Start a Rating Session

1. Enter your dataset folder path and click **Next**.
2. Select the subfolders to rate and click **Start**.
3. On the **Rating Survey Setup** screen:
   - Enter your **evaluator name** (used to organise results).
   - Select a **question set**.
   - Click **Start Rating**.

### 3. Rate Images

The rating screen shows:
- **Left** — the generation prompt (if a `metadata.json` exists in the image folder, see below)
- **Centre** — the image at full height
- **Right** — the question set to answer
- **Filmstrip** at the bottom — click any dot to jump to that image

Answer all questions and click **Submit answer** (or press `↑` / `↓` to navigate without submitting).  
You can exit at any time; your progress is saved and the session resumes automatically on next launch.

### 4. Results

Results are saved to:

```
<your-folder>/evaluations/<evaluator>/<question_set_name>_<timestamp>.csv
```

CSV columns: `image`, `evaluator`, `question_set`, `timestamp`, `prompt`, then one column per question key.

---

## Review Evaluations

Compare answers from multiple evaluators image by image.

1. On the setup screen click **📋 Review Evaluations**.
2. Enter the dataset folder and click **Scan for Evaluators**.
3. Select which evaluators to load and click **Load Evaluations**.
4. Navigate with:

| Action | Key |
|--------|-----|
| Previous / next image | `←` / `→` |
| Switch evaluator | `↑` / `↓` |
| Zoom image | click image |

---

## Optional: Generation Prompts (`metadata.json`)

If your images were AI-generated, you can display the generation prompt alongside each image during rating and store it in the CSV output.

Create a `metadata.json` file inside each image subfolder:

```json
{
  "img1.jpg": { "prompt": "a cat sitting on a red sofa, photorealistic" },
  "img2.jpg": { "prompt": "a dog running through a field, oil painting" }
}
```

The prompt is shown to the left of the image during rating and saved in the `prompt` column of the CSV.

---

## Folder structure

```
my-dataset/
  cats/
    img1.jpg
    img2.jpg
    metadata.json        ← optional, for generation prompts
  dogs/
    img1.jpg
  good/                  ← created by Classic Sort
    cats/
      img1.jpg
  bad/                   ← created by Classic Sort
    cats/
      img2.jpg
  evaluations/           ← created by Rating Survey
    alice/
      my_question_set_20250101_120000.csv
    bob/
      my_question_set_20250101_143000.csv
```
