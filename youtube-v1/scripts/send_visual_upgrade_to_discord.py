#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
YOUTUBE = REPO / "youtube-v1"
sys.path.insert(0, str(YOUTUBE / "scripts"))

DEFAULT_TARGET = "channel:1503779032817209465"
DISCORD_STAGE_ROOT = Path("/tmp/openclaw/pattern-lab-review")
MAX_DISCORD_MEDIA_BYTES = 8 * 1024 * 1024
OPENCLAW_BIN = os.environ.get("OPENCLAW_BIN", "/Users/openclaw/.npm-global/bin/openclaw")


def run(command):
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")
    subprocess.run(command, cwd=REPO, check=True, env=env)


def repo_display(path):
    path = Path(path)
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def validate_channel_target(target):
    if not target.startswith("channel:"):
        raise SystemExit("Pattern Lab visual upgrade review must go to a Discord text channel: channel:<id>.")


def stage_media(video_id, path):
    path = Path(path)
    if not path.exists():
        raise SystemExit(f"Missing visual upgrade file: {repo_display(path)}")
    size = path.stat().st_size
    if size > MAX_DISCORD_MEDIA_BYTES:
        raise SystemExit(f"Visual upgrade file exceeds Discord limit: {repo_display(path)} ({size / 1024 / 1024:.1f} MB).")
    stage_dir = DISCORD_STAGE_ROOT / f"video-{video_id}" / "visual-upgrade"
    stage_dir.mkdir(parents=True, exist_ok=True)
    staged = stage_dir / path.name
    shutil.copy2(path, staged)
    os.chmod(staged, 0o600)
    return staged


def callback(action, asset_type, video_id, filename=None, reason=None):
    payload = {"action": action, "videoId": video_id, "assetType": asset_type}
    if filename:
        payload["filename"] = filename
    if reason:
        payload["reason"] = reason
    return "patternlab:" + json.dumps(payload, separators=(",", ":"))


def controls(video_id, label, filename):
    payload = {
        "title": f"James avatar concept {label}",
        "tone": "info",
        "blocks": [
            {
                "type": "context",
                "text": "Approve exactly one James avatar before it appears in a public video.",
            },
            {
                "type": "buttons",
                "buttons": [
                    {
                        "label": f"Approve James {label}",
                        "style": "success",
                        "value": callback("approve", "avatar", video_id, filename=filename),
                    },
                    {
                        "label": f"Regenerate {label}",
                        "style": "secondary",
                        "value": callback("regenerate", "avatar", video_id, filename=filename, reason="owner_requested_avatar_variant"),
                    },
                    {
                        "label": f"Reject {label}",
                        "style": "danger",
                        "value": callback("reject", "avatar", video_id, filename=filename, reason="avatar_style_not_approved"),
                    },
                ],
            },
        ],
    }
    return json.dumps(payload)


def send_message(target, message, presentation=None):
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
    if presentation:
        command.extend(["--presentation", presentation])
    run(command)


def send_media(target, message, media_path, presentation=None):
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
        "--media",
        str(media_path),
    ]
    if presentation:
        command.extend(["--presentation", presentation])
    run(command)


def main():
    parser = argparse.ArgumentParser(description="Send Pattern Lab visual upgrade concepts to Discord for approval.")
    parser.add_argument("--video-id", default="02")
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    validate_channel_target(args.target)

    subprocess.run(
        [sys.executable, "youtube-v1/scripts/patternlab_visual_upgrade.py", "--video-id", args.video_id],
        cwd=REPO,
        check=True,
    )
    root = YOUTUBE / "local-output" / f"video-{args.video_id}"
    visual_dir = root / "visual-upgrade"
    plan = stage_media(args.video_id, root / "approval" / "visual-upgrade-plan.md")
    avatars = [
        ("A", stage_media(args.video_id, visual_dir / "james_avatar_concept_a.png"), "visual-upgrade/james_avatar_concept_a.png"),
        ("B", stage_media(args.video_id, visual_dir / "james_avatar_concept_b.png"), "visual-upgrade/james_avatar_concept_b.png"),
        ("C", stage_media(args.video_id, visual_dir / "james_avatar_concept_c.png"), "visual-upgrade/james_avatar_concept_c.png"),
    ]
    styleboards = [
        stage_media(args.video_id, visual_dir / "visual_mode_lab.png"),
        stage_media(args.video_id, visual_dir / "visual_mode_judgment.png"),
        stage_media(args.video_id, visual_dir / "visual_mode_field.png"),
    ]
    intro = (
        "Pattern Lab visual upgrade pack is ready for approval.\n\n"
        "Please approve one James avatar concept before it appears in any public video. "
        "The recommended default is Avatar A because it adds human presence without a fake talking-head feel.\n\n"
        "The styleboards show how future videos will become more watchable: animated source-proof moments, decision stamps, and script-synced visual changes."
    )
    if args.dry_run:
        print(f"Target: {args.target}")
        print(intro)
        for item in [plan, *[avatar for _, avatar, _ in avatars], *styleboards]:
            print(item)
        print("Controls: per-avatar approve/regenerate/reject")
        return
    send_message(args.target, intro)
    send_media(args.target, "Visual upgrade approval plan", plan)
    for label, avatar, filename in avatars:
        send_media(args.target, f"James avatar concept {label}", avatar, controls(args.video_id, label, filename))
    for styleboard in styleboards:
        send_media(args.target, f"Pattern Lab visual styleboard: {styleboard.stem}", styleboard)


if __name__ == "__main__":
    main()
