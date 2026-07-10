#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_legacy import is_legacy_video_id

STATE_JSON = BASE / "state" / "monetization" / "profit-analytics.json"
STATE_MD = BASE / "state" / "monetization" / "profit-analytics.md"


def read_rows(video_id):
    path = output_root(video_id) / "metrics" / f"video-{video_id}-performance.csv"
    if not path.exists():
        return path, []
    with path.open(encoding="utf-8", newline="") as handle:
        return path, list(csv.DictReader(handle))


def num(row, key):
    raw = (row.get(key) or "").strip()
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def pending(value):
    if value in (None, ""):
        return "pending"
    return value


def discovered_video_ids():
    ids = set()
    for parent in [BASE / "launch", BASE / "local-output"]:
        if not parent.exists():
            continue
        for path in parent.glob("video-*"):
            suffix = path.name.removeprefix("video-")
            if suffix.isdigit() and not is_legacy_video_id(suffix):
                ids.add(suffix.zfill(2))
    return sorted(ids)


def row_watch_hours(row):
    explicit = num(row, "watch_hours")
    if explicit:
        return explicit
    return round((num(row, "views") * num(row, "average_view_duration_seconds")) / 3600, 4)


def summarize_rows(video_id, rows):
    long_form = next((r for r in rows if r.get("surface") == "long-form"), rows[0] if rows else {})
    shorts = [r for r in rows if r.get("surface") == "short"]
    views = sum(num(r, "views") for r in rows)
    long_views = num(long_form, "views")
    subs = sum(num(r, "subscribers_gained") for r in rows)
    subscriber_conversion = num(long_form, "subscriber_conversion_per_1000_views")
    if not subscriber_conversion and views:
        subscriber_conversion = round((subs / views) * 1000, 2)
    revenue = sum(num(r, "estimated_revenue_usd") for r in rows)
    watch_hours = sum(row_watch_hours(r) for r in rows if r.get("surface") == "long-form")
    related_clicks = sum(num(r, "related_video_clicks") for r in shorts)
    total_short_views = sum(num(r, "views") for r in shorts)
    shorts_to_long_rate = round((related_clicks / total_short_views) * 100, 2) if total_short_views else 0.0
    city_requests = sum(num(r, "city_requests") for r in rows)
    local_corrections = sum(num(r, "local_corrections") for r in rows)
    source_suggestions = sum(num(r, "source_suggestions") for r in rows)
    source_disputes = sum(num(r, "source_disputes") for r in rows)
    return {
        "video_id": video_id,
        "status": "pending_public_metrics" if not views else "tracking",
        "profit": {
            "estimated_revenue_usd": round(revenue, 2),
            "rpm_usd": pending(long_form.get("rpm_usd") or ""),
            "watch_hours": round(watch_hours, 2),
            "subscriber_conversion_per_1000_views": pending(subscriber_conversion or ""),
        },
        "retention": {
            "ctr_percent": pending(long_form.get("ctr_percent") or ""),
            "average_view_duration_seconds": pending(long_form.get("average_view_duration_seconds") or ""),
            "average_percentage_viewed": pending(long_form.get("average_percentage_viewed") or ""),
            "retention_30s_percent": pending(long_form.get("retention_30s_percent") or ""),
        },
        "thumbnail_test": {
            "family": long_form.get("thumbnail_family") or "pending",
            "candidate_role": long_form.get("thumbnail_candidate_role") or "pending",
            "title_thumbnail_promise": long_form.get("title_thumbnail_promise") or "pending",
            "youtube_ab_test_status": long_form.get("youtube_ab_test_status") or "pending",
            "watch_time_share_winner": long_form.get("watch_time_share_winner") or "pending",
            "browse_ctr_percent": pending(long_form.get("browse_ctr_percent") or ""),
            "suggested_ctr_percent": pending(long_form.get("suggested_ctr_percent") or ""),
            "search_ctr_percent": pending(long_form.get("search_ctr_percent") or ""),
        },
        "audience_signals": {
            "city_requests": int(city_requests),
            "local_corrections": int(local_corrections),
            "source_suggestions": int(source_suggestions),
            "source_disputes": int(source_disputes),
            "nostalgia_or_local_emotion": pending(long_form.get("nostalgia_or_local_emotion") or ""),
            "geography_confusion": pending(long_form.get("geography_confusion") or ""),
            "expectation_mismatch_comments": pending(long_form.get("expectation_mismatch_comments") or ""),
        },
        "shorts_to_long": {
            "related_video_clicks": int(related_clicks),
            "shorts_to_long_click_rate_percent": shorts_to_long_rate,
        },
        "media_quality": {
            "tags": long_form.get("media_quality_tags") or "pending",
            "sponsor_fit": long_form.get("sponsor_fit") or "pending",
        },
    }


def write_reports(video_id, payload):
    out = ensure_dir(output_root(video_id) / "metrics")
    video_json = out / f"video-{video_id}-profit-analytics.json"
    video_md = out / f"video-{video_id}-profit-analytics.md"
    ensure_dir(STATE_JSON.parent)
    for path in [video_json, STATE_JSON]:
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Profit Analytics: Video {video_id}", "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}", "",
        "## Profit And Watch Hours", "",
        f"- Estimated revenue: ${payload['profit']['estimated_revenue_usd']}",
        f"- RPM: {payload['profit']['rpm_usd']}",
        f"- Watch hours: {payload['profit']['watch_hours']}",
        f"- Subscribers per 1,000 views: {payload['profit']['subscriber_conversion_per_1000_views']}", "",
        "## Thumbnail Test", "",
        f"- Family: {payload['thumbnail_test']['family']}",
        f"- Candidate role: {payload['thumbnail_test']['candidate_role']}",
        f"- A/B status: {payload['thumbnail_test']['youtube_ab_test_status']}",
        f"- Watch-time winner: {payload['thumbnail_test']['watch_time_share_winner']}", "",
        "## Audience Signals", "",
        f"- City requests: {payload['audience_signals']['city_requests']}",
        f"- Local corrections: {payload['audience_signals']['local_corrections']}",
        f"- Source suggestions: {payload['audience_signals']['source_suggestions']}",
        f"- Source disputes: {payload['audience_signals']['source_disputes']}", "",
        "## Media Quality", "",
        f"- Tags: {payload['media_quality']['tags']}",
        f"- Sponsor fit: {payload['media_quality']['sponsor_fit']}", "",
    ]
    for path in [video_md, STATE_MD]:
        path.write_text("\n".join(lines), encoding="utf-8")
    return video_json, video_md


def build_profit_analytics(video_id="03"):
    metrics_path, rows = read_rows(video_id)
    if not rows:
        raise SystemExit(f"Missing metrics rows: {display_path(metrics_path)}")
    payload = summarize_rows(video_id, rows)
    payload.update({
        "generated_at": utc_now(),
        "metrics_path": display_path(metrics_path),
        "required_import_source": "YouTube Analytics API first read plus YouTube Studio/manual CSV for unsupported CTR, Shorts bridge, and revenue metrics.",
        "legacy_excluded": True,
    })
    write_reports(video_id, payload)
    return payload


def build_channel_profit_analytics(active_video_id="03"):
    active = build_profit_analytics(active_video_id)
    videos = []
    for video_id in discovered_video_ids():
        path, rows = read_rows(video_id)
        if rows:
            item = summarize_rows(video_id, rows)
            item["metrics_path"] = display_path(path)
            videos.append(item)
    channel = {**active, "channel_videos": videos, "active_video_id": active_video_id}
    STATE_JSON.write_text(json.dumps(channel, indent=2) + "\n", encoding="utf-8")
    return channel


def main():
    parser = argparse.ArgumentParser(description="Build Pattern Lab profit and analytics reports from local metric imports.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload = build_channel_profit_analytics(args.video_id)
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(f"Status: {payload['status']}")
        print(f"Profit analytics report: {display_path(output_root(args.video_id) / 'metrics' / f'video-{args.video_id}-profit-analytics.md')}")


if __name__ == "__main__":
    main()
