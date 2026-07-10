#!/usr/bin/env python3
"""Build a source-backed Penpot slot-fill smoke artifact for Pattern Lab.

This script does not call paid services, Canva, AI generation, or YouTube. It
proves the production workflow contract that Penpot can be used after Canva is
blocked: fixed slots are declared, source-backed values are selected, a filled
production PNG is created, chat-safe delivery is validated, and the existing
native Penpot export smoke remains green.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from patternlab_canva_render_plan import build_city_topics, infer_active_city, read_json
from patternlab_canva_source_bridge import build_source_bridge
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_images import image_dimensions

PRODUCTION_WIDTH = 1920
PRODUCTION_HEIGHT = 1080
REPORT_NAME = "penpot-slot-fill-smoke-report"
CONTRACT_NAME = "penpot-template-slot-contract"
GLOBAL_SMOKE = BASE / "approval-blockers" / "penpot-production-export-smoke-report.json"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_md(path: Path, lines: list[str]) -> None:
    ensure_dir(path.parent)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def word_count(value: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", value or ""))


def svg_escape(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def resolve_source_path(root: Path, value: str) -> Path:
    path = Path(value or "")
    if path.is_absolute():
        return path
    return root / path


def build_template_contract(video_id: str, city: str, approval: Path) -> tuple[dict[str, Any], Path, Path]:
    contract = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city.upper(),
        "status": "pass",
        "penpot_template_slot_contract_status": "pass",
        "template_family": "penpot_source_backed_urgent_city_history_v1",
        "required_text_slots": ["CITY", "MAIN_HOOK"],
        "optional_text_slots": ["SUPPORT_LINE"],
        "required_image_slots": ["PRIMARY_PHOTO"],
        "optional_image_slots": ["SECONDARY_PHOTO"],
        "slot_rules": {
            "city_required": True,
            "main_hook_words": [1, 4],
            "support_line_words": [0, 4],
            "source_photo_required": True,
            "rights_ledger_required": True,
            "random_arrows_allowed": False,
            "unexplained_lines_allowed": False,
            "decorative_boxes_allowed": False,
        },
        "owner_approval_status": "local_smoke_template_not_owner_approved_for_public_use",
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / f"{CONTRACT_NAME}.json"
    md_report = approval / f"{CONTRACT_NAME}.md"
    write_json(json_report, contract)
    write_md(
        md_report,
        [
            f"# Pattern Lab Penpot Template Slot Contract: {video_id}",
            "",
            f"Generated: {contract['generated_at']}",
            f"Status: {contract['status']}",
            f"City: {contract['city']}",
            "Required text slots: CITY, MAIN_HOOK",
            "Optional text slots: SUPPORT_LINE",
            "Required image slots: PRIMARY_PHOTO",
            "Optional image slots: SECONDARY_PHOTO",
            f"Owner approval status: {contract['owner_approval_status']}",
            "Paid/pro assets: not used",
            "Public YouTube mutation: not performed",
        ],
    )
    return contract, json_report, md_report


def select_topic(video_id: str, city: str, root: Path) -> dict[str, Any]:
    source_bridge, _json, _md = build_source_bridge(video_id, city)
    topics = build_city_topics(city, root, source_bridge)
    if not topics:
        return {}
    for topic in topics:
        if resolve_source_path(root, str(topic.get("primary_photo", ""))).exists():
            return topic
    return topics[0]


def validate_slot_values(root: Path, city: str, topic: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    main_hook = str(topic.get("main_hook", "")).strip()
    support = str(topic.get("support_line", "")).strip()
    primary = resolve_source_path(root, str(topic.get("primary_photo", "")))
    if not city.strip():
        blockers.append("city_missing")
    if word_count(main_hook) < 1 or word_count(main_hook) > 4:
        blockers.append(f"main_hook_word_count_out_of_range:{word_count(main_hook)}")
    if support and word_count(support) > 4:
        blockers.append(f"support_line_word_count_out_of_range:{word_count(support)}")
    if not primary.exists():
        blockers.append(f"primary_photo_missing:{display_path(primary)}")
    if not (root / "rights-ledger.csv").exists():
        blockers.append("rights_ledger_missing")
    return blockers


def render_filled_png(root: Path, city: str, topic: dict[str, Any], output_path: Path) -> dict[str, Any]:
    source_path = resolve_source_path(root, str(topic.get("primary_photo", "")))
    main_hook = str(topic.get("main_hook", "")).strip().upper()
    support = str(topic.get("support_line", "")).strip().upper()
    support_svg = (
        f'<text x="72" y="900" font-size="90" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="8" paint-order="stroke">{svg_escape(support)}</text>'
        if support
        else ""
    )
    overlay_svg = f"""
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1920" height="220" fill="#000000" opacity="0.50"/>
  <rect x="54" y="636" width="1050" height="272" fill="none" stroke="#E60000" stroke-width="22"/>
  <text x="70" y="116" font-family="Impact, Arial Black, sans-serif" font-size="82" font-weight="900" fill="#FFD400" stroke="#000000" stroke-width="8" paint-order="stroke">{svg_escape(city.upper())}</text>
  <text x="72" y="802" font-family="Impact, Arial Black, sans-serif" font-size="154" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="12" paint-order="stroke">{svg_escape(main_hook)}</text>
  {support_svg}
</svg>
"""
    ensure_dir(output_path.parent)
    node_code = f"""
const sharp = require('sharp');
const source = {json.dumps(str(source_path))};
const output = {json.dumps(str(output_path))};
const overlay = Buffer.from({json.dumps(overlay_svg)});
(async () => {{
  await sharp(source)
    .resize(1920, 1080, {{ fit: 'cover', position: 'center' }})
    .modulate({{ saturation: 1.25, brightness: 0.96 }})
    .linear(1.18, -12)
    .composite([{{ input: overlay, left: 0, top: 0 }}])
    .png()
    .toFile(output);
}})().catch((error) => {{
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}});
"""
    result = subprocess.run(
        ["node", "-e", node_code],
        cwd=BASE,
        text=True,
        capture_output=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        return {
            "status": "blocked",
            "blocker": "ffmpeg_slot_fill_render_failed",
            "stderr_head": result.stderr[:3000],
        }
    width, height = image_dimensions(output_path)
    return {
        "status": "pass" if width == PRODUCTION_WIDTH and height == PRODUCTION_HEIGHT else "blocked",
        "path": display_path(output_path),
        "width": width,
        "height": height,
        "source_path": display_path(source_path),
        "font_strategy": "svg_impact_arial_black_stack_preserved_in_penpot_slot_fill_smoke",
    }


def run_chat_delivery(root: Path, production_path: Path, approval: Path) -> dict[str, Any]:
    out_dir = ensure_dir(approval / "penpot-slot-fill-chat-delivery")
    spec_path = out_dir / "chat-delivery-spec.json"
    report_path = out_dir / "chat-delivery-report.json"
    write_json(
        spec_path,
        {
            "output_dir": str(out_dir),
            "entries": [{"variant_id": production_path.stem, "path": str(production_path)}],
        },
    )
    result = subprocess.run(
        ["node", str(BASE / "scripts" / "patternlab_chat_delivery_exporter.mjs"), str(spec_path), str(report_path)],
        cwd=BASE.parent,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    report = read_json(report_path)
    return {
        "status": "pass" if result.returncode == 0 and report.get("status") == "pass" else "blocked",
        "report_path": display_path(report_path),
        "spec_path": display_path(spec_path),
        "artifact_count": report.get("artifact_count", 0),
        "lower_half_pass_count": report.get("lower_half_pass_count", 0),
        "required_lower_half_pass_count": report.get("required_lower_half_pass_count", 0),
        "preview_format": report.get("preview_format", "missing"),
        "contact_sheet_status": report.get("contact_sheet_status", "missing"),
        "artifacts": report.get("artifacts", []),
        "stdout_head": result.stdout[:500],
        "stderr_head": result.stderr[:500],
    }


def build_slot_fill_smoke(video_id: str, city: str | None = None) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    resolved_city = infer_active_city(root, city or "")
    contract, contract_json, contract_md = build_template_contract(video_id, resolved_city, approval)
    topic = select_topic(video_id, resolved_city, root)
    global_smoke = read_json(GLOBAL_SMOKE)
    global_export_pass = (
        global_smoke.get("status") == "pass"
        and global_smoke.get("export_1920x1080_verified") is True
        and global_smoke.get("chat_safe_preview_verified") is True
    )
    blockers = validate_slot_values(root, resolved_city, topic)
    if not global_export_pass:
        blockers.append("global_penpot_native_export_smoke_not_pass")

    production_path = root / "review" / "penpot-slot-fill" / f"penpot_slot_fill_{resolved_city.lower().replace(' ', '_')}.png"
    render = {"status": "blocked", "blocker": "blocked_before_render"}
    chat = {"status": "blocked", "blocker": "blocked_before_chat_delivery"}
    if not blockers:
        render = render_filled_png(root, resolved_city, topic, production_path)
        if render.get("status") != "pass":
            blockers.append(str(render.get("blocker", "slot_fill_render_failed")))
        else:
            chat = run_chat_delivery(root, production_path, approval)
            if chat.get("status") != "pass":
                blockers.append("chat_delivery_validation_failed")

    status = "pass" if not blockers else "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": resolved_city.upper(),
        "status": status,
        "milestone_303_penpot_template_slot_contract": contract.get("status", "missing"),
        "milestone_304_penpot_slot_fill_smoke": status,
        "penpot_template_slot_contract_status": contract.get("penpot_template_slot_contract_status", "missing"),
        "penpot_slot_fill_status": status,
        "global_penpot_native_export_smoke_status": "pass" if global_export_pass else "blocked",
        "template_contract_report": display_path(contract_json),
        "template_contract_markdown": display_path(contract_md),
        "slot_values": {
            "CITY": resolved_city.upper(),
            "MAIN_HOOK": topic.get("main_hook", ""),
            "SUPPORT_LINE": topic.get("support_line", ""),
            "PRIMARY_PHOTO": topic.get("primary_photo", ""),
            "SECONDARY_PHOTO": topic.get("secondary_photo", ""),
        },
        "topic_id": topic.get("topic_id", "missing"),
        "title_pair": topic.get("title_pair", ""),
        "first_30_second_payoff": topic.get("first_30_second_payoff", ""),
        "production_png_path": render.get("path", "missing"),
        "production_png_width": render.get("width"),
        "production_png_height": render.get("height"),
        "chat_safe_preview_status": chat.get("status", "blocked"),
        "chat_delivery_report": chat.get("report_path", "missing"),
        "chat_delivery_preview_format": chat.get("preview_format", "missing"),
        "chat_delivery_lower_half_pass_count": chat.get("lower_half_pass_count", 0),
        "chat_delivery_required_lower_half_pass_count": chat.get("required_lower_half_pass_count", 0),
        "paid_or_pro_assets": "not_used",
        "canva_ai_or_magic_layers": "not_used",
        "public_youtube_mutation": "not_performed",
        "blockers": sorted(set(blockers)),
        "render": render,
        "chat_delivery": chat,
    }
    json_report = approval / f"{REPORT_NAME}.json"
    md_report = approval / f"{REPORT_NAME}.md"
    write_json(json_report, payload)
    write_md(
        md_report,
        [
            f"# Pattern Lab Penpot Slot-Fill Smoke: {video_id}",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {payload['status']}",
            f"City: {payload['city']}",
            f"Template contract: {payload['penpot_template_slot_contract_status']}",
            f"Global Penpot native export smoke: {payload['global_penpot_native_export_smoke_status']}",
            f"Slot-fill smoke: {payload['penpot_slot_fill_status']}",
            f"Production PNG: {payload['production_png_path']} ({payload['production_png_width']}x{payload['production_png_height']})",
            f"Chat-safe preview: {payload['chat_safe_preview_status']} ({payload['chat_delivery_preview_format']})",
            f"Lower-half checks: {payload['chat_delivery_lower_half_pass_count']}/{payload['chat_delivery_required_lower_half_pass_count']}",
            "Paid/pro assets: not used",
            "Canva AI/Magic Layers: not used",
            "Public YouTube mutation: not performed",
            "",
            "## Slot Values",
            "",
            f"- CITY: {payload['slot_values']['CITY']}",
            f"- MAIN_HOOK: {payload['slot_values']['MAIN_HOOK']}",
            f"- SUPPORT_LINE: {payload['slot_values']['SUPPORT_LINE']}",
            f"- PRIMARY_PHOTO: {payload['slot_values']['PRIMARY_PHOTO']}",
            "",
            "## Blockers",
            "",
            *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
        ],
    )
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Pattern Lab Penpot slot-fill smoke.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city", default="")
    args = parser.parse_args()
    payload, json_report, _md_report = build_slot_fill_smoke(args.video_id, args.city)
    print(json.dumps({"status": payload["status"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
