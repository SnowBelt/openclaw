#!/usr/bin/env python3
"""Create local Pattern Lab performance-learning checkpoint scaffolds."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now


CHECKPOINTS = [
    {"label": "24h", "hours_since_publish": 24, "purpose": "first-read packaging and hook validation"},
    {"label": "72h", "hours_since_publish": 72, "purpose": "early retention and title-thumbnail promise check"},
    {"label": "7d", "hours_since_publish": 168, "purpose": "week-one topic strength and traffic-source read"},
    {"label": "30d", "hours_since_publish": 720, "purpose": "durable learning loop and next-topic decision"},
]


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def build_performance_learning_scaffold(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    metrics = ensure_dir(root / "metrics")
    approval = ensure_dir(root / "approval")
    report_prefix = video_id if video_id.startswith("video-") else f"video-{video_id}"
    public_report = read_json(approval / "public-publish-report.json")
    analytics_blocker = read_json(metrics / f"{report_prefix}-youtube-analytics-readonly-blocker.json")
    analytics_24h = read_json(metrics / f"{report_prefix}-youtube-analytics-24h.json")
    oauth_available = analytics_24h.get("status") == "imported" or bool(public_report.get("published_videos"))
    checkpoint_rows = []
    for checkpoint in CHECKPOINTS:
        report_json = metrics / f"{report_prefix}-learning-{checkpoint['label']}.json"
        row = {
            **checkpoint,
            "status": "pending_live_analytics" if oauth_available else "blocked_oauth_or_publish_missing",
            "source_report": display_path(report_json),
            "required_metrics": [
                "views",
                "estimatedMinutesWatched",
                "averageViewDuration",
                "averageViewPercentage",
                "subscribersGained",
                "retention_30s_percent",
            ],
            "decision_outputs": [
                "double_down",
                "repackage",
                "revise_hook",
                "improve_visual_pacing",
                "retire_topic",
                "expand_into_series",
            ],
            "youtube_mutation": "not_performed",
        }
        report_json.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        checkpoint_rows.append(row)
    blockers: list[str] = []
    if not public_report:
        blockers.append("public_publish_report_missing; checkpoints remain local scaffold only")
    if analytics_blocker:
        blockers.append("youtube_analytics_readonly_blocker_present")
    if not oauth_available:
        blockers.append("youtube_analytics_oauth_or_public_video_unavailable")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass",
        "performance_learning_loop_scaffold_status": "pass",
        "live_analytics_status": "blocked" if blockers else "ready_for_import_when_due",
        "checkpoint_count": len(checkpoint_rows),
        "checkpoint_labels": [row["label"] for row in checkpoint_rows],
        "checkpoints": checkpoint_rows,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
        "public_publish": "not_performed",
        "thumbnail_replacement": "not_performed",
    }
    json_path = metrics / f"{report_prefix}-performance-learning-scaffold.json"
    md_path = metrics / f"{report_prefix}-performance-learning-scaffold.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Performance Learning Scaffold: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Live analytics: {payload['live_analytics_status']}",
        "YouTube mutation: not_performed",
        "",
        "## Checkpoints",
        "",
    ]
    for row in checkpoint_rows:
        lines.extend(
            [
                f"### {row['label']}",
                f"- Hours since publish: {row['hours_since_publish']}",
                f"- Purpose: {row['purpose']}",
                f"- Status: {row['status']}",
                f"- Report: {row['source_report']}",
                "",
            ]
        )
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab performance learning checkpoint scaffold.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, json_path, _md_path = build_performance_learning_scaffold(args.video_id)
    print(json.dumps({"status": payload["status"], "checkpoint_count": payload["checkpoint_count"], "report": display_path(json_path)}, indent=2))


if __name__ == "__main__":
    main()
