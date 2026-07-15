#!/usr/bin/env python3
"""Fail closed when a Pattern Lab thumbnail's visual grammar is misleading."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_visual_acquisition_quality import image_metrics
from patternlab.thumbnail import candidate_issues, load_thumbnail_candidate_manifest, quality_status


def validate_candidate(candidate: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    blockers: list[str] = []
    composition = str(candidate.get("composition_mode", "")).strip()
    visuals = candidate.get("visual_objects", [])
    public_text = " ".join(str(value) for value in candidate.get("public_text", [])).upper()
    if composition not in {"proof_context", "map_system", "then_now"}:
        blockers.append("composition_mode_missing_or_unknown")
    if not isinstance(visuals, list) or not visuals:
        blockers.append("visual_objects_missing")
        visuals = []
    proof_objects = [item for item in visuals if isinstance(item, dict) and item.get("role") == "proof"]
    if not proof_objects:
        blockers.append("visible_proof_object_missing")
    for item in visuals:
        if not isinstance(item, dict):
            blockers.append("visual_object_not_object")
            continue
        kind = str(item.get("kind", ""))
        role = str(item.get("role", ""))
        if kind == "ai_support" and role == "proof":
            blockers.append("ai_support_presented_as_proof")
        if role == "proof" and not str(item.get("source_url", "")).strip():
            blockers.append("proof_source_url_missing")
    if composition == "then_now":
        panels = [item for item in visuals if isinstance(item, dict) and item.get("slot") in {"then", "now"}]
        if len(panels) != 2:
            blockers.append("then_now_requires_exactly_two_matched_panels")
        else:
            by_slot = {str(item.get("slot")): item for item in panels}
            then_kind = str(by_slot.get("then", {}).get("kind", ""))
            now_kind = str(by_slot.get("now", {}).get("kind", ""))
            if then_kind not in {"historical_photo", "historical_map", "historical_document"}:
                blockers.append("then_panel_is_not_historical_source")
            if now_kind not in {"modern_photo", "modern_map"}:
                blockers.append("now_panel_is_not_current_source")
            # Treat a generic map in the THEN slot as a map for the purpose of
            # the mismatch rule as well.  The separate historical-source check
            # still explains why an untyped map is invalid evidence.
            if (then_kind in {"historical_map", "map"} and now_kind == "modern_photo") or (
                then_kind == "historical_photo" and now_kind == "modern_map"
            ):
                blockers.append("then_now_modality_mismatch")
    elif "THEN" in public_text or "NOW" in public_text:
        blockers.append("then_now_label_without_then_now_composition")
    if any(str(item.get("kind", "")) == "map" and str(item.get("slot", "")) == "then" for item in visuals if isinstance(item, dict)):
        blockers.append("map_cannot_substitute_for_then_photo")
    if any(str(item.get("kind", "")) == "ai_support" for item in visuals if isinstance(item, dict)):
        visible_proof_area = float(candidate.get("visible_proof_area_ratio", 0) or 0)
        if visible_proof_area < 0.20:
            blockers.append("ai_support_requires_visible_real_proof_area_at_least_20_percent")
    if candidate.get("hero_luminance") not in {"bright", "balanced"}:
        blockers.append("hero_image_is_dim_or_unscored")
    # Do not trust a hand-authored "bright" label. Modern heroes and major
    # insets must pass pixel-derived energy floors before they can be shown.
    energy = []
    for item in visuals:
        if not isinstance(item, dict) or item.get("kind") != "modern_photo":
            continue
        raw = str(item.get("local_path") or "").strip()
        path = Path(raw) if raw else None
        if path and root and not path.is_absolute():
            path = root / path
        metrics = image_metrics(path) if path and path.is_file() else None
        row_blockers = []
        if not metrics:
            row_blockers.append("modern_thumbnail_source_metrics_unavailable")
        elif not (item.get("monochrome_intent") is True and item.get("human_monochrome_approval") is True):
            if metrics["mean_luma"] < 0.45:
                row_blockers.append("modern_thumbnail_source_luma_below_floor")
            if metrics["mean_saturation"] < 0.24:
                row_blockers.append("modern_thumbnail_source_saturation_below_floor")
            if metrics["luma_standard_deviation"] < 0.16:
                row_blockers.append("modern_thumbnail_source_contrast_below_floor")
        blockers.extend(row_blockers)
        energy.append({"slot": item.get("slot", ""), "path": str(path or ""), "metrics": metrics or {}, "blockers": row_blockers})
    if bool(candidate.get("generic_text_card", False)):
        blockers.append("generic_text_card_blocked")
    if int(candidate.get("non_city_word_count", 99) or 99) > 4:
        blockers.append("headline_over_four_non_city_words")
    return {
        "id": candidate.get("id", ""),
        "status": "pass" if not blockers else "blocked",
        "composition_mode": composition,
        "modern_visual_energy": energy,
        "blockers": blockers,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest = load_thumbnail_candidate_manifest(root)
    rows = [validate_candidate(item, root) for item in manifest.candidates]
    blockers = candidate_issues(rows, "blockers")
    if not rows:
        blockers.append("thumbnail_semantic_candidate_manifest_missing")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": quality_status(has_candidates=bool(rows), blockers=blockers),
        "candidate_count": len(rows),
        "rows": rows,
        "blockers": blockers,
        "rules": [
            "A map cannot stand in for a historical photo in a THEN/NOW thumbnail.",
            "AI support can add drama but cannot be the only visible proof object.",
            "THEN/NOW requires matched source modalities and a factual source for both panels.",
            "Modern heroes and major insets must pass measured luma, saturation, and contrast floors; metadata labels and filters cannot rescue a weak source.",
        ],
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "thumbnail-semantic-quality-report.json"
    md_path = approval / "thumbnail-semantic-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Thumbnail Semantic Quality: Video {video_id}", "", f"Status: {payload['status']}", ""]
    for row in rows:
        lines.append(f"- {row['id']}: {row['status']}")
        lines.extend(f"  - {blocker}" for blocker in row["blockers"])
    if not rows:
        lines.append("- no candidate manifest")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
