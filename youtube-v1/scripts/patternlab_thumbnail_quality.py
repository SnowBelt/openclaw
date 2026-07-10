#!/usr/bin/env python3
import argparse
import csv
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_images import IMAGE_HEIGHT, IMAGE_WIDTH, file_status, validate_image_pack


MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
REQUIRED_THUMBNAILS = [
    {
        "filename": "thumbnail_candidate_a.png",
        "role": "emotional_mystery",
        "headline": "DETROIT WAS REDRAWN",
        "required_prompt_terms": ["DETROIT WAS REDRAWN", "clear thumbnail promise", "premium city typography", "Detroit skyline/landmark recognition"],
    },
    {
        "filename": "thumbnail_candidate_b.png",
        "role": "map_system_proof",
        "headline": "DETROIT'S HIDDEN MAP",
        "required_prompt_terms": ["DETROIT'S HIDDEN MAP", "map/system proof", "polished proof mark", "Detroit skyline/landmark recognition"],
    },
    {
        "filename": "thumbnail_candidate_c.png",
        "role": "contrarian_history_angle",
        "headline": "DETROIT'S FALL EXPLAINED",
        "required_prompt_terms": ["DETROIT'S FALL EXPLAINED", "contrarian history", "clear thumbnail promise", "premium city typography"],
    },
]
REQUIRED_REVIEW_HEADLINES = {
    "DETROIT WAS REDRAWN",
    "DETROIT'S HIDDEN MAP",
    "DETROIT 1942",
    "DETROIT'S LOST STREETS",
    "DETROIT'S FALL EXPLAINED",
}
SAFETY_PROMPT_TERMS = [
    "source-media-policy",
    "thumbnail-click-policy",
    "autonomous-production-architecture",
    "2-4 word",
    "first 30",
    "no fake",
    "no watermark",
    "no Pro-locked",
    "city name dominance",
    "thumbnail search shelf",
    "clear thumbnail promise",
    "premium city typography",
    "skyline/landmark recognition",
    "competitive benchmark aesthetic",
    "polished proof mark",
]
CANONICAL_SEQUENCE = "OpenClaw strategy/source safety -> Canva plugin render -> OpenClaw validation -> owner review / YouTube test"
REQUIRED_REVIEW_CHECKS = {
    "phone_size_readability",
    "title_thumbnail_promise_match",
    "first_30_second_payoff_match",
    "candidate_diversity",
    "rights_ledger_complete",
    "no_fake_archival_proof",
    "visual_mystery_clear",
    "city_anchor_clear",
    "proof_object_clear",
    "dominant_real_photo",
    "human_or_action_interest_when_available",
    "no_source_board_clutter",
    "strong_thumbnail_contrast",
    "single_clear_proof_mark",
    "city_name_dominance",
    "city_name_phone_readable",
    "five_review_concepts",
    "selected_three_from_five",
    "search_result_shelf_test",
    "competitive_color_contrast",
    "clear_thumbnail_promise",
    "premium_city_typography",
    "detroit_skyline_or_landmark_recognition",
    "detroit_recognizable_visual",
    "polished_proof_mark",
    "competitive_benchmark_aesthetic",
    "free_first_toolchain",
    "free_source_asset_sourcing",
    "free_premium_typography",
    "open_source_enhancement_cutout_lab",
    "mobile_ocr_readability",
    "benchmark_similarity_scoring",
    "twenty_to_eight_to_five_to_three_pipeline",
    "photopea_gimp_manual_handoff",
    "active_city_agnostic_templates",
    "active_city_visual_recognition",
    "ai_support_asset_policy",
    "internet_reference_non_derivative_gate",
    "no_internal_thumbnail_labels",
    "arrow_semantic_gate",
    "owner_feedback_learning_gate",
    "ten_out_of_ten_art_direction_path",
    "every_word_intent_gate",
    "spelling_ocr_verification",
    "cutoff_text_detection",
    "brightness_subject_visibility",
    "no_image_distortion",
    "layout_safe_zone_gate",
    "concept_specific_art_direction_gate",
    "redaction_realism_gate",
    "newspaper_realism_gate",
    "then_now_orientation_gate",
    "creative_variation_memory_gate",
    "per_thumbnail_critique_report",
    "publication_name_preflight_gate",
    "generic_ai_support_asset_gate",
    "owner_rating_preference_learning_v2",
    "redrawn_map_semantic_match_gate",
    "underground_semantic_asset_gate",
    "whole_word_redaction_gate",
    "curiosity_hook_prominence_gate",
    "lost_streets_visual_relevance_gate",
    "then_now_split_integrity_gate",
    "ai_support_asset_manifest_gate",
    "current_style_renderer_v4_gate",
}
REQUIRED_HARD_BLOCKS = (
    "fake archival photo",
    "copied thumbnail layout from another channel",
    "watermarked stock image",
    "source or rights unclear",
    "source-board clutter",
    "tiny source labels",
    "city only a small tag",
    "city name unreadable at phone size",
    "ambiguous thumbnail promise",
    "boring/plain city font",
    "not recognizably detroit",
    "rough proof marks",
    "ai output copied from an unlicensed reference image",
    "internal label",
    "random arrow",
    "owner-rated sub-4/10",
    "misspelled active city name",
    "cut-off thumbnail text",
    "unintentional public words",
    "background too dark",
    "stretched or squeezed source image",
    "redaction graphic with only solid black boxes",
    "fake newspaper without body text",
    "then/now comparison with now on the left",
    "reusing the same title-bar/proof-card layout",
    "partial-word redactions",
    "low-value public labels",
    "rail or track-only image",
    "then/now image crossing the center divider",
    "AI support asset presented as source proof",
)




def city_possessive(city):
    city_upper = (city or "Detroit").upper()
    return f"{city_upper}'" if city_upper.endswith("S") else f"{city_upper}'S"


def format_city_template(template, city):
    city_upper = (city or "Detroit").upper()
    return template.replace("{CITY_POSSESSIVE}", city_possessive(city_upper)).replace("{CITY}", city_upper)


def active_city_for_quality(metadata, factory_report):
    for source in (factory_report, metadata):
        for key in ("active_city", "city", "target_city"):
            value = source.get(key) if isinstance(source, dict) else None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return "Detroit"


def required_review_headlines_for_city(city):
    templates = {
        "{CITY} WAS REDRAWN",
        "{CITY_POSSESSIVE} HIDDEN MAP",
        "{CITY} 1942",
        "{CITY_POSSESSIVE} LOST STREETS",
        "{CITY_POSSESSIVE} FALL EXPLAINED",
    }
    return {format_city_template(template, city) for template in templates}


def required_thumbnails_for_city(city):
    city_upper = (city or "Detroit").upper()
    city_recognition_phrase = f"{city} skyline/landmark recognition"
    return [
        {
            "filename": "thumbnail_candidate_a.png",
            "role": "emotional_mystery",
            "headline": format_city_template("{CITY} WAS REDRAWN", city_upper),
            "required_prompt_terms": [format_city_template("{CITY} WAS REDRAWN", city_upper), "clear thumbnail promise", "premium city typography", city_recognition_phrase],
        },
        {
            "filename": "thumbnail_candidate_b.png",
            "role": "map_system_proof",
            "headline": format_city_template("{CITY_POSSESSIVE} HIDDEN MAP", city_upper),
            "required_prompt_terms": [format_city_template("{CITY_POSSESSIVE} HIDDEN MAP", city_upper), "map/system proof", "polished proof mark", city_recognition_phrase],
        },
        {
            "filename": "thumbnail_candidate_c.png",
            "role": "contrarian_history_angle",
            "headline": format_city_template("{CITY_POSSESSIVE} FALL EXPLAINED", city_upper),
            "required_prompt_terms": [format_city_template("{CITY_POSSESSIVE} FALL EXPLAINED", city_upper), "contrarian history", "clear thumbnail promise", "premium city typography"],
        },
    ]

def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def load_ledger(root):
    ledger = Path(root) / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def latest_row(rows, filename):
    matches = [row for row in rows if Path(row.get("filename", "")).name == filename]
    return matches[-1] if matches else {}


def prompt_text(video_id):
    path = BASE / "launch" / f"video-{video_id}" / "image-prompts.md"
    return path, path.read_text(encoding="utf-8") if path.exists() else ""


def has_terms(text, terms):
    lower = text.lower()
    return [term for term in terms if term.lower() not in lower]


def words(text):
    return re.findall(r"[A-Za-z0-9']+", text or "")


def read_canva_brief(root):
    return read_json(Path(root) / "approval" / "canva-thumbnail-brief.json")


def read_factory_report(root):
    return read_json(Path(root) / "approval" / "thumbnail-factory-report.json")


def build_thumbnail_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    prompt_path, prompts = prompt_text(video_id)
    metadata = read_json(approval / "upload-metadata.json")
    click_policy = read_json(BASE / "resources" / "thumbnail-click-policy.json")
    free_policy = read_json(BASE / "resources" / "thumbnail-free-first-policy.json")
    art_policy = read_json(BASE / "resources" / "thumbnail-10x-art-direction-policy.json")
    canva_brief = read_canva_brief(root)
    factory_report = read_factory_report(root)
    visible_source_audit = read_json(approval / "thumbnail-visible-source-audit-report.json")
    image_report = validate_image_pack(root)
    ledger_rows = load_ledger(root)
    blockers = []
    warnings = []
    candidates = []
    package_checks = []
    quality_city = active_city_for_quality(metadata, factory_report)
    required_thumbnails = required_thumbnails_for_city(quality_city)
    topic_headlines = {
        str(item.get("headline", ""))
        for item in metadata.get("thumbnail_topic_concepts", [])
        if isinstance(item, dict) and item.get("headline")
    }
    topic_headline_by_concept = {
        str(item.get("concept_id", "")): str(item.get("headline", ""))
        for item in metadata.get("thumbnail_topic_concepts", [])
        if isinstance(item, dict) and item.get("concept_id") and item.get("headline")
    }
    selected_concept_by_filename = {
        "thumbnail_candidate_a.png": "clear_redrawn",
        "thumbnail_candidate_b.png": "hidden_map",
        "thumbnail_candidate_c.png": "fall_explained",
    }
    for item in required_thumbnails:
        topic_headline = topic_headline_by_concept.get(selected_concept_by_filename.get(item["filename"], ""))
        if topic_headline:
            item["headline"] = topic_headline
            item["required_prompt_terms"] = [topic_headline, "clear thumbnail promise", "premium city typography"]
    required_review_headlines = topic_headlines or required_review_headlines_for_city(quality_city)

    def add_package_check(name, passed, detail):
        package_checks.append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            blockers.append(f"Thumbnail package gate failed: {detail}.")

    if not prompts:
        blockers.append(f"Image prompt package is missing: {display_path(prompt_path)}.")
    else:
        missing_safety = has_terms(prompts, SAFETY_PROMPT_TERMS)
        if missing_safety:
            blockers.append(f"Image prompts are missing safety exclusions: {', '.join(missing_safety)}.")
        prompt_requirements = {
            "phone_size_readability": "phone size" in prompts.lower() or "phone-size" in prompts.lower(),
            "dominant_focal_point": "one dominant" in prompts.lower(),
            "dominant_real_photo": "dominant real photo" in prompts.lower(),
            "city_anchor": "explicit city anchor" in prompts.lower() or "clear city anchor" in prompts.lower(),
            "city_name_dominance": "city name dominance" in prompts.lower() and "primary" in prompts.lower(),
            "clear_thumbnail_promise": "clear thumbnail promise" in prompts.lower(),
            "premium_city_typography": "premium city typography" in prompts.lower(),
            "active_city_skyline_landmark": f"{quality_city.lower()} skyline/landmark recognition" in prompts.lower() or "active-city skyline/landmark recognition" in prompts.lower() or "active city skyline/landmark recognition" in prompts.lower(),
            "competitive_benchmark_aesthetic": "competitive benchmark aesthetic" in prompts.lower(),
            "polished_proof_mark": "polished proof mark" in prompts.lower(),
            "search_shelf_test": "thumbnail search shelf" in prompts.lower(),
            "proof_object": "explicit proof object" in prompts.lower() or "clear proof object" in prompts.lower(),
            "first_30_second_payoff": "first 30-second payoff" in prompts.lower(),
            "no_fake_archival": "no fake archival" in prompts.lower() or "do not present ai reconstructions as archival" in prompts.lower(),
            "no_watermark_or_pro_locked": "no watermark" in prompts.lower() and "pro-locked" in prompts.lower(),
            "no_source_board_clutter": "no source-board clutter" in prompts.lower(),
        }
        for name, passed in prompt_requirements.items():
            add_package_check(name, passed, name.replace("_", " "))

    default_thumbnail = metadata.get("default_thumbnail", "")
    title_options = metadata.get("title_options") or []
    default_title = metadata.get("default_title") or ""
    if len(title_options) < 5:
        blockers.append(f"Thumbnail package needs at least 5 title options; found {len(title_options)}.")
    if not default_title:
        blockers.append("Default title is missing.")
    if default_thumbnail not in [f"images/{item['filename']}" for item in required_thumbnails]:
        blockers.append(f"Default thumbnail is not one of the required thumbnail candidates: {default_thumbnail or 'missing'}.")
    thumbnail_paths = sorted((root / "images").glob("thumbnail_candidate_*.png")) if (root / "images").exists() else []
    add_package_check(
        "exactly_three_thumbnail_candidates",
        len(thumbnail_paths) == int(click_policy.get("required_candidate_count", 3)),
        f"{len(thumbnail_paths)} thumbnail candidate files",
    )
    add_package_check(
        "five_review_concepts_required",
        int(click_policy.get("required_review_concept_count", 0)) == 5,
        "click policy requires five review concepts before selecting three production candidates",
    )
    add_package_check(
        "canonical_thumbnail_formula",
        "premium city typography" in click_policy.get("canonical_formula", "").lower()
        and "recognizable" in click_policy.get("canonical_formula", "").lower()
        and ("active-city" in click_policy.get("canonical_formula", "").lower() or "active city" in click_policy.get("canonical_formula", "").lower())
        and "proof object" in click_policy.get("canonical_formula", "").lower(),
        "click policy includes premium city typography, recognizable active-city visuals, clear promise, proof object, and 2-4 words",
    )
    add_package_check(
        "required_review_checks",
        REQUIRED_REVIEW_CHECKS.issubset(set(click_policy.get("required_review_checks", []))),
        "click policy includes city-name, clear-promise, premium-font, active-city recognition, AI-support, owner-feedback, benchmark-aesthetic, shelf-test, mobile, payoff, rights, and proof-object checks",
    )
    hard_blocks = " ".join(click_policy.get("hard_blocks", [])).lower()
    add_package_check(
        "hard_blocks",
        all(item.lower() in hard_blocks for item in REQUIRED_HARD_BLOCKS),
        "click policy blocks small city tags, ambiguous promises, plain fonts, non-city visuals, fake archival images, copied layouts, internal labels, random arrows, watermarks, and unclear rights",
    )
    add_package_check("canva_brief_exists", bool(canva_brief), "Canva thumbnail brief exists")
    add_package_check("thumbnail_factory_report_exists", bool(factory_report), "Repo-local city-first thumbnail factory report exists")

    brief_roles = {}
    if canva_brief:
        add_package_check(
            "canonical_autonomous_sequence",
            canva_brief.get("canonical_sequence") == CANONICAL_SEQUENCE,
            "Canva brief preserves the OpenClaw strategy/source safety -> Canva render -> validation -> review/test sequence",
        )
        add_package_check(
            "canva_role_boundary",
            "Canva is the rendering engine only" in canva_brief.get("canva_role", ""),
            "Canva brief keeps OpenClaw as strategy/source/validation owner",
        )
        add_package_check(
            "canva_free_watermark_rule",
            "without watermark" in canva_brief.get("canva_free_rule", "").lower()
            and "pro-locked" in canva_brief.get("canva_free_rule", "").lower(),
            "Canva Free exports must be watermark-free and avoid Pro-locked assets",
        )
        brief_candidates = canva_brief.get("candidates", [])
        add_package_check("canva_candidate_count", len(brief_candidates) == len(required_thumbnails), f"{len(brief_candidates)} selected Canva candidate briefs")
        add_package_check(
            "canva_review_concept_count",
            len(canva_brief.get("review_concepts", [])) == 5,
            f"{len(canva_brief.get('review_concepts', []))} Canva review concepts",
        )
        brief_roles = {item.get("filename"): item for item in brief_candidates}

    factory_candidates = {}
    if factory_report:
        factory_candidates = {item.get("filename", ""): item for item in factory_report.get("candidates", [])}
        review_headlines = {item.get("headline", "") for item in factory_report.get("review_concepts", [])}
        add_package_check("thumbnail_factory_pass", factory_report.get("status") == "pass", f"thumbnail factory status is {factory_report.get('status') or 'missing'}")
        add_package_check("thumbnail_factory_five_review_concepts", factory_report.get("review_concept_count") == 5, f"{factory_report.get('review_concept_count', 0)} review concepts")
        add_package_check("thumbnail_factory_twenty_roughs", factory_report.get("rough_concept_count", 0) >= 20, f"{factory_report.get('rough_concept_count', 0)} rough concepts")
        add_package_check("thumbnail_factory_eight_shortlisted", factory_report.get("shortlisted_concept_count", 0) >= 8, f"{factory_report.get('shortlisted_concept_count', 0)} shortlisted concepts")
        add_package_check("thumbnail_factory_selected_three", factory_report.get("selected_candidate_count") == 3, f"{factory_report.get('selected_candidate_count', 0)} selected production candidates")
        add_package_check("thumbnail_factory_free_toolchain", factory_report.get("free_toolchain_status") == "pass", f"free toolchain status is {factory_report.get('free_toolchain_status', 'missing')}")
        add_package_check("thumbnail_factory_no_paid_tool", factory_report.get("paid_tool_used") is False, f"paid_tool_used={factory_report.get('paid_tool_used')}")
        add_package_check("thumbnail_factory_no_paid_asset", factory_report.get("paid_asset_used") is False, f"paid_asset_used={factory_report.get('paid_asset_used')}")
        add_package_check("thumbnail_factory_rights_ledger_complete", factory_report.get("rights_ledger_complete") is True, f"rights_ledger_complete={factory_report.get('rights_ledger_complete')}")
        add_package_check("thumbnail_factory_free_fonts", factory_report.get("free_font_count", 0) >= 5, f"{factory_report.get('free_font_count', 0)} free/system fonts")
        add_package_check("thumbnail_factory_mobile_ocr_readability", factory_report.get("mobile_ocr_readability_status") == "pass", f"mobile OCR readiness is {factory_report.get('mobile_ocr_readability_status', 'missing')}")
        add_package_check("thumbnail_factory_benchmark_similarity", factory_report.get("benchmark_similarity_status") == "pass", f"benchmark similarity is {factory_report.get('benchmark_similarity_status', 'missing')}")
        add_package_check("thumbnail_factory_manual_handoff", factory_report.get("manual_handoff_status") == "pass" and (approval / "thumbnail-manual-handoff.json").exists(), "Photopea/GIMP manual handoff exists")
        add_package_check("thumbnail_factory_required_headlines", required_review_headlines.issubset(review_headlines), f"headlines={sorted(review_headlines)}")
        add_package_check("thumbnail_factory_city_name_dominance", factory_report.get("city_name_dominant_count") == 5, f"{factory_report.get('city_name_dominant_count', 0)} city-dominant concepts")
        add_package_check("thumbnail_factory_phone_readability", factory_report.get("city_name_phone_readable_count") == 5, f"{factory_report.get('city_name_phone_readable_count', 0)} phone-readable city names")
        add_package_check("thumbnail_factory_search_shelf", factory_report.get("search_shelf_test_status") == "pass" and (approval / "thumbnail-search-shelf-test.png").exists(), "thumbnail search shelf test passes")
        add_package_check("thumbnail_factory_clear_promise", factory_report.get("clear_promise_count") == 5, f"{factory_report.get('clear_promise_count', 0)} clear-promise concepts")
        add_package_check("thumbnail_factory_skyline_or_landmark", factory_report.get("skyline_or_landmark_count", 0) >= 4, f"{factory_report.get('skyline_or_landmark_count', 0)} skyline/landmark concepts")
        add_package_check("thumbnail_factory_city_recognizable", factory_report.get("city_recognizable_visual_count", factory_report.get("detroit_recognizable_visual_count")) == 5, f"{factory_report.get('city_recognizable_visual_count', factory_report.get('detroit_recognizable_visual_count', 0))} recognizably active-city concepts")
        add_package_check("thumbnail_factory_city_agnostic", factory_report.get("city_agnostic_status") == "pass" and bool(factory_report.get("active_city")), f"active_city={factory_report.get('active_city', 'missing')}")
        add_package_check("thumbnail_factory_premium_city_font", factory_report.get("premium_city_font_count") == 5, f"{factory_report.get('premium_city_font_count', 0)} premium city font concepts")
        add_package_check("thumbnail_factory_polished_proof_marks", factory_report.get("polished_proof_mark_count") == 5, f"{factory_report.get('polished_proof_mark_count', 0)} polished proof-mark concepts")
        add_package_check("thumbnail_factory_benchmark_aesthetic", factory_report.get("benchmark_aesthetic_match_count") == 5, f"{factory_report.get('benchmark_aesthetic_match_count', 0)} competitive benchmark aesthetic concepts")
        add_package_check("thumbnail_factory_ai_support_policy", factory_report.get("ai_support_asset_policy_status") == "pass", f"AI support asset policy is {factory_report.get('ai_support_asset_policy_status', 'missing')}")
        add_package_check("thumbnail_factory_reference_non_derivative", factory_report.get("internet_reference_non_derivative_status") == "pass", f"internet reference gate is {factory_report.get('internet_reference_non_derivative_status', 'missing')}")
        add_package_check("thumbnail_factory_owner_feedback_learning", factory_report.get("owner_feedback_learning_status") == "pass", f"owner feedback learning is {factory_report.get('owner_feedback_learning_status', 'missing')}")
        add_package_check("thumbnail_factory_owner_rating_learning_v2", factory_report.get("owner_rating_learning_v2_status") == "pass" and factory_report.get("preferred_baseline_style") == "current_owner_preferred", f"owner rating V2={factory_report.get('owner_rating_learning_v2_status', 'missing')} baseline={factory_report.get('preferred_baseline_style', 'missing')}")
        add_package_check("thumbnail_factory_redrawn_map_semantic_match", factory_report.get("redrawn_map_semantic_match_status") == "pass", f"redrawn map semantic match={factory_report.get('redrawn_map_semantic_match_status', 'missing')}")
        add_package_check("thumbnail_factory_underground_semantic_asset", factory_report.get("underground_semantic_asset_status") == "pass", f"underground semantic asset={factory_report.get('underground_semantic_asset_status', 'missing')}")
        add_package_check("thumbnail_factory_whole_word_redaction", factory_report.get("whole_word_redaction_status") == "pass" and factory_report.get("partial_word_redaction_count", 1) == 0, f"whole-word redaction={factory_report.get('whole_word_redaction_status', 'missing')} partial={factory_report.get('partial_word_redaction_count', 'missing')}")
        add_package_check("thumbnail_factory_low_value_public_words", factory_report.get("low_value_public_word_count", 1) == 0, f"{factory_report.get('low_value_public_word_count', 'missing')} low-value public words")
        add_package_check("thumbnail_factory_curiosity_hook_prominence", factory_report.get("curiosity_hook_prominence_status") == "pass", f"curiosity hook prominence={factory_report.get('curiosity_hook_prominence_status', 'missing')}")
        add_package_check("thumbnail_factory_lost_streets_visual_relevance", factory_report.get("lost_streets_semantic_asset_status") == "pass" and factory_report.get("rail_image_used_for_lost_streets") is False, f"lost-streets semantic={factory_report.get('lost_streets_semantic_asset_status', 'missing')} rail={factory_report.get('rail_image_used_for_lost_streets', 'missing')}")
        add_package_check("thumbnail_factory_then_now_split_integrity", factory_report.get("then_now_split_integrity_status") == "pass" and factory_report.get("then_now_median_crossing_count", 1) == 0, f"then/now split={factory_report.get('then_now_split_integrity_status', 'missing')} crossings={factory_report.get('then_now_median_crossing_count', 'missing')}")
        add_package_check("thumbnail_factory_now_modern_skyline", factory_report.get("now_modern_skyline_status") == "pass", f"NOW modern skyline={factory_report.get('now_modern_skyline_status', 'missing')}")
        add_package_check("thumbnail_factory_ai_support_asset_manifest", factory_report.get("ai_support_asset_manifest_status") == "pass" and factory_report.get("ai_fake_proof_count", 1) == 0, f"AI support manifest={factory_report.get('ai_support_asset_manifest_status', 'missing')} fake proof={factory_report.get('ai_fake_proof_count', 'missing')}")
        add_package_check("thumbnail_factory_current_style_renderer_v4", factory_report.get("current_style_renderer_v4_status") == "pass", f"current-style renderer V4={factory_report.get('current_style_renderer_v4_status', 'missing')}")
        add_package_check("thumbnail_visible_source_audit", visible_source_audit.get("status") == "pass" and factory_report.get("visible_source_audit_status") == "pass", f"visible source audit={visible_source_audit.get('status', 'missing')} factory={factory_report.get('visible_source_audit_status', 'missing')}")
        add_package_check(
            "thumbnail_real_city_source_first_examples",
            factory_report.get("real_city_source_first_examples_status") == "pass"
            and factory_report.get("official_city_example_mode") == "source_backed_ready"
            and factory_report.get("ad_hoc_mockup_blocked") is True
            and factory_report.get("visible_real_photo_count") == 5
            and factory_report.get("photo_hero_or_major_inset_count") == 5
            and factory_report.get("map_only_concept_count") == 0
            and factory_report.get("unmanifested_visible_source_count") == 0,
            f"source-first={factory_report.get('real_city_source_first_examples_status', 'missing')} mode={factory_report.get('official_city_example_mode', 'missing')} ad_hoc_mockup_blocked={factory_report.get('ad_hoc_mockup_blocked', 'missing')}",
        )
        add_package_check("thumbnail_visible_real_photos", factory_report.get("visible_real_photo_count") == 5 and visible_source_audit.get("visible_real_photo_count") == 5, f"visible real photos={factory_report.get('visible_real_photo_count', 'missing')}/{visible_source_audit.get('visible_real_photo_count', 'missing')}")
        add_package_check("thumbnail_photo_hero_or_major_inset", factory_report.get("photo_hero_or_major_inset_count") == 5 and visible_source_audit.get("photo_hero_or_major_inset_count") == 5, f"photo hero/major inset={factory_report.get('photo_hero_or_major_inset_count', 'missing')}/{visible_source_audit.get('photo_hero_or_major_inset_count', 'missing')}")
        add_package_check("thumbnail_no_map_only_concepts", factory_report.get("map_only_concept_count") == 0 and visible_source_audit.get("map_only_concept_count") == 0, f"map-only concepts={factory_report.get('map_only_concept_count', 'missing')}/{visible_source_audit.get('map_only_concept_count', 'missing')}")
        add_package_check("thumbnail_no_unmanifested_visible_sources", factory_report.get("unmanifested_visible_source_count") == 0 and visible_source_audit.get("unmanifested_visible_source_count") == 0, f"unmanifested visible sources={factory_report.get('unmanifested_visible_source_count', 'missing')}/{visible_source_audit.get('unmanifested_visible_source_count', 'missing')}")
        add_package_check("thumbnail_factory_no_internal_labels", factory_report.get("internal_public_label_count", 0) == 0, f"{factory_report.get('internal_public_label_count', 0)} internal labels")
        add_package_check("thumbnail_factory_arrow_semantic_gate", factory_report.get("random_arrow_count", 0) == 0, f"{factory_report.get('random_arrow_count', 0)} random arrows")
        add_package_check("thumbnail_factory_every_word_intent", factory_report.get("irrelevant_public_word_count", 1) == 0 and factory_report.get("every_word_intent_gate_status") == "pass", f"{factory_report.get('irrelevant_public_word_count', 'missing')} irrelevant words")
        add_package_check("thumbnail_factory_spelling_ocr", factory_report.get("spelling_error_count", 1) == 0 and factory_report.get("spelling_ocr_verification_status") == "pass", f"{factory_report.get('spelling_error_count', 'missing')} spelling errors")
        add_package_check("thumbnail_factory_cutoff_text", factory_report.get("cutoff_text_count", 1) == 0 and factory_report.get("cutoff_text_detection_status") == "pass", f"{factory_report.get('cutoff_text_count', 'missing')} cut-off text items")
        add_package_check("thumbnail_factory_brightness_visibility", factory_report.get("too_dark_count", 1) == 0 and factory_report.get("brightness_subject_visibility_status") == "pass", f"{factory_report.get('too_dark_count', 'missing')} too-dark concepts")
        add_package_check("thumbnail_factory_no_image_distortion", factory_report.get("distorted_image_count", 1) == 0 and factory_report.get("no_image_distortion_status") == "pass", f"{factory_report.get('distorted_image_count', 'missing')} distorted images")
        add_package_check("thumbnail_factory_layout_safe_zone", factory_report.get("layout_safe_zone_violation_count", 1) == 0 and factory_report.get("layout_safe_zone_status") == "pass", f"{factory_report.get('layout_safe_zone_violation_count', 'missing')} safe-zone violations")
        add_package_check("thumbnail_factory_subject_not_covered", factory_report.get("recognizable_subject_covered_count", 1) == 0, f"{factory_report.get('recognizable_subject_covered_count', 'missing')} covered recognizable subjects")
        add_package_check("thumbnail_factory_concept_specific_art_direction", factory_report.get("concept_specific_pass_count") == 5 and factory_report.get("concept_specific_art_direction_status") == "pass", f"{factory_report.get('concept_specific_pass_count', 0)} concept-specific passes")
        add_package_check("thumbnail_factory_creative_variation_memory", factory_report.get("creative_variation_style_count", 0) >= 5 and factory_report.get("creative_variation_memory_status") == "pass", f"{factory_report.get('creative_variation_style_count', 0)} style families")
        add_package_check("thumbnail_factory_per_thumbnail_critique", factory_report.get("per_thumbnail_critique_count") == 5 and factory_report.get("per_thumbnail_critique_status") == "pass", f"{factory_report.get('per_thumbnail_critique_count', 0)} critiques")
        add_package_check("thumbnail_factory_publication_name_preflight", factory_report.get("publication_name_preflight_status") in {"required_before_public_use", "pass"}, f"publication preflight={factory_report.get('publication_name_preflight_status', 'missing')}")
        add_package_check("thumbnail_factory_10x_art_direction_report", (approval / "thumbnail-10x-art-direction-report.json").exists(), "thumbnail-10x-art-direction-report.json exists")
        add_package_check("thumbnail_factory_photo_backed_candidates", factory_report.get("photo_backed_candidate_count") == len(required_thumbnails), f"{factory_report.get('photo_backed_candidate_count', 0)} photo-backed candidates")
        add_package_check("thumbnail_factory_dominant_real_photo_candidates", factory_report.get("dominant_real_photo_candidate_count") == len(required_thumbnails), f"{factory_report.get('dominant_real_photo_candidate_count', 0)} dominant real photo/map/document candidates")
        add_package_check("thumbnail_factory_human_or_action_interest", factory_report.get("human_or_action_candidate_count", 0) >= 2, f"{factory_report.get('human_or_action_candidate_count', 0)} human/action/strong-place-interest candidates")
        add_package_check("thumbnail_factory_no_abstract_placeholders", factory_report.get("abstract_placeholder_count") == 0, f"{factory_report.get('abstract_placeholder_count', 0)} abstract placeholders")
        add_package_check("thumbnail_factory_no_source_board_clutter", factory_report.get("source_board_clutter_count", 0) == 0, f"{factory_report.get('source_board_clutter_count', 0)} source-board clutter candidates")
        add_package_check("thumbnail_factory_no_tiny_labels", factory_report.get("tiny_label_count", 0) == 0, f"{factory_report.get('tiny_label_count', 0)} tiny-label candidates")
        add_package_check("thumbnail_factory_single_major_proof_mark", factory_report.get("single_major_proof_mark_candidate_count") == len(required_thumbnails), f"{factory_report.get('single_major_proof_mark_candidate_count', 0)} single-proof-mark candidates")
        add_package_check("thumbnail_factory_distinct_hashes", factory_report.get("distinct_file_hash_count") == len(required_thumbnails), f"{factory_report.get('distinct_file_hash_count', 0)} distinct selected candidate hashes")
        add_package_check(
            "thumbnail_factory_canva_ready_handoff",
            factory_report.get("canva_render_status") == "repo_local_factory_rendered_canva_ready" and (approval / "canva-render-handoff.json").exists(),
            "repo-local factory rendered Canva-ready handoff",
        )
        add_package_check("thumbnail_factory_contact_sheet", (approval / "thumbnail-contact-sheet.png").exists(), "thumbnail contact sheet exists")
        add_package_check("thumbnail_factory_five_concept_contact_sheet", (approval / "thumbnail-five-concept-contact-sheet.png").exists(), "five-concept contact sheet exists")
        for report_name in [
            "free-thumbnail-toolchain-report.json",
            "thumbnail-asset-sourcing-report.json",
            "thumbnail-font-report.json",
            "thumbnail-readability-report.json",
            "thumbnail-benchmark-similarity-report.json",
            "thumbnail-manual-handoff-report.json",
        ]:
            add_package_check(f"thumbnail_{report_name.replace('-', '_').replace('.json', '')}", (approval / report_name).exists(), f"{report_name} exists")
    add_package_check(
        "thumbnail_free_first_policy",
        free_policy.get("default_cost") == "free" and free_policy.get("paid_tools_require_owner_approval") is True,
        "thumbnail-free-first-policy requires free default and owner approval for paid tools",
    )
    add_package_check(
        "thumbnail_10x_art_direction_policy",
        art_policy.get("city_agnostic") is True and "image_generator_recommendation" in art_policy,
        "thumbnail-10x-art-direction-policy exists with city-agnostic and image-generator guidance",
    )

    for item in required_thumbnails:
        filename = item["filename"]
        status = file_status(root, filename)
        path = root / "images" / filename
        size_bytes = path.stat().st_size if path.exists() else 0
        ledger = latest_row(ledger_rows, filename)
        missing_prompt_terms = has_terms(prompts, item["required_prompt_terms"]) if prompts else item["required_prompt_terms"]
        brief_candidate = brief_roles.get(filename, {})
        factory_candidate = factory_candidates.get(filename, {})
        thumbnail_text = brief_candidate.get("thumbnail_text", "") or factory_candidate.get("headline", "")
        thumbnail_word_count = len(words(thumbnail_text))
        candidate = {
            "filename": filename,
            "role": item["role"],
            "expected_headline": item["headline"],
            "valid_file": status["valid"],
            "dimensions": status["dimensions"],
            "size_bytes": size_bytes,
            "under_youtube_video_limit": size_bytes > 0 and size_bytes <= MAX_THUMBNAIL_BYTES,
            "ledger_asset_type": ledger.get("asset_type", ""),
            "ledger_review_status": ledger.get("human_review_status", ""),
            "brief_role": brief_candidate.get("role", ""),
            "thumbnail_text": thumbnail_text,
            "thumbnail_word_count": thumbnail_word_count,
            "factory_city_name_dominant": factory_candidate.get("city_name_dominant", False),
            "factory_city_name_phone_readable": factory_candidate.get("city_name_phone_readable", False),
            "factory_clear_promise": factory_candidate.get("clear_promise", False),
            "factory_active_city": factory_candidate.get("active_city", factory_report.get("active_city", "")),
            "factory_city_recognizable_visual": factory_candidate.get("city_recognizable_visual", factory_candidate.get("detroit_recognizable_visual", False)),
            "factory_detroit_recognizable_visual": factory_candidate.get("detroit_recognizable_visual", False),
            "factory_skyline_or_landmark": factory_candidate.get("skyline_or_landmark", False),
            "factory_premium_city_font": factory_candidate.get("premium_city_font", False),
            "factory_polished_proof_mark": factory_candidate.get("polished_proof_mark", False),
            "factory_benchmark_aesthetic_match": factory_candidate.get("benchmark_aesthetic_match", False),
            "factory_photo_backed": factory_candidate.get("photo_backed", False),
            "factory_dominant_real_photo": factory_candidate.get("dominant_real_photo", False),
            "factory_human_or_action_interest": factory_candidate.get("human_or_action_interest", False),
            "factory_visual_strategy": factory_candidate.get("visual_strategy", ""),
            "factory_proof_object": factory_candidate.get("proof_object", ""),
            "factory_click_interest_trigger": factory_candidate.get("click_interest_trigger", ""),
            "factory_source_board_clutter": factory_candidate.get("source_board_clutter", False),
            "factory_tiny_labels": factory_candidate.get("tiny_labels", False),
            "factory_major_proof_marks": factory_candidate.get("major_proof_marks", 0),
            "factory_placeholder_terms": factory_candidate.get("abstract_placeholder_terms", []),
            "factory_internal_public_label_used": factory_candidate.get("internal_public_label_used", False),
            "factory_random_arrow_used": factory_candidate.get("random_arrow_used", False),
            "factory_ai_support_asset_policy_pass": factory_candidate.get("ai_support_asset_policy_pass", True),
            "factory_internet_reference_non_derivative_pass": factory_candidate.get("internet_reference_non_derivative_pass", True),
            "missing_prompt_terms": missing_prompt_terms,
        }
        candidates.append(candidate)
        if not status["valid"]:
            blockers.append(f"{filename} is not a valid {IMAGE_WIDTH}x{IMAGE_HEIGHT} PNG thumbnail: {status['reason']}.")
        if size_bytes > MAX_THUMBNAIL_BYTES:
            blockers.append(f"{filename} is above YouTube's video thumbnail size limit: {size_bytes / 1024 / 1024:.1f} MB.")
        if ledger.get("asset_type") != "thumbnail":
            blockers.append(f"{filename} is missing a thumbnail rights-ledger row.")
        if missing_prompt_terms:
            blockers.append(f"{filename} prompt is missing strategic terms for {item['role']}: {', '.join(missing_prompt_terms)}.")
        if brief_candidate.get("role") != item["role"]:
            blockers.append(f"{filename} Canva brief role must be {item['role']}; found {brief_candidate.get('role') or 'missing'}.")
        if factory_report and not factory_candidate:
            blockers.append(f"{filename} is missing from the thumbnail factory report.")
        if factory_candidate and factory_candidate.get("headline") != item["headline"]:
            blockers.append(f"{filename} factory headline must be {item['headline']}; found {factory_candidate.get('headline') or 'missing'}.")
        if factory_candidate and not factory_candidate.get("city_name_dominant"):
            blockers.append(f"{filename} must make the city name primary or co-primary.")
        if factory_candidate and not factory_candidate.get("city_name_phone_readable"):
            blockers.append(f"{filename} city name must be readable at phone/search-result size.")
        if factory_candidate and not factory_candidate.get("clear_promise"):
            blockers.append(f"{filename} must carry a clear thumbnail promise.")
        if factory_candidate and not factory_candidate.get("city_recognizable_visual", factory_candidate.get("detroit_recognizable_visual")):
            blockers.append(f"{filename} must look recognizably like the active city through skyline, landmark, map, or city-context visuals.")
        if factory_candidate and not factory_candidate.get("premium_city_font"):
            blockers.append(f"{filename} must use premium city typography.")
        if factory_candidate and not factory_candidate.get("polished_proof_mark"):
            blockers.append(f"{filename} must use a polished proof mark, not rough annotation.")
        if factory_candidate and not factory_candidate.get("benchmark_aesthetic_match"):
            blockers.append(f"{filename} must match the competitive benchmark aesthetic gate.")
        if factory_candidate and not factory_candidate.get("photo_backed"):
            blockers.append(f"{filename} must be photo-backed by the repo-local thumbnail factory.")
        if factory_candidate and not factory_candidate.get("dominant_real_photo"):
            blockers.append(f"{filename} must use one dominant real photo/map/document rather than a source-board layout.")
        if factory_candidate and factory_candidate.get("source_board_clutter"):
            blockers.append(f"{filename} has source-board/research-board clutter.")
        if factory_candidate and factory_candidate.get("tiny_labels"):
            blockers.append(f"{filename} depends on tiny labels that cannot read at phone size.")
        if factory_candidate and factory_candidate.get("internal_public_label_used"):
            blockers.append(f"{filename} uses an internal public label such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF.")
        if factory_candidate and factory_candidate.get("random_arrow_used"):
            blockers.append(f"{filename} uses a random arrow unrelated to a route/map/path promise.")
        if factory_candidate and not factory_candidate.get("ai_support_asset_policy_pass", True):
            blockers.append(f"{filename} fails the AI support asset policy.")
        if factory_candidate and not factory_candidate.get("internet_reference_non_derivative_pass", True):
            blockers.append(f"{filename} fails the internet reference non-derivative gate.")
        if factory_candidate and factory_candidate.get("major_proof_marks") != 1:
            blockers.append(f"{filename} must use exactly one major proof mark; found {factory_candidate.get('major_proof_marks')}.")
        if factory_candidate and factory_candidate.get("abstract_placeholder_terms"):
            blockers.append(f"{filename} contains abstract placeholder terms: {', '.join(factory_candidate.get('abstract_placeholder_terms', []))}.")
        if not (2 <= thumbnail_word_count <= 4):
            blockers.append(f"{filename} thumbnail text must be 2-4 words; found {thumbnail_word_count} words.")
        for brief_field in ["city_anchor", "proof_object", "visual_contradiction", "canva_brief"]:
            if not brief_candidate.get(brief_field):
                blockers.append(f"{filename} Canva brief is missing {brief_field}.")

    if image_report.get("usable_valid") and image_report.get("selected_source") not in {"codex", "openai", "mixed"}:
        warnings.append(f"Image source is unusual: {image_report.get('selected_source')}.")
    if not image_report.get("usable_valid"):
        blockers.append("Required image pack is not valid, so thumbnails cannot clear quality.")

    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "blockers": blockers,
        "warnings": warnings,
        "default_title": default_title,
        "active_city": factory_report.get("active_city", quality_city),
        "default_thumbnail": default_thumbnail,
        "title_options": len(title_options),
        "required_dimensions": f"{IMAGE_WIDTH}x{IMAGE_HEIGHT}",
        "youtube_video_thumbnail_max_mb": 2,
        "thumbnail_factory_status": factory_report.get("status", "missing") if factory_report else "missing",
        "thumbnail_factory_report": display_path(approval / "thumbnail-factory-report.json"),
        "thumbnail_contact_sheet": display_path(approval / "thumbnail-contact-sheet.png"),
        "thumbnail_five_concept_contact_sheet": display_path(approval / "thumbnail-five-concept-contact-sheet.png"),
        "thumbnail_search_shelf_test": display_path(approval / "thumbnail-search-shelf-test.png"),
        "canva_render_handoff": display_path(approval / "canva-render-handoff.json"),
        "city_name_dominance_status": "pass" if factory_report.get("city_name_dominant_count") == 5 else "blocked",
        "clear_promise_status": "pass" if factory_report.get("clear_promise_count") == 5 else "blocked",
        "city_recognition_status": "pass" if factory_report.get("city_recognizable_visual_count", factory_report.get("detroit_recognizable_visual_count")) == 5 and factory_report.get("skyline_or_landmark_count", 0) >= 4 else "blocked",
        "detroit_recognition_status": "pass" if factory_report.get("city_recognizable_visual_count", factory_report.get("detroit_recognizable_visual_count")) == 5 and factory_report.get("skyline_or_landmark_count", 0) >= 4 else "blocked",
        "premium_typography_status": "pass" if factory_report.get("premium_city_font_count") == 5 else "blocked",
        "competitive_benchmark_aesthetic_status": "pass" if factory_report.get("benchmark_aesthetic_match_count") == 5 else "blocked",
        "city_agnostic_status": factory_report.get("city_agnostic_status", "missing"),
        "current_thumbnail_renderer": factory_report.get("current_thumbnail_renderer", "missing"),
        "current_image_generator": factory_report.get("current_image_generator", "missing"),
        "recommended_free_ai_support_generator": factory_report.get("recommended_free_ai_support_generator", "missing"),
        "recommended_premium_ai_support_generator": factory_report.get("recommended_premium_ai_support_generator", "missing"),
        "ai_support_asset_policy_status": factory_report.get("ai_support_asset_policy_status", "missing"),
        "internet_reference_non_derivative_status": factory_report.get("internet_reference_non_derivative_status", "missing"),
        "owner_feedback_learning_status": factory_report.get("owner_feedback_learning_status", "missing"),
        "owner_rating_learning_v2_status": factory_report.get("owner_rating_learning_v2_status", "missing"),
        "preferred_baseline_style": factory_report.get("preferred_baseline_style", "missing"),
        "redrawn_map_semantic_match_status": factory_report.get("redrawn_map_semantic_match_status", "missing"),
        "underground_semantic_asset_status": factory_report.get("underground_semantic_asset_status", "missing"),
        "whole_word_redaction_status": factory_report.get("whole_word_redaction_status", "missing"),
        "partial_word_redaction_count": factory_report.get("partial_word_redaction_count", "missing"),
        "low_value_public_word_count": factory_report.get("low_value_public_word_count", "missing"),
        "curiosity_hook_prominence_status": factory_report.get("curiosity_hook_prominence_status", "missing"),
        "lost_streets_semantic_asset_status": factory_report.get("lost_streets_semantic_asset_status", "missing"),
        "rail_image_used_for_lost_streets": factory_report.get("rail_image_used_for_lost_streets", "missing"),
        "then_now_split_integrity_status": factory_report.get("then_now_split_integrity_status", "missing"),
        "then_now_median_crossing_count": factory_report.get("then_now_median_crossing_count", "missing"),
        "now_modern_skyline_status": factory_report.get("now_modern_skyline_status", "missing"),
        "ai_support_asset_manifest_status": factory_report.get("ai_support_asset_manifest_status", "missing"),
        "ai_fake_proof_count": factory_report.get("ai_fake_proof_count", "missing"),
        "current_style_renderer_v4_status": factory_report.get("current_style_renderer_v4_status", "missing"),
        "real_city_source_first_examples_status": factory_report.get("real_city_source_first_examples_status", "missing"),
        "official_city_example_mode": factory_report.get("official_city_example_mode", "missing"),
        "ad_hoc_mockup_blocked": factory_report.get("ad_hoc_mockup_blocked", False),
        "source_first_example_blockers": factory_report.get("source_first_example_blockers", []),
        "visible_source_audit_status": factory_report.get("visible_source_audit_status", visible_source_audit.get("status", "missing")),
        "visible_real_photo_count": factory_report.get("visible_real_photo_count", visible_source_audit.get("visible_real_photo_count", 0)),
        "photo_hero_or_major_inset_count": factory_report.get("photo_hero_or_major_inset_count", visible_source_audit.get("photo_hero_or_major_inset_count", 0)),
        "map_only_concept_count": factory_report.get("map_only_concept_count", visible_source_audit.get("map_only_concept_count", 0)),
        "stale_unmanifested_source_count": factory_report.get("stale_unmanifested_source_count", visible_source_audit.get("stale_unmanifested_source_count", 0)),
        "unmanifested_visible_source_count": factory_report.get("unmanifested_visible_source_count", visible_source_audit.get("unmanifested_visible_source_count", 0)),
        "thumbnail_visible_source_audit_report": display_path(approval / "thumbnail-visible-source-audit-report.json"),
        "ten_out_of_ten_art_direction_path_status": factory_report.get("ten_out_of_ten_art_direction_path_status", "missing"),
        "no_internal_thumbnail_labels_status": factory_report.get("no_internal_thumbnail_labels_status", "missing"),
        "arrow_semantic_gate_status": factory_report.get("arrow_semantic_gate_status", "missing"),
        "every_word_intent_gate_status": factory_report.get("every_word_intent_gate_status", "missing"),
        "spelling_ocr_verification_status": factory_report.get("spelling_ocr_verification_status", "missing"),
        "cutoff_text_detection_status": factory_report.get("cutoff_text_detection_status", "missing"),
        "brightness_subject_visibility_status": factory_report.get("brightness_subject_visibility_status", "missing"),
        "no_image_distortion_status": factory_report.get("no_image_distortion_status", "missing"),
        "layout_safe_zone_status": factory_report.get("layout_safe_zone_status", "missing"),
        "concept_specific_art_direction_status": factory_report.get("concept_specific_art_direction_status", "missing"),
        "creative_variation_memory_status": factory_report.get("creative_variation_memory_status", "missing"),
        "per_thumbnail_critique_status": factory_report.get("per_thumbnail_critique_status", "missing"),
        "publication_name_preflight_status": factory_report.get("publication_name_preflight_status", "missing"),
        "irrelevant_public_word_count": factory_report.get("irrelevant_public_word_count", "missing"),
        "spelling_error_count": factory_report.get("spelling_error_count", "missing"),
        "cutoff_text_count": factory_report.get("cutoff_text_count", "missing"),
        "distorted_image_count": factory_report.get("distorted_image_count", "missing"),
        "creative_variation_style_count": factory_report.get("creative_variation_style_count", "missing"),
        "per_thumbnail_critique_count": factory_report.get("per_thumbnail_critique_count", "missing"),
        "free_toolchain_status": factory_report.get("free_toolchain_status", "missing"),
        "mobile_ocr_readability_status": factory_report.get("mobile_ocr_readability_status", "missing"),
        "benchmark_similarity_status": factory_report.get("benchmark_similarity_status", "missing"),
        "manual_handoff_status": factory_report.get("manual_handoff_status", "missing"),
        "search_shelf_test_status": factory_report.get("search_shelf_test_status", "missing"),
        "package_checks": package_checks,
        "candidates": candidates,
    }

    (approval / "thumbnail-quality-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Thumbnail Quality Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {status}",
        f"Active city: {payload['active_city']}",
        f"City-agnostic templates: {payload['city_agnostic_status']}",
        f"Current thumbnail renderer: {payload['current_thumbnail_renderer']}",
        f"Current image generator: {payload['current_image_generator']}",
        f"Recommended free AI support generator: {payload['recommended_free_ai_support_generator']}",
        f"Recommended premium AI support generator: {payload['recommended_premium_ai_support_generator']}",
        f"AI support asset policy: {payload['ai_support_asset_policy_status']}",
        f"Internet reference non-derivative gate: {payload['internet_reference_non_derivative_status']}",
        f"Owner feedback learning: {payload['owner_feedback_learning_status']}",
        f"Owner rating preference V2: {payload['owner_rating_learning_v2_status']} ({payload['preferred_baseline_style']})",
        f"Real city source-first examples: {payload['real_city_source_first_examples_status']} | mode={payload['official_city_example_mode']} | ad_hoc_mockup_blocked={payload['ad_hoc_mockup_blocked']}",
        f"Visible source audit: {payload['visible_source_audit_status']} | real photos {payload['visible_real_photo_count']}/5 | major photo regions {payload['photo_hero_or_major_inset_count']}/5 | map-only {payload['map_only_concept_count']} | unmanifested {payload['unmanifested_visible_source_count']}",
        f"Map/redrawn semantic match: {payload['redrawn_map_semantic_match_status']}",
        f"Underground semantic asset: {payload['underground_semantic_asset_status']}",
        f"Whole-word redaction: {payload['whole_word_redaction_status']} ({payload['partial_word_redaction_count']} partial-word redactions)",
        f"Low-value public words: {payload['low_value_public_word_count']}",
        f"Curiosity hook prominence: {payload['curiosity_hook_prominence_status']}",
        f"Lost-streets visual relevance: {payload['lost_streets_semantic_asset_status']} (rail image used: {payload['rail_image_used_for_lost_streets']})",
        f"Then/now split integrity: {payload['then_now_split_integrity_status']} ({payload['then_now_median_crossing_count']} median crossings)",
        f"NOW modern skyline: {payload['now_modern_skyline_status']}",
        f"AI support asset boundary: {payload['ai_support_asset_manifest_status']} ({payload['ai_fake_proof_count']} fake proof assets)",
        f"Current-style renderer V4: {payload['current_style_renderer_v4_status']}",
        f"10/10 art-direction path: {payload['ten_out_of_ten_art_direction_path_status']}",
        f"Every-word intent gate: {payload['every_word_intent_gate_status']} ({payload['irrelevant_public_word_count']} irrelevant words)",
        f"Spelling/OCR verification: {payload['spelling_ocr_verification_status']} ({payload['spelling_error_count']} spelling errors)",
        f"Cutoff text detection: {payload['cutoff_text_detection_status']} ({payload['cutoff_text_count']} cut-off text items)",
        f"Brightness/subject visibility: {payload['brightness_subject_visibility_status']}",
        f"No image distortion: {payload['no_image_distortion_status']} ({payload['distorted_image_count']} distorted images)",
        f"Layout safe zones: {payload['layout_safe_zone_status']}",
        f"Concept-specific art direction: {payload['concept_specific_art_direction_status']}",
        f"Creative variation memory: {payload['creative_variation_memory_status']} ({payload['creative_variation_style_count']} style families)",
        f"Per-thumbnail critique: {payload['per_thumbnail_critique_status']} ({payload['per_thumbnail_critique_count']} critiques)",
        f"Publication-name preflight: {payload['publication_name_preflight_status']}",
        f"Default title: {default_title or 'missing'}",
        f"Default thumbnail: {default_thumbnail or 'missing'}",
        f"Title options: {len(title_options)}",
        f"City name dominance: {payload['city_name_dominance_status']}",
        f"Clear promise: {payload['clear_promise_status']}",
        f"City skyline/landmark recognition: {payload['city_recognition_status']}",
        f"Premium city typography: {payload['premium_typography_status']}",
        f"Competitive benchmark aesthetic: {payload['competitive_benchmark_aesthetic_status']}",
        f"Thumbnail search shelf test: {payload['search_shelf_test_status']}",
        "",
        "## Candidate Strategy",
        "",
        "- Review set: five active-city-recognizable competitive thumbnail concepts: clear redrawn promise, hidden map, year/time-travel, lost streets, and fall explained.",
        "- Production set: select the strongest three candidates from the five review concepts.",
        "- Factory requirement: active-city name must use premium Impact-style typography, the base visual must read as that city through skyline/landmark/context, the promise must be clear, and the proof cue must be polished.",
        "- Required sequence: OpenClaw strategy/source safety -> Canva plugin render -> OpenClaw validation -> owner review / YouTube test.",
        "- Winning signal after publish: watch-time share first, then CTR and first-30-second retention.",
        "- Hard rejects: ambiguous promise, boring/plain city font, not recognizably the active city, rough proof marks, tiny city tag, fake archival proof, copied layouts, watermarks, source-board clutter, tiny labels, internal public labels, random arrows, misspelled city text, cut-off words, distorted photos, too-dark subjects, repeated title-bar/proof-card layouts, unclear rights, and missing first-30-second payoff.",
        "",
        "## Package Checks",
        "",
    ]
    for check in package_checks:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Candidates", ""])
    for candidate in candidates:
        size_mb = candidate["size_bytes"] / 1024 / 1024 if candidate["size_bytes"] else 0
        lines.append(
            f"- {candidate['filename']}: {candidate['role']} | valid={candidate['valid_file']} | "
            f"{candidate['dimensions'] or 'missing'} | {size_mb:.2f} MB | "
            f"ledger={candidate['ledger_asset_type'] or 'missing'} | review={candidate['ledger_review_status'] or 'missing'} | "
            f"text={candidate['thumbnail_text'] or 'missing'} ({candidate['thumbnail_word_count']} words) | "
            f"city_name_dominant={candidate['factory_city_name_dominant']} | phone_readable={candidate['factory_city_name_phone_readable']} | "
            f"clear_promise={candidate['factory_clear_promise']} | city_visual={candidate['factory_city_recognizable_visual']} | "
            f"premium_font={candidate['factory_premium_city_font']} | benchmark_aesthetic={candidate['factory_benchmark_aesthetic_match']} | "
            f"dominant_real_photo={candidate['factory_dominant_real_photo']} | trigger={candidate['factory_click_interest_trigger'] or 'missing'}"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    (approval / "thumbnail-quality-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, approval / "thumbnail-quality-report.md"


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab city-history thumbnail strategy and files.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, report = build_thumbnail_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Thumbnail quality report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()
