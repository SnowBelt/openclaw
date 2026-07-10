#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now
from upload_private_youtube import build_youtube_client, resolve_base_path


UPLOAD_REPORTS = [
    ("long-form", None, "youtube-upload-report.json", "long-form"),
    ("short", 1, "youtube-upload-report-short-01.json", "short-01"),
    ("short", 2, "youtube-upload-report-short-02.json", "short-02"),
    ("short", 3, "youtube-upload-report-short-03.json", "short-03"),
]
PUBLIC_UPDATE_SCOPES = {
    "https://www.googleapis.com/auth/youtube.force-ssl",
    "https://www.googleapis.com/auth/youtube",
}


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_report(root, video_id, live, status, published_videos, blockers):
    approval = ensure_dir(root / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "live": live,
        "status": status,
        "public_publish_order": [item[3] for item in UPLOAD_REPORTS],
        "published_videos": published_videos,
        "blockers": blockers,
    }
    json_path = approval / "public-publish-report.json"
    md_path = approval / "public-publish-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Public Publish Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Live publish: {live}",
        f"Status: {status}",
        "",
        "## Published Videos",
        "",
    ]
    for item in published_videos:
        lines.append(
            f"- {item.get('label')}: {item.get('youtube_url', '')} "
            f"{item.get('privacy_before', '')} -> {item.get('privacy_after', '')}; "
            f"title unchanged={item.get('title_unchanged')}"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def redacted_error(exc):
    text = str(exc).replace("\n", " ")
    for marker in ["access_token", "refresh_token", "client_secret", "Authorization", "Bearer "]:
        if marker in text:
            return f"{type(exc).__name__}: redacted"
    return f"{type(exc).__name__}: {text[:800]}"


def collect_upload_reports(root):
    reports = []
    blockers = []
    approval = root / "approval"
    for surface, short_index, filename, label in UPLOAD_REPORTS:
        path = approval / filename
        report = read_json(path)
        if not report:
            blockers.append(f"Missing upload report: {display_path(path)}.")
            continue
        if report.get("status") != "uploaded":
            blockers.append(f"{filename} status is not uploaded.")
        if report.get("privacy") not in {"private", "unlisted"}:
            blockers.append(f"{filename} must start private/unlisted before public publish.")
        if not report.get("youtube_video_id"):
            blockers.append(f"{filename} is missing youtube_video_id.")
        reports.append({
            "surface": surface,
            "short_index": short_index,
            "label": label,
            "filename": filename,
            "path": path,
            "report": report,
        })
    return reports, blockers


def require_public_publish_approval(root):
    approval = root / "approval"
    public_approval = read_json(approval / "public-publish-approval.json")
    if not public_approval:
        return ["Public publish approval is missing."]
    blockers = []
    if public_approval.get("approval") != "public_publish":
        blockers.append("Public publish approval file does not approve public publish.")
    if public_approval.get("youtube_live_verification_status") != "verified":
        blockers.append("Public publish approval was not recorded after verified live YouTube evidence.")
    if not public_approval.get("youtube_studio_checks_owner_attested"):
        blockers.append("Owner YouTube Studio checks attestation is missing.")
    if not public_approval.get("synthetic_disclosure_owner_attested"):
        blockers.append("Owner synthetic disclosure attestation is missing.")
    return blockers


def fetch_video(youtube, youtube_video_id):
    response = youtube.videos().list(part="snippet,status", id=youtube_video_id).execute()
    items = response.get("items", [])
    if not items:
        raise RuntimeError(f"YouTube video {youtube_video_id} was not found.")
    return items[0]


def update_public_status(youtube, youtube_video_id, made_for_kids):
    body = {
        "id": youtube_video_id,
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": bool(made_for_kids),
        },
    }
    return youtube.videos().update(part="status", body=body).execute()


def publish_report(youtube, entry, live):
    report = entry["report"]
    youtube_video_id = report.get("youtube_video_id")
    before = fetch_video(youtube, youtube_video_id)
    title_before = before.get("snippet", {}).get("title", "")
    privacy_before = before.get("status", {}).get("privacyStatus", "")
    if live and privacy_before != "public":
        update_public_status(youtube, youtube_video_id, report.get("made_for_kids", False))
    after = fetch_video(youtube, youtube_video_id)
    title_after = after.get("snippet", {}).get("title", "")
    privacy_after = after.get("status", {}).get("privacyStatus", "")
    return {
        "label": entry["label"],
        "surface": entry["surface"],
        "short_index": entry["short_index"],
        "youtube_video_id": youtube_video_id,
        "youtube_url": report.get("youtube_url", f"https://www.youtube.com/watch?v={youtube_video_id}"),
        "privacy_before": privacy_before,
        "privacy_after": privacy_after,
        "title_before": title_before,
        "title_after": title_after,
        "title_unchanged": title_before == title_after == report.get("title"),
    }


def build_youtube():
    token_file = resolve_base_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
    client_secrets = resolve_base_path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""), "YOUTUBE_CLIENT_SECRETS_FILE")
    token = read_json(token_file) or {}
    scopes = token.get("scopes") or token.get("scope") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    if not PUBLIC_UPDATE_SCOPES.intersection(set(scopes)):
        raise RuntimeError(
            "YouTube OAuth token is missing a public-update scope. "
            "Regenerate it with generate_youtube_oauth_token.py so videos.update can set privacyStatus=public."
        )
    return build_youtube_client(token_file, client_secrets)


def main():
    parser = argparse.ArgumentParser(description="Set approved Pattern Lab uploads public. Never changes video content.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--live", action="store_true", help="Update YouTube visibility to public.")
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    reports, blockers = collect_upload_reports(root)
    blockers.extend(require_public_publish_approval(root))
    if blockers:
        payload, _json_path, md_path = write_report(root, args.video_id, args.live, "blocked", [], blockers)
        print(json.dumps(payload, indent=2))
        print(f"Public publish report: {display_path(md_path)}")
        raise SystemExit(1)

    published_videos = []
    try:
        youtube = build_youtube()
        for entry in reports:
            published_videos.append(publish_report(youtube, entry, args.live))
        publish_blockers = []
        for item in published_videos:
            if args.live and item.get("privacy_after") != "public":
                publish_blockers.append(f"{item['youtube_video_id']} privacy is {item.get('privacy_after')}, not public.")
            if not item.get("title_unchanged"):
                publish_blockers.append(f"{item['youtube_video_id']} title changed during public publish.")
        status = "published" if args.live and not publish_blockers else ("dry-run-ready" if not publish_blockers else "blocked")
        payload, _json_path, md_path = write_report(
            root,
            args.video_id,
            args.live,
            status,
            published_videos,
            publish_blockers,
        )
        print(json.dumps(payload, indent=2))
        print(f"Public publish report: {display_path(md_path)}")
        if publish_blockers:
            raise SystemExit(1)
    except Exception as exc:
        blockers = [redacted_error(exc)]
        payload, _json_path, md_path = write_report(root, args.video_id, args.live, "blocked", published_videos, blockers)
        print(json.dumps(payload, indent=2))
        print(f"Public publish report: {display_path(md_path)}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
