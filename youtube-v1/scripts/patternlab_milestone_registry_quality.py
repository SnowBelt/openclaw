#!/usr/bin/env python3
"""Fail closed when the durable Pattern Lab milestone registry contradicts itself."""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

HEADING = re.compile(
    r"^#{2,3} (?:(Transcript/Viral) )?Milestone ([^ —\n]+) —", re.MULTILINE
)
EXPIRED_TIMING = re.compile(r"timing-blocked until `([^`]+)`", re.IGNORECASE)


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    registry = BASE / "production-grade-milestones.md"
    text = registry.read_text(encoding="utf-8") if registry.exists() else ""
    matches = HEADING.findall(text)
    ids = [f"{prefix + ' ' if prefix else ''}{identifier}" for prefix, identifier in matches]
    duplicates = sorted(key for key, count in Counter(ids).items() if count > 1)
    expired = []
    now = datetime.now(timezone.utc)
    for match in EXPIRED_TIMING.finditer(text):
        try:
            until = datetime.fromisoformat(match.group(1).replace("Z", "+00:00"))
        except ValueError:
            expired.append(match.group(1))
            continue
        if until < now:
            expired.append(match.group(1))
    blockers = []
    if not registry.exists():
        blockers.append("milestone_registry_missing")
    if duplicates:
        blockers.append(f"duplicate_milestone_ids:{','.join(duplicates)}")
    if expired:
        blockers.append(f"expired_timing_blockers:{','.join(expired)}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "registry": display_path(registry),
        "milestone_count": len(ids),
        "standard_milestone_count": sum(1 for prefix, _identifier in matches if not prefix),
        "transcript_viral_milestone_count": sum(1 for prefix, _identifier in matches if prefix),
        "duplicate_ids": duplicates,
        "expired_timing_blockers": expired,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    approval = ensure_dir(output_root(video_id) / "approval")
    json_path = approval / "milestone-registry-quality-report.json"
    md_path = approval / "milestone-registry-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Milestone Registry Quality: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Milestones: {payload['milestone_count']}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in blockers] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
