#!/usr/bin/env python3
import argparse
from pathlib import Path

from patternlab_common import append_ledger, load_dotenv, output_root, utc_now


def main():
    parser = argparse.ArgumentParser(description="Record existing Pattern Lab media assets in the rights ledger.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    for image in sorted((root / "images").glob("*.png")):
        asset_type = "thumbnail" if image.name.startswith("thumbnail") else "image"
        append_ledger(
            root,
            {
                "asset_id": f"video-{args.video_id}-{asset_type}-{image.stem}",
                "asset_type": asset_type,
                "filename": str(image.relative_to(root)),
                "tool": "Codex image generation",
                "model_or_service": "local-reviewed-asset",
                "source_prompt_or_source_file": "launch/video-01/image-prompts.md",
                "license_status": "owner-reviewed original Pattern Lab asset",
                "created_at": utc_now(),
                "notes": image.stem,
                "human_review_required": "yes",
                "human_review_status": "pending",
            },
        )
    print(f"Recorded assets from {root}")


if __name__ == "__main__":
    main()
