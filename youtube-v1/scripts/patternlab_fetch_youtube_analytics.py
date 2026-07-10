#!/usr/bin/env python3
import argparse
import csv
import json
import os
import shutil
import stat
from datetime import datetime, timedelta, timezone

from patternlab_common import display_path, ensure_dir, load_dotenv, media_duration_seconds, output_root, utc_now
from patternlab_post_public_metrics import METRIC_FIELDS
from upload_private_youtube import resolve_base_path


ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly"
BASIC_METRICS = [
    "views",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
    "subscribersGained",
]
RETENTION_DIMENSION = "elapsedVideoTimeRatio"
RETENTION_METRIC = "audienceWatchRatio"
UNSUPPORTED_METRICS = [
    "impressions",
    "ctr_percent",
    "browse_ctr_percent",
    "suggested_ctr_percent",
    "search_ctr_percent",
    "shorts_viewed_percent",
    "shorts_swiped_away_percent",
    "related_video_clicks",
    "estimated_revenue_usd",
    "rpm_usd",
]


def parse_utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_utc(value):
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(path, rows, fieldnames):
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows([{field: row.get(field, "") for field in fieldnames} for row in rows])


def metric_key(row):
    return (
        row.get("youtube_video_id") or row.get("video_id") or "",
        row.get("surface") or "",
        str(row.get("hours_since_publish") or ""),
    )


def dedupe_rows(rows):
    by_key = {}
    order = []
    for row in rows:
        key = metric_key(row)
        if not all(key):
            order.append(row)
            continue
        if key not in by_key:
            by_key[key] = dict(row)
            order.append(by_key[key])
            continue
        target = by_key[key]
        for field, value in row.items():
            if value not in {None, ""}:
                target[field] = value
    return order


def backup_metrics(path):
    if not path.exists():
        return ""
    backup_dir = ensure_dir(path.parent / "backups")
    backup = backup_dir / f"{path.stem}.before-idempotency-{utc_now().replace(':', '').replace('-', '')}.csv"
    shutil.copy2(path, backup)
    return display_path(backup)


def row_id(video_id, item):
    label = item.get("label", "")
    if label == "long-form":
        return video_id
    if label.startswith("short-"):
        return f"{video_id}-{label}"
    raise SystemExit(f"Unsupported public publish label: {label}")


def require_public_publish(root, video_id):
    report_path = root / "approval" / "public-publish-report.json"
    report = read_json(report_path)
    if not report:
        raise SystemExit(f"Missing public publish report: {display_path(report_path)}")
    if report.get("status") != "published":
        raise SystemExit(f"Public publish report is not published: {report.get('status')}")
    videos = report.get("published_videos", [])
    if len(videos) != 4:
        raise SystemExit(f"Public publish report must include four videos; found {len(videos)}.")
    for item in videos:
        if item.get("privacy_after") != "public":
            raise SystemExit(f"{item.get('label')} is not public in the publish report.")
        if item.get("title_unchanged") is not True:
            raise SystemExit(f"{item.get('label')} title changed during publish.")
        if not item.get("youtube_video_id") or not item.get("youtube_url"):
            raise SystemExit(f"{item.get('label')} is missing YouTube id or URL.")
        expected_row_id = row_id(video_id, item)
        if not expected_row_id:
            raise SystemExit(f"Could not derive metrics row id for {item.get('label')}.")
    return report


def existing_24h_rows(rows, checkpoint_hours):
    return [row for row in rows if str(row.get("hours_since_publish", "")) == str(checkpoint_hours)]


def video_duration_seconds(root, row):
    row_video_id = row.get("video_id", "")
    base_video_id = row_video_id.split("-short-", 1)[0]
    if row.get("surface") == "long-form":
        path = root / "video" / f"pattern-lab-video-{base_video_id}-draft.mp4"
    else:
        short_suffix = row_video_id.rsplit("-", 1)[-1]
        path = root / "shorts" / f"pattern-lab-video-{base_video_id}-short-{short_suffix}.mp4"
    if not path.exists():
        return None, display_path(path)
    try:
        return media_duration_seconds(path), display_path(path)
    except Exception:
        return None, display_path(path)


def token_scopes(token_file):
    token = read_json(token_file, {})
    scopes = token.get("scopes") or token.get("scope") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    return sorted(scopes)


def build_analytics_client(token_file, client_secrets):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token = read_json(token_file)
    if not token:
        raise RuntimeError("YouTube OAuth token file is missing or unreadable.")
    credentials = Credentials.from_authorized_user_info(token)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        token_file.write_text(credentials.to_json(), encoding="utf-8")
        os.chmod(token_file, stat.S_IRUSR | stat.S_IWUSR)
    if not credentials.valid:
        raise RuntimeError("YouTube OAuth token is invalid after refresh attempt.")
    if not client_secrets.exists():
        raise RuntimeError(f"Missing YouTube OAuth client secrets: {display_path(client_secrets)}")
    return build("youtubeAnalytics", "v2", credentials=credentials)


def query_report(client, **kwargs):
    return client.reports().query(**kwargs).execute()


def first_row_as_dict(response):
    rows = response.get("rows") or []
    if not rows:
        return None
    headers = [header["name"] for header in response.get("columnHeaders", [])]
    return dict(zip(headers, rows[0]))


def table_rows_as_dicts(response):
    rows = response.get("rows") or []
    headers = [header["name"] for header in response.get("columnHeaders", [])]
    return [dict(zip(headers, row)) for row in rows]


def fetch_basic_metrics(client, youtube_video_id, start_date, end_date):
    response = query_report(
        client,
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        metrics=",".join(BASIC_METRICS),
        filters=f"video=={youtube_video_id}",
    )
    return first_row_as_dict(response), response


def nearest_ratio(rows, target_ratio):
    candidates = []
    for row in rows:
        try:
            elapsed = float(row.get(RETENTION_DIMENSION, ""))
            watch = float(row.get(RETENTION_METRIC, ""))
        except (TypeError, ValueError):
            continue
        candidates.append((abs(elapsed - target_ratio), elapsed, watch))
    if not candidates:
        return None
    _, elapsed, watch = min(candidates, key=lambda item: item[0])
    return {
        "elapsed_video_time_ratio": round(elapsed, 4),
        "audience_watch_ratio": round(watch, 4),
        "percent": round(watch * 100, 2),
    }


def fetch_retention_metrics(client, youtube_video_id, start_date, end_date, duration_seconds):
    response = query_report(
        client,
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        dimensions=RETENTION_DIMENSION,
        metrics=RETENTION_METRIC,
        filters=f"video=={youtube_video_id}",
        sort=RETENTION_DIMENSION,
        maxResults=200,
    )
    rows = table_rows_as_dicts(response)
    if not rows or not duration_seconds:
        return None, None, response
    thirty_second_ratio = min(1.0, 30.0 / duration_seconds)
    return nearest_ratio(rows, thirty_second_ratio), nearest_ratio(rows, 0.5), response


def as_int_string(value):
    try:
        return str(int(round(float(value))))
    except (TypeError, ValueError):
        return ""


def as_decimal_string(value, places=2):
    try:
        return f"{float(value):.{places}f}"
    except (TypeError, ValueError):
        return ""


def build_report_md(payload):
    lines = [
        f"# Pattern Lab YouTube Analytics 24h First Read: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Live: {payload['live']}",
        f"Coverage: {payload.get('coverage_start_date', 'pending')} to {payload.get('coverage_end_date', 'pending')}",
        f"Next retry after: {payload.get('next_retry_after_utc', 'not_required')}",
        "",
        "## Unsupported Or Deferred Metrics",
        "",
    ]
    lines.extend([f"- {metric}" for metric in payload["unsupported_metrics"]])
    lines.extend(["", "## Videos", ""])
    for item in payload["videos"]:
        lines.extend(
            [
                f"### {item.get('video_id', '')}",
                "",
                f"- YouTube ID: {item.get('youtube_video_id', '')}",
                f"- Status: {item.get('status', '')}",
                f"- Views: {item.get('views', 'pending')}",
                f"- Watch hours: {item.get('watch_hours', 'pending')}",
                f"- Average view duration: {item.get('average_view_duration_seconds', 'pending')}",
                f"- Average viewed: {item.get('average_percentage_viewed', 'pending')}",
                f"- 30s retention: {item.get('retention_30s_percent', 'pending')}",
                f"- 50% retention: {item.get('retention_50_percent', 'pending')}",
                "",
            ]
        )
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    return "\n".join(lines) + "\n"


def write_report(root, video_id, payload):
    metrics_dir = ensure_dir(root / "metrics")
    json_path = metrics_dir / f"video-{video_id}-youtube-analytics-24h.json"
    md_path = metrics_dir / f"video-{video_id}-youtube-analytics-24h.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(build_report_md(payload), encoding="utf-8")
    return json_path, md_path


def write_readonly_blocker_report(root, video_id, payload):
    metrics_dir = ensure_dir(root / "metrics")
    blocker = {
        "generated_at": payload.get("generated_at", utc_now()),
        "video_id": video_id,
        "status": payload.get("status", "blocked_readonly_analytics"),
        "live": payload.get("live", True),
        "youtube_mutation": "not_performed",
        "public_publish": "not_performed",
        "thumbnail_replacement": "not_performed",
        "blockers": payload.get("blockers", []),
        "next_retry_after_utc": payload.get("next_retry_after_utc", ""),
        "source_report": display_path(metrics_dir / f"video-{video_id}-youtube-analytics-24h.json"),
    }
    json_path = metrics_dir / f"video-{video_id}-youtube-analytics-readonly-blocker.json"
    md_path = metrics_dir / f"video-{video_id}-youtube-analytics-readonly-blocker.md"
    json_path.write_text(json.dumps(blocker, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab YouTube Analytics Read-Only Blocker: Video {video_id}",
        "",
        f"Generated: {blocker['generated_at']}",
        f"Status: {blocker['status']}",
        "YouTube mutation: not_performed",
        "Public publish: not_performed",
        "Thumbnail replacement: not_performed",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {item}" for item in blocker["blockers"]] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def blocker_payload(video_id, live, status, blockers, videos=None, coverage=None, next_retry=None):
    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "checkpoint_hours": 24,
        "live": live,
        "status": status,
        "coverage_start_date": (coverage or {}).get("start_date", ""),
        "coverage_end_date": (coverage or {}).get("end_date", ""),
        "next_retry_after_utc": next_retry or "",
        "videos": videos or [],
        "unsupported_metrics": UNSUPPORTED_METRICS,
        "blockers": blockers,
    }


def import_metrics(video_id, checkpoint_hours, live):
    load_dotenv()
    root = output_root(video_id)
    public_report = require_public_publish(root, video_id)
    metrics_path = root / "metrics" / f"video-{video_id}-performance.csv"
    rows = read_rows(metrics_path)
    if not rows:
        raise SystemExit(f"Missing metrics rows: {display_path(metrics_path)}")
    original_row_count = len(rows)
    rows = dedupe_rows(rows)
    deduplicated_row_count = len(rows)
    backup_path = ""
    if live and deduplicated_row_count < original_row_count:
        backup_path = backup_metrics(metrics_path)
        write_rows(metrics_path, rows, list(rows[0].keys()) if rows else METRIC_FIELDS)
    fieldnames = list(rows[0].keys()) if rows else METRIC_FIELDS
    for field in METRIC_FIELDS:
        if field not in fieldnames:
            fieldnames.append(field)

    rows_24 = existing_24h_rows(rows, checkpoint_hours)
    if len(rows_24) != 4:
        payload = blocker_payload(
            video_id,
            live,
            "blocked_metrics_baseline_missing",
            [f"Expected four {checkpoint_hours}h metrics rows; found {len(rows_24)}."],
        )
        write_report(root, video_id, payload)
        return payload

    published_at = parse_utc(rows_24[0].get("published_at_utc") or public_report.get("generated_at") or utc_now())
    checkpoint_due = max(parse_utc(row["checkpoint_due_at_utc"]) for row in rows_24 if row.get("checkpoint_due_at_utc"))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    coverage = {
        "start_date": published_at.date().isoformat(),
        "end_date": checkpoint_due.date().isoformat(),
    }
    public_items_by_row_id = {row_id(video_id, item): item for item in public_report["published_videos"]}

    planned_videos = [
        {
            "video_id": row.get("video_id", ""),
            "surface": row.get("surface", ""),
            "youtube_video_id": row.get("youtube_video_id", ""),
            "publish_url": row.get("publish_url", ""),
            "status": "pending_api_import",
        }
        for row in rows_24
    ]
    if now < checkpoint_due:
        retry = format_utc(checkpoint_due + timedelta(hours=2))
        payload = blocker_payload(
            video_id,
            live,
            "blocked_metrics_not_available",
            [
                f"{checkpoint_hours}h checkpoint is not due until {format_utc(checkpoint_due)}.",
                "YouTube Analytics API data is date-based and may lag after the checkpoint.",
            ],
            planned_videos,
            coverage,
            retry,
        )
        write_report(root, video_id, payload)
        return payload

    if not live:
        payload = blocker_payload(
            video_id,
            live,
            "dry_run_ready",
            ["Run with --live after OAuth analytics scope is present to query YouTube Analytics API."],
            planned_videos,
            coverage,
            format_utc(now + timedelta(hours=6)),
        )
        write_report(root, video_id, payload)
        return payload

    token_file = resolve_base_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
    client_secrets = resolve_base_path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""), "YOUTUBE_CLIENT_SECRETS_FILE")
    scopes = token_scopes(token_file)
    if ANALYTICS_SCOPE not in scopes:
        payload = blocker_payload(
            video_id,
            live,
            "blocked_oauth_scope_missing",
            [f"YouTube OAuth token is missing required scope: {ANALYTICS_SCOPE}."],
            planned_videos,
            coverage,
            format_utc(now + timedelta(hours=1)),
        )
        write_report(root, video_id, payload)
        return payload

    try:
        client = build_analytics_client(token_file, client_secrets)
    except Exception as exc:
        error = f"{type(exc).__name__}: {str(exc)[:500]}"
        payload = blocker_payload(
            video_id,
            live,
            "blocked_oauth_refresh_failed",
            [
                "YouTube Analytics read-only OAuth refresh failed before any Analytics query.",
                error,
                "No YouTube upload, publish, thumbnail replacement, deletion, or other mutation was performed.",
            ],
            planned_videos,
            coverage,
            format_utc(now + timedelta(hours=1)),
        )
        write_report(root, video_id, payload)
        write_readonly_blocker_report(root, video_id, payload)
        return payload

    imported_videos = []
    updated_rows_by_id = {}
    blockers = []
    for row in rows_24:
        current_row_id = row.get("video_id", "")
        public_item = public_items_by_row_id.get(current_row_id, {})
        youtube_video_id = row.get("youtube_video_id") or public_item.get("youtube_video_id", "")
        duration_seconds, duration_path = video_duration_seconds(root, row)
        video_report = {
            "video_id": current_row_id,
            "surface": row.get("surface", ""),
            "youtube_video_id": youtube_video_id,
            "publish_url": row.get("publish_url", ""),
            "duration_seconds": round(duration_seconds, 2) if duration_seconds else None,
            "duration_source": duration_path,
            "status": "pending",
        }
        if not youtube_video_id:
            video_report["status"] = "blocked_missing_youtube_video_id"
            blockers.append(f"{current_row_id} is missing a YouTube video id.")
            imported_videos.append(video_report)
            continue
        try:
            basic, basic_response = fetch_basic_metrics(
                client, youtube_video_id, coverage["start_date"], coverage["end_date"]
            )
        except Exception as exc:
            video_report["status"] = "blocked_api_error"
            video_report["error"] = f"{type(exc).__name__}: {str(exc)[:500]}"
            blockers.append(f"{current_row_id} Analytics API basic metrics query failed.")
            imported_videos.append(video_report)
            continue
        video_report["basic_response_columns"] = [
            header.get("name", "") for header in basic_response.get("columnHeaders", [])
        ]
        if not basic:
            video_report["status"] = "blocked_no_api_rows"
            blockers.append(f"{current_row_id} returned no YouTube Analytics rows for the 24h coverage range.")
            imported_videos.append(video_report)
            continue

        retention_30 = None
        retention_50 = None
        try:
            retention_30, retention_50, retention_response = fetch_retention_metrics(
                client,
                youtube_video_id,
                coverage["start_date"],
                coverage["end_date"],
                duration_seconds,
            )
            video_report["retention_response_columns"] = [
                header.get("name", "") for header in retention_response.get("columnHeaders", [])
            ]
        except Exception as exc:
            video_report["retention_status"] = "partial_api_error"
            video_report["retention_error"] = f"{type(exc).__name__}: {str(exc)[:500]}"

        updated = dict(row)
        views = as_int_string(basic.get("views"))
        estimated_minutes = basic.get("estimatedMinutesWatched")
        watch_hours = as_decimal_string((float(estimated_minutes) / 60.0) if estimated_minutes is not None else "", 4)
        avg_duration = as_decimal_string(basic.get("averageViewDuration"), 2)
        avg_percent = as_decimal_string(basic.get("averageViewPercentage"), 2)
        subscribers = as_int_string(basic.get("subscribersGained"))
        updated.update(
            {
                "recorded_at_utc": utc_now(),
                "views": views,
                "watch_hours": watch_hours,
                "average_view_duration_seconds": avg_duration,
                "average_percentage_viewed": avg_percent,
                "subscribers_gained": subscribers,
                "metrics_source": "YouTube Analytics API",
                "metrics_import_status": "api_partial_manual_studio_needed",
                "decision_label": "api_partial_manual_studio_needed",
                "youtube_ab_test_status": "api_partial_manual_studio_needed",
                "comments_signal_summary": (
                    "YouTube Analytics API first read imported; CTR/impressions/Shorts bridge metrics require Studio/manual export."
                ),
                "next_action": (
                    "Import YouTube Studio CTR/impressions/Shorts bridge metrics when available; keep API metrics as first read."
                ),
            }
        )
        if retention_30:
            updated["retention_30s_percent"] = as_decimal_string(retention_30["percent"], 2)
        if retention_50:
            updated["retention_50_percent"] = as_decimal_string(retention_50["percent"], 2)
        updated_rows_by_id[current_row_id] = updated
        video_report.update(
            {
                "status": "api_partial_manual_studio_needed",
                "views": views,
                "watch_hours": watch_hours,
                "average_view_duration_seconds": avg_duration,
                "average_percentage_viewed": avg_percent,
                "retention_30s_percent": updated.get("retention_30s_percent", ""),
                "retention_50_percent": updated.get("retention_50_percent", ""),
                "subscribers_gained": subscribers,
            }
        )
        imported_videos.append(video_report)

    if blockers or len(updated_rows_by_id) != 4:
        payload = blocker_payload(
            video_id,
            live,
            "blocked_metrics_not_available",
            blockers or ["Not all four videos returned usable 24h YouTube Analytics API metrics."],
            imported_videos,
            coverage,
            format_utc(now + timedelta(hours=6)),
        )
        write_report(root, video_id, payload)
        return payload

    updated_rows = [updated_rows_by_id.get(row.get("video_id", ""), row) for row in rows]
    write_rows(metrics_path, updated_rows, fieldnames)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "checkpoint_hours": checkpoint_hours,
        "live": live,
        "status": "api_partial_manual_studio_needed",
        "coverage_start_date": coverage["start_date"],
        "coverage_end_date": coverage["end_date"],
        "metrics_csv": display_path(metrics_path),
        "original_row_count": original_row_count,
        "deduplicated_row_count": deduplicated_row_count,
        "deduplication_backup": backup_path,
        "videos": imported_videos,
        "unsupported_metrics": UNSUPPORTED_METRICS,
        "blockers": [],
        "next_retry_after_utc": "",
    }
    write_report(root, video_id, payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description="Fetch Pattern Lab YouTube Analytics API metrics for the 24h first read.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--checkpoint-hours", type=int, default=24)
    parser.add_argument("--live", action="store_true", help="Query YouTube Analytics API. Never mutates YouTube content.")
    args = parser.parse_args()
    payload = import_metrics(args.video_id, args.checkpoint_hours, args.live)
    root = output_root(args.video_id)
    print(json.dumps(payload, indent=2))
    print(
        "YouTube Analytics 24h report: "
        f"{display_path(root / 'metrics' / f'video-{args.video_id}-youtube-analytics-24h.md')}"
    )
    if payload["status"].startswith("blocked_"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
