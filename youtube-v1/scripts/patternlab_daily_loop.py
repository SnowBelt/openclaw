#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, media_duration_seconds, output_root, utc_now
from patternlab_legacy import active_launch_video_ids


REPO = BASE.parent
DEFAULT_TARGET = "channel:1503779032817209465"
PRODUCTION_WEEKDAYS = {0, 2, 4}
DISCORD_STAGE_ROOT = Path("/tmp/openclaw/pattern-lab-review")
OPENCLAW_BIN = os.environ.get("OPENCLAW_BIN", "/Users/openclaw/.local/bin/openclaw")


def env_with_paths():
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")
    return env


def run(command, check=True):
    print("+ " + " ".join(command))
    return subprocess.run(command, cwd=REPO, check=check, env=env_with_paths())


def package_video_ids():
    ids = []
    for video_id in active_launch_video_ids():
        path = BASE / "launch" / f"video-{video_id}"
        if (path / "package.json").exists() or (path / "final-script.md").exists():
            ids.append(video_id)
    return ids


def next_review_video_id():
    ids = package_video_ids()
    return ids[-1] if ids else "03"


def media_complete(video_id):
    root = output_root(video_id)
    required = [
        root / "video" / f"pattern-lab-video-{video_id}-draft.mp4",
        root / "images" / "thumbnail_candidate_a.png",
        root / "images" / "thumbnail_candidate_b.png",
        root / "images" / "thumbnail_candidate_c.png",
        root / "audio" / "voiceover_full_normalized.mp3",
        root / "proof-footage" / "artifact-proof-clip.mp4",
        root / "shorts" / f"pattern-lab-video-{video_id}-short-01.mp4",
        root / "shorts" / f"pattern-lab-video-{video_id}-short-02.mp4",
        root / "shorts" / f"pattern-lab-video-{video_id}-short-03.mp4",
    ]
    missing = [path for path in required if not path.exists()]
    if missing:
        return False, missing
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    try:
        duration = media_duration_seconds(long_form)
        if duration < 8 * 60 or duration > 14 * 60:
            return False, [long_form]
    except Exception:
        return False, [long_form]
    bad_shorts = []
    for index in [1, 2, 3]:
        short = root / "shorts" / f"pattern-lab-video-{video_id}-short-{index:02d}.mp4"
        try:
            short_duration = media_duration_seconds(short)
            if short_duration < 25 or short_duration > 45:
                bad_shorts.append(short)
        except Exception:
            bad_shorts.append(short)
    if bad_shorts:
        return False, bad_shorts
    return True, []


def send_status(target, video_id, status_path, missing):
    missing_lines = "\n".join(f"- {display_path(path)}" for path in missing) if missing else "- none"
    message = (
        f"Pattern Lab Video {video_id} production status.\n\n"
        "The monetization package is prepared, but a complete media review packet is not ready yet.\n\n"
        "Missing media:\n"
        f"{missing_lines}\n\n"
        "Public publishing remains blocked."
    )
    command = [
        OPENCLAW_BIN,
        "message",
        "send",
        "--channel",
        "discord",
        "--target",
        target,
        "--message",
        message,
    ]
    if status_path.exists():
        stage_dir = DISCORD_STAGE_ROOT / f"video-{video_id}"
        stage_dir.mkdir(parents=True, exist_ok=True)
        staged = stage_dir / status_path.name
        shutil.copy2(status_path, staged)
        os.chmod(staged, 0o600)
        command.extend(["--media", str(staged)])
    try:
        run(command)
    except subprocess.CalledProcessError as exc:
        root = output_root(video_id)
        approval = ensure_dir(root / "approval")
        blocker = {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "delivery_blocked_local_production_preserved",
            "delivery": "discord",
            "target": target,
            "exit_code": exc.returncode,
            "reason": "Discord delivery failed; local production artifacts remain available.",
            "public_youtube_mutation": "not_performed",
        }
        (approval / "daily-delivery-blocker-report.json").write_text(json.dumps(blocker, indent=2) + "\n", encoding="utf-8")
        (approval / "daily-delivery-blocker-report.md").write_text(
            f"# Pattern Lab Daily Delivery Blocker: Video {video_id}\n\n"
            f"Generated: {blocker['generated_at']}\n"
            f"Status: {blocker['status']}\n"
            "Public YouTube mutation: not_performed\n",
            encoding="utf-8",
        )
        print(f"Daily delivery blocked but local production preserved: {display_path(approval / 'daily-delivery-blocker-report.md')}")
        return False
    return True


def should_prepare_today(force):
    if force:
        return True
    now = datetime.now(ZoneInfo("America/New_York"))
    return now.weekday() in PRODUCTION_WEEKDAYS


def package_locked(video_id):
    root = output_root(video_id)
    approval = root / "approval"
    package_hash = approval / "package-hash-report.json"
    if package_hash.exists():
        try:
            hash_payload = json.loads(package_hash.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return False, "package hash report invalid"
        if hash_payload.get("status") != "pass" or hash_payload.get("stale_outputs") or hash_payload.get("blockers"):
            return False, "current package hash report is blocked or stale"
    upload = approval / "youtube-upload-report.json"
    repairs = approval / "repair-queue.jsonl"
    if repairs.exists():
        for line in repairs.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                return True, "unparseable repair queue requires manual review"
            if event.get("status", "queued") not in {"resolved", "closed", "cancelled"}:
                return False, "open repair queue item"
    if upload.exists():
        try:
            payload = json.loads(upload.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return False, "upload report invalid"
        if payload.get("status") == "uploaded" and payload.get("privacy") in {"private", "unlisted"}:
            media_paths = [
                root / "video" / f"pattern-lab-video-{video_id}-draft.mp4",
                root / "audio" / "voiceover_full_normalized.mp3",
                *sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")),
                *sorted((root / "images").glob("thumbnail_candidate_*.png")),
            ]
            newest_media = max((path.stat().st_mtime for path in media_paths if path.exists()), default=0)
            if newest_media > upload.stat().st_mtime:
                return False, "current local media is newer than private/unlisted upload report"
            return True, "private/unlisted upload report locks current package"
    return False, "not uploaded"


def should_prepare_new_package(selected_video, force):
    if force:
        return True
    locked, _reason = package_locked(selected_video)
    if locked:
        return False
    if selected_video not in package_video_ids():
        return True
    complete, _missing = media_complete(selected_video)
    return complete and should_prepare_today(False)


def main():
    parser = argparse.ArgumentParser(description="Run the Pattern Lab daily monetization loop.")
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--video-id")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-package", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    selected_video = args.video_id or next_review_video_id()
    if should_prepare_new_package(selected_video, args.force_package):
        factory = [sys.executable, "youtube-v1/scripts/patternlab_daily_factory.py"]
        if args.video_id:
            factory.extend(["--video-id", args.video_id])
        if args.dry_run:
            factory.append("--dry-run")
        run(factory)
        if not args.dry_run:
            selected_video = args.video_id or next_review_video_id()

    complete, missing = media_complete(selected_video)
    if args.dry_run:
        locked, lock_reason = package_locked(selected_video)
        root = output_root(selected_video)
        rendered_shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{selected_video}-short-*.mp4")) if (root / "shorts").exists() else []
        print(f"Selected review video: {selected_video}")
        print(f"Media complete: {complete}")
        print(f"Package locked: {locked} ({lock_reason})")
        print(f"Generated Shorts count: {len(rendered_shorts)}")
        print("Review Shorts policy: review all rendered Shorts")
        print("Upload/public policy: use top 3 Shorts unless owner approves more")
        for path in missing:
            print(f"Missing: {display_path(path)}")
        return

    if complete:
        run([sys.executable, "youtube-v1/scripts/patternlab_package_hashes.py", "--video-id", selected_video], check=False)
        run([sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", selected_video], check=False)
        run([sys.executable, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", selected_video], check=False)
        readiness = output_root(selected_video) / "approval" / "private-upload-readiness.json"
        readiness_payload = {}
        if readiness.exists():
            try:
                readiness_payload = json.loads(readiness.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                readiness_payload = {}
        if readiness_payload.get("status") != "private-upload-ready":
            print("Review delivery withheld because current package readiness is not passing.")
            return
        run([sys.executable, "youtube-v1/scripts/send_daily_review_to_discord.py", "--video-id", selected_video, "--target", args.target])
        return

    root = output_root(selected_video)
    run([sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", selected_video], check=False)
    run([sys.executable, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", selected_video], check=False)
    readiness = root / "approval" / "private-upload-readiness.md"
    preflight = root / "approval" / "patternlab-preflight.md"
    status = preflight if preflight.exists() else readiness if readiness.exists() else root / "approval" / "daily-production-status.md"
    if not send_status(args.target, selected_video, status, missing):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
