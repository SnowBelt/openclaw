#!/usr/bin/env python3
"""Render Cleveland's Cuyahoga River Fire thumbnail review set.

This is deliberately a review-only package.  The official EPA page identifies
the visible fire photograph as 1952, but the underlying Cleveland Press image
needs a direct archive reuse confirmation before any public use.  The renderer
therefore proves the packaging, typography, source binding, and owner-visible
delivery surface without silently treating the asset as publication-cleared.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_premium_font_common import chrome_render, export_chat_delivery
from patternlab_thumbnail_worldclass import sha256


EPA_LANDING = "https://19january2021snapshot.epa.gov/sciencematters/putting-out-fire-50-years-science-protect-americas-water_.html"
EPA_IMAGE = "https://19january2021snapshot.epa.gov/sites/static/files/styles/large/public/2020-02/river_fire.jpg"


def _source_rows(source: Path) -> list[dict[str, Any]]:
    return [
        {
            "asset_id": "epa-cuyahoga-river-fire-1952",
            "asset_type": "historical_photo",
            "filename": "epa-cuyahoga-river-fire-1952.jpg",
            "source_title": "The Cuyahoga River on fire in 1952",
            "source_url": EPA_LANDING,
            "direct_asset_url": EPA_IMAGE,
            "creator": "Cleveland Press Collection / photographer attribution requires direct archive confirmation",
            "archive_or_platform": "U.S. Environmental Protection Agency historical snapshot",
            "source_class": "historical_evidence_review_only",
            "license_or_rights_basis": "Official EPA page identifies the image and date; underlying commercial reuse rights are pending direct archive confirmation.",
            "attribution_required": "pending",
            "attribution_text": "Pending direct archive confirmation",
            "commercial_use_ok": "pending",
            "modification_ok": "pending",
            "recognizable_people_property_trademark_risk": "low",
            "ai_reconstruction_disclosure": "not_applicable",
            "human_review_status": "rights_hold_before_publication",
            "sha256": sha256(source / "epa-cuyahoga-river-fire-1952.jpg"),
        },
        *[
            {
                "asset_id": item[0],
                "asset_type": "ai_thumbnail_support",
                "filename": item[1],
                "source_title": "Pattern Lab owner-approved Codex support plate",
                "source_url": "",
                "creator": "Codex image generation",
                "archive_or_platform": "Codex built-in image generation",
                "source_class": "ai_thumbnail_support",
                "license_or_rights_basis": "Owner-approved Pattern Lab non-proof support workflow.",
                "attribution_required": "no",
                "attribution_text": "",
                "commercial_use_ok": "review_only_pending_final_tool-and-release-check",
                "modification_ok": "yes",
                "recognizable_people_property_trademark_risk": "none_intended",
                "ai_reconstruction_disclosure": "non-proof support; never archival evidence",
                "human_review_status": "approved_non_proof_support_only",
                "sha256": sha256(source / item[1]),
            }
            for item in (
                ("codex-cleveland-terminal-tower-support", "codex-cleveland-terminal-tower-support.png"),
                ("codex-cleveland-cuyahoga-support", "codex-cleveland-cuyahoga-support.png"),
                ("codex-cleveland-streetcar-support", "codex-cleveland-streetcar-support.png"),
            )
        ],
    ]


def _specs(source: Path, review: Path) -> list[dict[str, Any]]:
    fire = source / "epa-cuyahoga-river-fire-1952.jpg"
    terminal = source / "codex-cleveland-terminal-tower-support.png"
    river = source / "codex-cleveland-cuyahoga-support.png"
    streetcar = source / "codex-cleveland-streetcar-support.png"
    common: dict[str, Any] = {
        "city": "CLEVELAND",
        "city_font_family": "Bebas Neue",
        "main_font_family": "Anton",
        "support_font_family": "Bebas Neue",
        "inset_image": str(fire),
        "inset_label": "",
        "inset_border": "#FFD600",
        "inset_width": 765,
        "inset_height": 590,
        "inset_top": 165,
        "inset_right": 46,
        "saturation": 1.28,
        "brightness": 1.18,
        "contrast": 1.13,
        "background_position": "center",
        "generic_text_card": False,
        "visible_proof_area_ratio": 0.31,
        "hero_luminance": "bright",
        "proof_object": "Official EPA page caption identifying the Cuyahoga fire photograph as 1952",
        "source_rights_status": "review_only_rights_hold_before_publication",
        "typography": {
            "city_font": "Bebas Neue",
            "main_font": "Anton",
            "support_font": "Bebas Neue",
            "city_stroke_width": 3,
            "main_stroke_width": 3,
            "support_stroke_width": 0,
        },
        "visual_objects": [
            {"role": "support", "kind": "ai_support", "source_url": "", "local_path": "", "slot": "background"},
            {"role": "proof", "kind": "historical_photo", "source_url": EPA_LANDING, "local_path": str(fire), "slot": "inset"},
        ],
    }
    rows = [
        {
            **common,
            "id": "cleveland-city-dominant-photo-not-69",
            "variant_id": "cleveland-city-dominant-photo-not-69",
            "out": str(review / "cleveland-01-that-photo-wasnt-69.png"),
            "image": str(river),
            "city_color": "#FFFFFF",
            "city_size": 210,
            "city_width": 1060,
            "main": "PHOTO\nNOT 1969",
            "main_left": 70,
            "main_top": 292,
            "main_width": 980,
            "main_size": 226,
            "main_tracking": -3,
            "effect_recipe_id": "editorial_white_glow",
            "inset_rotate": -2,
            "title_pair": "Cleveland's Famous River Fire Photo Wasn't From 1969",
            "thumbnail_hook": "CLEVELAND — PHOTO NOT 1969",
            "composition_mode": "proof_context",
            "public_text": ["CLEVELAND", "PHOTO", "NOT 1969"],
            "non_city_word_count": 3,
            "ocr_regions": [[0.02, 0.02, 0.64, 0.21], [0.02, 0.24, 0.56, 0.65]],
            "viewer_reason": "A local-recognition city lockup plus a compact, verifiable contradiction about a famous image that survives a phone shelf.",
            "visual_objects": [
                {"role": "support", "kind": "ai_support", "source_url": "", "local_path": str(river), "slot": "background"},
                {"role": "proof", "kind": "historical_photo", "source_url": EPA_LANDING, "local_path": str(fire), "slot": "inset"},
            ],
        },
        {
            **common,
            "id": "cleveland-mystery-photo-is-1952",
            "variant_id": "cleveland-mystery-photo-is-1952",
            "out": str(review / "cleveland-02-the-photo-is-1952.png"),
            "image": str(terminal),
            "brightness": 1.36,
            "contrast": 1.08,
            "city_color": "#FFD600",
            "city_size": 192,
            "city_width": 980,
            "main": "THIS IS\n1952",
            "main_left": 70,
            "main_top": 302,
            "main_width": 940,
            "main_size": 234,
            "main_tracking": -4,
            "effect_recipe_id": "editorial_white_glow",
            "inset_rotate": 2,
            "title_pair": "The Cuyahoga River Fire Photo Everyone Gets Wrong",
            "thumbnail_hook": "CLEVELAND — THIS IS 1952",
            "composition_mode": "proof_context",
            "public_text": ["CLEVELAND", "THIS IS", "1952"],
            "non_city_word_count": 3,
            "ocr_regions": [[0.02, 0.02, 0.64, 0.21], [0.02, 0.24, 0.56, 0.65]],
            "viewer_reason": "The date itself becomes the mystery; the actual historic image is large enough to verify the promise at shelf size.",
            "visual_objects": [
                {"role": "support", "kind": "ai_support", "source_url": "", "local_path": str(terminal), "slot": "background"},
                {"role": "proof", "kind": "historical_photo", "source_url": EPA_LANDING, "local_path": str(fire), "slot": "inset"},
            ],
        },
        {
            **common,
            "id": "cleveland-transformation-river-burned",
            "variant_id": "cleveland-transformation-river-burned",
            "out": str(review / "cleveland-03-the-river-burned.png"),
            "image": str(streetcar),
            "city_color": "#FFFFFF",
            "city_size": 200,
            "city_width": 1040,
            "main": "RIVER\nON FIRE",
            "main_left": 70,
            "main_top": 310,
            "main_width": 890,
            "main_size": 224,
            "main_tracking": -4,
            "effect_recipe_id": "editorial_gold_ink",
            "support_hidden": True,
            "inset_rotate": -3,
            "title_pair": "When Cleveland's River Caught Fire",
            "thumbnail_hook": "CLEVELAND — RIVER ON FIRE",
            "composition_mode": "proof_context",
            "public_text": ["CLEVELAND", "RIVER", "ON FIRE"],
            "non_city_word_count": 3,
            "ocr_regions": [[0.02, 0.02, 0.64, 0.21], [0.02, 0.24, 0.54, 0.65]],
            "viewer_reason": "The high-stakes event promise is immediate, while the year and real image make it a source-led Cleveland story rather than generic disaster packaging.",
            "visual_objects": [
                {"role": "support", "kind": "ai_support", "source_url": "", "local_path": str(streetcar), "slot": "background"},
                {"role": "proof", "kind": "historical_photo", "source_url": EPA_LANDING, "local_path": str(fire), "slot": "inset"},
            ],
        },
    ]
    return rows


def build(video_id: str) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    source = root / "source-packet" / "thumbnail-worldclass"
    required = [
        source / "epa-cuyahoga-river-fire-1952.jpg",
        source / "codex-cleveland-terminal-tower-support.png",
        source / "codex-cleveland-cuyahoga-support.png",
        source / "codex-cleveland-streetcar-support.png",
    ]
    missing = [display_path(item) for item in required if not item.is_file()]
    if missing:
        raise SystemExit("Cleveland source packet is incomplete: " + ", ".join(missing))
    approval = ensure_dir(root / "approval")
    review = ensure_dir(root / "review" / "thumbnail-cleveland-river-fire")
    ledger_path = source / "rights-ledger.json"
    ledger_path.write_text(json.dumps({"generated_at": utc_now(), "video_id": video_id, "status": "review_only_rights_hold_before_publication", "assets": _source_rows(source)}, indent=2) + "\n", encoding="utf-8")
    brief = {
        "video_id": video_id,
        "city": "Cleveland",
        "viewer_promise": "Explain why the famous Cuyahoga River fire image is dated 1952 even though the 1969 fire became the national symbol.",
        "hidden_history_question": "How did a 1952 image become fused in public memory with Cleveland's 1969 fire?",
        "proof_object": "Official EPA page caption identifying the photograph as 1952",
        "city_anchor": "CLEVELAND lockup plus Cuyahoga/Terminal Tower support environment",
        "emotion": "surprise, local recognition, and historical correction without denying the 1969 fire",
        "hero_subject": "the dated 1952 Cuyahoga River fire image, shown as a visible proof object",
        "headline_options": ["THAT PHOTO WASN'T '69", "THE PHOTO IS 1952", "THE RIVER BURNED"],
        "color_direction": "vivid cobalt/azure and warm gold; clean white/yellow display type, near-black stroke, small signal-red depth accent",
        "source_asset_ids": ["epa-cuyahoga-river-fire-1952"],
        "forbidden_claims": ["the 1969 Cuyahoga fire never happened", "the EPA image has cleared commercial reuse", "AI support is archival evidence"],
        "first_30_second_payoff": "Show the same EPA captioned 1952 photograph and then distinguish the 1952 and June 22, 1969 fires.",
        "ai_support_policy": "non_proof_support_only",
        "template_families": ["proof_object_context", "archival_modern_composite", "landmark_story"],
    }
    (approval / "thumbnail-worldclass-brief.json").write_text(json.dumps(brief, indent=2) + "\n", encoding="utf-8")
    specs = _specs(source, review)
    render = chrome_render(specs, root, "thumbnail-cleveland-river-fire-render.json", "thumbnail-cleveland-river-fire-contact-sheet.jpg", "thumbnail-cleveland-river-fire-shelf-previews")
    helper = render.get("helper", {}) if isinstance(render.get("helper"), dict) else {}
    entries = {str(item.get("variant_id")): item for item in helper.get("entries", []) if isinstance(item, dict)}
    candidates = []
    for spec in specs:
        out = Path(str(spec["out"]))
        candidates.append({
            "id": spec["id"], "variant_id": spec["variant_id"], "path": display_path(out),
            "sha256": sha256(out) if out.is_file() else "", "title_pair": spec["title_pair"],
            "thumbnail_hook": spec["thumbnail_hook"], "composition_mode": spec["composition_mode"],
            "visual_objects": spec["visual_objects"], "visible_proof_area_ratio": spec["visible_proof_area_ratio"],
            "hero_luminance": spec["hero_luminance"], "generic_text_card": False,
            "public_text": spec["public_text"], "non_city_word_count": spec["non_city_word_count"],
            "typography": spec["typography"], "proof_object": spec["proof_object"],
            "viewer_reason": spec["viewer_reason"], "source_rights_status": spec["source_rights_status"],
            "city": spec["city"], "ocr_regions": spec.get("ocr_regions", []),
            "renderer_entry": entries.get(spec["variant_id"], {}),
        })
    contact_sheet = approval / "thumbnail-cleveland-river-fire-contact-sheet.jpg"
    chat = export_chat_delivery(root, candidates, contact_sheet)
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "review_only_rights_hold_before_publication" if helper.get("status") == "pass" and chat.get("surface_status") == "pass" else "blocked",
        "renderer": "headless_chrome_fontsource_html_css", "candidates": candidates,
        "brief": display_path(approval / "thumbnail-worldclass-brief.json"),
        "rights_ledger": display_path(ledger_path), "contact_sheet": display_path(contact_sheet),
        "chat_delivery": {"status": chat.get("surface_status"), "directory": display_path(Path(str(chat.get("directory", "")))) if chat.get("directory") else "", "artifacts": chat.get("artifacts", [])},
        "source_truth": {"historical_proof": "EPA page caption identifies the photograph as 1952.", "ai_support": "All bright Cleveland support layers are non-proof imagery.", "publication_rights": "Blocked pending direct archive confirmation for the underlying historic photograph."},
        "known_blockers": ["Historic photograph commercial reuse must be cleared directly with the underlying archive before any public-use claim or YouTube action."],
        "youtube_mutation": "not_performed",
    }
    manifest = approval / "thumbnail-codex-primary-review.json"
    manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the Cleveland Cuyahoga fire thumbnail review set.")
    parser.add_argument("--video-id", default="cleveland-river-fire-01")
    args = parser.parse_args()
    payload, manifest = build(args.video_id)
    print(json.dumps({"status": payload["status"], "candidate_count": len(payload["candidates"]), "manifest": display_path(manifest), "blockers": payload["known_blockers"]}, indent=2))


if __name__ == "__main__":
    main()
