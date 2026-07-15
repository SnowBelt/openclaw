#!/usr/bin/env python3
"""Build a hash-bound inventory for an exact Pattern Lab episode archive."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MEDIA_SUFFIXES = {".mp4", ".mov", ".m4v", ".wav", ".mp3", ".m4a", ".png", ".jpg", ".jpeg", ".webp", ".svg"}
TEXT_SUFFIXES = {".json", ".md", ".txt", ".csv", ".yaml", ".yml", ".srt", ".vtt"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def classify(relative: Path) -> str:
    name = relative.as_posix().lower()
    suffix = relative.suffix.lower()
    if "short" in name and suffix in MEDIA_SUFFIXES:
        return "shorts"
    if any(token in name for token in ("thumbnail", "thumb")) and suffix in MEDIA_SUFFIXES:
        return "thumbnail"
    if any(token in name for token in ("narration", "voiceover")) and suffix in MEDIA_SUFFIXES:
        return "narration"
    if "script" in name and suffix in TEXT_SUFFIXES:
        return "script"
    if any(token in name for token in ("rights", "license", "provenance", "source-ledger")):
        return "rights_receipts"
    if any(token in name for token in ("upload", "youtube-id", "youtube_id")):
        return "upload_receipts"
    if any(token in name for token in ("approval", "owner-review", "owner_feedback")):
        return "approval_receipts"
    if any(token in name for token in ("release", "package-hash", "manifest")):
        return "release_manifests"
    if any(token in name for token in ("source-packet", "source_media", "source-media", "archive")) and suffix in MEDIA_SUFFIXES:
        return "source_media"
    if suffix in {".mp4", ".mov", ".m4v"}:
        return "long_form_master"
    return "supporting_metadata" if suffix in TEXT_SUFFIXES else "other"


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a hash-bound Pattern Lab episode archive capsule.")
    parser.add_argument("episode_root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    root = args.episode_root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise SystemExit("episode root must be a real directory")
    output = (args.output or root / "archive-capsule.json").resolve()
    rows: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.resolve() == output or path.name.endswith(".tmp"):
            continue
        relative = path.relative_to(root)
        rows.append({"relative_path": relative.as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path), "archive_class": classify(relative)})
    required = {
        "long_form_master",
        "shorts",
        "thumbnail",
        "script",
        "narration",
        "source_media",
        "rights_receipts",
        "approval_receipts",
        "upload_receipts",
        "release_manifests",
    }
    present = {row["archive_class"] for row in rows}
    missing = sorted(required - present)
    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "episode_root": str(root),
        "status": "pass" if not missing else "incomplete",
        "exact_bytes_preserved": True,
        "lossy_recompression": "not_performed",
        "zip_mp4": "not_performed",
        "file_count": len(rows),
        "total_bytes": sum(row["bytes"] for row in rows),
        "present_classes": sorted(present),
        "missing_required_classes": missing,
        "files": rows,
        "youtube_mutation": "not_performed",
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    payload["capsule_sha256"] = hashlib.sha256(canonical).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, output)
    print(json.dumps({"status": payload["status"], "output": str(output), "capsule_sha256": payload["capsule_sha256"], "missing": missing}, indent=2))
    if args.require_complete and missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
