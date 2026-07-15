#!/usr/bin/env python3
"""Send only a passing, hash-bound Pattern Lab long-form replacement to Discord."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = YOUTUBE_ROOT.parent
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))
if str(YOUTUBE_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

from patternlab.approvals import current_release
from patternlab.state import PatternLabState, StateError, sha256_file
from patternlab_common import display_path, ensure_dir, output_root, utc_now
from send_daily_review_to_discord import (
    DEFAULT_TARGET,
    long_form_controls,
    send_message,
    send_video,
    set_active_review_release,
    stage_media,
    validate_channel_target,
    validate_duration,
    LONG_FORM_MAX_SECONDS,
    LONG_FORM_MIN_SECONDS,
)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def state_path() -> Path:
    return Path(os.environ.get("PATTERNLAB_STATE_DB", YOUTUBE_ROOT / "local-output" / "patternlab.sqlite3"))


def validate(video_id: str) -> tuple[dict, Path, list[Path], dict]:
    root = output_root(video_id)
    qa = read_json(root / "approval" / "long-form-media-qa-report.json")
    release_report = read_json(root / "approval" / "long-form-review-release-report.json")
    production = read_json(root / "approval" / "canonical-production-run.json")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    proxy = root / "review" / f"pattern-lab-video-{video_id}-draft-discord-review.mp4"
    parts = sorted((root / "review").glob(f"pattern-lab-video-{video_id}-draft-discord-review-part-*.mp4"))
    blockers: list[str] = []
    video_sha = sha256_file(video) if video.is_file() else ""
    if qa.get("status") != "pass" or qa.get("video_sha256") != video_sha:
        blockers.append("long_form_media_qa_missing_stale_or_blocked")
    if release_report.get("status") != "pass" or release_report.get("long_form_sha256") != video_sha:
        blockers.append("long_form_review_release_missing_stale_or_blocked")
    prior_stages = [row for row in production.get("stages", []) if isinstance(row, dict)]
    production_ready = bool(
        production.get("status") in {"running", "pass"}
        and not production.get("blockers")
        and prior_stages
        and all(row.get("status") in {"pass", "reused"} for row in prior_stages)
    )
    if not production_ready or production.get("profile") != "long_form_rebuild":
        blockers.append("canonical_production_run_missing_or_blocked")
    if not proxy.is_file() or proxy.stat().st_size == 0:
        blockers.append("discord_long_form_proxy_missing")
    if not parts:
        blockers.append("discord_high_quality_parts_missing")
    if video.is_file():
        validate_duration(video, LONG_FORM_MIN_SECONDS, LONG_FORM_MAX_SECONDS, "Long-form draft")
    store = PatternLabState(state_path())
    try:
        release = current_release(store, video_id)
    except (StateError, OSError, sqlite3.Error) as exc:
        blockers.append(f"active_long_form_release_unavailable:{type(exc).__name__}")
        release = {}
    if release.get("release_candidate_id") != release_report.get("release_candidate_id"):
        blockers.append("active_release_candidate_mismatch")
    if release.get("package_sha256") != release_report.get("package_sha256"):
        blockers.append("active_release_package_hash_mismatch")
    if blockers:
        raise SystemExit("Discord long-form review blocked: " + "; ".join(sorted(set(blockers))))
    return release, proxy, parts, qa


def main() -> None:
    parser = argparse.ArgumentParser(description="Send one passing Pattern Lab long-form replacement to Discord.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    validate_channel_target(args.target, False)
    release, proxy, parts, qa = validate(video_id)
    set_active_review_release(release)
    staged_proxy = stage_media(video_id, proxy)
    staged_parts = [stage_media(video_id, path) for path in parts]
    message = (
        f"Pattern Lab Video {video_id} — replacement long-form review\n"
        f"Automated QA: {qa.get('score', 0)}/100 (all hard gates passed)\n"
        f"Video SHA-256: {qa.get('video_sha256')}\n\n"
        "This rebuild retains James's approved narration, replaces the rejected visual edit, uses toggleable closed captions, "
        "and excludes Shorts/thumbnails from this review. Use the buttons to approve or request the smallest exact repair."
    )
    if not args.dry_run:
        send_message(args.target, message)
        send_video(args.target, "Continuous review proxy (full duration)", staged_proxy)
        send_message(args.target, "Long-form approval and targeted repair controls", long_form_controls(video_id))
        for index, part in enumerate(staged_parts, start=1):
            send_video(args.target, f"High-quality review part {index}/{len(staged_parts)}", part)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass",
        "dry_run": args.dry_run,
        "target": args.target,
        "release_candidate_id": release["release_candidate_id"],
        "package_sha256": release["package_sha256"],
        "video_sha256": qa["video_sha256"],
        "continuous_proxy": {"path": display_path(proxy), "sha256": sha256_file(proxy)},
        "high_quality_parts": [
            {"path": display_path(path), "sha256": sha256_file(path)} for path in parts
        ],
        "controls": "hash_bound_long_form_owner_feedback",
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(output_root(video_id) / "approval") / "long-form-discord-delivery-receipt.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Status: {payload['status']}")
    print(f"Receipt: {display_path(report)}")


if __name__ == "__main__":
    main()
