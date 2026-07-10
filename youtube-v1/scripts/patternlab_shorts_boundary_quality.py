#!/usr/bin/env python3
from __future__ import annotations

import argparse

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
    ]
    timestamps_exist = any(path.exists() and path.stat().st_size > 0 for path in timestamp_paths)
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    rendered_alignment_pending = not (long_form.exists() and timestamps_exist)
    if rendered_alignment_pending:
        blockers.append("rendered_cut_word_alignment_pending")
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
        blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "transcript_boundary_status": "pass" if not row_blockers else "blocked",
                "rendered_cut_alignment_status": "pending" if rendered_alignment_pending else "ready-for-word-boundary-validation",
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
        "rendered_cut_alignment_status": "pending" if rendered_alignment_pending else "ready-for-word-boundary-validation",
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
        ("Render Alignment", ["- Rendered-cut word alignment remains pending until long-form draft and word timestamps exist."]),
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
