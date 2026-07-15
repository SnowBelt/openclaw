#!/usr/bin/env python3
"""Build the review-only Video 04 thumbnail finalists with Chrome typography.

The bright Codex-generated layers are intentionally non-proof support. The
Sanborn map stays visibly present as the source-bearing object. This renderer
does not label a map/photo pair as THEN/NOW because Video 04 does not yet have
an accepted, rights-cleared historical street photograph.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_premium_font_common import chrome_render
from patternlab_thumbnail_worldclass import sha256


def thumbnail_specs(source: Path, review: Path) -> list[dict[str, Any]]:
    city_map = source / "sanborn-congested-key-map.jpg"
    modern = source / "detroit-modern-context.jpg"
    support_a = source / "codex-primary-support-a.png"
    support_b = source / "codex-primary-support-b.png"
    support_c = source / "codex-primary-support-c.png"
    return [
        {
            "variant_id": "codex_primary_v2_city_dominant",
            "out": str(review / "codex-primary-v2-01-detroit-erased-this.png"),
            "image": str(support_a),
            "inset_image": str(city_map),
            "inset_label": "",
            "city": "DETROIT",
            "city_font_family": "Bebas Neue",
            "main_font_family": "Anton",
            "support_font_family": "Anton",
            "main": "ERASED\nTHIS",
            "support": "",
            "support_hidden": True,
            "effect_recipe_id": "editorial_gold_ink",
            "city_size": 212,
            "city_width": 1060,
            "main_left": 82,
            "main_top": 312,
            "main_width": 920,
            "main_size": 244,
            "main_tracking": -3,
            "inset_right": 68,
            "inset_top": 120,
            "inset_width": 690,
            "inset_height": 820,
            "inset_rotate": 2,
            "inset_border": "#FFD600",
            "saturation": 1.2,
            "brightness": 1.16,
            "contrast": 1.12,
            "background_position": "center",
            "composition_mode": "proof_context",
            "title_pair": "The Neighborhood Detroit Erased: Black Bottom and Paradise Valley",
            "thumbnail_hook": "DETROIT ERASED THIS",
            "proof_object": "Library of Congress Sanborn map of the affected Detroit district",
            "visual_objects": [
                {"role": "support", "kind": "ai_support", "source_url": "", "local_path": str(support_a), "slot": "background"},
                {"role": "proof", "kind": "map", "source_url": "https://www.loc.gov/item/sanborn03985_072/", "local_path": str(city_map), "slot": "inset"},
            ],
            "visible_proof_area_ratio": 0.28,
            "hero_luminance": "bright",
            "generic_text_card": False,
            "public_text": ["DETROIT", "ERASED THIS"],
            "non_city_word_count": 2,
            "typography": {
                "city_font": "Bebas Neue",
                "main_font": "Anton",
                "support_font": "Anton",
                "city_stroke_width": 3,
                "main_stroke_width": 2,
                "support_stroke_width": 0,
            },
        },
        {
            "variant_id": "codex_primary_v2_mystery_dominant",
            "out": str(review / "codex-primary-v2-02-black-bottom-was-here.png"),
            "image": str(support_b),
            "inset_image": str(city_map),
            "inset_label": "",
            "city": "DETROIT",
            "city_font_family": "Bebas Neue",
            "main_font_family": "Anton",
            "support_font_family": "Bebas Neue",
            "main": "BLACK\nBOTTOM",
            "support": "WAS HERE",
            "effect_recipe_id": "editorial_white_glow",
            "city_left": 980,
            "city_top": 48,
            "city_width": 850,
            "city_size": 168,
            "main_left": 980,
            "main_top": 268,
            "main_width": 850,
            "main_size": 214,
            "main_tracking": -2,
            "support_left": 1008,
            "support_bottom": 128,
            "support_width": 560,
            "support_size": 74,
            "support_bg": "#ED0014",
            "support_color": "#FFFFFF",
            "support_rotate": -2,
            "inset_right": 955,
            "inset_top": 145,
            "inset_width": 850,
            "inset_height": 800,
            "inset_rotate": -2,
            "inset_border": "#ED0014",
            "saturation": 1.22,
            "brightness": 1.18,
            "contrast": 1.12,
            "background_position": "center",
            "composition_mode": "proof_context",
            "title_pair": "The Map That Cut Detroit's Black Bottom",
            "thumbnail_hook": "BLACK BOTTOM WAS HERE",
            "proof_object": "Library of Congress Sanborn map of the affected Detroit district",
            "visual_objects": [
                {"role": "support", "kind": "ai_support", "source_url": "", "local_path": str(support_b), "slot": "background"},
                {"role": "proof", "kind": "map", "source_url": "https://www.loc.gov/item/sanborn03985_072/", "local_path": str(city_map), "slot": "inset"},
            ],
            "visible_proof_area_ratio": 0.31,
            "hero_luminance": "bright",
            "generic_text_card": False,
            "public_text": ["DETROIT", "BLACK BOTTOM", "WAS HERE"],
            "non_city_word_count": 4,
            "typography": {
                "city_font": "Bebas Neue",
                "main_font": "Anton",
                "support_font": "Bebas Neue",
                "city_stroke_width": 3,
                "main_stroke_width": 2,
                "support_stroke_width": 0,
            },
        },
        {
            "variant_id": "codex_primary_v2_map_system",
            "out": str(review / "codex-primary-v2-03-the-map-changed.png"),
            "image": str(city_map),
            "inset_image": str(modern),
            "inset_label": "",
            "city": "DETROIT",
            "city_font_family": "Bebas Neue",
            "main_font_family": "Anton",
            "support_font_family": "Anton",
            "main": "THE MAP\nCHANGED",
            "support": "I-375",
            "effect_recipe_id": "editorial_white_glow",
            "city_size": 202,
            "city_width": 980,
            "main_left": 82,
            "main_top": 330,
            "main_width": 970,
            "main_size": 204,
            "support_left": 100,
            "support_bottom": 116,
            "support_width": 330,
            "support_size": 78,
            "support_bg": "#ED0014",
            "support_color": "#FFFFFF",
            "inset_right": 74,
            "inset_top": 145,
            "inset_width": 720,
            "inset_height": 410,
            "inset_rotate": 3,
            "inset_border": "#FFD600",
            "saturation": 1.32,
            "brightness": 1.28,
            "contrast": 1.18,
            "background_position": "center",
            "composition_mode": "map_system",
            "title_pair": "The Map That Cut Detroit's Black Bottom",
            "thumbnail_hook": "THE MAP CHANGED",
            "proof_object": "Library of Congress Sanborn map of the affected Detroit district",
            "visual_objects": [
                {"role": "proof", "kind": "map", "source_url": "https://www.loc.gov/item/sanborn03985_072/", "local_path": str(city_map), "slot": "background"},
                {"role": "context", "kind": "modern_photo", "source_url": "pending_rights_ledger_confirmation", "local_path": str(modern), "slot": "inset"},
            ],
            "visible_proof_area_ratio": 0.55,
            "hero_luminance": "bright",
            "generic_text_card": False,
            "public_text": ["DETROIT", "THE MAP CHANGED", "I-375"],
            "non_city_word_count": 4,
            "typography": {
                "city_font": "Bebas Neue",
                "main_font": "Anton",
                "support_font": "Anton",
                "city_stroke_width": 3,
                "main_stroke_width": 2,
                "support_stroke_width": 0,
            },
        },
    ]


def build(video_id: str) -> tuple[dict[str, Any], Path]:
    if video_id != "04":
        raise SystemExit("This review renderer is limited to Video 04.")
    root = output_root(video_id)
    source = root / "source-packet" / "thumbnail-worldclass"
    required = [
        source / "sanborn-congested-key-map.jpg",
        source / "detroit-modern-context.jpg",
        source / "codex-primary-support-a.png",
        source / "codex-primary-support-b.png",
        source / "codex-primary-support-c.png",
    ]
    missing = [display_path(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Video 04 thumbnail source assets are missing: " + ", ".join(missing))
    review = ensure_dir(root / "review" / "thumbnail-codex-primary-v2")
    specs = thumbnail_specs(source, review)
    render = chrome_render(specs, root, "thumbnail-codex-primary-v2-render.json", "thumbnail-codex-primary-v2-contact-sheet.jpg", "thumbnail-codex-primary-v2-shelf-previews")
    helper = render["helper"]
    helper_entries = {str(item.get("variant_id")): item for item in helper.get("entries", []) if isinstance(item, dict)}
    candidates = []
    for spec in specs:
        output = Path(str(spec["out"]))
        candidates.append({
            "id": spec["variant_id"],
            "path": display_path(output),
            "sha256": sha256(output) if output.exists() else "",
            "title_pair": spec["title_pair"],
            "thumbnail_hook": spec["thumbnail_hook"],
            "composition_mode": spec["composition_mode"],
            "visual_objects": spec["visual_objects"],
            "visible_proof_area_ratio": spec["visible_proof_area_ratio"],
            "hero_luminance": spec["hero_luminance"],
            "generic_text_card": spec["generic_text_card"],
            "public_text": spec["public_text"],
            "non_city_word_count": spec["non_city_word_count"],
            "typography": spec["typography"],
            "renderer_entry": helper_entries.get(spec["variant_id"], {}),
        })
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "review_only_pending_source_and_owner_approval" if helper.get("status") == "pass" else "blocked",
        "renderer": "headless_chrome_fontsource_html_css",
        "candidates": candidates,
        "contact_sheet": display_path(root / "approval" / "thumbnail-codex-primary-v2-contact-sheet.jpg"),
        "shelf_previews": display_path(root / "approval" / "thumbnail-codex-primary-v2-shelf-previews"),
        "source_truth": {
            "proof": "Sanborn map is the only historical proof object in this candidate set.",
            "ai_support": "Codex-generated backgrounds are non-proof support only.",
            "then_now": "Not rendered. An accepted rights-cleared historical street photograph is required before a true then/now candidate can exist.",
        },
        "known_blockers": [
            "exact Video 04 source acceptance remains human-gated",
            "no accepted rights-cleared historical Black Bottom street photograph exists for a photo/photo then-now composition",
            "owner must approve an exact final candidate hash before any upload action",
        ],
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(root / "approval") / "thumbnail-codex-primary-review.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report = build(args.video_id)
    print(json.dumps({"status": payload["status"], "candidates": len(payload["candidates"]), "report": display_path(report)}, indent=2))


if __name__ == "__main__":
    main()
