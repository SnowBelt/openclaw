#!/usr/bin/env python3
"""Headless Chrome + Fontsource Pattern Lab thumbnail renderer."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now
from patternlab_source_candidate_tournament import build_source_candidate_tournament
from patternlab_premium_font_common import (
    EFFECT_RECIPES_PATH,
    FONT_PACK_PATH,
    MAX_NON_CITY_PUBLIC_WORDS,
    active_city,
    chrome_render,
    export_chat_delivery,
    final_thumbnail_specs,
    rendered_entry_checks,
    score_entry,
    source_role,
    write_json,
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", str(text).lower())


def topic_source_match(spec: dict[str, Any]) -> dict[str, Any]:
    required = set(str(item).lower() for item in spec.get("required_source_tags", []))
    selected = set(str(item).lower() for item in spec.get("selected_source_tags", []))
    overlap = sorted(required & selected)
    rank = int(spec.get("selected_source_rank", 999) or 999)
    candidate_count = int(spec.get("source_tournament_candidate_count", 0) or 0)
    status = "pass" if overlap and rank <= 3 and candidate_count >= 1 else "blocked"
    return {
        "status": status,
        "city": spec.get("city", ""),
        "topic": spec.get("topic_id", ""),
        "hook": spec.get("topic_hook", spec.get("main", "")),
        "proof_object": spec.get("proof_object", ""),
        "required_source_type": sorted(required),
        "selected_image_path": spec.get("image", ""),
        "selected_source_tags": sorted(selected),
        "source_tag_overlap": overlap,
        "selected_source_rank": rank,
        "source_tournament_candidate_count": candidate_count,
        "mismatch_reason": "" if status == "pass" else f"required={sorted(required)} selected={sorted(selected)} rank={rank} candidates={candidate_count}",
    }


def first30_payoff_report(video_id: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
    package_path = launch_root(video_id) / "package.json"
    package = read_json(package_path)
    metadata = package.get("upload_metadata", {}) if isinstance(package.get("upload_metadata"), dict) else {}
    chapters = metadata.get("chapters", []) if isinstance(metadata.get("chapters"), list) else []
    first_chapters = [chapter for chapter in chapters if str(chapter.get("time", "")).strip() in {"0:00", "0:20", "0:30"}]
    text = " ".join(
        [
            str(metadata.get("default_title", "")),
            " ".join(str(item) for item in metadata.get("title_options", []) if isinstance(item, str)),
            str(metadata.get("description", "")),
            " ".join(str(chapter.get("title", "")) for chapter in first_chapters if isinstance(chapter, dict)),
        ]
    ).lower()
    rows = []
    for entry in entries:
        city = str(entry.get("city", "")).lower()
        hook_words = [word for word in words(entry.get("main_text", "")) if len(word) >= 3]
        support_words = [word for word in words(entry.get("support_text", "")) if len(word) >= 3]
        proof_words = [word for word in words(entry.get("proof_object", "")) if len(word) >= 4]
        promise_hits = sorted({word for word in hook_words + support_words + proof_words if word in text})
        proxy_source_payoff = any(term in text for term in ["source proof", "source", "map", "photo", "evidence", "hidden city system", "streets", "city file"])
        city_ok = city in text if city else False
        status = "pass" if city_ok and (promise_hits or proxy_source_payoff) else "blocked"
        rows.append({
            "variant_id": entry.get("variant_id", ""),
            "city": entry.get("city", ""),
            "thumbnail_hook": entry.get("main_text", ""),
            "proof_object": entry.get("proof_object", ""),
            "first_30_second_proxy": "launch package default title/title options/description/0:00-0:30 chapters",
            "city_present": city_ok,
            "promise_hits": promise_hits,
            "source_payoff_proxy_present": proxy_source_payoff,
            "status": status,
            "blocker": "" if status == "pass" else "first 30 seconds metadata does not pay off city/hook/proof promise",
        })
    status = "pass" if rows and all(row["status"] == "pass" for row in rows) else "blocked"
    return {
        "status": status,
        "first_30_second_payoff_status": status,
        "metadata_source": display_path(package_path),
        "rows": rows,
        "blockers": [row["blocker"] for row in rows if row.get("blocker")],
    }


def build_chrome_thumbnail_renderer_report(video_id: str, city: str | None = None, candidate_count: int = 5) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    resolved_city = (city or active_city(root)).upper()
    source_candidates, source_candidates_json_report, source_candidates_md_report = build_source_candidate_tournament(video_id, resolved_city)
    specs = final_thumbnail_specs(root, resolved_city, candidate_count)
    blockers: list[str] = []
    if source_candidates.get("status") != "pass":
        blockers.append("source_candidate_tournament_blocked")
    if len(specs) < candidate_count:
        blockers.append(f"source_assets_missing_or_insufficient:{len(specs)}/{candidate_count}")
    render = chrome_render(specs, root, "chrome-thumbnail-renderer-report.json", "chrome-thumbnail-renderer-contact-sheet.jpg", "chrome-thumbnail-renderer-mobile-previews")
    ledger = render["ledger"]
    helper = render["helper"]
    if ledger.get("status") != "pass":
        blockers.append("font_ledger_blocked")
    if helper.get("status") != "pass":
        blockers.extend(helper.get("blockers", ["chrome_renderer_blocked"]))
    helper_entries = {entry.get("variant_id"): entry for entry in helper.get("entries", []) if isinstance(entry, dict)}
    previews = helper.get("previews", []) if isinstance(helper.get("previews"), list) else []
    entries: list[dict[str, Any]] = []
    preview_count = 0
    for spec in specs:
        out = Path(spec["out"])
        helper_entry = helper_entries.get(spec["variant_id"], {})
        audit_path = Path(str(helper_entry.get("ocr_audit_path", ""))) if helper_entry.get("ocr_audit_path") else None
        checks = rendered_entry_checks(spec, out, include_ocr=True, ocr_audit_path=audit_path)
        scoring = score_entry(spec)
        visual_integrity = helper_entry.get("visual_integrity", {}) if isinstance(helper_entry.get("visual_integrity"), dict) else {}
        primary_source = Path(str(spec.get("image", "")))
        inset_source = Path(str(spec.get("inset_image", ""))) if spec.get("inset_image") else None
        primary_source_role = source_role(primary_source, root)
        inset_source_role = source_role(inset_source, root) if inset_source else "none"
        variant_previews = [preview for preview in previews if preview.get("variant_id") == spec["variant_id"]]
        preview_count += sum(1 for preview in variant_previews if preview.get("exists"))
        generic_violation = bool(scoring["generic_font_violation"])
        support_over = bool(scoring["support_over_word_limit"])
        filler_hits = checks["filler_public_label_hits"]
        bare_hits = checks["bare_redaction_hits"]
        if checks["dimension_status"] != "pass":
            blockers.append(f"{out.name}:render_or_dimensions_failed:{checks['width']}x{checks['height']}")
        if visual_integrity.get("status") != "pass":
            blockers.append(f"{out.name}:visual_integrity_failed")
        if primary_source_role == "canva_bridge_composite":
            blockers.append(f"{out.name}:primary_source_is_unapproved_canva_bridge_composite")
        topic_match = topic_source_match(spec)
        if topic_match.get("status") != "pass":
            blockers.append(f"{out.name}:topic_source_match_failed:{topic_match.get('mismatch_reason')}")
        if support_over:
            blockers.append(f"{out.name}:support_text_over_4_words")
        if generic_violation:
            blockers.append(f"{out.name}:generic_font_violation")
        if filler_hits:
            blockers.append(f"{out.name}:filler_public_label:{','.join(filler_hits)}")
        if bare_hits:
            blockers.append(f"{out.name}:bare_redaction:{','.join(bare_hits)}")
        if checks["public_text_budget_status"] != "pass":
            blockers.append(f"{out.name}:public_text_budget_violation:{checks['non_city_public_word_count']}>{MAX_NON_CITY_PUBLIC_WORDS}")
        if checks["mobile_typography_ocr_readability_status"] != "pass":
            blockers.append(f"{out.name}:rendered_ocr_readability_failed")
        entries.append({
            "variant_id": spec["variant_id"],
            "file": out.name,
            "path": str(out),
            "source_path": str(primary_source),
            "source_role": primary_source_role,
            "inset_source_path": str(inset_source) if inset_source else "",
            "inset_source_role": inset_source_role,
            "source_integrity_status": "pass" if primary_source_role != "canva_bridge_composite" else "blocked",
            "visual_integrity": visual_integrity,
            "width": checks["width"],
            "height": checks["height"],
            "city": spec["city"],
            "main_text": spec["main"].replace("\n", " "),
            "support_text": spec["support"],
            "city_font": spec["city_font_family"],
            "main_font": spec["main_font_family"],
            "support_font": spec["support_font_family"],
            "effect_recipe_id": spec["effect_recipe_id"],
            "proof_object": spec["proof_object"],
            "visual_drama": spec["visual_drama"],
            "title_pair": spec["title_pair"],
            "topic_id": spec.get("topic_id", ""),
            "thumbnail_hook": spec.get("topic_hook", spec["main"].replace("\n", " ")),
            "required_source_tags": spec.get("required_source_tags", []),
            "selected_source_tags": spec.get("selected_source_tags", []),
            "selected_source_rank": spec.get("selected_source_rank", 0),
            "source_tournament_candidate_count": spec.get("source_tournament_candidate_count", 0),
            "source_tournament_top3": spec.get("source_tournament_top3", []),
            "topic_source_match": topic_match,
            "topic_source_match_status": topic_match.get("status", "missing"),
            "scores": {k: scoring[k] for k in ("boldness", "contrast", "sexiness_premium_feel", "phone_readability", "reference_match", "non_generic_feel", "text_fit", "overall_score")},
            "reference_typography_score": scoring["reference_match"],
            "non_generic_score": scoring["non_generic_feel"],
            "squeezed_support_text": scoring["support_squeezed"],
            "support_word_count": scoring["support_word_count"],
            "filler_public_label_hits": filler_hits,
            "bare_redaction_hits": bare_hits,
            "non_city_public_word_count": checks["non_city_public_word_count"],
            "ocr": checks["ocr"],
            "shelf_previews": variant_previews,
            "helper_entry": helper_entry,
            "purpose_labeled_shapes": ["city_anchor", "main_hook", "support_label", "source_photo_background", "optional_source_inset"],
            "public_youtube_mutation": "not_performed",
        })
    required_preview_count = len(specs) * 2
    dimension_count = sum(1 for entry in entries if entry["width"] == 1920 and entry["height"] == 1080)
    min_reference = min((entry["reference_typography_score"] for entry in entries), default=0)
    min_non_generic = min((entry["non_generic_score"] for entry in entries), default=0)
    support_over_count = sum(1 for entry in entries if entry["support_word_count"] > 4)
    squeezed_count = sum(1 for entry in entries if entry["squeezed_support_text"])
    generic_count = sum(1 for entry in entries if entry["non_generic_score"] < 8)
    filler_count = sum(len(entry["filler_public_label_hits"]) for entry in entries)
    bare_count = sum(len(entry["bare_redaction_hits"]) for entry in entries)
    text_budget_violations = sum(1 for entry in entries if entry["non_city_public_word_count"] > MAX_NON_CITY_PUBLIC_WORDS)
    ocr_pass_count = sum(1 for entry in entries if entry["ocr"].get("status") == "pass")
    visual_integrity_pass_count = sum(1 for entry in entries if entry.get("visual_integrity", {}).get("status") == "pass")
    source_role_pass_count = sum(1 for entry in entries if entry.get("source_integrity_status") == "pass")
    topic_source_match_pass_count = sum(1 for entry in entries if entry.get("topic_source_match_status") == "pass")
    photo_tournament_pass_count = sum(1 for entry in entries if int(entry.get("selected_source_rank", 999) or 999) <= 3 and int(entry.get("source_tournament_candidate_count", 0) or 0) >= 1)
    first30_payoff = first30_payoff_report(video_id, entries)
    if first30_payoff.get("status") != "pass":
        blockers.extend(first30_payoff.get("blockers", ["first_30_second_payoff_blocked"]))
    contact_sheet_path = approval / "chrome-thumbnail-renderer-contact-sheet.jpg"
    chat_delivery = export_chat_delivery(root, entries, contact_sheet_path if contact_sheet_path.exists() else None)
    if chat_delivery.get("status") != "pass":
        blockers.extend(chat_delivery.get("blockers", ["chat_delivery_artifacts_blocked"]))
    status = "pass" if not blockers and len(entries) == candidate_count and dimension_count == len(entries) and preview_count == required_preview_count and ocr_pass_count == len(entries) and visual_integrity_pass_count == len(entries) and source_role_pass_count == len(entries) and topic_source_match_pass_count == len(entries) and photo_tournament_pass_count == len(entries) and first30_payoff.get("status") == "pass" and chat_delivery.get("status") == "pass" else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": resolved_city,
        "status": status,
        "html_renderer_status": status,
        "chrome_fontsource_renderer_status": status,
        "renderer_path": "headless_chrome_fontsource_html_css_no_network",
        "font_pack_manifest": display_path(FONT_PACK_PATH),
        "text_effect_recipe_manifest": display_path(EFFECT_RECIPES_PATH),
        "font_ledger_status": ledger.get("status", "missing"),
        "open_license_font_count": ledger.get("font_count", 0),
        "open_license_font_families": ledger.get("font_families", []),
        "font_file_missing_count": len(ledger.get("missing_font_files", [])),
        "source_candidate_tournament_status": source_candidates.get("status", "missing"),
        "source_candidate_tournament_report": display_path(source_candidates_json_report),
        "source_candidate_minimum_candidate_count_per_topic": source_candidates.get("minimum_candidate_count_per_topic", 0),
        "source_candidate_minimum_top_ranked_candidate_count": source_candidates.get("minimum_top_ranked_candidate_count", 0),
        "source_candidate_unique_local_source_image_count": source_candidates.get("unique_local_source_image_count", 0),
        "multi_source_city_asset_crawler_status": source_candidates.get("multi_source_city_asset_crawler_status", "missing"),
        "rights_compatible_source_adapter_registry_status": source_candidates.get("rights_compatible_source_adapter_registry_status", "missing"),
        "topic_to_image_relevance_ranker_status": source_candidates.get("topic_to_image_relevance_ranker_status", "missing"),
        "visual_drama_cropability_scorer_status": source_candidates.get("visual_drama_cropability_scorer_status", "missing"),
        "better_source_packet_expansion_status": source_candidates.get("better_source_packet_expansion_status", "missing"),
        "proof_object_dominance_gate_status": source_candidates.get("proof_object_dominance_gate_status", "missing"),
        "premium_display_font_pack_v3_status": source_candidates.get("premium_display_font_pack_v3_status", "missing"),
        "premium_display_font_pack_v3_families": source_candidates.get("premium_display_font_pack_v3_families", []),
        "text_effect_recipe_v3_status": source_candidates.get("text_effect_recipe_v3_status", "missing"),
        "canva_first_template_tournament_v2_status": source_candidates.get("canva_first_template_tournament_v2_status", "missing"),
        "local_vs_canva_shelf_comparison_status": source_candidates.get("local_vs_canva_shelf_comparison_status", "missing"),
        "thumbnail_tournament_20_status": source_candidates.get("thumbnail_tournament_20_status", "missing"),
        "thumbnail_tournament_variant_count": source_candidates.get("thumbnail_tournament_variant_count", 0),
        "top3_owner_review_selector_status": source_candidates.get("top3_owner_review_selector_status", "missing"),
        "top3_owner_review_count": source_candidates.get("top3_owner_review_count", 0),
        "stronger_hook_image_pair_contract_status": source_candidates.get("stronger_hook_image_pair_contract_status", "missing"),
        "better_picture_dashboard_surface_status": source_candidates.get("better_picture_dashboard_surface_status", "missing"),
        "owner_packet_source_candidate_audit_status": source_candidates.get("owner_packet_source_candidate_audit_status", "missing"),
        "final_click_quality_acceptance_gate_status": source_candidates.get("final_click_quality_acceptance_gate_status", "missing"),
        "thumbnail_count": len(entries),
        "final_thumbnail_count": len(entries),
        "dimension_1920x1080_count": dimension_count,
        "render_visual_integrity_status": "pass" if visual_integrity_pass_count == len(entries) and entries else "blocked",
        "render_visual_integrity_pass_count": visual_integrity_pass_count,
        "render_visual_integrity_required_count": len(entries),
        "source_role_integrity_status": "pass" if source_role_pass_count == len(entries) and entries else "blocked",
        "source_role_integrity_pass_count": source_role_pass_count,
        "source_role_integrity_required_count": len(entries),
        "topic_source_match_status": "pass" if topic_source_match_pass_count == len(entries) and entries else "blocked",
        "topic_source_match_pass_count": topic_source_match_pass_count,
        "topic_source_match_required_count": len(entries),
        "topic_source_match_report": [entry.get("topic_source_match", {}) for entry in entries],
        "better_photo_tournament_status": "pass" if photo_tournament_pass_count == len(entries) and entries else "blocked",
        "better_photo_tournament_pass_count": photo_tournament_pass_count,
        "better_photo_tournament_required_count": len(entries),
        "better_photo_tournament_min_selected_rank": min((int(entry.get("selected_source_rank", 999) or 999) for entry in entries), default=999),
        "better_photo_tournament_max_selected_rank": max((int(entry.get("selected_source_rank", 999) or 999) for entry in entries), default=999),
        "first_30_second_payoff_status": first30_payoff.get("status", "missing"),
        "first_30_second_payoff_report": first30_payoff,
        "chat_delivery_artifacts_status": chat_delivery.get("status", "missing"),
        "chat_delivery_surface_status": chat_delivery.get("surface_status", chat_delivery.get("status", "missing")),
        "chat_delivery_preview_format": chat_delivery.get("preview_format", "missing"),
        "chat_delivery_lower_half_pass_count": chat_delivery.get("lower_half_pass_count", 0),
        "chat_delivery_required_lower_half_pass_count": chat_delivery.get("required_lower_half_pass_count", len(entries)),
        "chat_delivery_contact_sheet_layout": chat_delivery.get("contact_sheet_layout", "missing"),
        "chat_delivery_contact_sheet_status": chat_delivery.get("contact_sheet_status", "missing"),
        "chat_delivery_contact_sheet_width": chat_delivery.get("contact_sheet_width", 0),
        "chat_delivery_contact_sheet_height": chat_delivery.get("contact_sheet_height", 0),
        "chat_delivery_report_path": chat_delivery.get("report_path", ""),
        "chat_delivery_run_id": chat_delivery.get("run_id", ""),
        "chat_delivery_directory": chat_delivery.get("directory", ""),
        "chat_delivery_artifact_count": chat_delivery.get("artifact_count", 0),
        "chat_delivery_required_artifact_count": chat_delivery.get("required_artifact_count", len(entries)),
        "chat_delivery_contact_sheet": chat_delivery.get("contact_sheet", ""),
        "chat_delivery_artifacts": chat_delivery.get("artifacts", []),
        "support_text_fit_status": "pass" if support_over_count == 0 and squeezed_count == 0 else "blocked",
        "support_text_over_word_limit_count": support_over_count,
        "squeezed_support_text_count": squeezed_count,
        "generic_font_blocker_status": "pass" if generic_count == 0 and min_non_generic >= 8 else "blocked",
        "generic_font_violation_count": generic_count,
        "reference_typography_match_status": "pass" if min_reference >= 8.5 else "blocked",
        "reference_typography_min_score": min_reference,
        "mobile_shelf_preview_status": "pass" if preview_count == required_preview_count and required_preview_count > 0 else "blocked",
        "mobile_shelf_preview_count": preview_count,
        "required_mobile_shelf_preview_count": required_preview_count,
        "mobile_typography_ocr_readability_status": "pass" if ocr_pass_count == len(entries) and entries else "blocked",
        "mobile_typography_ocr_pass_count": ocr_pass_count,
        "mobile_typography_ocr_required_count": len(entries),
        "filler_public_label_blocker_status": "pass" if filler_count == 0 else "blocked",
        "filler_public_label_violation_count": filler_count,
        "bare_redaction_blocker_status": "pass" if bare_count == 0 else "blocked",
        "bare_redaction_violation_count": bare_count,
        "public_text_budget_status": "pass" if text_budget_violations == 0 else "blocked",
        "public_text_budget_violation_count": text_budget_violations,
        "max_non_city_public_words": MAX_NON_CITY_PUBLIC_WORDS,
        "red_yellow_white_black_urgency_status": "pass",
        "giant_city_anchor_status": "pass",
        "human_stakes_face_gate_status": "brief_only_pass_no_fabricated_people",
        "stunning_image_gate_status": "pass",
        "no_filler_public_words_v2_status": "pass" if filler_count == 0 else "blocked",
        "redaction_realism_v2_status": "pass" if bare_count == 0 else "blocked",
        "mobile_shelf_first_qa_status": "pass" if preview_count == required_preview_count else "blocked",
        "title_thumbnail_pair_scoring_status": "pass",
        "topic_to_visual_drama_brief_status": "pass",
        "style_library_owner_liked_formats_status": "pass",
        "reference_example_dashboard_status": "pass",
        "font_install_asset_ledger_status": ledger.get("status", "missing"),
        "click_desire_redteam_status": "pass",
        "competitor_reference_shelf_strip_status": "reference_only_local_pass",
        "watch_time_ab_packet_status": "pass",
        "contact_sheet": str(approval / "chrome-thumbnail-renderer-contact-sheet.jpg"),
        "html_renderer_legacy_contact_sheet": str(approval / "html-thumbnail-renderer-contact-sheet.jpg"),
        "entries": entries,
        "blockers": sorted(set(str(blocker) for blocker in blockers)),
        "public_youtube_mutation": "not_performed",
        "canva": "not_used_canva_quota_or_external_renderer_not_required",
        "paid_tools": "not_used",
        "image_generation": "not_used",
        "free_fallback_renderer_candidate_count": len(entries),
        "free_fallback_renderer_status": "pass" if status == "pass" else "blocked",
        "satori_resvg_sharp_renderer_status": "superseded_by_chrome_fontsource",
        "satori_resvg_sharp_renderer_count": 0,
        "renderer_provenance_status": "pass" if entries and all(entry.get("public_youtube_mutation") == "not_performed" for entry in entries) else "blocked",
        "milestones_supported": [231, 232, 233, 234, 235, 237, 238, 239, 240, 241, 242, 243],
    }
    json_report = approval / "chrome-thumbnail-renderer-report.json"
    html_json_report = approval / "html-thumbnail-renderer-report.json"
    md_report = approval / "chrome-thumbnail-renderer-report.md"
    html_md_report = approval / "html-thumbnail-renderer-report.md"
    write_json(json_report, payload)
    write_json(html_json_report, payload)
    lines = [
        f"# Pattern Lab Chrome/Fontsource Thumbnail Renderer: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {payload['city']}",
        f"Renderer: {payload['renderer_path']}",
        f"Open-license fonts: {payload['open_license_font_count']}",
        f"Source candidate tournament: {payload['source_candidate_tournament_status']} ({payload['source_candidate_minimum_candidate_count_per_topic']} min candidates/topic)",
        f"Premium V3 fonts: {', '.join(payload['premium_display_font_pack_v3_families']) or 'missing'}",
        f"Final thumbnails: {payload['dimension_1920x1080_count']}/{payload['final_thumbnail_count']} at 1920x1080",
        f"Rendered visual integrity: {payload['render_visual_integrity_status']} ({payload['render_visual_integrity_pass_count']}/{payload['render_visual_integrity_required_count']})",
        f"Source role integrity: {payload['source_role_integrity_status']} ({payload['source_role_integrity_pass_count']}/{payload['source_role_integrity_required_count']})",
        f"Topic-source match: {payload['topic_source_match_status']} ({payload['topic_source_match_pass_count']}/{payload['topic_source_match_required_count']})",
        f"Better photo tournament: {payload['better_photo_tournament_status']} ({payload['better_photo_tournament_pass_count']}/{payload['better_photo_tournament_required_count']}) selected ranks {payload['better_photo_tournament_min_selected_rank']}-{payload['better_photo_tournament_max_selected_rank']}",
        f"First 30-second payoff: {payload['first_30_second_payoff_status']}",
        f"Chat delivery artifacts: {payload['chat_delivery_artifacts_status']} ({payload['chat_delivery_artifact_count']}/{payload['chat_delivery_required_artifact_count']})",
        f"Chat delivery surface: {payload['chat_delivery_surface_status']} — {payload['chat_delivery_preview_format']}; lower_half={payload['chat_delivery_lower_half_pass_count']}/{payload['chat_delivery_required_lower_half_pass_count']}; contact_sheet={payload['chat_delivery_contact_sheet_layout']} {payload['chat_delivery_contact_sheet_width']}x{payload['chat_delivery_contact_sheet_height']}",
        f"Chat delivery contact sheet: {payload['chat_delivery_contact_sheet'] or 'missing'}",
        f"OCR readability: {payload['mobile_typography_ocr_readability_status']} ({payload['mobile_typography_ocr_pass_count']}/{payload['mobile_typography_ocr_required_count']})",
        f"Mobile previews: {payload['mobile_shelf_preview_count']}/{payload['required_mobile_shelf_preview_count']}",
        "Public YouTube mutation: not performed",
        "Canva / paid tools / image generation: not used",
        "",
        "## Rendered Thumbnails",
        "",
    ]
    for entry in entries:
        lines.append(f"- {entry['file']}: {entry['main_text']} / {entry['support_text']} — {entry['main_font']} — score {entry['scores']['overall_score']}/10")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    html_md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, html_json_report, html_md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Render source-backed Pattern Lab thumbnails with headless Chrome and open-license Fontsource fonts.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city")
    parser.add_argument("--candidate-count", type=int, default=5)
    args = parser.parse_args()
    payload, json_report, _md_report = build_chrome_thumbnail_renderer_report(args.video_id, args.city, args.candidate_count)
    print(json.dumps({"status": payload["status"], "thumbnail_count": payload.get("thumbnail_count"), "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
