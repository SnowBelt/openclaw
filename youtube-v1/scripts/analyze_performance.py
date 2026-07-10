#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now


def read_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def number(row, key):
    raw = (row.get(key) or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def count_signal(row, key):
    value = number(row, key)
    return value or 0


def is_public_pending_metrics(row):
    return bool((row.get("publish_url") or "").strip())


def is_api_partial_manual_needed(row):
    status = (row.get("metrics_import_status") or "").strip()
    source = (row.get("metrics_source") or "").strip()
    has_api_metrics = any(number(row, key) is not None for key in (
        "views",
        "average_view_duration_seconds",
        "average_percentage_viewed",
        "watch_hours",
    ))
    return status in {"api_imported", "api_partial_manual_studio_needed"} or (
        source == "YouTube Analytics API" and has_api_metrics
    )


def decide_long_form(row):
    ctr = number(row, "ctr_percent")
    avg = number(row, "average_percentage_viewed")
    retention = number(row, "retention_30s_percent")
    subs = number(row, "subscribers_gained")
    if ctr is None or avg is None or retention is None:
        if is_api_partial_manual_needed(row):
            return (
                "api_partial_manual_studio_needed",
                "Import YouTube Studio CTR/impressions and unsupported Shorts bridge metrics before the final packaging decision.",
            )
        if is_public_pending_metrics(row):
            return "pending_public_metrics", "Import the scheduled YouTube Studio export before making a performance decision."
        return "pending_publish", "Record CTR, average viewed, first 30s retention, city requests, source disputes, and subscriber conversion."
    if count_signal(row, "source_disputes") > 0 or count_signal(row, "geography_confusion") > 2:
        return "improve_visual_pacing", "Audit disputed source/geography comments before scaling the topic."
    if count_signal(row, "city_requests") >= 5 or count_signal(row, "source_suggestions") >= 3:
        return "expand_into_series", "Audience is asking for adjacent city files or better source depth."
    if ctr < 4 and avg >= 35:
        return "repackage", "Topic held attention, but the title-thumbnail promise is weak."
    if ctr >= 4 and retention < 55:
        return "revise_hook", "Packaging earned the click, but the opening did not hold enough viewers."
    subscriber_conversion = number(row, "subscriber_conversion_per_1000_views")
    if avg >= 45 and retention >= 65 and ((subs or 0) > 0 or (subscriber_conversion or 0) >= 2):
        return "double_down", "Retention and subscriber conversion justify an adjacent source-backed city file."
    if avg < 30:
        return "retire_topic", "Low retention suggests the topic or structure did not earn watch time."
    return "improve_visual_pacing", "Middle-ground performance; improve pacing and proof density before scaling."


def decide_short(row):
    viewed = number(row, "shorts_viewed_percent")
    related = number(row, "related_video_clicks")
    if viewed is None:
        if is_api_partial_manual_needed(row):
            return (
                "api_partial_manual_studio_needed",
                "Import YouTube Studio Shorts viewed-versus-swiped and related-video bridge metrics before judging the hook.",
            )
        if is_public_pending_metrics(row):
            return "pending_public_metrics", "Import the scheduled Shorts analytics export before judging the hook or bridge."
        return "pending_publish", "Record viewed-versus-swiped data."
    if viewed < 65:
        return "revise_hook", "First frame or first sentence is not strong enough."
    if related is not None and related > 0:
        if count_signal(row, "city_requests") >= 3:
            return "spin_off_city_series", "Short is converting and comments are requesting additional city files."
        return "double_down", "Short is converting some viewers toward long-form."
    return "improve_visual_pacing", "Viewed rate is acceptable; strengthen bridge to the long-form video."


def main():
    parser = argparse.ArgumentParser(description="Analyze Pattern Lab performance metrics.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    metrics = root / "metrics" / f"video-{args.video_id}-performance.csv"
    rows = read_rows(metrics)
    if not rows:
        raise SystemExit(f"Missing metrics rows: {display_path(metrics)}")

    decisions = []
    seen_keys = set()
    for row in rows:
        key = (row.get("video_id", ""), row.get("surface", ""), row.get("hours_since_publish", ""))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        if row.get("surface") == "short":
            label, next_action = decide_short(row)
        else:
            label, next_action = decide_long_form(row)
        decisions.append((row, label, next_action))

    report = ensure_dir(root / "metrics") / f"video-{args.video_id}-learning-report.md"
    lines = [
        f"# Pattern Lab Learning Report: Video {args.video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        "## Decisions",
        "",
    ]
    for row, label, next_action in decisions:
        lines.extend(
            [
                f"### {row.get('video_id', '')} ({row.get('surface', '')})",
                "",
                f"- Decision label: {label}",
                f"- Next action: {next_action}",
                f"- CTR: {row.get('ctr_percent') or 'pending'}",
                f"- Average viewed: {row.get('average_percentage_viewed') or 'pending'}",
                f"- First 30s retention: {row.get('retention_30s_percent') or 'pending'}",
                f"- Shorts viewed: {row.get('shorts_viewed_percent') or 'pending'}",
                f"- Related clicks: {row.get('related_video_clicks') or 'pending'}",
                "",
            ]
        )
    report.write_text("\n".join(lines), encoding="utf-8")
    json_report = ensure_dir(root / "metrics") / f"video-{args.video_id}-learning-report.json"
    json_report.write_text(
        json.dumps(
            {
                "generated_at": utc_now(),
                "video_id": args.video_id,
                "status": "analyzed",
                "source_row_count": len(rows),
                "deduped_decision_count": len(decisions),
                "decisions": [
                    {
                        "video_id": row.get("video_id", ""),
                        "surface": row.get("surface", ""),
                        "decision_label": label,
                        "next_action": next_action,
                        "city_requests": row.get("city_requests", ""),
                        "local_corrections": row.get("local_corrections", ""),
                        "source_suggestions": row.get("source_suggestions", ""),
                        "source_disputes": row.get("source_disputes", ""),
                    }
                    for row, label, next_action in decisions
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Learning report: {display_path(report)}")
    print(f"Learning JSON: {display_path(json_report)}")
    for _, label, next_action in decisions:
        print(f"{label}: {next_action}")


if __name__ == "__main__":
    main()
