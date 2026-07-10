#!/usr/bin/env python3
"""Premium Fontsource typography tournament for Pattern Lab thumbnails."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_premium_font_common import (
    EFFECT_RECIPES_PATH,
    FONT_PACK_PATH,
    MAX_NON_CITY_PUBLIC_WORDS,
    MIN_TOURNAMENT_VARIANTS,
    MIN_TOURNAMENT_WINNERS,
    MIN_WINNER_SCORE,
    active_city,
    chrome_render,
    rendered_entry_checks,
    score_entry,
    tournament_specs,
    write_json,
)


def build_font_tournament_report(video_id: str, city: str | None = None) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    resolved_city = (city or active_city(root)).upper()
    specs = tournament_specs(root, resolved_city)
    blockers: list[str] = []
    if len(specs) < MIN_TOURNAMENT_VARIANTS:
        blockers.append(f"font_tournament_variant_count_too_low:{len(specs)}<{MIN_TOURNAMENT_VARIANTS}")
    render = chrome_render(specs, root, "thumbnail-font-tournament-renderer-report.json", "thumbnail-font-tournament-contact-sheet.jpg", "thumbnail-font-tournament-mobile-previews")
    ledger = render["ledger"]
    helper = render["helper"]
    if ledger.get("status") != "pass":
        blockers.append("font_ledger_blocked")
    if helper.get("status") != "pass":
        blockers.extend(helper.get("blockers", ["chrome_renderer_blocked"]))
    previews = helper.get("previews", []) if isinstance(helper.get("previews"), list) else []
    entries: list[dict[str, Any]] = []
    preview_count = 0
    for spec in specs:
        out = Path(spec["out"])
        checks = rendered_entry_checks(spec, out, include_ocr=False)
        scoring = score_entry(spec)
        variant_previews = [preview for preview in previews if preview.get("variant_id") == spec["variant_id"]]
        preview_count += sum(1 for preview in variant_previews if preview.get("exists"))
        text_budget_fail = checks["public_text_budget_status"] != "pass"
        if checks["dimension_status"] != "pass":
            blockers.append(f"{out.name}:render_or_dimensions_failed:{checks['width']}x{checks['height']}")
        if scoring["support_over_word_limit"]:
            blockers.append(f"{out.name}:support_text_over_4_words")
        if scoring["support_squeezed"]:
            blockers.append(f"{out.name}:squeezed_bottom_text")
        if scoring["generic_font_violation"]:
            blockers.append(f"{out.name}:generic_font_violation")
        if checks["filler_public_label_hits"]:
            blockers.append(f"{out.name}:filler_public_label:{','.join(checks['filler_public_label_hits'])}")
        if checks["bare_redaction_hits"]:
            blockers.append(f"{out.name}:bare_redaction:{','.join(checks['bare_redaction_hits'])}")
        if text_budget_fail:
            blockers.append(f"{out.name}:public_text_budget_violation:{checks['non_city_public_word_count']}>{MAX_NON_CITY_PUBLIC_WORDS}")
        entries.append({
            "variant_id": spec["variant_id"],
            "file": out.name,
            "path": str(out),
            "width": checks["width"],
            "height": checks["height"],
            "city": spec["city"],
            "main_text": spec["main"].replace("\n", " "),
            "support_text": spec["support"],
            "city_font": spec["city_font_family"],
            "main_font": spec["main_font_family"],
            "support_font": spec["support_font_family"],
            "effect_recipe_id": spec["effect_recipe_id"],
            "scores": {k: scoring[k] for k in ("boldness", "contrast", "sexiness_premium_feel", "phone_readability", "reference_match", "non_generic_feel", "text_fit", "overall_score")},
            "winner": scoring["winner"],
            "support_word_count": scoring["support_word_count"],
            "support_over_word_limit": scoring["support_over_word_limit"],
            "support_squeezed": scoring["support_squeezed"],
            "generic_font_violation": scoring["generic_font_violation"],
            "non_city_public_word_count": checks["non_city_public_word_count"],
            "filler_public_label_hits": checks["filler_public_label_hits"],
            "bare_redaction_hits": checks["bare_redaction_hits"],
            "shelf_previews": variant_previews,
            "purpose_labeled_shapes": ["city_anchor", "main_hook", "support_label", "source_photo_background", "text_effect_recipe"],
            "public_youtube_mutation": "not_performed",
        })
    winner_count = sum(1 for entry in entries if entry["winner"])
    required_preview_count = len(entries) * 2
    min_reference_score = min((entry["scores"]["reference_match"] for entry in entries), default=0)
    min_non_generic_score = min((entry["scores"]["non_generic_feel"] for entry in entries), default=0)
    bottom_over_count = sum(1 for entry in entries if entry["support_over_word_limit"])
    squeezed_count = sum(1 for entry in entries if entry["support_squeezed"])
    generic_count = sum(1 for entry in entries if entry["generic_font_violation"])
    filler_count = sum(len(entry["filler_public_label_hits"]) for entry in entries)
    bare_count = sum(len(entry["bare_redaction_hits"]) for entry in entries)
    text_budget_violation_count = sum(1 for entry in entries if entry["non_city_public_word_count"] > MAX_NON_CITY_PUBLIC_WORDS)
    if winner_count < MIN_TOURNAMENT_WINNERS:
        blockers.append(f"font_tournament_winner_count_too_low:{winner_count}<{MIN_TOURNAMENT_WINNERS}")
    if preview_count != required_preview_count:
        blockers.append(f"font_tournament_mobile_previews_missing:{preview_count}/{required_preview_count}")
    status = "pass" if not blockers and len(entries) >= MIN_TOURNAMENT_VARIANTS and winner_count >= MIN_TOURNAMENT_WINNERS and preview_count == required_preview_count and min_reference_score >= MIN_WINNER_SCORE and min_non_generic_score >= MIN_WINNER_SCORE else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": resolved_city,
        "status": status,
        "font_tournament_status": status,
        "renderer_path": "headless_chrome_fontsource_html_css_no_network",
        "font_pack_manifest": display_path(FONT_PACK_PATH),
        "text_effect_recipe_manifest": display_path(EFFECT_RECIPES_PATH),
        "font_ledger_status": ledger.get("status", "missing"),
        "open_license_font_count": ledger.get("font_count", 0),
        "open_license_font_families": ledger.get("font_families", []),
        "variant_count": len(entries),
        "winning_variant_count": winner_count,
        "winning_count": winner_count,
        "minimum_required_variant_count": MIN_TOURNAMENT_VARIANTS,
        "minimum_required_winning_count": MIN_TOURNAMENT_WINNERS,
        "minimum_winner_score": MIN_WINNER_SCORE,
        "bottom_text_fit_status": "pass" if bottom_over_count == 0 and squeezed_count == 0 else "blocked",
        "bottom_text_over_word_limit_count": bottom_over_count,
        "squeezed_bottom_text_count": squeezed_count,
        "generic_font_blocker_status": "pass" if generic_count == 0 and min_non_generic_score >= MIN_WINNER_SCORE else "blocked",
        "generic_font_violation_count": generic_count,
        "reference_typography_match_status": "pass" if min_reference_score >= MIN_WINNER_SCORE else "blocked",
        "reference_typography_min_score": min_reference_score,
        "non_generic_min_score": min_non_generic_score,
        "mobile_shelf_preview_status": "pass" if preview_count == required_preview_count and required_preview_count > 0 else "blocked",
        "mobile_shelf_preview_count": preview_count,
        "required_mobile_shelf_preview_count": required_preview_count,
        "support_text_max_words": 4,
        "filler_public_label_blocker_status": "pass" if filler_count == 0 else "blocked",
        "filler_public_label_violation_count": filler_count,
        "bare_redaction_blocker_status": "pass" if bare_count == 0 else "blocked",
        "bare_redaction_violation_count": bare_count,
        "public_text_budget_status": "pass" if text_budget_violation_count == 0 else "blocked",
        "public_text_budget_violation_count": text_budget_violation_count,
        "contact_sheet": str(approval / "thumbnail-font-tournament-contact-sheet.jpg"),
        "entries": entries,
        "blockers": sorted(set(str(blocker) for blocker in blockers)),
        "public_youtube_mutation": "not_performed",
        "canva": "not_used",
        "paid_tools": "not_used",
        "image_generation": "not_used",
        "milestones_supported": [231, 232, 233, 235, 236, 237, 238, 239, 240, 243],
    }
    json_report = approval / "thumbnail-font-tournament-report.json"
    md_report = approval / "thumbnail-font-tournament-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Premium Font Tournament: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {payload['city']}",
        f"Variants: {payload['variant_count']}",
        f"Winning variants: {payload['winning_variant_count']} at {MIN_WINNER_SCORE}/10+",
        f"Font ledger: {payload['font_ledger_status']} ({payload['open_license_font_count']} fonts)",
        f"Generic font blocker: {payload['generic_font_blocker_status']}",
        f"Reference typography match: {payload['reference_typography_match_status']} (min {payload['reference_typography_min_score']}/10)",
        f"Mobile previews: {payload['mobile_shelf_preview_count']}/{payload['required_mobile_shelf_preview_count']}",
        "Public YouTube mutation: not performed",
        "Canva / paid tools / image generation: not used",
        "",
        "## Top Variants",
        "",
    ]
    for entry in sorted(entries, key=lambda item: item["scores"]["overall_score"], reverse=True)[:12]:
        lines.append(f"- {entry['variant_id']}: {entry['scores']['overall_score']}/10 — {entry['main_text']} / {entry['support_text']} — {entry['main_font']} + {entry['effect_recipe_id']}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the Pattern Lab premium Fontsource typography tournament locally.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city")
    args = parser.parse_args()
    payload, json_report, _md_report = build_font_tournament_report(args.video_id, args.city)
    print(json.dumps({"status": payload["status"], "variant_count": payload.get("variant_count"), "winning_count": payload.get("winning_count"), "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
