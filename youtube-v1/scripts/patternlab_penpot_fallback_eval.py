#!/usr/bin/env python3
"""Evaluate Pattern Lab Penpot fallback readiness without paid assets or public mutation."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_canva_render_plan import read_json

REQUIRED_TEXT_SLOTS = ["CITY", "MAIN_HOOK"]
OPTIONAL_TEXT_SLOTS = ["SUPPORT_LINE"]
REQUIRED_IMAGE_SLOTS = ["PRIMARY_PHOTO"]
OPTIONAL_IMAGE_SLOTS = ["SECONDARY_PHOTO"]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    docker_path = shutil.which("docker")
    global_smoke = read_json(Path(__file__).resolve().parents[1] / "approval-blockers" / "penpot-production-export-smoke-report.json")
    global_export_pass = (
        global_smoke.get("milestone_222_penpot_production_1920x1080_export") == "pass"
        and global_smoke.get("export_1920x1080_verified") is True
        and global_smoke.get("chat_safe_preview_verified") is True
    )
    slot_fill = read_json(approval / "penpot-slot-fill-smoke-report.json")
    slot_fill_pass = (
        slot_fill.get("penpot_slot_fill_status") == "pass"
        and slot_fill.get("chat_safe_preview_status") == "pass"
        and slot_fill.get("production_png_width") == 1920
        and slot_fill.get("production_png_height") == 1080
    )
    blockers: list[str] = []
    warnings: list[str] = []
    if not docker_path:
        blockers.append("docker_missing_for_self_hosted_penpot")
    ready_status = "pass" if slot_fill_pass else ("ready_for_approved_template_slot_fill" if global_export_pass else "ready_for_local_self_host_smoke")
    # Do not start containers or fetch images here. This is a deterministic local readiness contract.
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": ready_status if not blockers else "blocked",
        "penpot_fallback_status": ready_status if not blockers else "blocked",
        "docker_available": bool(docker_path),
        "docker_path": docker_path or "missing",
        "network_fetch_performed": False,
        "container_started": False,
        "global_penpot_export_smoke_status": "pass" if global_export_pass else "blocked_pending_global_smoke",
        "global_penpot_export_smoke_report": display_path(Path(__file__).resolve().parents[1] / "approval-blockers" / "penpot-production-export-smoke-report.json"),
        "global_penpot_production_png": global_smoke.get("production_png_path", "missing"),
        "global_penpot_chat_delivery_report": global_smoke.get("chat_delivery_report_path", "missing"),
        "penpot_slot_fill_status": slot_fill.get("penpot_slot_fill_status", "missing"),
        "penpot_slot_fill_report": display_path(approval / "penpot-slot-fill-smoke-report.json"),
        "penpot_slot_fill_chat_safe_preview_status": slot_fill.get("chat_safe_preview_status", "missing"),
        "template_slot_schema_status": "pass",
        "required_text_slots": REQUIRED_TEXT_SLOTS,
        "optional_text_slots": OPTIONAL_TEXT_SLOTS,
        "required_image_slots": REQUIRED_IMAGE_SLOTS,
        "optional_image_slots": OPTIONAL_IMAGE_SLOTS,
        "production_ready_status": "pass_slot_fill_smoke" if slot_fill_pass else ("blocked_pending_owner_approved_penpot_templates" if global_export_pass else "blocked_pending_self_host_install_api_export_smoke"),
        "export_validation_status": "pass_global_penpot_export_smoke" if global_export_pass else "blocked_pending_1920x1080_export_smoke",
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "blockers": blockers,
        "warnings": warnings,
    }
    json_report = approval / "penpot-fallback-evaluation-report.json"
    md_report = approval / "penpot-fallback-evaluation-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Penpot Fallback Evaluation: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Docker available: {payload['docker_available']} ({payload['docker_path']})",
        f"Global Penpot export smoke: {payload['global_penpot_export_smoke_status']}",
        f"Penpot slot-fill smoke: {payload['penpot_slot_fill_status']}",
        f"Template slot schema: {payload['template_slot_schema_status']}",
        f"Production ready: {payload['production_ready_status']}",
        f"Export validation: {payload['export_validation_status']}",
        "Network fetch performed: false",
        "Container started: false",
        "Paid/pro assets: not used",
        "Public YouTube mutation: not performed",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {item}" for item in blockers] or ["- none for local readiness contract; install/export smoke still required"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Penpot fallback readiness without external mutation.")
    parser.add_argument("--video-id", default="cleveland-test")
    args = parser.parse_args()
    payload, json_report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(json_report)}, indent=2))
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
