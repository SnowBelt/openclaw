#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_legacy import is_legacy_video_id
from patternlab_profit_analytics import build_profit_analytics


STATE_PATH = BASE / "state" / "monetization" / "channel-progress.json"
REPORT_JSON = BASE / "state" / "monetization" / "ypp-progress.json"
REPORT_MD = BASE / "state" / "monetization" / "ypp-progress.md"
DEFAULT_PROGRESS = {
    "subscribers": 0,
    "valid_public_long_form_watch_hours_12m": 0,
    "valid_public_shorts_views_90d": 0,
    "public_uploads_90d": 0,
}


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def number(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def metric_rows(video_id):
    root = output_root(video_id)
    path = root / "metrics" / f"video-{video_id}-performance.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    by_key = {}
    order = []
    for row in rows:
        key = (
            row.get("youtube_video_id") or row.get("video_id") or "",
            row.get("surface") or "",
            str(row.get("hours_since_publish") or ""),
        )
        if not all(key):
            order.append(row)
            continue
        if key not in by_key:
            by_key[key] = dict(row)
            order.append(by_key[key])
        else:
            for field, value in row.items():
                if value not in {None, ""}:
                    by_key[key][field] = value
    return order


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


def aggregate_metrics():
    watch_hours = 0.0
    shorts_views = 0.0
    subscribers_gained = 0.0
    public_upload_urls = set()
    for video_id in discovered_video_ids():
        rows = metric_rows(video_id)
        if not rows:
            continue
        for row in rows:
            surface = row.get("surface", "")
            views = number(row.get("views"))
            avd = number(row.get("average_view_duration_seconds"))
            publish_url = (row.get("publish_url") or "").strip()
            if publish_url:
                public_upload_urls.add(publish_url)
            subscribers_gained += number(row.get("subscribers_gained"))
            if surface == "long-form":
                explicit_watch_hours = number(row.get("watch_hours"))
                watch_hours += explicit_watch_hours if explicit_watch_hours else (views * avd) / 3600
            elif surface == "short":
                shorts_views += views
    return {
        "subscribers": int(subscribers_gained),
        "valid_public_long_form_watch_hours_12m": round(watch_hours, 2),
        "valid_public_shorts_views_90d": int(shorts_views),
        "public_uploads_90d": len(public_upload_urls),
    }


def pct(value, target):
    if not target:
        return 0
    return round(min(100.0, (float(value) / float(target)) * 100), 1)


def build_tracker_report():
    strategy = read_json(BASE / "state" / "monetization" / "strategy.json", {})
    manual = {**DEFAULT_PROGRESS, **(read_json(STATE_PATH, {}) or {})}
    aggregate = aggregate_metrics()
    progress = {**manual}
    for key, value in aggregate.items():
        progress[key] = value
    paths = strategy.get("monetization_paths", {})
    primary = paths.get("primary", {})
    secondary = paths.get("secondary_shorts", {})
    early = paths.get("early_ypp_where_available", {})
    milestones = {
        "full_ads_long_form": {
            "subscribers": {"current": progress["subscribers"], "target": primary.get("subscribers", 1000)},
            "watch_hours": {
                "current": progress["valid_public_long_form_watch_hours_12m"],
                "target": primary.get("valid_public_long_form_watch_hours_12m", 4000),
            },
        },
        "full_ads_shorts": {
            "subscribers": {"current": progress["subscribers"], "target": secondary.get("subscribers", 1000)},
            "shorts_views": {
                "current": progress["valid_public_shorts_views_90d"],
                "target": secondary.get("valid_public_shorts_views_90d", 10000000),
            },
        },
        "early_ypp_where_available": {
            "subscribers": {"current": progress["subscribers"], "target": early.get("subscribers", 500)},
            "public_uploads_90d": {"current": progress["public_uploads_90d"], "target": early.get("public_uploads_90d", 3)},
            "watch_hours": {
                "current": progress["valid_public_long_form_watch_hours_12m"],
                "target": early.get("valid_public_long_form_watch_hours_12m", 3000),
            },
            "shorts_views": {
                "current": progress["valid_public_shorts_views_90d"],
                "target": early.get("valid_public_shorts_views_90d", 3000000),
            },
        },
    }
    profit = {}
    try:
        profit = build_profit_analytics("03")
    except Exception:
        profit = {}
    blockers = []
    if progress["public_uploads_90d"] == 0:
        blockers.append("No public uploads are recorded yet; private/unlisted uploads do not advance YPP thresholds.")
    if progress["valid_public_long_form_watch_hours_12m"] == 0:
        blockers.append("No valid public long-form watch hours recorded yet.")
    payload = {
        "generated_at": utc_now(),
        "status": "tracking" if blockers else "progressing",
        "progress_source": {
            "manual_state": display_path(STATE_PATH),
            "metrics_aggregate": "youtube-v1/local-output/*/metrics/*.csv",
        },
        "progress": progress,
        "milestones": milestones,
        "profit_analytics": {
            "status": profit.get("status", "missing"),
            "estimated_revenue_usd": profit.get("profit", {}).get("estimated_revenue_usd", 0),
            "rpm_usd": profit.get("profit", {}).get("rpm_usd", "pending"),
            "watch_hours": profit.get("profit", {}).get("watch_hours", 0),
            "subscriber_conversion_per_1000_views": profit.get("profit", {}).get("subscriber_conversion_per_1000_views", "pending"),
            "source_disputes": profit.get("audience_signals", {}).get("source_disputes", 0),
            "city_requests": profit.get("audience_signals", {}).get("city_requests", 0),
        },
        "blockers": blockers,
        "next_actions": [
            "Publish approved long-form videos publicly after private checks and owner approval.",
            "Use Shorts for subscriber acquisition and related-video clicks, not as the only monetization bet.",
            "Record YouTube Studio metrics at 24h, 72h, 7d, and 30d after every public upload.",
        ],
    }
    ensure_dir(REPORT_JSON.parent)
    REPORT_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab YPP Progress",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Progress",
        "",
        f"- Subscribers: {progress['subscribers']}",
        f"- Valid public long-form watch hours: {progress['valid_public_long_form_watch_hours_12m']}",
        f"- Valid public Shorts views: {progress['valid_public_shorts_views_90d']}",
        f"- Public uploads in 90 days: {progress['public_uploads_90d']}",
        f"- Estimated revenue: ${payload['profit_analytics']['estimated_revenue_usd']}",
        f"- RPM: {payload['profit_analytics']['rpm_usd']}",
        f"- Subscribers per 1,000 views: {payload['profit_analytics']['subscriber_conversion_per_1000_views']}",
        f"- City requests: {payload['profit_analytics']['city_requests']}",
        f"- Source disputes: {payload['profit_analytics']['source_disputes']}",
        "",
        "## Milestones",
        "",
    ]
    for milestone, values in milestones.items():
        lines.append(f"### {milestone}")
        for label, item in values.items():
            lines.append(f"- {label}: {item['current']} / {item['target']} ({pct(item['current'], item['target'])}%)")
        lines.append("")
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Next Actions", ""])
    lines.extend([f"- {action}" for action in payload["next_actions"]])
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, REPORT_MD


def main():
    parser = argparse.ArgumentParser(description="Track Pattern Lab YPP monetization progress.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload, report = build_tracker_report()
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(f"Status: {payload['status']}")
        print(f"YPP progress report: {display_path(report)}")
        for blocker in payload["blockers"]:
            print(f"- {blocker}")


if __name__ == "__main__":
    main()
