#!/usr/bin/env python3
"""Write a consolidated Pattern Lab thumbnail renderer readiness report."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_canva_render_plan import build_render_plan, read_json
from patternlab_common import BASE, display_path, ensure_dir, utc_now
from patternlab_html_thumbnail_renderer import build_html_thumbnail_renderer_report
from patternlab_penpot_slot_fill_smoke import build_slot_fill_smoke
from patternlab_renderer_decision_gate import build_decision_gate

REPORT_ROOT = BASE / "approval-blockers"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_md(path: Path, lines: list[str]) -> None:
    ensure_dir(path.parent)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_readiness_report(video_id: str, city: str | None = None) -> tuple[dict[str, Any], Path, Path]:
    canva, canva_json, _canva_md = build_render_plan(video_id, city or "Miami")
    penpot, penpot_json, _penpot_md = build_slot_fill_smoke(video_id, city)
    local, local_json, _local_md = build_html_thumbnail_renderer_report(video_id)
    decision, decision_json, _decision_md = build_decision_gate(video_id, city)
    canva_export_report = read_json(REPORT_ROOT / "canva-export-capability-report.json")

    canva_status = "pass" if decision.get("selected_renderer") == "canva_plugin" else "blocked_or_not_selected"
    penpot_status = "pass" if penpot.get("penpot_slot_fill_status") == "pass" else "blocked"
    local_status = "pass" if local.get("html_renderer_status") == "pass" else "blocked"
    owner_review_can_proceed = decision.get("renderer_decision_gate_status") == "pass"
    status = "pass" if owner_review_can_proceed else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": (city or decision.get("city") or "").upper(),
        "status": status,
        "milestone_309_production_renderer_readiness_report": status,
        "canva_status": canva_status,
        "canva_export_status": canva_export_report.get("status", canva.get("export_local_file_bridge_status", "missing")),
        "canva_blockers": canva.get("canva_blockers", []),
        "canva_report": display_path(canva_json),
        "penpot_status": penpot_status,
        "penpot_slot_fill_status": penpot.get("penpot_slot_fill_status", "missing"),
        "penpot_chat_safe_preview_status": penpot.get("chat_safe_preview_status", "missing"),
        "penpot_report": display_path(penpot_json),
        "local_status": local_status,
        "local_html_renderer_status": local.get("html_renderer_status", "missing"),
        "local_chat_delivery_surface_status": local.get("chat_delivery_surface_status", "missing"),
        "local_report": display_path(local_json),
        "selected_renderer": decision.get("selected_renderer", "missing"),
        "renderer_output_mode": decision.get("renderer_output_mode", "missing"),
        "renderer_decision_report": display_path(decision_json),
        "owner_review_can_proceed": owner_review_can_proceed,
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
        "blockers": [] if status == "pass" else ["renderer_decision_gate_blocked"],
    }
    json_report = REPORT_ROOT / "patternlab-renderer-readiness-report.json"
    md_report = REPORT_ROOT / "patternlab-renderer-readiness-report.md"
    write_json(json_report, payload)
    write_md(
        md_report,
        [
            "# Pattern Lab Renderer Readiness Report",
            "",
            f"Generated: {payload['generated_at']}",
            f"Video ID: {payload['video_id']}",
            f"City: {payload['city']}",
            f"Status: {payload['status']}",
            f"Selected renderer: {payload['selected_renderer']} ({payload['renderer_output_mode']})",
            f"Canva: {payload['canva_status']} export={payload['canva_export_status']} blockers={', '.join(payload['canva_blockers']) or 'none'}",
            f"Penpot: {payload['penpot_status']} slot_fill={payload['penpot_slot_fill_status']} chat={payload['penpot_chat_safe_preview_status']}",
            f"Local: {payload['local_status']} html={payload['local_html_renderer_status']} chat={payload['local_chat_delivery_surface_status']}",
            f"Owner review can proceed: {payload['owner_review_can_proceed']}",
            "Paid/pro assets: not used",
            "Public YouTube mutation: not performed",
            "",
            "## Blockers",
            "",
            *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
        ],
    )
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Write Pattern Lab renderer readiness report.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city", default="")
    args = parser.parse_args()
    payload, json_report, _md_report = build_readiness_report(args.video_id, args.city or None)
    print(json.dumps({"status": payload["status"], "selected_renderer": payload["selected_renderer"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
