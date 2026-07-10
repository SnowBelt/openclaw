#!/usr/bin/env python3
"""Verify that the top-level Pattern Lab status is fail-closed and explainable."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, output_root
from patternlab_status import MANDATORY_REPORTS, read_json, readiness_status


def build_report(video_id: str) -> tuple[dict, Path]:
    approval = output_root(video_id) / "approval"
    status_payload = read_json(approval / "patternlab-status.json")
    package_hash = read_json(approval / "package-hash-report.json")
    checks = []
    blockers = []
    for name in MANDATORY_REPORTS:
        status, path = readiness_status(approval, name)
        checks.append({"name": name, "status": status, "path": path})
        if status != "pass":
            blockers.append(f"{name}:{status}")
    if package_hash.get("stale_outputs") or package_hash.get("blockers"):
        if not any(item.startswith("package_hash:") for item in blockers):
            blockers.append("package_hash:blocked")
    expected = "blocked" if blockers else "pass"
    actual = status_payload.get("status", "missing")
    status = "pass" if actual == expected else "blocked"
    payload = {
        "video_id": video_id,
        "status": status,
        "expected_top_level_status": expected,
        "actual_top_level_status": actual,
        "checks": checks,
        "blockers": blockers if actual != expected else [],
        "youtube_mutation": "not_performed",
    }
    path = approval / "patternlab-status-consistency-report.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, path = build_report(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Consistency report: {display_path(path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
