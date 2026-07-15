#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

import patternlab_script_bootstrap  # noqa: F401

from patternlab.shorts_alignment import locate_all
from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import (
    complete_sentence,
    minimum_script_package_ok,
    script_items,
    script_package,
    short_ref,
    starts_context_dependent,
    write_report,
)


def build_boundary_quality_report(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    blockers = minimum_script_package_ok(package)
    warnings: list[str] = []
    timestamp_paths = [
        root / "audio" / "voiceover_words.json",
        root / "audio" / "word-timestamps.json",
        root / "approval" / "word-timestamps.json",
        root / "captions" / "word-alignment.json",
    ]
    timestamps_exist = any(path.exists() and path.stat().st_size > 0 for path in timestamp_paths)
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    words: list[dict] = []
    for path in timestamp_paths:
        if not path.is_file() or path.stat().st_size == 0:
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(value, dict) and isinstance(value.get("words"), list):
            words = value["words"]
            break
    rendered_alignment_pending = not bool(words)
    timestamps_exist = bool(words)
    if rendered_alignment_pending:
        blockers.append("exact_word_alignment_missing")
    rows = []
    for item in script_items(package):
        script = str(item.get("script") or "").strip()
        hook = str(item.get("hook") or "").strip()
        row_blockers = []
        if starts_context_dependent(hook):
            row_blockers.append("hook starts with context-dependent phrasing")
        if starts_context_dependent(script):
            row_blockers.append("script starts with context-dependent phrasing")
        if not complete_sentence(script):
            row_blockers.append("script does not end as a complete sentence")
        if not complete_sentence(hook):
            row_blockers.append("hook does not end as a complete sentence")
        sentences = [str(value) for value in item.get("narration_sentences", []) if str(value).strip()]
        intervals: list[tuple[float, float]] = []
        if not sentences:
            row_blockers.append("approved narration sentence list is missing")
        elif words:
            try:
                intervals = locate_all(words, sentences)
            except ValueError as exc:
                row_blockers.append(str(exc))
        blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "transcript_boundary_status": "pass" if not row_blockers else "blocked",
                "rendered_cut_alignment_status": "pending" if rendered_alignment_pending else ("pass" if intervals and not row_blockers else "blocked"),
                "sentence_intervals": [
                    {"start": round(start, 3), "end": round(end, 3)} for start, end in intervals
                ],
                "blockers": row_blockers,
            }
        )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "word_timestamp_candidates": [display_path(path) for path in timestamp_paths],
        "word_timestamps_exist": timestamps_exist,
        "long_form_exists": long_form.exists(),
        "rendered_cut_alignment_status": "pending" if rendered_alignment_pending else ("pass" if not blockers else "blocked"),
        "shorts": rows,
    }
    sections = [
        (
            "Boundary Checks",
            [
                f"- Short {row['index']}: transcript={row['transcript_boundary_status']} rendered_cut={row['rendered_cut_alignment_status']}"
                for row in rows
            ],
        ),
        ("Render Alignment", ["- Rendering uses only exact complete approved narration sentences with word-aligned intervals; placeholder long-form cuts are forbidden."]),
    ]
    return write_report(video_id, "shorts-boundary-quality-report", "Pattern Lab Shorts Boundary Quality Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts sentence and word-boundary quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_boundary_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Boundary quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
