#!/usr/bin/env python3
"""Reconcile local upload receipts with stable local media identities."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now


def resolve_receipt_media_path(root: Path, value: str) -> Path:
    """Resolve receipt paths relative to the Pattern Lab base or package root.

    Upload receipts intentionally store repo-relative display paths.  Treating
    those as cwd-relative made valid receipts look missing when this command
    was run from another working directory.
    """
    path = Path(value)
    if path.is_absolute():
        return path
    repo_root = Path(__file__).resolve().parents[2]
    if str(path).startswith("local-output/"):
        return repo_root / "youtube-v1" / path
    if str(path).startswith("youtube-v1/"):
        return repo_root / path
    return root / path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    receipts = sorted(approval.glob("youtube-upload-report*.json"))
    blockers: list[str] = []
    assets: list[dict] = []
    for receipt_path in receipts:
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            blockers.append(f"invalid_receipt:{receipt_path.name}")
            continue
        youtube_id = receipt.get("youtube_video_id")
        local_sha = receipt.get("video_file_sha256")
        file_path = resolve_receipt_media_path(root, receipt.get("video_file", ""))
        if not youtube_id:
            blockers.append(f"{receipt_path.name}:missing_youtube_video_id")
        if not local_sha:
            blockers.append(f"{receipt_path.name}:missing_video_file_sha256")
        elif file_path.exists() and sha256(file_path) != local_sha:
            blockers.append(f"{receipt_path.name}:local_sha256_mismatch")
        elif not file_path.exists():
            blockers.append(f"{receipt_path.name}:local_file_missing")
        assets.append({
            "receipt": display_path(receipt_path),
            "surface": receipt.get("surface"), "short_index": receipt.get("short_index"),
            "local_file": receipt.get("video_file"), "local_file_exists": file_path.exists(),
            "local_sha256": local_sha, "youtube_video_id": youtube_id,
            "youtube_url": receipt.get("youtube_url"), "privacy": receipt.get("privacy"),
        })
    if not receipts:
        blockers.append("no_upload_receipts_found")
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked", "asset_count": len(assets),
        "assets": assets, "blockers": blockers, "youtube_mutation": "not_performed",
    }
    json_path = approval / "asset-identity-report.json"
    md_path = approval / "asset-identity-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Asset Identity: Video {video_id}", "", f"Status: {payload['status']}", "", "## Assets", ""]
    lines.extend(f"- {a['surface']} {a['short_index'] or ''}: YouTube `{a['youtube_video_id'] or 'missing'}`; SHA `{a['local_sha256'] or 'missing'}`" for a in assets)
    lines.extend(["", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")


if __name__ == "__main__":
    main()
