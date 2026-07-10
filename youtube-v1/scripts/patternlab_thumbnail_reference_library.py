#!/usr/bin/env python3
"""Validate the owner reference thumbnail library infrastructure.

Reference thumbnails are style/anatomy inputs only. This script never copies,
traces, downloads, uploads, publishes, or mutates YouTube.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

LIBRARY_PATH = BASE / "resources" / "thumbnail-reference-library.json"
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def resolve_reference_path(value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    return BASE / candidate


def validate_reference_library(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    library = read_json(LIBRARY_PATH)
    reference_images = library.get("reference_images", [])
    if not isinstance(reference_images, list):
        reference_images = []

    entries: list[dict[str, Any]] = []
    blockers: list[str] = []
    for index, item in enumerate(reference_images, start=1):
        if not isinstance(item, dict):
            blockers.append(f"reference_{index}:invalid_entry")
            continue
        raw_path = str(item.get("path") or item.get("file") or "").strip()
        image_path = resolve_reference_path(raw_path) if raw_path else Path("")
        exists = bool(raw_path and image_path.exists() and image_path.is_file())
        suffix_ok = image_path.suffix.lower() in ALLOWED_IMAGE_SUFFIXES if raw_path else False
        if not raw_path:
            blockers.append(f"reference_{index}:path_missing")
        elif not exists:
            blockers.append(f"reference_{index}:file_missing:{raw_path}")
        elif not suffix_ok:
            blockers.append(f"reference_{index}:unsupported_image_suffix:{image_path.suffix}")
        entries.append(
            {
                "id": str(item.get("id") or f"reference_{index}"),
                "path": display_path(image_path) if raw_path else "missing",
                "exists": exists,
                "suffix_ok": suffix_ok,
                "style_family": item.get("style_family", "owner_reference"),
                "owner_rating": item.get("owner_rating", ""),
                "owner_feedback_date": item.get("owner_feedback_date", ""),
                "approved_style_traits": item.get("approved_style_traits", []),
                "traits": item.get("traits", {}),
                "rights_boundary": item.get("rights_boundary", ""),
                "copy_boundary": item.get("copy_boundary", ""),
                "not_public_asset": bool(item.get("not_public_asset", True)),
                "notes": item.get("notes", ""),
            }
        )

    existing_count = sum(1 for item in entries if item["exists"] and item["suffix_ok"])
    required_count = int(library.get("required_owner_reference_image_count", 3) or 3)
    missing_references = existing_count < required_count
    status = "pass" if not blockers and not missing_references else "blocked_missing_owner_reference_images"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "infrastructure_status": "pass" if LIBRARY_PATH.exists() else "blocked",
        "library_file": display_path(LIBRARY_PATH),
        "reference_image_directory": library.get("reference_image_directory", "resources/thumbnail-reference-library"),
        "reference_image_count": len(entries),
        "existing_reference_image_count": existing_count,
        "required_owner_reference_image_count": required_count,
        "reference_images_missing": missing_references,
        "blocking_reason": "blocked_missing_owner_reference_images" if missing_references else "none",
        "analysis_dimensions": library.get("analysis_dimensions", []),
        "hard_rules": library.get("hard_rules", []),
        "reference_images": entries,
        "blockers": blockers,
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
        "canva": "not_used",
        "completion_boundary": "Infrastructure is ready. Reference style matching remains blocked until owner reference thumbnail image files are added to the library.",
    }
    json_report = approval / "thumbnail-reference-library-report.json"
    md_report = approval / "thumbnail-reference-library-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Thumbnail Reference Library: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Infrastructure: {payload['infrastructure_status']}",
        f"References: {existing_count}/{required_count}",
        "Public YouTube mutation: not performed",
        "Paid tools / Canva: not used",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or (["- blocked_missing_owner_reference_images"] if missing_references else ["- none"])),
        "",
        "## Hard Rules",
        "",
        *[f"- {item}" for item in payload["hard_rules"]],
    ]
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab owner reference thumbnail library infrastructure.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = validate_reference_library(args.video_id)
    print(json.dumps({"status": payload["status"], "infrastructure_status": payload["infrastructure_status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
