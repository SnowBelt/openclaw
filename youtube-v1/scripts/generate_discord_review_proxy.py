#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, ensure_dir, ffmpeg_cmd, media_duration_seconds, output_root


REPO = BASE.parent
MAX_DISCORD_MEDIA_BYTES = 8 * 1024 * 1024


def repo_display(path):
    path = Path(path)
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def run_ffmpeg(source, target, crf):
    command = [
        ffmpeg_cmd(),
        "-y",
        "-i",
        str(source),
        "-vf",
        "scale=640:-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-c:a",
        "aac",
        "-b:a",
        "40k",
        "-movflags",
        "+faststart",
        str(target),
    ]
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description="Create a full-duration Discord-safe Pattern Lab review proxy.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = output_root(args.video_id)
    source = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    if not source.exists():
        raise SystemExit(f"Missing long-form draft: {repo_display(source)}")
    review = ensure_dir(root / "review")
    target = review / f"pattern-lab-video-{args.video_id}-draft-discord-review.mp4"
    source_duration = media_duration_seconds(source)
    if (
        target.exists()
        and not args.force
        and target.stat().st_size <= MAX_DISCORD_MEDIA_BYTES
        and media_duration_seconds(target) + 5 >= source_duration
    ):
        print(f"Discord review proxy already valid: {repo_display(target)}")
        return

    last_size = None
    for crf in [38, 41, 44, 47]:
        run_ffmpeg(source, target, crf)
        size = target.stat().st_size
        last_size = size
        if size <= MAX_DISCORD_MEDIA_BYTES:
            proxy_duration = media_duration_seconds(target)
            if proxy_duration + 5 < source_duration:
                raise SystemExit("Discord review proxy is shorter than the long-form draft.")
            print(f"Discord review proxy: {repo_display(target)} ({size / 1024 / 1024:.1f} MB)")
            return
    raise SystemExit(
        "Discord review proxy is still too large after compression: "
        f"{last_size / 1024 / 1024:.1f} MB"
    )


if __name__ == "__main__":
    main()
