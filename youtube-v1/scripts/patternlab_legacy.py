#!/usr/bin/env python3
import json

from patternlab_common import BASE


LEGACY_MANIFEST = BASE / "resources" / "legacy-videos.json"


def normalize_video_id(value):
    raw = str(value or "").strip()
    if raw.startswith("video-"):
        raw = raw.removeprefix("video-")
    if raw.isdigit():
        return raw.zfill(2)
    return raw


def read_legacy_manifest():
    if not LEGACY_MANIFEST.exists():
        return {"legacy_videos": []}
    return json.loads(LEGACY_MANIFEST.read_text(encoding="utf-8"))


def legacy_video_ids():
    payload = read_legacy_manifest()
    ids = set()
    for item in payload.get("legacy_videos", []):
        video_id = normalize_video_id(item.get("video_id"))
        if video_id:
            ids.add(video_id)
    return ids


def is_legacy_video_id(video_id):
    return normalize_video_id(video_id) in legacy_video_ids()


def all_launch_video_ids(include_legacy=False):
    launch = BASE / "launch"
    if not launch.exists():
        return []
    legacy_ids = legacy_video_ids()
    ids = []
    for path in sorted(launch.glob("video-*")):
        video_id = normalize_video_id(path.name.removeprefix("video-"))
        if not video_id.isdigit():
            continue
        if not include_legacy and video_id in legacy_ids:
            continue
        ids.append(video_id)
    return ids


def active_launch_video_ids():
    return all_launch_video_ids(include_legacy=False)


def legacy_marker_path(video_id):
    return BASE / "launch" / f"video-{normalize_video_id(video_id)}" / "LEGACY.md"


def missing_legacy_markers():
    missing = []
    for video_id in sorted(legacy_video_ids()):
        marker = legacy_marker_path(video_id)
        if not marker.exists():
            missing.append(str(marker.relative_to(BASE)))
    return missing


def legacy_isolation_summary():
    return {
        "manifest": str(LEGACY_MANIFEST.relative_to(BASE)),
        "legacy_video_ids": sorted(legacy_video_ids()),
        "active_launch_video_ids": active_launch_video_ids(),
        "missing_legacy_markers": missing_legacy_markers(),
    }

