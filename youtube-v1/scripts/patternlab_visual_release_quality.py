#!/usr/bin/env python3
"""Aggregate only hash-bound visual proof required before owner review."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now


REQUIRED = {
    "canonical_preflight": "canonical-preflight-report.json",
    "canonical_render_plan": "canonical-render-plan.json",
    "render_quality": "render-quality-report.json",
    "visual_judge": "visual-judge-report.json",
    "evidence_binding": "evidence-manifest-binding.json",
}


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    checks = []
    for name, filename in REQUIRED.items():
        payload = read_json(approval / filename)
        expected = "pass"
        actual = payload.get("status", "missing")
        checks.append({"name": name, "path": display_path(approval / filename), "status": actual, "passed": actual == expected})
    blockers = [f"{item['name']}:{item['status']}" for item in checks if not item["passed"]]
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "checks": checks, "blockers": blockers, "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-release-quality-report.json"
    md_path = approval / "visual-release-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Visual Release Quality: Video {video_id}", "", f"Status: {payload['status']}", "", "## Checks", "",
        *[f"- {item['name']}: {'pass' if item['passed'] else 'fail'} ({item['status']})" for item in checks],
        "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Check Pattern Lab visual release proof.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
