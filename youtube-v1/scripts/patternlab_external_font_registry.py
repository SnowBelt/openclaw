#!/usr/bin/env python3
"""Validate Pattern Lab external foundry registry without downloading fonts."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

REGISTRY_PATH = BASE / "resources" / "thumbnail-external-font-registry.json"
REPORT_NAME = "external-font-registry-report"


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


def build_external_font_registry_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    registry = read_json(REGISTRY_PATH)
    blockers: list[str] = []
    foundries = registry.get("foundries", []) if isinstance(registry.get("foundries"), list) else []
    if not str(registry.get("status", "")).startswith("pass"):
        blockers.append("external_font_registry_status_not_pass")
    if len(foundries) < 5:
        blockers.append(f"external_font_foundry_count_too_low:{len(foundries)}<5")
    entries: list[dict[str, Any]] = []
    for foundry in foundries:
        entry_blockers: list[str] = []
        for field in ("foundry_id", "name", "url", "planned_role", "status"):
            if not str(foundry.get(field, "")).strip():
                entry_blockers.append(f"missing_{field}")
        if foundry.get("license_verification_required") is not True:
            entry_blockers.append("license_verification_not_required")
        if foundry.get("commercial_use_required") is not True:
            entry_blockers.append("commercial_use_not_required")
        if foundry.get("status") not in {"candidate_not_bundled", "candidate_not_bundled_license_or_file_not_verified", "bundled_verified_font_available"}:
            entry_blockers.append("foundry_status_invalid")
        entries.append({**foundry, "validation_status": "pass" if not entry_blockers else "blocked", "blockers": entry_blockers})
        blockers.extend(f"{foundry.get('foundry_id', 'missing')}:{blocker}" for blocker in entry_blockers)
    candidate_fonts = registry.get("candidate_fonts", []) if isinstance(registry.get("candidate_fonts"), list) else []
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "external_font_registry_status": "pass" if not blockers else "blocked",
        "foundry_count": len(entries),
        "required_foundry_count": 5,
        "candidate_font_count": len(candidate_fonts),
        "external_font_download_status": "pass" if candidate_fonts else "blocked_pending_explicit_owner_download_approval",
        "font_bundle_mutation": "performed_after_owner_approval" if candidate_fonts else "not_performed",
        "registry_file": display_path(REGISTRY_PATH),
        "foundries": entries,
        "candidate_fonts": candidate_fonts,
        "blockers": sorted(set(blockers)),
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / f"{REPORT_NAME}.json"
    md_report = approval / f"{REPORT_NAME}.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab External Font Registry: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Foundries: {payload['foundry_count']}/{payload['required_foundry_count']}",
        f"Download status: {payload['external_font_download_status']}",
        "",
        "## Foundries",
        "",
    ]
    for entry in entries:
        lines.append(f"- {entry.get('name', 'missing')}: {entry['validation_status']} | {entry.get('planned_role', 'missing')}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate external font registry.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    payload, json_report, _md_report = build_external_font_registry_report(args.video_id)
    print(json.dumps({"status": payload["status"], "foundry_count": payload["foundry_count"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
