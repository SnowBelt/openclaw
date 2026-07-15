#!/usr/bin/env python3
import argparse
import math
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


def run_ffmpeg(source, target, crf, *, scale):
    command = [
        ffmpeg_cmd(),
        "-y",
        "-i",
        str(source),
        "-vf",
        scale,
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


def run_long_part(source: Path, target: Path, *, start: float, duration: float) -> None:
    command = [
        ffmpeg_cmd(), "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(source), "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", "520k", "-maxrate", "600k", "-bufsize", "1200k", "-c:a", "aac",
        "-b:a", "48k", "-movflags", "+faststart", str(target),
    ]
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description="Create a full-duration Discord-safe Pattern Lab review proxy.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--long-form-only", action="store_true")
    args = parser.parse_args()

    root = output_root(args.video_id)
    source = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    if not source.exists():
        raise SystemExit(f"Missing long-form draft: {repo_display(source)}")
    review = ensure_dir(root / "review")
    target = review / f"pattern-lab-video-{args.video_id}-draft-discord-review.mp4"
    source_duration = media_duration_seconds(source)
    long_proxy_current = (
        target.exists()
        and not args.force
        and target.stat().st_size <= MAX_DISCORD_MEDIA_BYTES
        and media_duration_seconds(target) + 5 >= source_duration
        and target.stat().st_mtime >= source.stat().st_mtime
    )
    if long_proxy_current:
        print(f"Discord review proxy already valid: {repo_display(target)}")
    else:
        last_size = None
        for crf in [38, 41, 44, 47]:
            run_ffmpeg(source, target, crf, scale="scale=640:-2")
            size = target.stat().st_size
            last_size = size
            if size <= MAX_DISCORD_MEDIA_BYTES:
                proxy_duration = media_duration_seconds(target)
                if proxy_duration + 5 < source_duration:
                    raise SystemExit("Discord review proxy is shorter than the long-form draft.")
                print(f"Discord review proxy: {repo_display(target)} ({size / 1024 / 1024:.1f} MB)")
                break
        else:
            raise SystemExit(
                "Discord review proxy is still too large after compression: "
                f"{last_size / 1024 / 1024:.1f} MB"
            )

    part_seconds = 90.0
    part_count = math.ceil(source_duration / part_seconds)
    for index in range(part_count):
        start = index * part_seconds
        duration = min(part_seconds, source_duration - start)
        part = review / f"pattern-lab-video-{args.video_id}-draft-discord-review-part-{index + 1:02d}.mp4"
        current = (
            part.exists()
            and not args.force
            and part.stat().st_mtime >= source.stat().st_mtime
            and part.stat().st_size <= MAX_DISCORD_MEDIA_BYTES
            and abs(media_duration_seconds(part) - duration) <= 1.0
        )
        if not current:
            run_long_part(source, part, start=start, duration=duration)
        if part.stat().st_size > MAX_DISCORD_MEDIA_BYTES:
            raise SystemExit(f"High-quality Discord review part is too large: {repo_display(part)}")
        print(
            f"Discord high-quality part {index + 1}/{part_count}: {repo_display(part)} "
            f"({part.stat().st_size / 1024 / 1024:.1f} MB)"
        )

    if args.long_form_only:
        return

    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{args.video_id}-short-*.mp4"))
    if len(shorts) < 3:
        raise SystemExit("At least three rendered Shorts are required for Discord review.")
    for short in shorts:
        short_target = review / f"{short.stem}-discord-review.mp4"
        source_duration = media_duration_seconds(short)
        if (
            short_target.exists()
            and not args.force
            and short_target.stat().st_size <= MAX_DISCORD_MEDIA_BYTES
            and media_duration_seconds(short_target) + 0.25 >= source_duration
            and short_target.stat().st_mtime >= short.stat().st_mtime
        ):
            print(f"Discord Short proxy already valid: {repo_display(short_target)}")
            continue
        short_size = None
        for crf in [30, 33, 36, 39]:
            run_ffmpeg(short, short_target, crf, scale="scale=720:-2")
            short_size = short_target.stat().st_size
            if short_size <= MAX_DISCORD_MEDIA_BYTES:
                proxy_duration = media_duration_seconds(short_target)
                if proxy_duration + 0.25 < source_duration:
                    raise SystemExit(f"Discord review proxy is shorter than {short.name}.")
                print(
                    f"Discord Short proxy: {repo_display(short_target)} "
                    f"({short_size / 1024 / 1024:.1f} MB)"
                )
                break
        else:
            raise SystemExit(
                f"Discord review proxy for {short.name} is still too large after compression: "
                f"{short_size / 1024 / 1024:.1f} MB"
            )


if __name__ == "__main__":
    main()
