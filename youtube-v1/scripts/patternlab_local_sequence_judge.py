#!/usr/bin/env python3
"""Run a hash-bound local Qwen3-VL review over the full long-form sequence."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_local_visual_judge_runner import (
    MODEL_ID,
    cached_model_files,
    content_address,
    narration_at,
    parse_srt,
    run_model,
)
from patternlab_media_qa_common import load_policy, qa_contract_hash


SEQUENCE_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "sequence_coherence": {"type": "integer", "minimum": 0, "maximum": 100},
            "visual_variety": {"type": "integer", "minimum": 0, "maximum": 100},
            "narration_alignment": {"type": "integer", "minimum": 0, "maximum": 100},
            "artifact_freedom": {"type": "integer", "minimum": 0, "maximum": 100},
            "typography_restraint": {"type": "integer", "minimum": 0, "maximum": 100},
            "hard_failures": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": ["score", "sequence_coherence", "visual_variety", "narration_alignment", "artifact_freedom", "typography_restraint", "hard_failures", "reason"],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def normalize_failures(value: object) -> list[str]:
    rows = value if isinstance(value, list) else []
    return sorted({str(row).strip() for row in rows if str(row).strip().lower() not in {"", "none", "no hard failures", "n/a"}})


def prompt(sheet: dict, captions: list[dict]) -> str:
    cell_text = "; ".join(
        (
            f"cell {row['cell']}={row['timestamp_seconds']}s asset {row['asset_id']} "
            f"narration={narration_at(captions, float(row['timestamp_seconds']))!r}"
        )
        for row in sheet.get("cells", [])
    )
    return (
        "You are the strict sequence-level release judge for Pattern Lab, a premium source-backed city-history channel. "
        "The image is a chronological contact sheet from one continuous long-form video. Judge the sequence, not isolated beauty. "
        "A score of 93 means genuinely release-ready; 92 means repair. Reject repeated or visually near-identical images, repeated source title cards, "
        "generic filler, abrupt mismatched imagery, dim or weak frames, horizontal split/wrap artifacts, duplicated top/bottom strips, random boxes, "
        "caption clutter, or a sequence whose underlying images do not progress with the story. Compare every cell's underlying image to the supplied "
        "nearby narration. Mentally ignore every caption, source label, and callout "
        "when judging whether the underlying visuals are relevant. Text can never rescue a wrong image. Distinct crops of one source count as variety only "
        "when they visibly reveal new evidence. The sequence must feel like a polished documentary, not a slide deck. "
        f"Cell order and timestamps: {cell_text}. Return only the requested JSON."
    )


def build_report(video_id: str, *, timeout: int = 240) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    sequence_path = approval / "long-form-sequence-quality-report.json"
    sequence = read_json(sequence_path)
    blockers: list[str] = []
    if sequence.get("status") != "pass" or sequence.get("blockers"):
        blockers.append("long_form_sequence_deterministic_quality_not_pass")
    sheets = sequence.get("contact_sheets") if isinstance(sequence.get("contact_sheets"), list) else []
    if not sheets:
        blockers.append("long_form_sequence_contact_sheets_missing")
    captions_path = root / "captions" / "closed-captions-final.srt"
    captions = parse_srt(captions_path) if captions_path.is_file() else []
    if not captions:
        blockers.append("long_form_sequence_closed_captions_missing")
    minimum = int(load_policy().get("long_form_sequence", {}).get("minimum_sequence_judge_score", 93))
    judgments: list[dict] = []
    if not blockers:
        for index, sheet in enumerate(sheets, start=1):
            path = Path(str(sheet.get("path") or ""))
            if not path.is_file() or sheet.get("sha256") != sha256_file(path):
                blockers.append(f"long_form_sequence_contact_sheet_missing_or_stale:{index}")
                continue
            parsed, elapsed, output_sha, _ = run_model(
                path,
                prompt(sheet, captions),
                SEQUENCE_SCHEMA,
                timeout=timeout,
                maximum_output_tokens=900,
            )
            dimensions = {name: int(parsed.get(name, 0)) for name in ("sequence_coherence", "visual_variety", "narration_alignment", "artifact_freedom", "typography_restraint")}
            failures = normalize_failures(parsed.get("hard_failures"))
            score = int(parsed.get("score", 0))
            row_blockers = [f"score_below_{minimum}"] if score < minimum else []
            row_blockers.extend(f"dimension_below_{minimum}:{name}" for name, value in dimensions.items() if value < minimum)
            row_blockers.extend(f"hard_failure:{value}" for value in failures)
            judgments.append(
                {
                    "sheet_index": index,
                    "path": str(path),
                    "sha256": sha256_file(path),
                    "score": score,
                    "dimensions": dimensions,
                    "hard_failures": failures,
                    "reason": str(parsed.get("reason") or "")[:1000],
                    "elapsed_seconds": round(elapsed, 3),
                    "output_sha256": output_sha,
                    "blockers": row_blockers,
                }
            )
            blockers.extend(f"sequence_sheet_{index}:{value}" for value in row_blockers)
    model, mmproj = cached_model_files()
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "judge_model": MODEL_ID,
        "judge_mode": "local",
        "judge_model_sha256": content_address(model),
        "judge_mmproj_sha256": content_address(mmproj),
        "qa_contract_sha256": qa_contract_hash(),
        "video_sha256": sha256_file(video) if video.is_file() else "",
        "captions_sha256": sha256_file(captions_path) if captions_path.is_file() else "",
        "sequence_quality_report_sha256": sha256_file(sequence_path) if sequence_path.is_file() else "",
        "minimum_score": minimum,
        "judgments": judgments,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report_path = approval / "local-sequence-judge-report.json"
    md_path = approval / "local-sequence-judge-report.md"
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Local Sequence Judge: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Sheets judged: {len(judgments)}",
                f"Minimum score: {minimum}",
                "",
                *[f"- Sheet {row['sheet_index']}: {row['score']}/100" for row in judgments],
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "Paid provider calls: not performed",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, report_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Pattern Lab long-form sequence judge.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--timeout-seconds", type=int, default=240)
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), timeout=args.timeout_seconds)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
