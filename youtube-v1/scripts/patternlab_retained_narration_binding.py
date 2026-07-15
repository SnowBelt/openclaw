#!/usr/bin/env python3
"""Bind an owner-authorized retained narration to the current review package."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bind owner-authorized retained Pattern Lab narration.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--approved-script-sha256", required=True)
    parser.add_argument("--owner-retained-existing-narration", action="store_true")
    args = parser.parse_args()
    if not args.owner_retained_existing_narration:
        raise SystemExit("Owner retained-narration authorization flag is required.")

    video_id = args.video_id.zfill(2)
    root = output_root(video_id)
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    transcript = root / "audio" / "voiceover_full.txt"
    voice = root / "audio" / "voiceover_full_normalized.mp3"
    missing = [path for path in (script, transcript, voice) if not path.is_file()]
    if missing:
        raise SystemExit("Missing retained narration input(s): " + ", ".join(display_path(path) for path in missing))
    script_hash = sha256(script)
    if script_hash != args.approved_script_sha256:
        raise SystemExit(
            "Current script hash does not match the exact owner-approved script hash: "
            f"{script_hash} != {args.approved_script_sha256}"
        )

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass",
        "authorization": "owner_retained_existing_narration",
        "approved_script": {"path": display_path(script), "sha256": script_hash},
        "retained_narration_transcript": {"path": display_path(transcript), "sha256": sha256(transcript)},
        "retained_normalized_audio": {"path": display_path(voice), "sha256": sha256(voice)},
        "new_voice_generation_performed": False,
        "youtube_mutation": "not_performed",
    }
    path = ensure_dir(root / "approval") / "retained-narration-binding.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Retained narration binding: {display_path(path)}")


if __name__ == "__main__":
    main()
