#!/usr/bin/env python3
import argparse
import json
from collections import Counter, defaultdict

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_discord_feedback import read_jsonl, summarize_events, unresolved_repairs


def build_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    feedback = read_jsonl(approval / "owner-feedback.jsonl")
    review_actions = read_jsonl(approval / "review-actions.jsonl")
    repairs = read_jsonl(approval / "repair-queue.jsonl")
    open_repairs = unresolved_repairs(root)
    negative = [event for event in feedback if event.get("sentiment") == "negative"]
    positive = [event for event in feedback if event.get("sentiment") == "positive"]
    by_asset_failure = Counter(event.get("asset_type", "missing") for event in negative)
    by_reason_failure = Counter(event.get("reason", "missing") for event in negative)
    short_failures = Counter(event.get("reason", "missing") for event in negative if event.get("asset_type") == "short")
    thumbnail_signals = Counter(event.get("reason", "missing") for event in feedback if event.get("asset_type") == "thumbnail")
    approved_styles = Counter(event.get("reason", "missing") for event in positive)
    next_defaults = []
    if by_reason_failure.get("random_text_box"):
        next_defaults.append("Run stray overlay/text-box checks before owner review.")
    if by_reason_failure.get("starts_mid_sentence"):
        next_defaults.append("Require sentence-boundary validation for every Short before render.")
    if by_reason_failure.get("visuals_mismatch"):
        next_defaults.append("Tighten narration-to-visual beat matching before edit lock.")
    if by_reason_failure.get("bad_font_color"):
        next_defaults.append("Avoid rejected font/color combinations in future thumbnails and Shorts captions.")
    if approved_styles.get("use_this_style_more"):
        next_defaults.append("Prefer the approved Short style in the next package.")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass",
        "feedback_summary": summarize_events(feedback),
        "owner_learning_state": "active" if feedback else "validated_but_no_real_owner_events",
        "warnings": [] if feedback else ["No real Discord owner feedback events have been captured yet."],
        "review_action_count": len(review_actions),
        "repair_queue_count": len(repairs),
        "open_unresolved_repair_count": len(open_repairs),
        "repeated_rejection_patterns": by_reason_failure.most_common(),
        "approved_styles_to_repeat": approved_styles.most_common(),
        "asset_level_failure_rate": by_asset_failure.most_common(),
        "short_specific_failure_reasons": short_failures.most_common(),
        "thumbnail_taste_signals": thumbnail_signals.most_common(),
        "next_production_defaults": next_defaults,
        "open_unresolved_repair_items": open_repairs,
        "blockers": [],
    }
    json_path = approval / "owner-feedback-learning-report.json"
    md_path = approval / "owner-feedback-learning-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Owner Feedback Learning: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Owner learning state: {payload['owner_learning_state']}",
        "",
        "## Warnings",
        "",
    ]
    lines.extend([f"- {item}" for item in payload["warnings"]] or ["- none"])
    lines.extend([
        "",
        "## Repeated Rejection Patterns",
        "",
    ])
    lines.extend([f"- {reason}: {count}" for reason, count in payload["repeated_rejection_patterns"]] or ["- none"])
    lines.extend(["", "## Approved Styles To Repeat", ""])
    lines.extend([f"- {reason}: {count}" for reason, count in payload["approved_styles_to_repeat"]] or ["- none"])
    lines.extend(["", "## Asset-Level Failure Rate", ""])
    lines.extend([f"- {asset}: {count}" for asset, count in payload["asset_level_failure_rate"]] or ["- none"])
    lines.extend(["", "## Short-Specific Failure Reasons", ""])
    lines.extend([f"- {reason}: {count}" for reason, count in payload["short_specific_failure_reasons"]] or ["- none"])
    lines.extend(["", "## Thumbnail Taste Signals", ""])
    lines.extend([f"- {reason}: {count}" for reason, count in payload["thumbnail_taste_signals"]] or ["- none"])
    lines.extend(["", "## Next Production Defaults", ""])
    lines.extend([f"- {item}" for item in next_defaults] or ["- none yet"])
    lines.extend(["", "## Open Unresolved Repair Items", ""])
    lines.extend([f"- {item.get('asset_type','')} {item.get('asset_id','')} {item.get('reason','')} scope={item.get('repair_scope','')} status={item.get('status','queued')}" for item in open_repairs] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Build Pattern Lab owner feedback learning report.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Owner feedback learning report: {display_path(md_path)}")


if __name__ == "__main__":
    main()
