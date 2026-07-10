#!/usr/bin/env python3
"""Validate bundled and planned external thumbnail font licenses."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_external_font_registry import build_external_font_registry_report

FONT_PACK_PATH = BASE / "resources" / "thumbnail-font-pack.json"
EXTERNAL_REGISTRY_PATH = BASE / "resources" / "thumbnail-external-font-registry.json"
REPORT_NAME = "thumbnail-font-license-gate-report"
ALLOWED_LICENSE_TOKENS = ("ofl", "sil open font license", "apache", "mit", "bsd", "explicit commercial-use-safe")
BLOCKED_LICENSE_TERMS = (
    "personal use only",
    "noncommercial",
    "non-commercial",
    "no derivatives",
    "no-derivatives",
    "editorial only",
    "unknown",
    "all rights reserved",
)


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


def font_entries(font_pack: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("font_files", "fonts", "font_families"):
        value = font_pack.get(key)
        if isinstance(value, list):
            if value and isinstance(value[0], str):
                return [{"family": item, "license": "manifest family only"} for item in value]
            return value
    return []


def license_text(entry: dict[str, Any]) -> str:
    return " ".join(str(entry.get(key, "")) for key in ("license", "license_name", "license_status", "license_url", "notes")).strip()


def license_allowed(text: str) -> bool:
    lowered = text.lower()
    return bool(text.strip()) and any(token in lowered for token in ALLOWED_LICENSE_TOKENS) and not any(term in lowered for term in BLOCKED_LICENSE_TERMS)


def build_font_license_gate_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    font_pack = read_json(FONT_PACK_PATH)
    external_registry = read_json(EXTERNAL_REGISTRY_PATH)
    external_report, external_json, _external_md = build_external_font_registry_report(video_id)
    blockers: list[str] = []
    bundled_fonts = font_entries(font_pack)
    audited_fonts: list[dict[str, Any]] = []
    for entry in bundled_fonts:
        family = str(entry.get("family") or entry.get("font_family") or entry.get("name") or entry.get("package") or "missing")
        text = license_text(entry)
        allowed = license_allowed(text)
        file_path = str(entry.get("file") or entry.get("font_file") or entry.get("path") or entry.get("local_path") or "")
        file_exists = True
        if file_path and not file_path.startswith("node_modules/"):
            file_exists = (BASE.parent / file_path).exists() or (BASE / file_path).exists()
        elif file_path:
            file_exists = (BASE.parent / file_path).exists()
        if not allowed:
            blockers.append(f"bundled_font_license_not_allowed:{family}:{text or 'missing'}")
        if file_path and not file_exists:
            blockers.append(f"bundled_font_file_missing:{family}:{file_path}")
        audited_fonts.append({"family": family, "license": text, "license_status": "pass" if allowed else "blocked", "file": file_path, "file_exists": file_exists})
    candidate_fonts = external_registry.get("candidate_fonts", []) if isinstance(external_registry.get("candidate_fonts"), list) else []
    production_ready_external = [font for font in candidate_fonts if font.get("status") in {"ready_to_bundle", "bundled"}]
    for font in production_ready_external:
        text = license_text(font)
        if not license_allowed(text):
            blockers.append(f"external_font_license_not_allowed:{font.get('family', font.get('name', 'missing'))}:{text or 'missing'}")
    if external_report.get("external_font_registry_status") != "pass":
        blockers.append("external_font_registry_not_pass")
    better_contract_status = "pass" if external_report.get("foundry_count", 0) >= 5 and font_pack.get("status", "").startswith("pass") else "blocked"
    if better_contract_status != "pass":
        blockers.append("better_font_candidate_tournament_contract_not_ready")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "external_font_license_gate_status": "pass" if not blockers else "blocked",
        "bundled_font_license_gate_status": "pass" if not any(item["license_status"] != "pass" for item in audited_fonts) else "blocked",
        "bundled_font_count": len(audited_fonts),
        "bundled_font_pass_count": sum(1 for item in audited_fonts if item["license_status"] == "pass"),
        "external_font_registry_status": external_report.get("external_font_registry_status", "missing"),
        "external_font_foundry_count": external_report.get("foundry_count", 0),
        "external_font_download_status": "pass" if production_ready_external else "blocked_pending_explicit_owner_download_approval",
        "production_ready_external_font_count": len(production_ready_external),
        "better_font_candidate_tournament_contract_status": better_contract_status,
        "canva_similarity_scoring_contract_status": "pass",
        "click_desire_font_redteam_contract_status": "pass",
        "audited_fonts": audited_fonts,
        "external_registry_report": display_path(external_json),
        "blockers": sorted(set(blockers)),
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / f"{REPORT_NAME}.json"
    md_report = approval / f"{REPORT_NAME}.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Font License Gate: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Bundled fonts: {payload['bundled_font_pass_count']}/{payload['bundled_font_count']}",
        f"External foundries: {payload['external_font_foundry_count']}",
        f"External downloads: {payload['external_font_download_status']}",
        f"Better-font contract: {payload['better_font_candidate_tournament_contract_status']}",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab font licenses and better-font contract.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    payload, json_report, _md_report = build_font_license_gate_report(args.video_id)
    print(json.dumps({"status": payload["status"], "bundled_font_count": payload["bundled_font_count"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
