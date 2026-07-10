#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path

from patternlab_common import BASE, display_path, load_dotenv, output_root, utc_now
from patternlab_youtube_credentials import CLIENT_ACCOUNT, TOKEN_ACCOUNT, read_json_secret, write_token


ALLOWED_PRIVACY = {"private", "unlisted"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_receipt(path):
    stat = path.stat()
    return {
        "video_file_sha256": sha256(path),
        "video_file_size": stat.st_size,
        "video_file_mtime": stat.st_mtime,
    }


def resolve_base_path(value, label):
    if not value or value == "replace_me":
        raise SystemExit(f"{label} is not configured.")
    path = Path(value)
    if not path.is_absolute():
        path = BASE / path
    return path


def load_json(path):
    if not path.exists():
        raise SystemExit(f"Missing required file: {display_path(path)}")
    return json.loads(path.read_text(encoding="utf-8"))


def readiness_status(root):
    report = root / "approval" / "private-upload-readiness.md"
    if not report.exists():
        return "missing"
    for line in report.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def final_package_hash(root):
    report = root / "approval" / "package-hash-report.json"
    if not report.exists():
        raise SystemExit("Final package hash report is missing.")
    payload = json.loads(report.read_text(encoding="utf-8"))
    if payload.get("status") != "pass" or not payload.get("final_package_hash"):
        raise SystemExit("Final package hash report is not passing.")
    return payload["final_package_hash"]


def selected_video(root, video_id, surface, short_index):
    if surface == "long-form":
        return root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    return root / "shorts" / f"pattern-lab-video-{video_id}-short-{short_index:02d}.mp4"


def selected_thumbnail(root, metadata):
    thumbnail = metadata.get("default_thumbnail") or "images/thumbnail_candidate_a.png"
    path = root / thumbnail
    if path.exists():
        return path
    return root / "images" / "thumbnail_candidate_a.png"


def selected_metadata(metadata, video_id, surface, short_index):
    if surface == "long-form":
        return {
            "title": metadata["default_title"],
            "description": metadata["description"] + "\n\n" + metadata["description_footer"],
            "tags": metadata["tags"],
            "categoryId": metadata.get("category_id", "27"),
            "madeForKids": bool(metadata.get("made_for_kids", False)),
        }
    shorts = metadata.get("shorts", [])
    short = next((item for item in shorts if item.get("id") == f"{video_id}-short-{short_index:02d}"), None)
    if not short:
        raise SystemExit(f"Missing metadata for Short {short_index}.")
    return {
        "title": short["title"],
        "description": (
            short["related_video_promise"]
            + "\n\n"
            + "Pattern Lab studies American cities through maps, archives, photographs, buildings, neighborhoods, industries, and evidence."
        ),
        "tags": ["Pattern Lab", "YouTube Shorts", "Detroit history", "city history", "US history", "urban history"],
        "categoryId": metadata.get("category_id", "27"),
        "madeForKids": bool(metadata.get("made_for_kids", False)),
    }


def build_youtube_client(token_file, client_secrets):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    token, token_source = read_json_secret(token_file, TOKEN_ACCOUNT)
    if not token:
        raise SystemExit("YouTube OAuth token is missing.")
    credentials = Credentials.from_authorized_user_info(token)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        write_token(token_file, json.loads(credentials.to_json()))
    if not credentials.valid:
        raise SystemExit("YouTube OAuth token is invalid. Regenerate it before live upload.")
    client, _client_source = read_json_secret(client_secrets, CLIENT_ACCOUNT)
    if not client:
        raise SystemExit(f"Missing YouTube OAuth client secrets: {display_path(client_secrets)}")
    return build("youtube", "v3", credentials=credentials)


def upload_video(youtube, video_path, metadata, privacy):
    from googleapiclient.http import MediaFileUpload

    body = {
        "snippet": {
            "title": metadata["title"],
            "description": metadata["description"],
            "tags": metadata["tags"],
            "categoryId": metadata["categoryId"],
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": metadata["madeForKids"],
        },
    }
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=MediaFileUpload(str(video_path), chunksize=-1, resumable=True),
    )
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response


def set_thumbnail(youtube, video_id, thumbnail):
    from googleapiclient.http import MediaFileUpload

    if not thumbnail.exists():
        return None
    return youtube.thumbnails().set(
        videoId=video_id,
        media_body=MediaFileUpload(str(thumbnail)),
    ).execute()


def main():
    parser = argparse.ArgumentParser(description="Upload Pattern Lab media as private or unlisted only.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--surface", choices=["long-form", "short"], default="long-form")
    parser.add_argument("--short-index", type=int, default=1)
    parser.add_argument("--privacy", choices=sorted(ALLOWED_PRIVACY), default="private")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--skip-readiness", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    metadata_path = root / "approval" / "upload-metadata.json"
    metadata = selected_metadata(load_json(metadata_path), args.video_id, args.surface, args.short_index)
    video_path = selected_video(root, args.video_id, args.surface, args.short_index)
    if not video_path.exists():
        raise SystemExit(f"Missing video file: {display_path(video_path)}")

    status = readiness_status(root)
    if not args.skip_readiness and status != "private-upload-ready":
        raise SystemExit(f"Private upload blocked by readiness status: {status}")

    token_file = resolve_base_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
    client_secrets = resolve_base_path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""), "YOUTUBE_CLIENT_SECRETS_FILE")
    report_path = root / "approval" / (
        "youtube-upload-report.json"
        if args.surface == "long-form"
        else f"youtube-upload-report-short-{args.short_index:02d}.json"
    )
    planned = {
        "generated_at": utc_now(),
        "video_id": args.video_id,
        "surface": args.surface,
        "short_index": args.short_index if args.surface == "short" else None,
        "privacy": args.privacy,
        "public_publish": "blocked_until_explicit_owner_approval",
        "video_file": display_path(video_path),
        "title": metadata["title"],
        "category_id": metadata["categoryId"],
        "made_for_kids": metadata["madeForKids"],
        "tags": metadata["tags"],
        "status": "dry_run",
        "final_package_hash": final_package_hash(root),
        **file_receipt(video_path),
    }
    if not args.live:
        print(json.dumps(planned, indent=2))
        print("Dry run only. No upload performed.")
        return

    youtube = build_youtube_client(token_file, client_secrets)
    response = upload_video(youtube, video_path, metadata, args.privacy)
    uploaded_id = response["id"]
    thumbnail_response = None
    if args.surface == "long-form":
        thumbnail_response = set_thumbnail(youtube, uploaded_id, selected_thumbnail(root, load_json(metadata_path)))
    report = {
        **planned,
        "status": "uploaded",
        "youtube_video_id": uploaded_id,
        "youtube_url": f"https://www.youtube.com/watch?v={uploaded_id}",
        "thumbnail_set": bool(thumbnail_response),
        "youtube_checks_result": "owner must verify checks in YouTube Studio before public publish",
        "uploaded_at": utc_now(),
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
