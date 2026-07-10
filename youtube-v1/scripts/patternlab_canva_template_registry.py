#!/usr/bin/env python3
"""Validate the Pattern Lab Canva template contract registry without mutating Canva."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

POLICY_PATH = BASE / "resources" / "thumbnail-canva-automation-policy.json"
REGISTRY_PATH = BASE / "resources" / "thumbnail-canva-template-registry.json"


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


def _non_empty_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def validate_registry(video_id: str = "miami-photo-redo") -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    registry = read_json(REGISTRY_PATH)
    blockers: list[str] = []
    warnings: list[str] = []

    required_text_slots = set(policy.get("required_text_slots", ["CITY", "MAIN_HOOK", "SUPPORT_LINE"]))
    required_image_slots = set(policy.get("required_image_slots", ["PRIMARY_PHOTO"]))
    required_fields = set(registry.get("schema", {}).get("required_fields", []))
    templates = _non_empty_list(registry.get("templates"))

    if policy.get("status") != "pass":
        blockers.append("canva_policy_status_not_pass")
    if policy.get("runtime_font_family_control") != "not_supported_by_current_canva_edit_api":
        blockers.append("runtime_font_family_control_policy_missing")
    if not templates:
        blockers.append("template_registry_empty")

    entries: list[dict[str, Any]] = []
    for template in templates:
        key = str(template.get("template_key", "missing"))
        missing_fields = sorted(field for field in required_fields if field not in template)
        text_slots = set(_non_empty_list(template.get("text_slots")))
        image_slots = set(_non_empty_list(template.get("image_slots")))
        design_id = str(template.get("canva_design_id", "") or "").strip()
        brand_template_id = str(template.get("brand_template_id", "") or "").strip()
        owner_status = str(template.get("owner_approval_status", ""))
        free_status = str(template.get("free_or_pro_asset_status", ""))
        font_expected = template.get("font_preservation_expected") is True
        topic_tags = _non_empty_list(template.get("allowed_topic_tags"))
        entry_blockers: list[str] = []
        if missing_fields:
            entry_blockers.append("missing_fields:" + ",".join(missing_fields))
        missing_text_slots = sorted(required_text_slots - text_slots)
        if missing_text_slots:
            entry_blockers.append("missing_text_slots:" + ",".join(missing_text_slots))
        missing_image_slots = sorted(required_image_slots - image_slots)
        if missing_image_slots:
            entry_blockers.append("missing_image_slots:" + ",".join(missing_image_slots))
        if not topic_tags:
            entry_blockers.append("missing_allowed_topic_tags")
        if not font_expected:
            entry_blockers.append("font_preservation_not_expected")
        if free_status != "free_only_required":
            entry_blockers.append("free_only_status_missing")
        if template.get("random_arrows_allowed") is not False:
            entry_blockers.append("random_arrows_not_blocked")
        if template.get("unexplained_lines_allowed") is not False:
            entry_blockers.append("unexplained_lines_not_blocked")
        if template.get("decorative_boxes_allowed") is not False:
            entry_blockers.append("decorative_boxes_not_blocked")
        production_ready = bool(design_id or brand_template_id) and owner_status == "approved"
        if not design_id and not brand_template_id:
            warnings.append(f"{key}:template_id_missing")
        if owner_status != "approved":
            warnings.append(f"{key}:owner_approval_pending")
        entries.append(
            {
                "template_key": key,
                "style_family": template.get("style_family", "missing"),
                "status": "pass" if not entry_blockers else "blocked",
                "blockers": entry_blockers,
                "canva_design_id_present": bool(design_id),
                "brand_template_id_present": bool(brand_template_id),
                "production_ready": production_ready,
                "owner_approval_status": owner_status,
                "free_or_pro_asset_status": free_status,
                "font_preservation_expected": font_expected,
                "text_slots": sorted(text_slots),
                "image_slots": sorted(image_slots),
                "allowed_topic_tags": topic_tags,
            }
        )
        blockers.extend(f"{key}:{item}" for item in entry_blockers)

    template_id_missing_count = sum(1 for item in entries if not item["canva_design_id_present"] and not item["brand_template_id_present"])
    production_ready_count = sum(1 for item in entries if item["production_ready"])
    slot_schema_status = "pass" if entries and not blockers else "blocked"
    production_ready_status = "pass" if production_ready_count == len(entries) and entries else "blocked_template_ids_missing"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if slot_schema_status == "pass" else "blocked",
        "registry_status": "pass" if slot_schema_status == "pass" else "blocked",
        "slot_schema_status": slot_schema_status,
        "font_preservation_gate_status": "pass" if entries and all(item["font_preservation_expected"] for item in entries) else "blocked",
        "canva_policy_status": policy.get("status", "missing"),
        "policy_file": display_path(POLICY_PATH),
        "registry_file": display_path(REGISTRY_PATH),
        "template_count": len(entries),
        "production_ready_template_count": production_ready_count,
        "template_id_missing_count": template_id_missing_count,
        "production_ready_status": production_ready_status,
        "execution_blocked_reason": "template_ids_and_owner_approval_missing" if production_ready_status != "pass" else "none",
        "runtime_font_family_control": policy.get("runtime_font_family_control", "missing"),
        "templates": entries,
        "blockers": sorted(set(blockers)),
        "warnings": sorted(set(warnings)),
        "public_youtube_mutation": "not_performed",
        "canva_live_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / "thumbnail-canva-template-registry-report.json"
    md_report = approval / "thumbnail-canva-template-registry-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Canva Template Registry: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Template count: {payload['template_count']}",
        f"Template IDs missing: {payload['template_id_missing_count']}",
        f"Production ready: {payload['production_ready_status']}",
        "Public YouTube mutation: not performed",
        "Canva live mutation: not performed",
        "Paid/pro assets: not used",
        "",
        "## Templates",
        "",
    ]
    for entry in entries:
        lines.append(f"- {entry['template_key']}: {entry['status']} | {entry['style_family']} | approved={entry['owner_approval_status']} | template_id={entry['canva_design_id_present'] or entry['brand_template_id_present']}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {item}" for item in payload["warnings"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Canva template registry contract.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = validate_registry(args.video_id)
    print(json.dumps({"status": payload["status"], "template_count": payload["template_count"], "production_ready_status": payload["production_ready_status"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
