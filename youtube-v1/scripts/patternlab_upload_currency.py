#!/usr/bin/env python3
"""Verify local Pattern Lab upload reports still describe the current media files.

This script never mutates YouTube. It compares private/unlisted upload reports to
local media files. New upload reports include SHA-256 hashes; legacy reports are
accepted only when the reported upload time is newer than the current local file
mtime, and the report records that lower-confidence fallback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def resolve_reported_path(value: str) -> Path:
    path = Path(value or "")
    if path.is_absolute():
        return path
    return BASE / path


def report_path(root: Path, short_index: int | None) -> Path:
    if short_index is None:
        return root / "approval" / "youtube-upload-report.json"
    return root / "approval" / f"youtube-upload-report-short-{short_index:02d}.json"


def build_row(root: Path, label: str, short_index: int | None) -> dict[str, Any]:
    report = read_json(report_path(root, short_index))
    blockers: list[str] = []
    warnings: list[str] = []
    if report.get("status") != "uploaded":
        blockers.append("upload_report_missing_or_not_uploaded")
    local_path = resolve_reported_path(report.get("video_file", ""))
    if not report.get("video_file") or not local_path.exists():
        blockers.append("reported_local_media_missing")
        local_sha = ""
        local_mtime = 0.0
        local_size = 0
    else:
        local_sha = sha256(local_path)
        stat = local_path.stat()
        local_mtime = stat.st_mtime
        local_size = stat.st_size
    expected_sha = report.get("video_file_sha256", "")
    uploaded_at = parse_time(report.get("uploaded_at") or report.get("generated_at"))
    if expected_sha:
        if local_sha and local_sha != expected_sha:
            blockers.append("local_media_hash_differs_from_uploaded_report")
        currency_status = "sha256_verified" if not blockers else "blocked"
    else:
        if uploaded_at and local_mtime and uploaded_at.timestamp() >= local_mtime:
            warnings.append("legacy_upload_report_has_no_sha256; accepted because upload time is newer than local media mtime")
            currency_status = "legacy_mtime_verified"
        else:
            blockers.append("legacy_upload_report_cannot_prove_current_media_was_uploaded")
            currency_status = "blocked"
    return {
        "surface": label,
        "short_index": short_index,
        "status": "pass" if not blockers else "blocked",
        "currency_status": currency_status,
        "youtube_video_id": report.get("youtube_video_id", ""),
        "youtube_url": report.get("youtube_url", ""),
        "upload_report": display_path(report_path(root, short_index)),
        "video_file": report.get("video_file", ""),
        "local_file_exists": local_path.exists() if report.get("video_file") else False,
        "local_file_sha256": local_sha,
        "reported_video_file_sha256": expected_sha,
        "local_file_size": local_size,
        "local_file_mtime": local_mtime,
        "uploaded_at": report.get("uploaded_at", ""),
        "blockers": blockers,
        "warnings": warnings,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    rows = [build_row(root, "long-form", None)]
    rows.extend(build_row(root, f"short-{index:02d}", index) for index in [1, 2, 3])
    blockers = [f"{row['surface']}:{blocker}" for row in rows for blocker in row["blockers"]]
    warnings = [f"{row['surface']}:{warning}" for row in rows for warning in row["warnings"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "rows": rows,
        "blockers": blockers,
        "warnings": warnings,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "upload-currency-report.json"
    md_path = approval / "upload-currency-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Upload Currency: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "YouTube mutation: not performed",
        "",
        "## Media Currency",
        "",
    ]
    for row in rows:
        lines.append(f"- {row['surface']}: {row['currency_status']} `{row['youtube_video_id']}` file=`{row['video_file']}`")
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Pattern Lab upload report currency. Never mutates YouTube.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Upload currency report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
