#!/usr/bin/env python3
"""Build an anatomy report from owner reference thumbnails.

When no owner reference images exist, the script records an explicit blocker
instead of pretending Pattern Lab has reference-level style data.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_thumbnail_reference_library import validate_reference_library


DEFAULT_TRAIT_MODEL = {
    "hero_object_size": "large readable subject occupying 35-65 percent of the frame",
    "foreground_depth": "foreground object/card/source element separated from background with shadow or occlusion",
    "background_separation": "background darkened or simplified behind title text",
    "title_font_weight": "bold condensed sans with minimal stroke and high contrast",
    "title_contrast": "white/yellow/red against darkened photo or solid shape",
    "mystery_gap": "one clear unanswered question, usually 2-5 words",
    "proof_object_legibility": "map/document/photo clue large enough to understand at phone size",
    "city_anchor_presence": "city name visible and not competing with the main hook",
    "mobile_shelf_readability": "headline reads at 320x180 and remains recognizable at 160x90",
}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_reference_anatomy_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    library, library_json, _library_md = validate_reference_library(video_id)
    anatomy_entries: list[dict[str, Any]] = []
    for ref in library.get("reference_images", []):
        if not ref.get("exists"):
            continue
        reference_traits = ref.get("traits", {})
        if not isinstance(reference_traits, dict):
            reference_traits = {}
        anatomy_entries.append(
            {
                "id": ref.get("id"),
                "path": ref.get("path"),
                "style_family": ref.get("style_family", "owner_reference"),
                "owner_rating": ref.get("owner_rating", ""),
                "approved_style_traits": ref.get("approved_style_traits", []),
                "anatomy_status": "pass",
                "traits": {**DEFAULT_TRAIT_MODEL, **reference_traits},
                "rights_boundary": ref.get("rights_boundary", ""),
                "copy_boundary": ref.get("copy_boundary", ""),
                "not_public_asset": bool(ref.get("not_public_asset", True)),
            }
        )

    has_refs = bool(anatomy_entries)
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if has_refs else "blocked_missing_owner_reference_images",
        "analyzer_infrastructure_status": "pass",
        "reference_library_status": library.get("status", "missing"),
        "reference_library_report": display_path(library_json),
        "reference_count": len(anatomy_entries),
        "reference_anatomy_status": "pass" if has_refs else "blocked_missing_owner_reference_images",
        "canonical_trait_model": DEFAULT_TRAIT_MODEL,
        "entries": anatomy_entries,
        "blockers": [] if has_refs else ["blocked_missing_owner_reference_images"],
        "copy_boundary": "Analyze mechanics only. Do not clone text, photos, composition, or proprietary visual identity from references.",
        "owner_reference_style_rules": [
            "raise color energy; avoid bland dark overlays",
            "use bigger premium/display typography with phone-size contrast",
            "use stunning city images, human stakes, dramatic object scale, or clean then/now contrast",
            "avoid public filler labels such as SOURCE PHOTO, RECEIPT, or SOURCE FILE",
            "never show bare redaction bars without readable surrounding words",
        ],
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
    }
    json_report = approval / "thumbnail-reference-anatomy-report.json"
    md_report = approval / "thumbnail-reference-anatomy-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Reference Anatomy Analyzer: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Infrastructure: {payload['analyzer_infrastructure_status']}",
        f"Reference count: {payload['reference_count']}",
        "",
        "## Canonical Traits Pattern Lab Should Test",
        "",
    ]
    for key, value in DEFAULT_TRAIT_MODEL.items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Pattern Lab owner reference thumbnail anatomy.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_reference_anatomy_report(args.video_id)
    print(json.dumps({"status": payload["status"], "analyzer_infrastructure_status": payload["analyzer_infrastructure_status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
