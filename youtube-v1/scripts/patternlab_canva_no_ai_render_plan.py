#!/usr/bin/env python3
"""Build Canva no-AI approved-template edit/export plans without calling Canva."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_canva_render_plan import build_city_topics, find_template, infer_active_city, read_json
from patternlab_canva_source_bridge import build_source_bridge
from patternlab_canva_template_registry import REGISTRY_PATH, validate_registry

POLICY_PATH = BASE / "resources" / "thumbnail-canva-no-ai-policy.json"
REPORT_NAME = "canva-no-ai-render-plan-report"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def words(value: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", value or "")


def non_city_word_count(city: str, *texts: str) -> int:
    city_words = {word.upper() for word in words(city)}
    return sum(1 for word in words(" ".join(texts)) if word.upper() not in city_words)


def rel_to_root(root: Path, value: str) -> str:
    if not value:
        return ""
    path = Path(value)
    if path.is_absolute():
        try:
            return str(path.relative_to(root))
        except ValueError:
            return str(path)
    return value


def operation_plan(topic: dict[str, Any], template: dict[str, Any], root: Path) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = [
        {"type": "replace_text", "slot": "CITY", "replacement": topic.get("city", "")},
        {"type": "replace_text", "slot": "MAIN_HOOK", "replacement": topic.get("main_hook", "")},
        {"type": "replace_text", "slot": "SUPPORT_LINE", "replacement": topic.get("support_line", "")},
        {
            "type": "update_fill",
            "slot": "PRIMARY_PHOTO",
            "asset_type": "image",
            "source_path": rel_to_root(root, str(topic.get("primary_photo", ""))),
        },
    ]
    if "SECONDARY_PHOTO" in template.get("image_slots", []) and topic.get("secondary_photo"):
        operations.append(
            {
                "type": "update_fill",
                "slot": "SECONDARY_PHOTO",
                "asset_type": "image",
                "source_path": rel_to_root(root, str(topic.get("secondary_photo", ""))),
            }
        )
    operations.append({"type": "update_title", "title": f"Pattern Lab {topic.get('city', '')} — {topic.get('main_hook', '')}"})
    return operations


def validate_edit_plan(plan: dict[str, Any], policy: dict[str, Any], root: Path) -> list[str]:
    blockers: list[str] = []
    allowed_ops = set(policy.get("allowed_canva_edit_operations", []))
    forbidden = {str(item).lower() for item in policy.get("forbidden_canva_operations_or_workflows", [])}
    city = str(plan.get("city", "")).strip()
    main_hook = str(plan.get("main_hook", "")).strip()
    support = str(plan.get("support_line", "")).strip()
    public_text = f"{city} {main_hook} {support}".upper()
    main_min, main_max = policy.get("main_hook_word_range", [1, 4])
    support_min, support_max = policy.get("support_line_word_range", [2, 4])
    if not city:
        blockers.append("city_missing")
    elif city.upper() not in public_text:
        blockers.append("city_not_visible")
    main_words = len(words(main_hook))
    if main_words < int(main_min) or main_words > int(main_max):
        blockers.append(f"main_hook_word_count_out_of_range:{main_words}")
    if support:
        support_words = len(words(support))
        if support_words < int(support_min) or support_words > int(support_max):
            blockers.append(f"support_line_word_count_out_of_range:{support_words}")
    max_non_city_words = int(policy.get("max_non_city_public_words", 5))
    non_city_words = non_city_word_count(city, main_hook, support)
    if non_city_words > max_non_city_words:
        blockers.append(f"non_city_public_word_count_too_high:{non_city_words}>{max_non_city_words}")
    for label in policy.get("blocked_public_labels", []):
        if str(label).upper() in public_text:
            blockers.append(f"blocked_public_label:{label}")
    if plan.get("source_workflow") != "approved_template_no_ai_edit_export":
        blockers.append("wrong_source_workflow")
    if plan.get("canva_ai_generation") != "not_used":
        blockers.append("canva_ai_generation_not_blocked")
    if plan.get("magic_layers_image_to_design") != "not_used":
        blockers.append("magic_layers_not_blocked")
    if plan.get("paid_or_pro_assets") != "not_used":
        blockers.append("paid_or_pro_assets_not_blocked")
    template = plan.get("template", {})
    if not template.get("canva_design_id") and not template.get("brand_template_id"):
        blockers.append("approved_template_id_missing")
    if template.get("owner_approval_status") != "approved":
        blockers.append("template_not_owner_approved")
    if template.get("font_preservation_expected") is not True:
        blockers.append("font_preservation_not_expected")
    if template.get("random_arrows_allowed") is not False:
        blockers.append("random_arrows_not_blocked")
    if template.get("unexplained_lines_allowed") is not False:
        blockers.append("unexplained_lines_not_blocked")
    if template.get("decorative_boxes_allowed") is not False:
        blockers.append("decorative_boxes_not_blocked")
    for op in plan.get("planned_operations", []):
        op_type = str(op.get("type", ""))
        if op_type not in allowed_ops:
            blockers.append(f"operation_not_allowed:{op_type}")
        if op_type.lower() in forbidden:
            blockers.append(f"forbidden_workflow:{op_type}")
        source_path = op.get("source_path")
        if op_type == "update_fill" and source_path and not (root / source_path).exists():
            blockers.append(f"source_fill_missing:{source_path}")
    return blockers


def negative_fixture_results(policy: dict[str, Any], approved_template: dict[str, Any], root: Path) -> dict[str, Any]:
    fixtures = [
        {
            "name": "ai_generate_design_blocked",
            "plan": {"city": "CLEVELAND", "main_hook": "WHO CUT IT?", "support_line": "", "template": approved_template, "source_workflow": "generate_design", "canva_ai_generation": "used", "magic_layers_image_to_design": "not_used", "paid_or_pro_assets": "not_used", "planned_operations": [{"type": "generate_design"}]},
            "expected": "blocked",
        },
        {
            "name": "magic_layers_blocked",
            "plan": {"city": "CLEVELAND", "main_hook": "WHO CUT IT?", "support_line": "", "template": approved_template, "source_workflow": "image_to_design", "canva_ai_generation": "not_used", "magic_layers_image_to_design": "used", "paid_or_pro_assets": "not_used", "planned_operations": [{"type": "image_to_design"}]},
            "expected": "blocked",
        },
        {
            "name": "paid_asset_blocked",
            "plan": {"city": "CLEVELAND", "main_hook": "WHO CUT IT?", "support_line": "", "template": approved_template, "source_workflow": "approved_template_no_ai_edit_export", "canva_ai_generation": "not_used", "magic_layers_image_to_design": "not_used", "paid_or_pro_assets": "used", "planned_operations": [{"type": "replace_text", "slot": "CITY", "replacement": "CLEVELAND"}]},
            "expected": "blocked",
        },
        {
            "name": "missing_city_blocked",
            "plan": {"city": "", "main_hook": "WHO CUT IT?", "support_line": "", "template": approved_template, "source_workflow": "approved_template_no_ai_edit_export", "canva_ai_generation": "not_used", "magic_layers_image_to_design": "not_used", "paid_or_pro_assets": "not_used", "planned_operations": [{"type": "replace_text", "slot": "MAIN_HOOK", "replacement": "WHO CUT IT?"}]},
            "expected": "blocked",
        },
    ]
    results = []
    for fixture in fixtures:
        blockers = validate_edit_plan(fixture["plan"], policy, root)
        results.append({"name": fixture["name"], "status": "pass" if blockers else "fail", "blockers": blockers})
    return {"status": "pass" if all(item["status"] == "pass" for item in results) else "blocked", "fixtures": results}


def build_no_ai_render_plan(video_id: str, city: str | None = None) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    registry = read_json(REGISTRY_PATH)
    registry_report, _registry_json, _registry_md = validate_registry(video_id)
    source_bridge, source_bridge_json, _source_bridge_md = build_source_bridge(video_id)
    resolved_city = infer_active_city(root, city or "")
    topics = build_city_topics(resolved_city, root, source_bridge)[:3]
    templates = [item for item in registry.get("templates", []) if item.get("owner_approval_status") == "approved"]
    blockers: list[str] = []
    if policy.get("status") != "pass":
        blockers.append("canva_no_ai_policy_not_pass")
    if registry_report.get("registry_status") != "pass":
        blockers.append("canva_template_registry_not_pass")
    if source_bridge.get("status") != "pass":
        blockers.append("canva_source_bridge_not_pass")
    edit_plans: list[dict[str, Any]] = []
    for index, topic in enumerate(topics, start=1):
        template = find_template(topic.get("topic_tags", []), templates)
        if not template:
            blockers.append(f"topic_{index}_approved_template_missing:{topic.get('topic_id', 'missing')}")
            continue
        plan = {
            "candidate_index": index,
            "topic_id": topic.get("topic_id", ""),
            "city": topic.get("city", resolved_city.upper()),
            "main_hook": topic.get("main_hook", ""),
            "support_line": topic.get("support_line", ""),
            "title_pair": topic.get("title_pair", ""),
            "template_key": template.get("template_key", ""),
            "canva_design_id": template.get("canva_design_id", ""),
            "brand_template_id": template.get("brand_template_id", ""),
            "template": template,
            "source_workflow": "approved_template_no_ai_edit_export",
            "canva_ai_generation": "not_used",
            "magic_layers_image_to_design": "not_used",
            "generate_design": "not_used",
            "paid_or_pro_assets": "not_used",
            "public_youtube_mutation": "not_performed",
            "font_strategy": "preserve_template_fonts_no_runtime_font_family_selection",
            "primary_photo": rel_to_root(root, str(topic.get("primary_photo", ""))),
            "secondary_photo": rel_to_root(root, str(topic.get("secondary_photo", ""))),
            "planned_operations": operation_plan(topic, template, root),
            "first_30_second_payoff": topic.get("first_30_second_payoff", ""),
        }
        plan_blockers = validate_edit_plan(plan, policy, root)
        plan["status"] = "pass" if not plan_blockers else "blocked"
        plan["blockers"] = plan_blockers
        blockers.extend(f"{plan['topic_id']}:{blocker}" for blocker in plan_blockers)
        edit_plans.append(plan)
    negative_tests = negative_fixture_results(policy, templates[0] if templates else {}, root)
    if negative_tests.get("status") != "pass":
        blockers.append("negative_fixtures_not_fail_closed")
    operation_count = sum(len(plan.get("planned_operations", [])) for plan in edit_plans)
    font_preserved_count = sum(1 for plan in edit_plans if plan.get("template", {}).get("font_preservation_expected") is True)
    status = "pass" if not blockers and len(edit_plans) == 3 and operation_count > 0 else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": resolved_city.upper(),
        "status": status,
        "canva_no_ai_render_plan_status": status,
        "canva_no_ai_production_mode_status": "pass" if policy.get("production_mode") == "approved_template_edit_export_only" else "blocked",
        "canva_ai_generation_status": "not_used",
        "magic_layers_image_to_design_status": "not_used",
        "generate_design_status": "not_used",
        "canva_operation_allowlist_status": "pass" if not any("operation_not_allowed" in blocker or "forbidden_workflow" in blocker for blocker in blockers) else "blocked",
        "canva_template_font_preservation_audit_v2_status": "pass" if font_preserved_count == len(edit_plans) and edit_plans else "blocked",
        "approved_template_no_ai_edit_export_status": status,
        "edit_plan_count": len(edit_plans),
        "required_edit_plan_count": 3,
        "planned_operation_count": operation_count,
        "font_preserved_plan_count": font_preserved_count,
        "canva_no_ai_preview_export_smoke_status": "blocked_pending_explicit_canva_no_ai_edit_export_approval",
        "canva_no_ai_live_regeneration_status": "blocked_pending_explicit_canva_no_ai_edit_export_approval",
        "ready_for_live_canva_no_ai_validation_after_approval": status == "pass",
        "source_bridge_report": display_path(source_bridge_json),
        "template_registry_report_status": registry_report.get("registry_status", "missing"),
        "policy_file": display_path(POLICY_PATH),
        "edit_plans": edit_plans,
        "negative_tests": negative_tests,
        "blockers": sorted(set(blockers)),
        "public_youtube_mutation": "not_performed",
        "canva_live_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / f"{REPORT_NAME}.json"
    md_report = approval / f"{REPORT_NAME}.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Canva No-AI Render Plan: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {payload['city']}",
        f"Edit plans: {payload['edit_plan_count']}/{payload['required_edit_plan_count']}",
        f"Operation allowlist: {payload['canva_operation_allowlist_status']}",
        f"Font preservation audit V2: {payload['canva_template_font_preservation_audit_v2_status']}",
        f"Live preview/export: {payload['canva_no_ai_preview_export_smoke_status']}",
        "Canva AI generation: not used",
        "Magic Layers/image-to-design: not used",
        "Paid/pro assets: not used",
        "Public YouTube mutation: not performed",
        "",
        "## Plans",
        "",
    ]
    for plan in edit_plans:
        lines.append(f"- {plan['topic_id']}: {plan['status']} | {plan['template_key']} | {plan['main_hook']} | ops={len(plan['planned_operations'])}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local Canva no-AI template edit/export plans.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city")
    args = parser.parse_args()
    payload, json_report, _md_report = build_no_ai_render_plan(args.video_id, args.city)
    print(json.dumps({"status": payload["status"], "edit_plan_count": payload["edit_plan_count"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
