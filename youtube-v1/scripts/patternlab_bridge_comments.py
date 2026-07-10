#!/usr/bin/env python3
"""Plan or record Pattern Lab bridge comment posting/pinning.

This script never mutates YouTube. It reads approved metadata and writes the exact
comment checklist. Manual confirmation can be recorded after YouTube Studio/API
work is separately approved and completed.
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
    metadata = read_json(approval / "upload-metadata.json")
    blockers: list[str] = []
    rows = []
    long_form = upload_report(root, None)
    comment = metadata.get("pinned_comment") or metadata.get("default_pinned_comment") or ""
    if not comment:
        blockers.append("long_form_pinned_comment_missing_from_metadata")
    rows.append(
        {
            "surface": "long-form",
            "youtube_video_id": long_form.get("youtube_video_id", ""),
            "youtube_url": long_form.get("youtube_url", ""),
            "comment_text": comment,
            "post_status": "manual_confirmed" if manual_confirm else "pending_manual_or_approved_automation",
            "pin_status": "manual_confirmed" if manual_confirm else "pending_manual_or_approved_automation",
        }
    )
    shorts_meta = metadata.get("shorts") or []
    if len(shorts_meta) < 3:
        blockers.append("short_comment_metadata_missing")
    for index in [1, 2, 3]:
        report = upload_report(root, index)
        short_meta = shorts_meta[index - 1] if len(shorts_meta) >= index else {}
        text = short_meta.get("pinned_comment") or comment
        if not text:
            blockers.append(f"short_{index}_pinned_comment_missing")
        rows.append(
            {
                "surface": f"short-{index:02d}",
                "youtube_video_id": report.get("youtube_video_id", ""),
                "youtube_url": report.get("youtube_url", ""),
                "comment_text": text,
                "post_status": "manual_confirmed" if manual_confirm else "pending_manual_or_approved_automation",
                "pin_status": "manual_confirmed" if manual_confirm else "pending_manual_or_approved_automation",
            }
        )
    for row in rows:
        if not row["youtube_video_id"]:
            blockers.append(f"{row['surface']}_upload_report_missing_youtube_id")
    if manual_confirm and not evidence_note.strip():
        blockers.append("manual_confirmation_requires_evidence_note")
    status = "pass" if manual_confirm and not blockers else "pending_owner_approval_or_manual_setup" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "manual_confirmed": manual_confirm and not blockers,
        "evidence_note": evidence_note.strip(),
        "comments": rows,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "bridge-comments-report.json"
    md_path = approval / "bridge-comments-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Bridge Comments: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "YouTube mutation: not performed",
        "",
        "## Required Comments",
        "",
    ]
    for row in rows:
        lines.append(f"- {row['surface']} `{row['youtube_video_id']}` post={row['post_status']} pin={row['pin_status']}")
    lines.extend(["", "## Comment Text", ""])
    for row in rows:
        lines.extend([f"### {row['surface']}", "", row["comment_text"] or "MISSING", ""])
    lines.extend(["## Evidence", "", f"- {payload['evidence_note'] or 'none'}", "", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or record Pattern Lab bridge comments. Never mutates YouTube.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--manual-confirm", action="store_true", help="Record that comments were posted/pinned manually.")
    parser.add_argument("--evidence-note", default="")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id, manual_confirm=args.manual_confirm, evidence_note=args.evidence_note)
    print(json.dumps(payload, indent=2))
    print(f"Bridge comments report: {display_path(md_path)}")
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
