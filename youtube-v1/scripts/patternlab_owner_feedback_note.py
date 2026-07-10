#!/usr/bin/env python3
import argparse
import json

from patternlab_common import display_path, ensure_dir, output_root
from patternlab_discord_feedback import append_owner_feedback, parse_owner_note


def main():
    parser = argparse.ArgumentParser(description="Parse a Pattern Lab owner timestamp/freeform feedback note.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--text", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = output_root(args.video_id)
    event = parse_owner_note(args.video_id, args.text)
    result = {"ok": True, "dry_run": args.dry_run, "event": event, "youtube_mutation": "not_performed"}
    if not args.dry_run:
        path = append_owner_feedback(root, event)
        result["owner_feedback_file"] = display_path(path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
