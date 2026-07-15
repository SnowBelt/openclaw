#!/usr/bin/env python3
"""Verify that the selected profile produced every owner-review asset."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.visual_system import package_counts
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


POLICY_PATH = BASE / "resources" / "patternlab-visual-system-policy.json"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def build_report(video_id: str, profile: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH).get("package", {})
    required = policy.get("full_package_required_assets", {}) if profile == "full_package" else {"long_form": 1, "closed_caption_files": 1}
    counts = package_counts(root, video_id)
    blockers: list[str] = []
    for name, floor in required.items():
        if name.endswith("_maximum"):
            metric = name.removesuffix("_maximum")
            if counts.get(metric, 0) > int(floor):
                blockers.append(f"package_asset_above_ceiling:{metric}:{counts.get(metric, 0)}/{floor}")
            continue
        if counts.get(name, 0) < int(floor):
            blockers.append(f"package_asset_below_floor:{name}:{counts.get(name, 0)}/{floor}")
    if profile == "full_package":
        for report_name in (
            "media-qa-report.json",
            "shorts-quality-report.json",
            "thumbnail-quality-report.json",
            "package-hash-report.json",
        ):
            report = read_json(approval / report_name)
            if report.get("status") != "pass" or report.get("blockers") or report.get("warnings"):
                blockers.append(f"package_required_report_not_pass:{report_name}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "profile": profile,
        "status": "pass" if not blockers else "blocked",
        "counts": counts,
        "required": required,
        "excluded_by_profile": ["shorts", "thumbnail_candidates"] if profile == "long_form_rebuild" else [],
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "package-completeness-report.json"
    md_path = approval / "package-completeness-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Package Completeness: Video {video_id}",
                "",
                f"Profile: {profile}",
                f"Status: {payload['status']}",
                "",
                *[f"- {name}: {value}" for name, value in counts.items()],
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
    parser = argparse.ArgumentParser(description="Validate Pattern Lab package completeness.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--profile", choices=["long_form_rebuild", "full_package"], required=True)
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), args.profile)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
