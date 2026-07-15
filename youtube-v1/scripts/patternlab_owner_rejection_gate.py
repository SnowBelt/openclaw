#!/usr/bin/env python3
"""Prove that a new long-form candidate supersedes every owner-rejected render."""
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


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def build_report(video_id: str) -> tuple[dict, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    qa_path = approval / "long-form-media-qa-report.json"
    qa = json.loads(qa_path.read_text(encoding="utf-8")) if qa_path.is_file() else {}
    negative_events = [
        row
        for row in read_jsonl(approval / "owner-feedback.jsonl")
        if row.get("asset_type") == "video" and row.get("sentiment") == "negative"
    ]
    rejected_files = sorted((root / "video" / "rejected").glob(f"pattern-lab-video-{video_id}-owner-rejected-*.mp4"))
    rejected_rows = [
        {"path": display_path(path), "sha256": sha256_file(path)} for path in rejected_files if path.is_file()
    ]
    current_sha = sha256_file(video) if video.is_file() else ""
    blockers: list[str] = []
    has_rejection_history = bool(negative_events or rejected_rows)
    if bool(negative_events) != bool(rejected_rows):
        blockers.append("owner_rejection_history_incomplete")
    if not current_sha:
        blockers.append("replacement_long_form_missing")
    if has_rejection_history and current_sha and any(row["sha256"] == current_sha for row in rejected_rows):
        blockers.append("replacement_matches_owner_rejected_render")
    if qa.get("status") != "pass" or qa.get("video_sha256") != current_sha:
        blockers.append("replacement_long_form_qa_missing_stale_or_blocked")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "current_video": display_path(video),
        "current_video_sha256": current_sha,
        "latest_rejection_event": negative_events[-1] if negative_events else {},
        "rejection_history_status": "superseded" if has_rejection_history else "not_applicable",
        "owner_rejected_renders": rejected_rows,
        "repair_queue_resolution": "pending_owner_approval_of_replacement",
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report = approval / "owner-rejection-supersession-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a replacement does not reproduce an owner-rejected long-form render.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
