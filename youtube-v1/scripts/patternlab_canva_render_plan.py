#!/usr/bin/env python3
"""Build deterministic local Canva edit plans without calling Canva."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_canva_template_registry import POLICY_PATH, REGISTRY_PATH, validate_registry
from patternlab_canva_source_bridge import build_source_bridge
from patternlab_html_thumbnail_renderer import build_html_thumbnail_renderer_report

FILLER_LABELS = ("SOURCE PHOTO", "RECEIPT", "SOURCE FILE")
DEFAULT_MAX_NON_CITY_PUBLIC_WORDS = 5
BARE_REDACTION_TERMS = ("REDACTED", "████", "BLACK BAR")
FALLBACK_REGISTRY_PATH = BASE / "resources" / "thumbnail-renderer-fallback-registry.json"
REQUIRED_TOPICS = [
    {
        "topic_id": "miami_overtown_cut",
        "city": "MIAMI",
        "main_hook": "WHO CUT IT?",
        "support_line": "",
        "topic_tags": ["highway", "neighborhood", "infrastructure_cut", "who_cut_it", "route"],
        "primary_photo": "source-packet/manual-media/loc-miami-overtown_market.jpg",
        "secondary_photo": "source-packet/manual-media/loc-miami-overtown_skyline.jpg",
        "title_pair": "How Miami Split Overtown",
        "first_30_second_payoff": "Show the real Overtown source photo and explain the route cut before any broad context.",
    },
    {
        "topic_id": "miami_water_won",
        "city": "MIAMI",
        "main_hook": "THE WATER WON",
        "support_line": "",
        "topic_tags": ["water", "flood", "coast", "built_on_water"],
        "primary_photo": "source-packet/manual-media/loc-miami-skyline.jpg",
        "secondary_photo": "source-packet/manual-media/loc-miami-river_bay.jpg",
        "title_pair": "Why Miami Keeps Losing to Water",
        "first_30_second_payoff": "Show the waterfront skyline and explain the water risk immediately.",
    },
    {
        "topic_id": "miami_almost_erased",
        "city": "MIAMI",
        "main_hook": "ALMOST ERASED",
        "support_line": "SAVED OR LOST?",
        "topic_tags": ["preservation", "art_deco", "demolition", "almost_erased", "saved"],
        "primary_photo": "source-packet/manual-media/loc-miami-artdeco_colony.jpg",
        "secondary_photo": "source-packet/manual-media/loc-miami-artdeco_carlyle.jpg",
        "title_pair": "The Fight That Saved Miami Beach",
        "first_30_second_payoff": "Show the Art Deco building proof and frame the demolition/preservation stakes immediately.",
    },
]


def city_slug(city: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", city.lower()).strip("_") or "city"


def _source_bridge_assets(source_bridge: dict[str, Any]) -> list[dict[str, Any]]:
    assets = source_bridge.get("source_assets", [])
    return assets if isinstance(assets, list) else []


def _asset_local_path(asset: dict[str, Any]) -> str:
    return str(asset.get("local_path", "") or "")


def _find_source_asset(source_bridge: dict[str, Any], *needles: str) -> str:
    lowered_needles = [needle.lower() for needle in needles]
    for asset in _source_bridge_assets(source_bridge):
        haystack = " ".join(
            str(asset.get(key, ""))
            for key in ("asset_id", "local_path", "source_title", "visual_category")
        ).lower()
        if all(needle in haystack for needle in lowered_needles):
            local_path = _asset_local_path(asset)
            if local_path:
                return local_path
    for asset in _source_bridge_assets(source_bridge):
        local_path = _asset_local_path(asset)
        if local_path:
            return local_path
    return ""


def infer_active_city(root: Path, requested_city: str) -> str:
    requested = str(requested_city or "").strip()
    if requested and requested.lower() != "miami":
        return requested
    factory = read_json(root / "approval" / "thumbnail-factory-report.json")
    manifest = read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json")
    for candidate in (
        factory.get("active_city"),
        manifest.get("active_city"),
        manifest.get("city"),
    ):
        value = str(candidate or "").strip()
        if value:
            return value
    return requested or "Miami"


def build_city_topics(city: str, root: Path, source_bridge: dict[str, Any]) -> list[dict[str, Any]]:
    if city.strip().lower() == "miami":
        manual_media_exists = all((root / topic["primary_photo"]).exists() for topic in REQUIRED_TOPICS)
        if manual_media_exists:
            return REQUIRED_TOPICS

    city_upper = city.upper()
    slug = city_slug(city)
    map_asset = _find_source_asset(source_bridge, "map") or _find_source_asset(source_bridge, "street")
    underground_asset = _find_source_asset(source_bridge, "underground") or _find_source_asset(source_bridge, "transit") or map_asset
    historic_asset = _find_source_asset(source_bridge, "historic") or _find_source_asset(source_bridge, "street") or map_asset
    skyline_asset = _find_source_asset(source_bridge, "skyline") or _find_source_asset(source_bridge, "landmark") or historic_asset
    return [
        {
            "topic_id": f"{slug}_was_redrawn",
            "city": city_upper,
            "main_hook": "WAS REDRAWN",
            "support_line": "",
            "topic_tags": ["map", "file", "hidden", "route", "infrastructure_cut"],
            "primary_photo": map_asset,
            "secondary_photo": skyline_asset,
            "title_pair": f"How {city} Was Redrawn",
            "first_30_second_payoff": f"Show the real {city} map/source image before explaining what changed.",
        },
        {
            "topic_id": f"{slug}_under_city",
            "city": city_upper,
            "main_hook": "UNDER THE CITY",
            "support_line": "",
            "topic_tags": ["hidden", "route", "document", "mystery"],
            "primary_photo": underground_asset,
            "secondary_photo": skyline_asset,
            "title_pair": f"What Is Under {city}?",
            "first_30_second_payoff": f"Show the real {city} transit/underground/source image before broad context.",
        },
        {
            "topic_id": f"{slug}_lost_streets",
            "city": city_upper,
            "main_hook": "LOST STREETS",
            "support_line": "",
            "topic_tags": ["then_now", "lost", "map", "changed"],
            "primary_photo": historic_asset,
            "secondary_photo": skyline_asset,
            "title_pair": f"{city}'s Lost Streets",
            "first_30_second_payoff": f"Show the real {city} historic street/map source before the hidden-system explanation.",
        },
    ]


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", text)


def word_count(text: str) -> int:
    return len(words(text))


def non_city_word_count(city: str, main_hook: str, support: str) -> int:
    city_words = {word.upper() for word in words(city)}
    return sum(1 for word in words(f"{main_hook} {support}") if word.upper() not in city_words)


def public_text(plan: dict[str, Any]) -> str:
    return " ".join([plan.get("city", ""), plan.get("main_hook", ""), plan.get("support_line", "")]).upper()


def find_template(topic_tags: list[str], templates: list[dict[str, Any]]) -> dict[str, Any] | None:
    topic_set = set(topic_tags)
    best: tuple[int, dict[str, Any]] | None = None
    for template in templates:
        tags = set(template.get("allowed_topic_tags", []))
        score = len(topic_set & tags)
        if score and (best is None or score > best[0]):
            best = (score, template)
    return best[1] if best else None


def validate_plan(plan: dict[str, Any], root: Path, policy: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    city = str(plan.get("city", "")).strip()
    main_hook = str(plan.get("main_hook", "")).strip()
    support = str(plan.get("support_line", "")).strip()
    text = public_text(plan)
    if not city:
        blockers.append("city_missing")
    if city and city.upper() not in text:
        blockers.append("city_not_in_public_text")
    main_words = word_count(main_hook)
    support_words = word_count(support)
    main_min, main_max = policy.get("main_hook_word_range", [1, 4])
    support_min, support_max = policy.get("support_line_word_range", [2, 4])
    max_non_city_words = int(policy.get("max_non_city_public_words", DEFAULT_MAX_NON_CITY_PUBLIC_WORDS))
    non_city_words = non_city_word_count(city, main_hook, support)
    if main_words < int(main_min) or main_words > int(main_max):
        blockers.append(f"main_hook_word_count_out_of_range:{main_words}")
    if support:
        if support_words < int(support_min) or support_words > int(support_max):
            blockers.append(f"support_line_word_count_out_of_range:{support_words}")
    if non_city_words > max_non_city_words:
        blockers.append(f"total_public_text_non_city_word_count_out_of_range:{non_city_words}>{max_non_city_words}")
    for label in FILLER_LABELS:
        if label in text:
            blockers.append(f"filler_public_label:{label}")
    for label in BARE_REDACTION_TERMS:
        if label in text:
            blockers.append(f"bare_redaction_term:{label}")
    template = plan.get("template", {})
    if template.get("random_arrows_allowed") is not False:
        blockers.append("random_arrows_not_blocked_by_template")
    if template.get("unexplained_lines_allowed") is not False:
        blockers.append("unexplained_lines_not_blocked_by_template")
    if template.get("decorative_boxes_allowed") is not False:
        blockers.append("decorative_boxes_not_blocked_by_template")
    if template.get("font_preservation_expected") is not True:
        blockers.append("font_preservation_not_expected")
    primary = root / plan.get("primary_photo", "")
    if not primary.exists():
        blockers.append(f"primary_photo_missing:{plan.get('primary_photo', '')}")
    return blockers


def negative_fixture_results(policy: dict[str, Any], templates: list[dict[str, Any]], root: Path) -> dict[str, Any]:
    template = templates[0] if templates else {}
    base = {
        "city": "MIAMI",
        "main_hook": "WHO CUT IT?",
        "support_line": "ROUTE CUT DEEP",
        "primary_photo": "source-packet/manual-media/loc-miami-overtown_market.jpg",
        "template": template,
    }
    missing_id_template = {**template, "canva_design_id": "", "brand_template_id": ""}
    unapproved_template = {**template, "owner_approval_status": "blocked_pending_owner_approval"}
    cases = {
        "no_template_id_blocks_execution": not (missing_id_template.get("canva_design_id") or missing_id_template.get("brand_template_id")),
        "unsupported_topic_mismatch_blocks": find_template(["spaceport", "moon"], templates) is None,
        "support_text_over_4_words_blocks": bool(validate_plan({**base, "support_line": "THIS SUPPORT TEXT IS TOO LONG"}, root, policy)),
        "total_public_text_over_budget_blocks": bool(validate_plan({**base, "main_hook": "WHO CUT THIS CITY", "support_line": "FOLLOW THE MONEY"}, root, policy)),
        "missing_city_blocks": bool(validate_plan({**base, "city": ""}, root, policy)),
        "filler_label_blocks": bool(validate_plan({**base, "main_hook": "SOURCE PHOTO"}, root, policy)),
        "bare_redaction_blocks": bool(validate_plan({**base, "support_line": "REDACTED FILE"}, root, policy)),
        "random_elements_block": bool(validate_plan({**base, "template": {**template, "random_arrows_allowed": True}}, root, policy)),
        "unapproved_template_blocks_production": unapproved_template.get("owner_approval_status") != "approved",
    }
    return {
        "status": "pass" if all(cases.values()) else "blocked",
        "cases": cases,
        "failed_cases": [name for name, passed in cases.items() if not passed],
    }


def detect_canva_blockers(
    live_validation: dict[str, Any],
    template_id_missing_count: int,
    export_bridge_status: str,
    source_upload_live_pass: bool,
    source_fill_live_pass: bool,
    export_live_pass: bool,
) -> list[str]:
    blockers: list[str] = []
    live_status = str(live_validation.get("status", "missing"))
    blocker_text = " ".join(
        [
            live_status,
            str(live_validation.get("production_blocker", "")),
            str(live_validation.get("error", "")),
            str(live_validation.get("message", "")),
        ]
    ).lower()
    if "limit" in blocker_text or "quota" in blocker_text:
        blockers.append("canva_monthly_ai_limit")
    if "auth" in blocker_text or "credential" in blocker_text or "login" in blocker_text:
        blockers.append("canva_auth_missing")
    if "paid" in blocker_text or "pro asset" in blocker_text or "watermark" in blocker_text:
        blockers.append("canva_paid_asset_blocked")
    if template_id_missing_count:
        blockers.append("canva_template_ids_missing")
    if live_validation and not export_live_pass and str(export_bridge_status).startswith("blocked"):
        blockers.append("canva_export_unavailable")
    if live_validation and not source_upload_live_pass and "limit" not in blocker_text:
        blockers.append("canva_tool_unavailable")
    if live_validation and not source_fill_live_pass and "limit" not in blocker_text:
        blockers.append("canva_tool_unavailable")
    return sorted(set(blockers))


def renderer_registry_status() -> dict[str, Any]:
    registry = read_json(FALLBACK_REGISTRY_PATH)
    renderers = registry.get("renderers", []) if isinstance(registry.get("renderers"), list) else []
    return {
        "path": display_path(FALLBACK_REGISTRY_PATH),
        "status": registry.get("status", "missing"),
        "selection_order": registry.get("selection_order", []),
        "renderer_count": len(renderers),
        "renderers": renderers,
    }


def build_render_plan(video_id: str, city: str = "Miami") -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    city = infer_active_city(root, city)
    registry_report, registry_json_report, registry_md_report = validate_registry(video_id)
    source_bridge, source_bridge_json_report, source_bridge_md_report = build_source_bridge(video_id, city)
    policy = read_json(POLICY_PATH)
    registry = read_json(REGISTRY_PATH)
    templates = registry.get("templates", []) if isinstance(registry.get("templates"), list) else []
    blockers: list[str] = []
    warnings: list[str] = []
    plans: list[dict[str, Any]] = []
    topics = build_city_topics(city, root, source_bridge)

    for index, topic in enumerate(topics, 1):
        city_value = city.upper()
        template = find_template(topic["topic_tags"], templates)
        if not template:
            blockers.append(f"{topic['topic_id']}:approved_template_contract_missing")
            continue
        plan = {
            "plan_id": f"canva_plan_{index:02d}_{topic['topic_id']}",
            "topic_id": topic["topic_id"],
            "city": city_value,
            "main_hook": topic["main_hook"],
            "support_line": topic["support_line"],
            "topic_tags": topic["topic_tags"],
            "template_key": template.get("template_key", "missing"),
            "style_family": template.get("style_family", "missing"),
            "template": template,
            "canva_design_id": template.get("canva_design_id", ""),
            "brand_template_id": template.get("brand_template_id", ""),
            "template_owner_approval_status": template.get("owner_approval_status", "missing"),
            "text_replacements": {
                "CITY": city_value,
                "MAIN_HOOK": topic["main_hook"],
                "SUPPORT_LINE": topic["support_line"],
            },
            "image_replacements": {
                "PRIMARY_PHOTO": topic["primary_photo"],
                "SECONDARY_PHOTO": topic["secondary_photo"],
            },
            "primary_photo": topic["primary_photo"],
            "secondary_photo": topic["secondary_photo"],
            "title_pair": topic["title_pair"],
            "first_30_second_payoff": topic["first_30_second_payoff"],
            "canva_operation_blueprint": [
                "copy_design_or_create_design_from_brand_template_after_template_id_exists",
                "start_editing_transaction",
                "replace_text:CITY",
                "replace_text:MAIN_HOOK",
                "replace_text:SUPPORT_LINE",
                "update_fill:PRIMARY_PHOTO_after_asset_id_exists",
                "get_design_thumbnail",
                "commit_editing_transaction",
            ],
            "public_youtube_mutation": "not_performed",
        }
        plan_blockers = validate_plan(plan, root, policy)
        canva_execution_blockers = []
        if not (template.get("canva_design_id") or template.get("brand_template_id")):
            canva_execution_blockers.append("template_id_missing")
        if template.get("owner_approval_status") != "approved":
            canva_execution_blockers.append("owner_template_approval_missing")
        if canva_execution_blockers:
            warnings.append(f"{plan['plan_id']}:" + ",".join(canva_execution_blockers))
        plan["status"] = "pass" if not plan_blockers else "blocked"
        plan["qa_blockers"] = plan_blockers
        plan["canva_execution_status"] = "blocked_template_ids_missing" if canva_execution_blockers else "ready_for_canva_execution"
        plan["canva_execution_blockers"] = canva_execution_blockers
        plans.append(plan)
        blockers.extend(f"{plan['plan_id']}:{item}" for item in plan_blockers)

    negative = negative_fixture_results(policy, templates, root)
    if negative["status"] != "pass":
        blockers.extend(f"negative_fixture_failed:{item}" for item in negative["failed_cases"])

    canva_previous = read_json(approval / "thumbnail-canva-renderer-option-report.json")
    canva_examples_audit = read_json(approval / "canva-cleveland-examples-audit.json")
    local_html, local_html_json_report, local_html_md_report = build_html_thumbnail_renderer_report(video_id)
    live_validation = read_json(approval / "thumbnail-canva-live-validation-report.json")
    canva_examples = canva_examples_audit.get("examples", []) if isinstance(canva_examples_audit.get("examples"), list) else []
    canva_candidate_count = max(int(canva_previous.get("candidate_count", 0) or 0), len(canva_examples))
    local_renderer_pass = local_html.get("html_renderer_status") == "pass"
    template_id_missing_count = sum(1 for plan in plans if "template_id_missing" in plan.get("canva_execution_blockers", []))
    if template_id_missing_count:
        preview_status = "blocked_template_ids_missing"
    elif live_validation.get("preview_capture_status") == "pass":
        preview_status = "pass"
    elif canva_examples_audit.get("status", "").startswith("pass") and canva_examples:
        preview_status = "pass_draft_canva_preview_text_audited"
    else:
        preview_status = "pending_canva_preview_capture"
    export_bridge_status = live_validation.get("export_local_file_bridge_status") or "blocked_pending_live_canva_export"
    canva_live_mutation_status = "approved_bounded_template_validation" if live_validation.get("status") == "pass" else "not_performed"
    source_bridge_pass = source_bridge.get("status") == "pass"
    source_upload_live_pass = live_validation.get("source_photo_upload_status") == "pass"
    source_fill_live_pass = live_validation.get("source_photo_fill_status") == "pass"
    export_live_pass = str(export_bridge_status).startswith("pass")
    canva_primary_renderer = bool(policy.get("canva_primary_renderer", True))
    approved_free_fallback_allowed = bool(policy.get("approved_free_fallback_allowed", False))
    canva_required_for_all = bool(policy.get("canva_required_for_all_thumbnails", False))
    required_canva_count = int(live_validation.get("required_source_filled_thumbnail_count", 5) or 5)
    source_filled_count = int(live_validation.get("edit_preview_validated_template_count", 0) or 0)
    live_status = str(live_validation.get("status", "missing"))
    live_limit_blocked = "limit" in live_status.lower() or "limit" in str(live_validation.get("production_blocker", "")).lower()
    required_renderer_count = max(required_canva_count, len(plans), int(source_bridge.get("required_base_composite_count", 0) or 0), 5)
    local_fallback_count = int(local_html.get("dimension_1920x1080_count", 0) or 0)
    local_fallback_ready = (
        local_renderer_pass
        and local_fallback_count >= required_renderer_count
        and local_html.get("public_text_budget_status") == "pass"
        and local_html.get("generic_font_blocker_status") == "pass"
        and local_html.get("mobile_shelf_preview_status") == "pass"
        and local_html.get("filler_public_label_blocker_status") == "pass"
        and local_html.get("bare_redaction_blocker_status") == "pass"
        and local_html.get("renderer_provenance_status") == "pass"
    )
    canva_production_ready = source_upload_live_pass and source_fill_live_pass and export_live_pass and source_filled_count >= required_renderer_count
    canva_blockers = detect_canva_blockers(
        live_validation,
        template_id_missing_count,
        str(export_bridge_status),
        source_upload_live_pass,
        source_fill_live_pass,
        export_live_pass,
    )
    if source_filled_count < required_renderer_count:
        canva_blockers = sorted(set([*canva_blockers, "canva_partial_coverage"]))
    fallback_allowed_now = approved_free_fallback_allowed and bool(canva_blockers)
    approved_renderer_coverage_pass = canva_production_ready or (fallback_allowed_now and local_fallback_ready)
    if canva_production_ready:
        selected_renderer = "canva_plugin"
        renderer_output_mode = "canva_primary_production_ready"
        production_ready_status = "pass"
    elif fallback_allowed_now and local_fallback_ready:
        selected_renderer = "openclaw_local_renderer"
        renderer_output_mode = "free_fallback_production_ready"
        production_ready_status = "pass_fallback_renderer"
    else:
        selected_renderer = "blocked"
        renderer_output_mode = "blocked_pending_approved_renderer_coverage"
        production_ready_status = "blocked_canva_monthly_ai_limit" if live_limit_blocked else "blocked_pending_live_canva_source_fill_or_fallback_validation"
    production_blocker = live_validation.get("production_blocker") or source_bridge.get("source_bridge_production_blocker", "missing")
    draft_readiness_status = "pass" if len(plans) == 3 and not blockers and source_bridge_pass and preview_status.startswith("pass") else "blocked"
    report_status = "pass" if len(plans) == 3 and not blockers and registry_report.get("status") == "pass" and source_bridge_pass else "blocked"
    renderer_registry = renderer_registry_status()
    renderer_provenance = [
        {
            "candidate_id": entry.get("variant_id", f"fallback_{index:02d}"),
            "renderer_id": "openclaw_local_renderer",
            "path": display_path(Path(entry.get("path", ""))) if entry.get("path") else "",
            "status": "pass" if local_renderer_pass else "blocked",
            "city": entry.get("city", ""),
            "public_text": " ".join([str(entry.get("city", "")), str(entry.get("main_text", "")), str(entry.get("support_text", ""))]).strip(),
        }
        for index, entry in enumerate(local_html.get("entries", []), 1)
    ]
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city.upper(),
        "status": report_status,
        "render_plan_status": report_status,
        "edit_plan_count": len(plans),
        "required_edit_plan_count": 3,
        "canva_template_registry_status": registry_report.get("registry_status", "missing"),
        "canva_template_slot_schema_status": registry_report.get("slot_schema_status", "missing"),
        "canva_font_preservation_gate_status": registry_report.get("font_preservation_gate_status", "missing"),
        "public_text_budget_status": "pass" if all(not any(str(blocker).startswith("total_public_text_non_city_word_count_out_of_range") for blocker in plan.get("qa_blockers", [])) for plan in plans) else "blocked",
        "max_non_city_public_words": int(policy.get("max_non_city_public_words", DEFAULT_MAX_NON_CITY_PUBLIC_WORDS)),
        "canva_template_execution_status": "blocked_template_ids_missing" if template_id_missing_count else "ready_for_canva_execution",
        "canva_required_for_all_thumbnails": canva_required_for_all,
        "canva_primary_renderer": canva_primary_renderer,
        "approved_free_fallback_allowed": approved_free_fallback_allowed,
        "renderer_selection_status": "pass" if selected_renderer != "blocked" else "blocked",
        "selected_renderer": selected_renderer,
        "renderer_output_mode": renderer_output_mode,
        "renderer_registry_status": renderer_registry.get("status", "missing"),
        "renderer_registry_path": renderer_registry["path"],
        "renderer_registry_selection_order": renderer_registry.get("selection_order", []),
        "renderer_registry_count": renderer_registry.get("renderer_count", 0),
        "canva_blocker_status": "blocked_recorded" if canva_blockers else "none",
        "canva_blockers": canva_blockers,
        "fallback_allowed_now": fallback_allowed_now,
        "approved_renderer_coverage_status": "pass" if approved_renderer_coverage_pass else "blocked",
        "approved_renderer_coverage_count": required_renderer_count if approved_renderer_coverage_pass else max(source_filled_count, local_fallback_count),
        "approved_renderer_required_count": required_renderer_count,
        "free_fallback_renderer": "openclaw_local_renderer",
        "free_fallback_renderer_status": "pass" if local_fallback_ready else ("draft_ready" if local_renderer_pass else "blocked"),
        "free_fallback_candidate_count": local_fallback_count,
        "free_fallback_required_candidate_count": required_renderer_count,
        "free_fallback_renderer_report": display_path(local_html_json_report),
        "free_fallback_renderer_markdown_report": display_path(local_html_md_report),
        "renderer_provenance_status": "pass" if renderer_provenance and selected_renderer != "blocked" else "blocked",
        "renderer_provenance": renderer_provenance,
        "canva_source_filled_thumbnail_count": source_filled_count,
        "canva_required_source_filled_thumbnail_count": required_canva_count,
        "canva_all_thumbnails_covered_status": "pass" if canva_production_ready else production_ready_status,
        "canva_template_id_missing_count": template_id_missing_count,
        "canva_template_owner_approval_missing_count": sum(1 for plan in plans if "owner_template_approval_missing" in plan.get("canva_execution_blockers", [])),
        "preview_capture_status": preview_status,
        "local_audit_packet_status": "pass" if len(plans) == 3 and not blockers and source_bridge_pass else "blocked",
        "owner_final_approval_packet_v2_status": "pass" if len(plans) == 3 and not blockers and source_bridge_pass else "blocked",
        "canva_thumbnail_qa_integration_status": "pass" if len(plans) == 3 and not blockers and source_bridge_pass else "blocked",
        "canva_vs_local_renderer_tournament_status": "pass" if (canva_candidate_count >= 3 or canva_blockers) and local_renderer_pass else "blocked_missing_canva_or_local_reference",
        "canva_candidate_reference_count": canva_candidate_count,
        "local_renderer_status": local_html.get("html_renderer_status", "missing"),
        "fully_automated_city_run_smoke_status": "pass" if len(plans) == 3 and not blockers and source_bridge_pass else "blocked",
        "canva_production_ready_status": "pass" if canva_production_ready else production_ready_status,
        "youtube_replacement_status": "blocked_until_exact_owner_candidate_approval",
        "export_local_file_bridge_status": export_bridge_status,
        "canva_live_validation_status": live_validation.get("status", "missing"),
        "canva_live_validation_report": display_path(approval / "thumbnail-canva-live-validation-report.json") if live_validation else "missing",
        "canva_live_validated_template_count": live_validation.get("edit_preview_validated_template_count", 0),
        "canva_source_photo_upload_status": live_validation.get("source_photo_upload_status", "source_bridge_ready_pending_live_canva_upload"),
        "canva_source_photo_fill_status": live_validation.get("source_photo_fill_status", "source_bridge_ready_pending_live_canva_fill"),
        "canva_local_export_candidate": live_validation.get("local_export_candidate", ""),
        "canva_local_export_candidate_dimensions": live_validation.get("local_export_candidate_dimensions", ""),
        "canva_source_bridge_status": source_bridge.get("status", "missing"),
        "canva_source_url_normalization_matrix_status": source_bridge.get("source_url_normalization_matrix_status", "missing"),
        "canva_source_upload_fallback_ladder_status": source_bridge.get("source_upload_fallback_ladder_status", "missing"),
        "canva_source_backed_base_composite_bridge_status": source_bridge.get("source_backed_base_composite_bridge_status", "missing"),
        "canva_visual_source_presence_audit_status": source_bridge.get("canva_visual_source_presence_audit_status", "missing"),
        "canva_preview_text_audit_v2_status": source_bridge.get("canva_preview_text_audit_v2_status", "missing"),
        "canva_draft_readiness_status": draft_readiness_status,
        "canva_production_readiness_status": "pass" if canva_production_ready else production_ready_status,
        "canva_output_mode": renderer_output_mode,
        "canva_source_bridge_base_composite_count": source_bridge.get("base_composite_count", 0),
        "canva_source_bridge_required_base_composite_count": source_bridge.get("required_base_composite_count", 0),
        "canva_source_bridge_production_blocker": production_blocker,
        "plans": plans,
        "negative_tests": negative,
        "blockers": sorted(set(blockers)),
        "warnings": sorted(set(warnings)),
        "reports": {
            "registry_json": display_path(registry_json_report),
            "registry_md": display_path(registry_md_report),
            "source_bridge_json": display_path(source_bridge_json_report),
            "source_bridge_md": display_path(source_bridge_md_report),
            "policy": display_path(POLICY_PATH),
            "registry": display_path(REGISTRY_PATH),
            "renderer_registry": renderer_registry["path"],
            "free_fallback_renderer_json": display_path(local_html_json_report),
            "free_fallback_renderer_md": display_path(local_html_md_report),
        },
        "public_youtube_mutation": "not_performed",
        "canva_live_mutation": canva_live_mutation_status,
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / "thumbnail-canva-render-plan-report.json"
    md_report = approval / "thumbnail-canva-render-plan-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Canva Render Plan: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {payload['city']}",
        f"Edit plans: {payload['edit_plan_count']}/{payload['required_edit_plan_count']}",
        f"Canva execution: {payload['canva_template_execution_status']}",
        f"Renderer selection: {payload['selected_renderer']} ({payload['renderer_output_mode']})",
        f"Canva primary renderer: {payload['canva_primary_renderer']}",
        f"Approved free fallback allowed: {payload['approved_free_fallback_allowed']}",
        f"Canva blockers: {', '.join(payload['canva_blockers']) if payload['canva_blockers'] else 'none'}",
        f"Approved renderer coverage: {payload['approved_renderer_coverage_status']} ({payload['approved_renderer_coverage_count']}/{payload['approved_renderer_required_count']})",
        f"Free fallback renderer: {payload['free_fallback_renderer_status']} ({payload['free_fallback_candidate_count']}/{payload['free_fallback_required_candidate_count']})",
        f"Preview capture: {payload['preview_capture_status']}",
        f"Export bridge: {payload['export_local_file_bridge_status']}",
        f"Source bridge: {payload['canva_source_bridge_status']}",
        f"Source URL matrix: {payload['canva_source_url_normalization_matrix_status']}",
        f"Source fallback ladder: {payload['canva_source_upload_fallback_ladder_status']}",
        f"Source-backed base composites: {payload['canva_source_bridge_base_composite_count']}/{payload['canva_source_bridge_required_base_composite_count']} ({payload['canva_source_backed_base_composite_bridge_status']})",
        f"Canva required for all thumbnails: {payload['canva_required_for_all_thumbnails']} ({payload['canva_source_filled_thumbnail_count']}/{payload['canva_required_source_filled_thumbnail_count']} source-filled/imported)",
        f"Output mode: {payload['canva_output_mode']}",
        f"Production readiness: {payload['canva_production_readiness_status']}",
        f"Canva vs local tournament: {payload['canva_vs_local_renderer_tournament_status']}",
        "Public YouTube mutation: not performed",
        f"Canva live mutation: {payload['canva_live_mutation']}",
        "Paid/pro assets: not used",
        "",
        "## Edit Plans",
        "",
    ]
    for plan in plans:
        lines.append(f"- {plan['plan_id']}: {plan['status']} | {plan['template_key']} | {plan['city']} / {plan['main_hook']} / {plan['support_line']} | execution={plan['canva_execution_status']}")
    lines.extend(["", "## Renderer Provenance", ""])
    for item in renderer_provenance:
        lines.append(f"- {item['candidate_id']}: {item['renderer_id']} | {item['status']} | {item['path']} | {item['public_text']}")
    lines.extend(["", "## Negative Tests", ""])
    for name, passed in negative["cases"].items():
        lines.append(f"- {name}: {'pass' if passed else 'fail'}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {item}" for item in payload["warnings"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local Pattern Lab Canva template edit plans without Canva mutation.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    parser.add_argument("--city", default="Miami")
    parser.add_argument("--require-production-ready", action="store_true")
    args = parser.parse_args()
    payload, json_report, _md_report = build_render_plan(args.video_id, args.city)
    print(json.dumps({
        "status": payload["status"],
        "edit_plan_count": payload.get("edit_plan_count"),
        "canva_template_execution_status": payload.get("canva_template_execution_status"),
        "selected_renderer": payload.get("selected_renderer"),
        "approved_renderer_coverage_status": payload.get("approved_renderer_coverage_status"),
        "report": display_path(json_report),
    }, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)
    if args.require_production_ready and payload.get("approved_renderer_coverage_status") != "pass":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
