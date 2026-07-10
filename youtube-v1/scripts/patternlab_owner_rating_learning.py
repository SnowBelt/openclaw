#!/usr/bin/env python3
"""Validate Pattern Lab owner rating memory and hard-block rules."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

MEMORY_PATH = BASE / "resources" / "thumbnail-owner-rating-memory.json"
REQUIRED_RULE_SUBSTRINGS = [
    "city name required",
    "real source-backed",
    "weak topics",
    "random arrows",
    "fonts",
    "mysterious",
    "A/B tests",
    "vivid colors",
    "bare redaction",
    "source photo",
    "bland thumbnails",
]
REQUIRED_REJECT_REASONS = {
    "city_missing",
    "weak_topic",
    "generic_photo",
    "random_arrow",
    "unexplained_line",
    "decorative_black_box",
    "unreadable_text",
    "fake_proof",
    "font_not_premium",
    "same_template_reused_for_unique_topic_set",
    "bare_redaction_blocks",
    "source_photo_filler_label",
    "receipt_filler_label",
    "source_file_filler_label",
    "bland_color_palette",
    "generic_font",
    "not_click_worthy",
    "weak_image_energy",
}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def build_owner_rating_learning_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    memory = read_json(MEMORY_PATH)
    owner_rules = [str(item) for item in memory.get("owner_rules", []) if isinstance(item, str)]
    reject_reasons = set(str(item) for item in memory.get("hard_reject_reasons", []) if isinstance(item, str))
    rules_text = "\n".join(owner_rules).lower()
    missing_rule_phrases = [item for item in REQUIRED_RULE_SUBSTRINGS if item.lower() not in rules_text]
    missing_reject_reasons = sorted(REQUIRED_REJECT_REASONS - reject_reasons)
    liked_formats = memory.get("liked_formats", []) if isinstance(memory.get("liked_formats"), list) else []
    blockers = []
    if missing_rule_phrases:
        blockers.append("missing_owner_rule_phrases:" + ",".join(missing_rule_phrases))
    if missing_reject_reasons:
        blockers.append("missing_reject_reasons:" + ",".join(missing_reject_reasons))
    if len(liked_formats) < 3:
        blockers.append("liked_format_library_too_small")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "owner_rating_learning_v3_status": "pass" if not blockers else "blocked",
        "owner_memory_file": display_path(MEMORY_PATH),
        "owner_rule_count": len(owner_rules),
        "liked_format_count": len(liked_formats),
        "hard_reject_reason_count": len(reject_reasons),
        "missing_rule_phrases": missing_rule_phrases,
        "missing_reject_reasons": missing_reject_reasons,
        "liked_formats": liked_formats,
        "blockers": blockers,
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
    }
    json_report = approval / "thumbnail-owner-rating-learning-report.json"
    md_report = approval / "thumbnail-owner-rating-learning-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Owner Rating Learning V3: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Owner rules: {payload['owner_rule_count']}",
        f"Liked formats: {payload['liked_format_count']}",
        f"Reject reasons: {payload['hard_reject_reason_count']}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or ["- none"]),
    ]
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab owner thumbnail rating memory.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_owner_rating_learning_report(args.video_id)
    print(json.dumps({"status": payload["status"], "owner_rating_learning_v3_status": payload["owner_rating_learning_v3_status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
