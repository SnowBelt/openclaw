#!/usr/bin/env python3
import argparse
import json
import tempfile
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_discord_feedback import append_owner_feedback, owner_feedback_event, read_jsonl, validate_reason, validate_repair_scope

REQUIRED_FIELDS = [
    "event_id",
    "created_at",
    "video_id",
    "asset_type",
    "asset_id",
    "filename",
    "action",
    "reason",
    "repair_scope",
    "sentiment",
    "source",
    "freeform_note",
    "timestamp_start",
    "timestamp_end",
]
SENTIMENTS = {"positive", "negative", "gate"}


def validate_event(event):
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in event:
            errors.append(f"missing field {field}")
    if event.get("sentiment") not in SENTIMENTS:
        errors.append(f"invalid sentiment {event.get('sentiment')}")
    try:
        validate_reason(event.get("action", ""), event.get("asset_type", ""), event.get("reason", ""), event.get("freeform_note", ""))
    except Exception as exc:
        errors.append(str(exc))
    try:
        validate_repair_scope(event.get("repair_scope", ""))
    except Exception as exc:
        errors.append(str(exc))
    if any(marker in json.dumps(event) for marker in ["access_token", "refresh_token", "client_secret", "Bearer "]):
        errors.append("event contains sensitive marker")
    return errors


def build_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    path = approval / "owner-feedback.jsonl"
    path.touch(exist_ok=True)
    events = read_jsonl(path)
    invalid = []
    for index, event in enumerate(events, start=1):
        errors = validate_event(event)
        if errors:
            invalid.append({"line": index, "errors": errors, "event_id": event.get("event_id", "")})
    isolated_append_errors = []
    with tempfile.TemporaryDirectory(prefix="patternlab-owner-feedback-") as tmp:
        tmp_root = Path(tmp)
        sample = owner_feedback_event(
            "sample",
            "reject",
            asset_type="short",
            asset_id="video-sample-short-02",
            reason="random_text_box",
            repair_scope="this_short_only",
        )
        sample_file = append_owner_feedback(tmp_root, sample)
        sample_events = read_jsonl(sample_file)
        if len(sample_events) != 1:
            isolated_append_errors.append("isolated append did not write exactly one event")
        else:
            isolated_append_errors.extend(validate_event(sample_events[0]))
    warnings = []
    if not events:
        warnings.append("real_owner_feedback_events_missing: dry-run feedback validation passes, but owner-learning is not active until Discord records real owner feedback.")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not invalid and not isolated_append_errors else "blocked",
        "feedback_file": display_path(path) if path.exists() else "missing",
        "event_count": len(events),
        "owner_learning_state": "active" if events else "validated_but_no_real_owner_events",
        "warnings": warnings,
        "invalid_events": invalid,
        "isolated_non_dry_run_append_test": "pass" if not isolated_append_errors else "blocked",
        "isolated_non_dry_run_append_errors": isolated_append_errors,
        "required_fields": REQUIRED_FIELDS,
        "blockers": ([f"Invalid owner-feedback events: {len(invalid)}"] if invalid else [])
        + ([f"Isolated non-dry-run append test failed: {len(isolated_append_errors)} errors"] if isolated_append_errors else []),
    }
    json_path = approval / "owner-feedback-quality-report.json"
    md_path = approval / "owner-feedback-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Owner Feedback Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Events: {payload['event_count']}",
        f"Owner learning state: {payload['owner_learning_state']}",
        f"Isolated non-dry-run append test: {payload['isolated_non_dry_run_append_test']}",
        "",
        "## Warnings",
        "",
    ]
    lines.extend([f"- {item}" for item in payload["warnings"]] or ["- none"])
    lines.extend([
        "",
        "## Blockers",
        "",
    ])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab owner feedback log.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Owner feedback quality report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
