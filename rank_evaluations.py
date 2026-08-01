#!/usr/bin/env python3
"""Generate rankings from CSV files in evaluations/.

Outputs:
- evaluations/ranking_images_desc.csv: image ranking (mean across evaluators)
- evaluations/ranking_techniques_desc.csv: technique ranking

Special rule:
- visual_discomfort / visual_descomfort: lower is better, so it is inverted to a 1..5 score.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Dict, Iterable, List, Optional


NUMERIC_FIELDS = (
    "match_description",
    "originality",
    "aesthetic_appeal",
)

VISUAL_DISCOMFORT_ALIASES = (
    "visual_discomfort",
    "visual_descomfort",
)


def to_float(value: object) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_float(value: Optional[float], decimals: int = 4) -> str:
    if value is None:
        return ""
    return f"{value:.{decimals}f}"


def invert_visual_discomfort(value: Optional[float], scale_min: float = 1.0, scale_max: float = 5.0) -> Optional[float]:
    if value is None:
        return None
    return scale_max + scale_min - value


def normalize_subject_clarity(value: object) -> Optional[str]:
    text = (str(value).strip().lower() if value is not None else "")
    if text == "yes":
        return "yes"
    if text == "no":
        return "no"
    return None


def collect_input_files(evaluations_dir: Path) -> List[Path]:
    files = sorted(evaluations_dir.glob("*.csv"))
    excluded_prefixes = ("ranking_", "rank_")
    return [
        path
        for path in files
        if not any(path.name.startswith(prefix) for prefix in excluded_prefixes)
    ]


def read_rows(csv_path: Path) -> Iterable[Dict[str, str]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            row["_source_file"] = csv_path.name
            yield row


def compute_row_scores(row: Dict[str, str]) -> Dict[str, Optional[float]]:
    values: Dict[str, Optional[float]] = {}

    for field in NUMERIC_FIELDS:
        values[field] = to_float(row.get(field))

    visual_value: Optional[float] = None
    for alias in VISUAL_DISCOMFORT_ALIASES:
        candidate = to_float(row.get(alias))
        if candidate is not None:
            visual_value = candidate
            break

    values["visual_discomfort"] = visual_value
    values["visual_score_inverted"] = invert_visual_discomfort(visual_value)

    final_components = [
        values["match_description"],
        values["originality"],
        values["aesthetic_appeal"],
        values["visual_score_inverted"],
    ]
    valid_components = [x for x in final_components if x is not None]
    values["final_score"] = mean(valid_components) if valid_components else None

    return values


def aggregate_by_key(rows: List[Dict[str, str]], key_field: str) -> List[Dict[str, object]]:
    groups: Dict[str, Dict[str, object]] = defaultdict(lambda: {
        "samples": 0,
        "match_description": [],
        "originality": [],
        "visual_discomfort": [],
        "aesthetic_appeal": [],
        "visual_score_inverted": [],
        "final_score": [],
        "subject_clarity_yes": 0,
        "subject_clarity_no": 0,
    })

    for row in rows:
        key = (row.get(key_field) or "").strip()
        if not key:
            continue

        metrics = compute_row_scores(row)
        group = groups[key]
        group["samples"] = int(group["samples"]) + 1

        subject_clarity_value = normalize_subject_clarity(row.get("subject_clarity"))
        if subject_clarity_value == "yes":
            group["subject_clarity_yes"] = int(group["subject_clarity_yes"]) + 1
        elif subject_clarity_value == "no":
            group["subject_clarity_no"] = int(group["subject_clarity_no"]) + 1

        for metric_name in (
            "match_description",
            "originality",
            "visual_discomfort",
            "aesthetic_appeal",
            "visual_score_inverted",
            "final_score",
        ):
            metric_value = metrics.get(metric_name)
            if metric_value is not None:
                cast_list = group[metric_name]
                assert isinstance(cast_list, list)
                cast_list.append(metric_value)

    ranking: List[Dict[str, object]] = []
    for key, values in groups.items():
        subject_yes = int(values["subject_clarity_yes"])
        subject_no = int(values["subject_clarity_no"])
        if subject_yes > subject_no:
            subject_majority = "yes"
        elif subject_no > subject_yes:
            subject_majority = "no"
        else:
            subject_majority = "tie"

        entry = {
            key_field: key,
            "samples": values["samples"],
            "mean_match_description": mean(values["match_description"]) if values["match_description"] else None,
            "mean_originality": mean(values["originality"]) if values["originality"] else None,
            "mean_visual_discomfort": mean(values["visual_discomfort"]) if values["visual_discomfort"] else None,
            "mean_aesthetic_appeal": mean(values["aesthetic_appeal"]) if values["aesthetic_appeal"] else None,
            "mean_visual_score_inverted": mean(values["visual_score_inverted"]) if values["visual_score_inverted"] else None,
            "mean_final_score": mean(values["final_score"]) if values["final_score"] else None,
            "subject_clarity_yes": subject_yes,
            "subject_clarity_no": subject_no,
            "subject_clarity_majority_yes_no": subject_majority,
        }
        ranking.append(entry)

    ranking.sort(
        key=lambda item: (
            item["mean_final_score"] if item["mean_final_score"] is not None else float("-inf"),
            item["samples"],
        ),
        reverse=True,
    )
    return ranking


def write_ranking_csv(output_path: Path, rows: List[Dict[str, object]], id_field: str, include_subject_majority: bool = False) -> None:
    fieldnames = [
        id_field,
        "samples",
        "mean_match_description",
        "mean_originality",
        "mean_visual_discomfort",
        "mean_aesthetic_appeal",
    ]
    if include_subject_majority:
        fieldnames.extend([
            "subject_clarity_yes",
            "subject_clarity_no",
            "subject_clarity_majority_yes_no",
        ])

    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            row_data = {
                id_field: row.get(id_field, ""),
                "samples": row.get("samples", ""),
                "mean_match_description": format_float(row.get("mean_match_description")),
                "mean_originality": format_float(row.get("mean_originality")),
                "mean_visual_discomfort": format_float(row.get("mean_visual_discomfort")),
                "mean_aesthetic_appeal": format_float(row.get("mean_aesthetic_appeal")),
            }
            if include_subject_majority:
                row_data["subject_clarity_yes"] = row.get("subject_clarity_yes", "")
                row_data["subject_clarity_no"] = row.get("subject_clarity_no", "")
                row_data["subject_clarity_majority_yes_no"] = row.get("subject_clarity_majority_yes_no", "")
            writer.writerow(row_data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate rankings from evaluations CSV files.")
    parser.add_argument(
        "--evaluations-dir",
        default="evaluations",
        help="Directory containing evaluation CSV files (default: evaluations).",
    )
    args = parser.parse_args()

    evaluations_dir = Path(args.evaluations_dir)
    if not evaluations_dir.exists() or not evaluations_dir.is_dir():
        raise SystemExit(f"Invalid directory: {evaluations_dir}")

    input_files = collect_input_files(evaluations_dir)
    if not input_files:
        raise SystemExit("No evaluation CSV files found to process.")

    all_rows: List[Dict[str, str]] = []
    for csv_path in input_files:
        all_rows.extend(read_rows(csv_path))

    image_ranking = aggregate_by_key(all_rows, key_field="image")
    technique_ranking = aggregate_by_key(all_rows, key_field="technique")

    images_output = evaluations_dir / "ranking_images_desc.csv"
    techniques_output = evaluations_dir / "ranking_techniques_desc.csv"

    write_ranking_csv(images_output, image_ranking, id_field="image", include_subject_majority=True)
    write_ranking_csv(techniques_output, technique_ranking, id_field="technique", include_subject_majority=True)

    print(f"Processed {len(all_rows)} records from {len(input_files)} file(s).")
    print(f"Generated: {images_output}")
    print(f"Generated: {techniques_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
