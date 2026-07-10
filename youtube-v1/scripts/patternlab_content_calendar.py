#!/usr/bin/env python3
import argparse
import json
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


EASTERN = ZoneInfo("America/New_York")
PUBLISH_WEEKDAYS = [1, 3, 5]
PUBLISH_TIME = time(11, 0)
CALENDAR_JSON = BASE / "state" / "monetization" / "content-calendar.json"
CALENDAR_MD = BASE / "state" / "monetization" / "content-calendar.md"


def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def status_line(path):
    if not path.exists():
        return "missing"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def latest_learning_label(video_id):
    report = output_root(video_id) / "metrics" / f"video-{video_id}-learning-report.md"
    if not report.exists():
        return "pending_learning_report"
    text = report.read_text(encoding="utf-8")
    for label in ["double_down", "repackage", "revise_hook", "improve_visual_pacing", "retire_topic", "expand_into_series", "pending_publish"]:
        if f"Decision label: {label}" in text:
            return label
    return "learning_report_present"


def media_status(video_id):
    root = output_root(video_id)
    approval = root / "approval"
    return {
        "private_upload_readiness": status_line(approval / "private-upload-readiness.md"),
        "public_publish_readiness": status_line(approval / "public-publish-readiness.md"),
        "monetization_gates": (read_json(approval / "monetization-gates-report.json", {}) or {}).get("status", "missing"),
        "long_form_exists": (root / "video" / f"pattern-lab-video-{video_id}-draft.mp4").exists(),
        "shorts_count": len(list((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4"))) if (root / "shorts").exists() else 0,
        "learning_label": latest_learning_label(video_id),
    }


def next_publish_slots(days=14):
    now = datetime.now(EASTERN)
    today = now.date()
    slots = []
    cursor = today
    end = today + timedelta(days=days)
    while cursor <= end:
        if cursor.weekday() in PUBLISH_WEEKDAYS:
            slot = datetime.combine(cursor, PUBLISH_TIME, tzinfo=EASTERN)
            if slot > now:
                slots.append(slot)
        cursor += timedelta(days=1)
    return slots


def topic_score(strategy, topic):
    score = 0.0
    for key, weight in strategy.get("topic_scoring_weights", {}).items():
        score += (float(topic.get("scores", {}).get(key, 0)) / 10.0) * float(weight)
    return round(score, 1)


def package_exists(video_id):
    return (BASE / "launch" / f"video-{video_id}" / "package.json").exists()


def build_calendar(days=14):
    strategy = read_json(BASE / "state" / "monetization" / "strategy.json", {}) or {}
    slate = read_json(BASE / "state" / "monetization" / "content-slate.json", {}) or {}
    slots = next_publish_slots(days)
    topics = slate.get("topics", [])
    rows = []
    for index, topic in enumerate(topics[: len(slots)], start=0):
        video_id = topic["video_id"]
        score = topic_score(strategy, topic)
        status = media_status(video_id)
        blockers = []
        if score < strategy.get("topic_score_threshold", 80):
            blockers.append("topic score below threshold")
        if topic.get("sub_lane") not in strategy.get("sub_lanes", []):
            blockers.append("invalid sub-lane")
        if package_exists(video_id) and status["monetization_gates"] != "pass":
            blockers.append("monetization gates not passing")
        if package_exists(video_id) and status["shorts_count"] < 3:
            blockers.append("fewer than 3 Shorts")
        rows.append(
            {
                "publish_target_eastern": slots[index].isoformat(),
                "video_id": video_id,
                "working_title": topic.get("working_title", ""),
                "sub_lane": topic.get("sub_lane", ""),
                "topic_score": score,
                "artifact_type": topic.get("artifact_type", ""),
                "package_exists": package_exists(video_id),
                "private_upload_readiness": status["private_upload_readiness"],
                "public_publish_readiness": status["public_publish_readiness"],
                "monetization_gates": status["monetization_gates"],
                "long_form_exists": status["long_form_exists"],
                "shorts_count": status["shorts_count"],
                "learning_label": status["learning_label"],
                "blockers": blockers,
                "next_action": "owner_review" if status["private_upload_readiness"] == "blocked-before-private-upload" else "produce_package",
            }
        )
    payload = {
        "generated_at": utc_now(),
        "window_days": days,
        "cadence": "Long-form Tuesday/Thursday/Saturday at 11:00 AM America/New_York; 3-5 Shorts per long-form same day and following day after owner approval",
        "long_form_weekdays": ["Tuesday", "Thursday", "Saturday"],
        "default_publish_time_local": "11:00",
        "timezone": "America/New_York",
        "shorts_per_long_form": "3-5",
        "public_publish_status": "blocked_until_fresh_exact_owner_approval",
        "publish_slots_eastern": [slot.isoformat() for slot in slots],
        "rows": rows,
    }
    ensure_dir(CALENDAR_JSON.parent)
    CALENDAR_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab Two-Week Content Calendar",
        "",
        f"Generated: {payload['generated_at']}",
        f"Cadence: {payload['cadence']}",
        "",
        "## Schedule",
        "",
    ]
    for row in rows:
        blockers = ", ".join(row["blockers"]) if row["blockers"] else "none"
        lines.extend(
            [
                f"### Video {row['video_id']}: {row['working_title']}",
                f"- Publish target Eastern: {row['publish_target_eastern']}",
                f"- Sub-lane: {row['sub_lane']}",
                f"- Topic score: {row['topic_score']}/100",
                f"- Artifact: {row['artifact_type']}",
                f"- Private readiness: {row['private_upload_readiness']}",
                f"- Public readiness: {row['public_publish_readiness']}",
                f"- Long-form exists: {row['long_form_exists']}",
                f"- Shorts: {row['shorts_count']}/3",
                f"- Learning label: {row['learning_label']}",
                f"- Blockers: {blockers}",
                f"- Next action: {row['next_action']}",
                "",
            ]
        )
    CALENDAR_MD.write_text("\n".join(lines), encoding="utf-8")
    return payload, CALENDAR_MD


def main():
    parser = argparse.ArgumentParser(description="Generate the Pattern Lab two-week content calendar.")
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args()
    payload, report = build_calendar(args.days)
    print(f"Rows: {len(payload['rows'])}")
    print(f"Content calendar: {display_path(report)}")


if __name__ == "__main__":
    main()
