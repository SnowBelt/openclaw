#!/usr/bin/env python3
"""Delete explicitly approved replaced Pattern Lab YouTube uploads.

Safety rules:
- Deletes only ids passed with --old-video-id.
- Blocks if any old id equals a current active upload report id.
- Blocks if any found old id is public.
- Verifies current active uploads still exist after deletion.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now
from upload_private_youtube import resolve_base_path


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def upload_report_path(root: Path, index: int | None) -> Path:
    if index is None:
        return root / "approval" / "youtube-upload-report.json"
    return root / "approval" / f"youtube-upload-report-short-{index:02d}.json"


def current_upload_ids(root: Path) -> list[str]:
    ids: list[str] = []
    for index in [None, 1, 2, 3]:
        report = read_json(upload_report_path(root, index))
        video_id = str(report.get("youtube_video_id") or "").strip()
        if video_id:
            ids.append(video_id)
    return ids


def build_youtube_client(token_file: Path, client_secrets: Path):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token = read_json(token_file)
    credentials = Credentials.from_authorized_user_info(token)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        token_file.write_text(credentials.to_json(), encoding="utf-8")
        os.chmod(token_file, 0o600)
    if not credentials.valid:
        raise SystemExit("YouTube OAuth token is invalid. Regenerate it before deletion.")
    if not client_secrets.exists():
        raise SystemExit(f"Missing YouTube OAuth client secrets: {display_path(client_secrets)}")
    return build("youtube", "v3", credentials=credentials)


def fetch_videos(youtube, ids: list[str]) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for start in range(0, len(ids), 50):
        chunk = ids[start : start + 50]
        if not chunk:
            continue
        response = youtube.videos().list(part="snippet,status", id=",".join(chunk)).execute()
        for item in response.get("items", []):
            found[item.get("id", "")] = item
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete explicitly approved old Pattern Lab YouTube uploads.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--old-video-id", action="append", required=True)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    old_ids = []
    for raw in args.old_video_id:
        value = str(raw).strip()
        if value and value not in old_ids:
            old_ids.append(value)
    current_ids = current_upload_ids(root)
    blockers: list[str] = []
    if not old_ids:
        blockers.append("no_old_video_ids_supplied")
    overlap = sorted(set(old_ids).intersection(current_ids))
    if overlap:
        blockers.append(f"old_ids_overlap_current_active_uploads:{','.join(overlap)}")

    token_file = resolve_base_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
    client_secrets = resolve_base_path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""), "YOUTUBE_CLIENT_SECRETS_FILE")
    youtube = build_youtube_client(token_file, client_secrets) if args.live and not blockers else None

    before_old: dict[str, Any] = {}
    before_current: dict[str, Any] = {}
    deleted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    after_old: dict[str, Any] = {}
    after_current: dict[str, Any] = {}

    if args.live and youtube and not blockers:
        before_old = fetch_videos(youtube, old_ids)
        before_current = fetch_videos(youtube, current_ids)
        for video_id in current_ids:
            if video_id not in before_current:
                blockers.append(f"current_active_upload_missing_before_deletion:{video_id}")
        for video_id in old_ids:
            item = before_old.get(video_id)
            if not item:
                skipped.append({"youtube_video_id": video_id, "reason": "not_found_before_deletion"})
                continue
            privacy = ((item.get("status") or {}).get("privacyStatus") or "").lower()
            title = (item.get("snippet") or {}).get("title", "")
            if privacy == "public":
                blockers.append(f"old_upload_is_public_not_deleted:{video_id}")
                skipped.append({"youtube_video_id": video_id, "reason": "public_not_deleted", "title": title})
                continue
            if privacy not in {"private", "unlisted"}:
                blockers.append(f"old_upload_privacy_unknown_not_deleted:{video_id}:{privacy}")
                skipped.append({"youtube_video_id": video_id, "reason": f"privacy_unknown:{privacy}", "title": title})
                continue
            youtube.videos().delete(id=video_id).execute()
            deleted.append({"youtube_video_id": video_id, "privacy_before": privacy, "title": title})
        after_old = fetch_videos(youtube, old_ids)
        after_current = fetch_videos(youtube, current_ids)
        for video_id in current_ids:
            item = after_current.get(video_id)
            if not item:
                blockers.append(f"current_active_upload_missing_after_deletion:{video_id}")
            else:
                privacy = ((item.get("status") or {}).get("privacyStatus") or "").lower()
                if privacy != "private":
                    blockers.append(f"current_active_upload_privacy_changed:{video_id}:{privacy}")
        for item in deleted:
            if item["youtube_video_id"] in after_old:
                blockers.append(f"old_upload_still_found_after_deletion:{item['youtube_video_id']}")
    elif not args.live:
        skipped = [{"youtube_video_id": video_id, "reason": "dry_run"} for video_id in old_ids]

    live_success = bool(args.live and not blockers and not after_old)
    payload = {
        "generated_at": utc_now(),
        "video_id": args.video_id,
        "live": args.live,
        "status": "deleted" if live_success and deleted else ("already_deleted" if live_success else ("dry_run" if not args.live and not blockers else "blocked")),
        "old_video_ids_requested": old_ids,
        "current_active_video_ids": current_ids,
        "deleted": deleted,
        "skipped": skipped,
        "old_found_before": sorted(before_old.keys()),
        "old_found_after": sorted(after_old.keys()),
        "current_found_after": sorted(after_current.keys()),
        "blockers": blockers,
        "youtube_mutation": "old_private_uploads_deleted" if args.live and deleted else "not_performed",
        "not_performed": ["public_publish", "comment", "pin", "related_video", "title_change", "thumbnail_change"],
    }
    json_path = approval / "old-upload-deletion-report.json"
    md_path = approval / "old-upload-deletion-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Old Upload Deletion: Video {args.video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"YouTube mutation: {payload['youtube_mutation']}",
        "",
        "## Deleted",
        "",
    ]
    lines.extend([f"- {item['youtube_video_id']} ({item.get('privacy_before', '')}) {item.get('title', '')}" for item in deleted] or ["- none"])
    lines.extend(["", "## Skipped", ""])
    lines.extend([f"- {item['youtube_video_id']}: {item['reason']}" for item in skipped] or ["- none"])
    lines.extend(["", "## Current Active IDs", ""])
    lines.extend([f"- {video_id}" for video_id in current_ids] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    print(f"Old upload deletion report: {display_path(md_path)}")
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
