#!/usr/bin/env python3
"""Select the Pattern Lab thumbnail renderer deterministically and fail closed."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_canva_render_plan import build_render_plan, read_json
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_html_thumbnail_renderer import build_html_thumbnail_renderer_report
from patternlab_penpot_slot_fill_smoke import build_slot_fill_smoke

REGISTRY_PATH = BASE / "resources" / "thumbnail-renderer-fallback-registry.json"
REPORT_NAME = "renderer-decision-gate-report"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_md(path: Path, lines: list[str]) -> None:
    ensure_dir(path.parent)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def renderer_registry() -> dict[str, Any]:
    registry = read_json(REGISTRY_PATH)
    renderers = registry.get("renderers", []) if isinstance(registry.get("renderers"), list) else []
    return {
        "status": registry.get("status", "missing"),
        "selection_order": registry.get("selection_order", []),
        "renderer_count": len(renderers),
        "renderers": renderers,
    }


def build_decision_gate(video_id: str, city: str | None = None) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    registry = renderer_registry()
    canva, canva_json, _canva_md = build_render_plan(video_id, city or "Miami")
    penpot, penpot_json, _penpot_md = build_slot_fill_smoke(video_id, city)
    local, local_json, _local_md = build_html_thumbnail_renderer_report(video_id)

    canva_ready = canva.get("canva_production_ready_status") == "pass" and str(canva.get("export_local_file_bridge_status", "")).startswith("pass")
    canva_blockers = canva.get("canva_blockers", [])
    recorded_canva_blocker = bool(canva_blockers) or not canva_ready
    penpot_ready = (
        recorded_canva_blocker
        and penpot.get("penpot_slot_fill_status") == "pass"
        and penpot.get("chat_safe_preview_status") == "pass"
    )
    local_ready = (
        recorded_canva_blocker
        and local.get("html_renderer_status") == "pass"
        and local.get("chat_delivery_surface_status") == "pass"
        and int(local.get("dimension_1920x1080_count", 0) or 0) >= 1
    )

    if canva_ready:
        selected = "canva_plugin"
        mode = "canva_primary_export_ready"
        reason = "Canva source-fill/export is callable and passed."
    elif penpot_ready:
        selected = "penpot_self_host"
        mode = "penpot_template_slot_fill_fallback"
        reason = "Canva export is blocked; Penpot native export and slot-fill smoke passed."
    elif local_ready:
        selected = "openclaw_local_renderer"
        mode = "chrome_fontsource_backup_fallback"
        reason = "Canva export and Penpot slot-fill are not available; local renderer passed."
    else:
        selected = "blocked"
        mode = "blocked_no_approved_renderer"
        reason = "No renderer passed the deterministic readiness checks."

    status = "pass" if selected != "blocked" else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": (city or canva.get("city") or penpot.get("city") or "").upper(),
        "status": status,
        "milestone_305_renderer_priority_decision_gate": status,
        "renderer_decision_gate_status": status,
        "selected_renderer": selected,
        "renderer_output_mode": mode,
        "selection_reason": reason,
        "selection_order": registry.get("selection_order", []),
        "registry_status": registry.get("status", "missing"),
        "registry_path": display_path(REGISTRY_PATH),
        "canva_ready": canva_ready,
        "canva_blockers": canva_blockers,
        "canva_report": display_path(canva_json),
        "penpot_ready": penpot_ready,
        "penpot_report": display_path(penpot_json),
        "penpot_slot_fill_status": penpot.get("penpot_slot_fill_status", "missing"),
        "penpot_chat_safe_preview_status": penpot.get("chat_safe_preview_status", "missing"),
        "local_ready": local_ready,
        "local_report": display_path(local_json),
        "local_html_renderer_status": local.get("html_renderer_status", "missing"),
        "local_chat_delivery_surface_status": local.get("chat_delivery_surface_status", "missing"),
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
        "blockers": [] if status == "pass" else ["no_approved_renderer_ready"],
    }
    json_report = approval / f"{REPORT_NAME}.json"
    md_report = approval / f"{REPORT_NAME}.md"
    write_json(json_report, payload)
    write_md(
        md_report,
        [
            f"# Pattern Lab Renderer Decision Gate: {video_id}",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {payload['status']}",
            f"Selected renderer: {payload['selected_renderer']}",
            f"Mode: {payload['renderer_output_mode']}",
            f"Reason: {payload['selection_reason']}",
            f"Canva ready: {payload['canva_ready']} blockers={', '.join(payload['canva_blockers']) or 'none'}",
            f"Penpot ready: {payload['penpot_ready']} slot_fill={payload['penpot_slot_fill_status']} chat={payload['penpot_chat_safe_preview_status']}",
            f"Local ready: {payload['local_ready']} html={payload['local_html_renderer_status']} chat={payload['local_chat_delivery_surface_status']}",
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
    parser = argparse.ArgumentParser(description="Run Pattern Lab renderer decision gate.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city", default="")
    args = parser.parse_args()
    payload, json_report, _md_report = build_decision_gate(args.video_id, args.city or None)
    print(json.dumps({"status": payload["status"], "selected_renderer": payload["selected_renderer"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
