#!/usr/bin/env python3
"""Plan or record Pattern Lab Shorts Related Video setup.

This script never mutates YouTube. It produces a checklist/receipt showing which
Shorts must point to the long-form video. A manual confirmation can be recorded
only after the owner/operator has completed the setup in YouTube Studio.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def upload_report(root: Path, index: int | None) -> dict:
    if index is None:
        return read_json(root / "approval" / "youtube-upload-report.json")
    return read_json(root / "approval" / f"youtube-upload-report-short-{index:02d}.json")


def build_report(video_id: str, *, manual_confirm: bool = False, evidence_note: str = "") -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    long_form = upload_report(root, None)
    shorts = [upload_report(root, index) for index in [1, 2, 3]]
    blockers: list[str] = []
    if long_form.get("status") != "uploaded" or not long_form.get("youtube_video_id"):
        blockers.append("long_form_upload_report_missing_or_incomplete")
    rows = []
    for index, report in enumerate(shorts, start=1):
        if report.get("status") != "uploaded" or not report.get("youtube_video_id"):
            blockers.append(f"short_{index}_upload_report_missing_or_incomplete")
        rows.append(
            {
                "short_index": index,
                "short_youtube_video_id": report.get("youtube_video_id", ""),
                "short_youtube_url": report.get("youtube_url", ""),
                "required_related_video_id": long_form.get("youtube_video_id", ""),
                "required_related_video_url": long_form.get("youtube_url", ""),
                "setup_status": "manual_confirmed" if manual_confirm else "pending_manual_or_approved_automation",
            }
        )
    if manual_confirm and not evidence_note.strip():
        blockers.append("manual_confirmation_requires_evidence_note")
    status = "pass" if manual_confirm and not blockers else "pending_owner_approval_or_manual_setup" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "manual_confirmed": manual_confirm and not blockers,
        "evidence_note": evidence_note.strip(),
        "long_form_youtube_video_id": long_form.get("youtube_video_id", ""),
        "long_form_youtube_url": long_form.get("youtube_url", ""),
        "shorts": rows,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "related-video-setup-report.json"
    md_path = approval / "related-video-setup-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Related Video Setup: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "YouTube mutation: not performed",
        "",
        "## Required Setup",
        "",
    ]
    for row in rows:
        lines.append(
            f"- Short {row['short_index']} `{row['short_youtube_video_id']}` -> long-form `{row['required_related_video_id']}` ({row['setup_status']})"
        )
    lines.extend(["", "## Evidence", "", f"- {payload['evidence_note'] or 'none'}", "", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or record Pattern Lab Related Video setup. Never mutates YouTube.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--manual-confirm", action="store_true", help="Record that the setup was completed manually in YouTube Studio.")
    parser.add_argument("--evidence-note", default="")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id, manual_confirm=args.manual_confirm, evidence_note=args.evidence_note)
    print(json.dumps(payload, indent=2))
    print(f"Related Video setup report: {display_path(md_path)}")
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
