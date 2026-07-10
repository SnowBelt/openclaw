#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now
from upload_private_youtube import build_youtube_client, resolve_base_path


UPLOAD_REPORTS = [
    ("long-form", None, "youtube-upload-report.json"),
    ("short", 1, "youtube-upload-report-short-01.json"),
    ("short", 2, "youtube-upload-report-short-02.json"),
    ("short", 3, "youtube-upload-report-short-03.json"),
]


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def redacted_error(exc):
    text = str(exc).replace("\n", " ")
    sensitive_markers = ["access_token", "refresh_token", "client_secret", "Authorization", "Bearer "]
    for marker in sensitive_markers:
        if marker in text:
            return f"{type(exc).__name__}: redacted"
    return f"{type(exc).__name__}: {text[:600]}"


def collect_local_reports(root):
    reports = []
    blockers = []
    for surface, short_index, filename in UPLOAD_REPORTS:
        path = root / "approval" / filename
        report = read_json(path)
        if not report:
            blockers.append(f"Missing local upload report: {display_path(path)}.")
            continue
        record = {
            "report": display_path(path),
            "surface": surface,
            "short_index": short_index,
            "status": report.get("status"),
            "privacy": report.get("privacy"),
            "youtube_video_id": report.get("youtube_video_id"),
            "youtube_url": report.get("youtube_url"),
            "uploaded_at": report.get("uploaded_at"),
            "title": report.get("title"),
            "thumbnail_set": bool(report.get("thumbnail_set")),
        }
        reports.append(record)
        if report.get("status") != "uploaded":
            blockers.append(f"{filename} status is not uploaded.")
        if report.get("privacy") not in {"private", "unlisted"}:
            blockers.append(f"{filename} privacy is not private/unlisted.")
        if not report.get("youtube_video_id"):
            blockers.append(f"{filename} is missing youtube_video_id.")
    return reports, blockers


def verify_live_reports(reports):
    token_file = resolve_base_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
    client_secrets = resolve_base_path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""), "YOUTUBE_CLIENT_SECRETS_FILE")
    youtube = build_youtube_client(token_file, client_secrets)
    ids = [report["youtube_video_id"] for report in reports if report.get("youtube_video_id")]
    response = (
        youtube.videos()
        .list(part="snippet,status,contentDetails", id=",".join(ids))
        .execute()
    )
    by_id = {item.get("id"): item for item in response.get("items", [])}
    findings = []
    blockers = []
    for report in reports:
        video_id = report.get("youtube_video_id")
        item = by_id.get(video_id)
        finding = {
            "surface": report["surface"],
            "short_index": report["short_index"],
            "youtube_video_id": video_id,
            "found": bool(item),
            "expected_privacy": report.get("privacy"),
            "actual_privacy": "",
            "title_matches": False,
            "privacy_matches": False,
        }
        if item:
            snippet = item.get("snippet", {})
            status = item.get("status", {})
            finding["actual_privacy"] = status.get("privacyStatus", "")
            finding["actual_title"] = snippet.get("title", "")
            finding["title_matches"] = snippet.get("title", "") == report.get("title")
            finding["privacy_matches"] = status.get("privacyStatus", "") == report.get("privacy")
            finding["upload_status"] = status.get("uploadStatus", "")
            if not finding["privacy_matches"]:
                blockers.append(
                    f"{video_id} privacy mismatch: expected {report.get('privacy')}, got {status.get('privacyStatus', '')}."
                )
            if not finding["title_matches"]:
                blockers.append(f"{video_id} title mismatch during live verification.")
        else:
            blockers.append(f"{video_id} was not returned by YouTube videos.list.")
        findings.append(finding)
    return findings, blockers


def write_report(root, video_id, payload):
    approval = ensure_dir(root / "approval")
    json_path = approval / "youtube-live-verification-report.json"
    md_path = approval / "youtube-live-verification-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    live = payload["live_api_verification"]
    lines = [
        f"# Pattern Lab YouTube Live Verification: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        "",
        f"Status: {live['status']}",
        "Public publish: blocked until explicit owner approval after YouTube Studio checks",
        "",
        "## Local Upload Reports",
        "",
    ]
    for report in payload["local_upload_reports"]:
        lines.append(
            f"- {report['surface']}"
            + (f" {report['short_index']}" if report["short_index"] else "")
            + f": {report.get('status')} {report.get('privacy')} {report.get('youtube_url', '')}"
        )
    lines.extend(["", "## Live API Verification", ""])
    lines.append(f"- Status: {live['status']}")
    if live.get("reason"):
        lines.append(f"- Reason: {live['reason']}")
    if live.get("required_oauth_scopes"):
        lines.append(f"- Required OAuth scopes: {', '.join(live['required_oauth_scopes'])}")
    if live.get("findings"):
        lines.extend(["", "### Findings", ""])
        for finding in live["findings"]:
            lines.append(
                f"- {finding.get('youtube_video_id')}: found={finding.get('found')} "
                f"privacy={finding.get('actual_privacy')} title_matches={finding.get('title_matches')}"
            )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload.get("blockers", [])] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def build_payload(video_id, live):
    load_dotenv()
    root = output_root(video_id)
    reports, blockers = collect_local_reports(root)
    live_payload = {
        "status": "not_run",
        "reason": "Run with --live to query YouTube Data API for uploaded private/unlisted videos.",
        "required_oauth_scopes": [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
        ],
        "findings": [],
    }
    if blockers:
        live_payload["status"] = "blocked"
        live_payload["reason"] = "Local upload report evidence is incomplete."
    elif live:
        try:
            findings, live_blockers = verify_live_reports(reports)
            blockers.extend(live_blockers)
            live_payload["findings"] = findings
            if blockers:
                live_payload["status"] = "blocked"
                live_payload["reason"] = "Live YouTube API verification found mismatches."
            else:
                live_payload["status"] = "verified"
                live_payload["reason"] = "YouTube Data API returned the expected uploaded videos with matching private/unlisted status."
        except Exception as exc:
            live_payload["status"] = "blocked"
            live_payload["reason"] = redacted_error(exc)
            blockers.append("Live YouTube API verification failed; regenerate OAuth token or repair API access.")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "local_upload_reports": reports,
        "live_api_verification": live_payload,
        "public_publish": "blocked_until_explicit_owner_approval",
        "blockers": blockers,
    }
    json_path, md_path = write_report(root, video_id, payload)
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Verify Pattern Lab private/unlisted YouTube uploads.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--live", action="store_true", help="Query YouTube Data API. Never publishes publicly.")
    args = parser.parse_args()
    payload, _, md_path = build_payload(args.video_id, args.live)
    print(json.dumps(payload, indent=2))
    print(f"YouTube live verification report: {display_path(md_path)}")
    if payload.get("blockers"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
