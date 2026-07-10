#!/usr/bin/env python3
import argparse
import subprocess
import sys

from patternlab_common import BASE


def run(command):
    print("+ " + " ".join(command))
    subprocess.run(command, cwd=BASE.parent, check=True)


def main():
    parser = argparse.ArgumentParser(description="Run the Pattern Lab local media pipeline.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--live", action="store_true", help="Generate live ElevenLabs voiceover before assembly.")
    args = parser.parse_args()

    voiceover_args = [sys.executable, "youtube-v1/scripts/generate_voiceover.py", "--video-id", args.video_id]
    voiceover_args.append("--live" if args.live else "--assembly-draft")
    run([sys.executable, "youtube-v1/scripts/generate_upload_metadata.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/patternlab_retention_ladder.py", "--video-id", args.video_id])
    run(voiceover_args)
    run([sys.executable, "youtube-v1/scripts/source_visual_rebuild_assets.py", "--video-id", args.video_id, "--reuse-if-ready"])
    run([sys.executable, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/patternlab_visual_quality.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", args.video_id, "--dry-run"])
    run([sys.executable, "youtube-v1/scripts/monetization_gates.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/patternlab_quality_gates.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", args.video_id])
    run([sys.executable, "youtube-v1/scripts/patternlab_monetization_tracker.py"])
    run([sys.executable, "youtube-v1/scripts/patternlab_content_calendar.py"])


if __name__ == "__main__":
    main()
