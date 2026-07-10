#!/usr/bin/env python3
import argparse
import csv
import json
from datetime import datetime, timedelta

from patternlab_common import display_path, ensure_dir, output_root, utc_now


CHECKPOINT_HOURS = [24, 72, 168, 720]
METRICS_SOURCE = "YouTube Studio export/manual import"
METRIC_FIELDS = [
    "recorded_at_utc",
    "video_id",
    "surface",
    "publish_url",
    "youtube_video_id",
    "published_at_utc",
    "checkpoint_due_at_utc",
    "metrics_import_status",
    "metrics_source",
    "title",
    "thumbnail_variant",
    "hours_since_publish",
    "views",
    "impressions",
    "ctr_percent",
    "average_view_duration_seconds",
    "average_percentage_viewed",
    "retention_30s_percent",
    "retention_50_percent",
    "subscribers_gained",
    "estimated_revenue_usd",
    "rpm_usd",
    "shorts_viewed_percent",
    "shorts_swiped_away_percent",
    "related_video_clicks",
    "comments_signal_summary",
    "decision_label",
    "next_action",
    "subscriber_conversion_per_1000_views",
    "returning_viewers",
    "browse_ctr_percent",
    "suggested_ctr_percent",
    "search_ctr_percent",
    "thumbnail_family",
    "thumbnail_candidate_role",
    "title_thumbnail_promise",
    "youtube_ab_test_status",
    "watch_time_share_winner",
    "expectation_mismatch_comments",
    "city_requests",
    "local_corrections",
    "source_suggestions",
    "nostalgia_or_local_emotion",
    "geography_confusion",
    "source_disputes",
    "sponsor_fit",
    "media_quality_tags",
    "watch_hours",
]
PRESERVE_FIELDS = {
    "views",
    "impressions",
    "ctr_percent",
    "average_view_duration_seconds",
    "average_percentage_viewed",
    "retention_30s_percent",
    "retention_50_percent",
    "subscribers_gained",
    "estimated_revenue_usd",
    "rpm_usd",
    "shorts_viewed_percent",
    "shorts_swiped_away_percent",
    "related_video_clicks",
    "subscriber_conversion_per_1000_views",
    "returning_viewers",
    "browse_ctr_percent",
    "suggested_ctr_percent",
    "search_ctr_percent",
    "watch_time_share_winner",
    "expectation_mismatch_comments",
    "city_requests",
    "local_corrections",
    "source_suggestions",
    "nostalgia_or_local_emotion",
    "geography_confusion",
    "source_disputes",
    "media_quality_tags",
    "watch_hours",
}


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def read_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def require_public_publish(root):
    report_path = root / "approval" / "public-publish-report.json"
    report = read_json(report_path)
    if not report:
        raise SystemExit(f"Missing public publish report: {display_path(report_path)}")
    if report.get("status") != "published":
        raise SystemExit(f"Public publish report is not published: {report.get('status')}")
    videos = report.get("published_videos", [])
    if len(videos) != 4:
        raise SystemExit(f"Public publish report must include four videos; found {len(videos)}.")
    for video in videos:
        if video.get("privacy_after") != "public":
            raise SystemExit(f"{video.get('label')} is not public in the publish report.")
        if video.get("title_unchanged") is not True:
            raise SystemExit(f"{video.get('label')} title changed during publish.")
        if not video.get("youtube_video_id") or not video.get("youtube_url"):
            raise SystemExit(f"{video.get('label')} is missing YouTube id or URL.")
    return report


def row_id(video_id, item):
    label = item.get("label", "")
    if label == "long-form":
        return video_id
    if label.startswith("short-"):
        return f"{video_id}-{label}"
    raise SystemExit(f"Unsupported public publish label: {label}")


def row_surface(item):
    return "long-form" if item.get("label") == "long-form" else "short"


def default_thumbnail_variant(item):
    return "A" if item.get("label") == "long-form" else item.get("label", "")


def default_thumbnail_family(item):
    return "THIS EXPLAINS DETROIT" if item.get("label") == "long-form" else "Pattern Lab Shorts"


def default_candidate_role(item):
    return "emotional mystery" if item.get("label") == "long-form" else "shorts bridge"


def existing_by_key(rows):
    return {
        (row.get("video_id", ""), str(row.get("hours_since_publish", ""))): row
        for row in rows
    }


def checkpoint_due(published_at, hours):
    return (published_at + timedelta(hours=hours)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def build_rows(video_id, report, old_rows):
    published_at_raw = report.get("generated_at") or utc_now()
    published_at = parse_utc(published_at_raw)
    old = existing_by_key(old_rows)
    rows = []
    for item in report["published_videos"]:
        current_id = row_id(video_id, item)
        surface = row_surface(item)
        for hours in CHECKPOINT_HOURS:
            prior = old.get((current_id, str(hours)), {})
            row = {
                "recorded_at_utc": prior.get("recorded_at_utc") or utc_now(),
                "video_id": current_id,
                "surface": surface,
                "publish_url": item["youtube_url"],
                "youtube_video_id": item["youtube_video_id"],
                "published_at_utc": published_at_raw,
                "checkpoint_due_at_utc": checkpoint_due(published_at, hours),
                "metrics_import_status": "pending_export",
                "metrics_source": METRICS_SOURCE,
                "title": item.get("title_after") or item.get("title_before") or prior.get("title", ""),
                "thumbnail_variant": prior.get("thumbnail_variant") or default_thumbnail_variant(item),
                "hours_since_publish": str(hours),
                "comments_signal_summary": f"Pending {hours}h YouTube Studio export after public publish.",
                "decision_label": "pending_public_metrics",
                "next_action": f"Import the {hours}h YouTube Studio metrics export and then rerun Pattern Lab analytics.",
                "thumbnail_family": prior.get("thumbnail_family") or default_thumbnail_family(item),
                "thumbnail_candidate_role": prior.get("thumbnail_candidate_role") or default_candidate_role(item),
                "title_thumbnail_promise": prior.get("title_thumbnail_promise")
                or "Detroit city-file promise: hidden system explained with sources",
                "youtube_ab_test_status": "pending_public_metrics",
                "sponsor_fit": prior.get("sponsor_fit") or "local history, travel, maps, education",
                "media_quality_tags": prior.get("media_quality_tags") or "historical-photo-ready;map-proof-ready;stock-broll-context-only",
            }
            for field in PRESERVE_FIELDS:
                if field not in row:
                    row[field] = prior.get(field, "")
            rows.append({field: row.get(field, "") for field in METRIC_FIELDS})
    return rows


def write_rows(path, rows):
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=METRIC_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def write_report(root, video_id, rows):
    report = ensure_dir(root / "metrics") / f"video-{video_id}-post-public-metrics-baseline.json"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "ready_for_public_metrics_import",
        "checkpoint_rows": len(rows),
        "video_ids": sorted({row["video_id"] for row in rows}),
        "checkpoint_hours": CHECKPOINT_HOURS,
        "metrics_import_status": "pending_export",
        "metrics_source": METRICS_SOURCE,
    }
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path = ensure_dir(root / "metrics") / f"video-{video_id}-post-public-metrics-baseline.md"
    lines = [
        f"# Pattern Lab Post-Public Metrics Baseline: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Rows: {payload['checkpoint_rows']}",
        f"Metrics source: {payload['metrics_source']}",
        "",
        "## Next Import",
        "",
        "- Import YouTube Studio metrics at 24h, 72h, 7d, and 30d.",
        "- Do not invent CTR, retention, revenue, or subscriber data.",
    ]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report, md_path


def main():
    parser = argparse.ArgumentParser(description="Create the Pattern Lab post-public metrics baseline.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = output_root(args.video_id)
    metrics = root / "metrics" / f"video-{args.video_id}-performance.csv"
    if args.dry_run:
        publish_report_path = root / "approval" / "public-publish-report.json"
        if not publish_report_path.exists():
            rows = read_rows(metrics)
            baseline_json, baseline_md = write_report(root, args.video_id, rows)
            payload = read_json(baseline_json) or {}
            payload["status"] = "pending_public_publish"
            payload["blockers"] = ["public_publish_report_missing"]
            payload["youtube_mutation"] = "not_performed"
            baseline_json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            print("Status: pending_public_publish")
            print(f"Metrics CSV: {display_path(metrics)}")
            print(f"Baseline JSON: {display_path(baseline_json)}")
            print(f"Baseline report: {display_path(baseline_md)}")
            return
    report = require_public_publish(root)
    rows = build_rows(args.video_id, report, read_rows(metrics))
    if not args.dry_run:
        write_rows(metrics, rows)
    baseline_json, baseline_md = write_report(root, args.video_id, rows)
    print(f"Post-public metrics rows: {len(rows)}")
    print(f"Metrics CSV: {display_path(metrics)}")
    print(f"Baseline JSON: {display_path(baseline_json)}")
    print(f"Baseline report: {display_path(baseline_md)}")


if __name__ == "__main__":
    main()
