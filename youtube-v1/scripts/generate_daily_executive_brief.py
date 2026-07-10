#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, media_duration_seconds, output_root, utc_now
from patternlab_content_calendar import build_calendar
from patternlab_monetization_tracker import build_tracker_report
from patternlab_profit_analytics import build_profit_analytics


def read_status(path):
    path = Path(path)
    if not path.exists():
        return "missing"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def duration(path):
    path = Path(path)
    if not path.exists():
        return "missing"
    try:
        return f"{media_duration_seconds(path):.1f}s"
    except Exception:
        return "unverified"


def count_jsonl(path, unresolved_only=False):
    path = Path(path)
    if not path.exists():
        return 0
    count = 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            if not unresolved_only:
                count += 1
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                count += 1
                continue
            if row.get("status", "queued") not in {"resolved", "closed", "cancelled"}:
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description="Generate the Pattern Lab daily executive brief.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()

    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    brief = approval / "daily-executive-brief.md"
    ypp, ypp_report = build_tracker_report()
    profit = build_profit_analytics(args.video_id)
    calendar, calendar_report = build_calendar()
    monetization = read_json(approval / "monetization-gates-report.json")
    image_source = read_json(approval / "image-source-report.json")
    analytics_24h = read_json(root / "metrics" / f"video-{args.video_id}-youtube-analytics-24h.json")
    long_form = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    proxy = root / "review" / f"pattern-lab-video-{args.video_id}-draft-discord-review.mp4"
    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{args.video_id}-short-*.mp4"))
    thumbnails = sorted((root / "images").glob("thumbnail_candidate_*.png"))
    blockers = []
    readiness = approval / "private-upload-readiness.md"
    if readiness.exists():
        capture = False
        for line in readiness.read_text(encoding="utf-8").splitlines():
            if line.strip() == "## Blockers":
                capture = True
                continue
            if capture and line.startswith("## "):
                break
            if capture and line.startswith("- "):
                blockers.append(line[2:])

    lines = [
        f"# Pattern Lab Daily Executive Brief: Video {args.video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        "## State",
        "",
        f"- Monetization gates: {monetization.get('status', 'missing')}",
        f"- Topic score: {monetization.get('topic_score', 'unknown')}",
        f"- Private upload readiness: {read_status(readiness)}",
        f"- Public publish readiness: {read_status(approval / 'public-publish-readiness.md')}",
        f"- 24h analytics: {analytics_24h.get('status', 'missing')}",
        f"- Image source: {image_source.get('selected_source', 'unknown')}",
        f"- OpenAI image backup used: {image_source.get('backup_used', False)}",
        f"- YPP tracker: {ypp.get('status', 'missing')} ({display_path(ypp_report)})",
        f"- Profit analytics: {profit.get('status', 'missing')}",
        f"- Revenue/RPM: ${profit.get('profit', {}).get('estimated_revenue_usd', 0)} / {profit.get('profit', {}).get('rpm_usd', 'pending')}",
        f"- Subscribers per 1,000 views: {profit.get('profit', {}).get('subscriber_conversion_per_1000_views', 'pending')}",
        f"- City requests / source disputes: {profit.get('audience_signals', {}).get('city_requests', 0)} / {profit.get('audience_signals', {}).get('source_disputes', 0)}",
        f"- Content calendar rows: {len(calendar.get('rows', []))} ({display_path(calendar_report)})",
        "",
        "## Media",
        "",
        f"- Long-form draft: {duration(long_form)}",
        f"- Discord review proxy: {duration(proxy)}",
        f"- Shorts: {len(shorts)}",
        f"- Thumbnail candidates: {len(thumbnails)}",
        "",
        "## Review Queue",
        "",
        f"- Review actions logged: {count_jsonl(approval / 'review-actions.jsonl')}",
        f"- Unresolved repairs: {count_jsonl(approval / 'repair-queue.jsonl', unresolved_only=True)}",
        f"- Unresolved regenerations: {count_jsonl(approval / 'regeneration-queue.jsonl', unresolved_only=True)}",
        "",
        "## Human Gates",
        "",
    ]
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(
        [
            "",
            "## Next Best Action",
            "",
            "- Review the Discord packet on mobile, approve good assets, and use repair/regenerate buttons for weak assets.",
            "",
        ]
    )
    brief.write_text("\n".join(lines), encoding="utf-8")
    print(f"Daily executive brief: {brief.relative_to(root.parent.parent)}")


if __name__ == "__main__":
    main()
