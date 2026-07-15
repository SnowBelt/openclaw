#!/usr/bin/env python3
"""Require explicit source-to-thumbnail claim bindings before visual scoring."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_thumbnail_worldclass import read_json


def source_intake_path(root: Path, approval: Path) -> Path:
    binding = read_json(approval / "evidence-manifest-binding.json")
    raw = str(binding.get("intake_path") or "").strip()
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            from patternlab_common import BASE

            path = BASE / path
        if path.is_file():
            return path
    for candidate in (
        root / "source-packet" / "production" / "evidence-intake-expanded.json",
        root / "source-packet" / "long-form-rebuild" / "evidence-intake-expanded.json",
        root / "source-packet" / "evidence-intake.json",
    ):
        if candidate.is_file():
            return candidate
    return root / "source-packet" / "evidence-intake.json"


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    brief_path = approval / "thumbnail-worldclass-brief.json"
    brief = read_json(brief_path)
    intake_path = source_intake_path(root, approval)
    intake = read_json(intake_path)
    assets = intake.get("assets", []) if isinstance(intake, dict) else []
    tournament = read_json(approval / "thumbnail-worldclass-tournament.json")
    proposed_assets = []
    required_ids = list(brief.get("source_asset_ids", []))
    for index, item in enumerate(tournament.get("source_assets", [])):
        asset_id = item.get("asset_id") or (required_ids[index] if index < len(required_ids) else f"thumbnail-source-{index + 1}")
        proposed_assets.append({
            "asset_id": asset_id,
            "relative_path": item.get("path", ""),
            "sha256": item.get("sha256", ""),
            "source_url": item.get("source_url", ""),
            "rights_basis": item.get("rights", ""),
            "role": item.get("role", ""),
            "human_accepted": False,
            "rights_status": "pending_human_acceptance",
        })
    accepted_ids = {
        str(item.get("asset_id"))
        for item in assets
        if isinstance(item, dict)
        and item.get("human_accepted") is True
        and (
            item.get("rights_status") in {"pass", "approved", "public_domain"}
            or (
                bool(str(item.get("rights_basis") or item.get("license_or_rights_basis") or "").strip())
                and item.get("commercial_use_ok") is True
                and item.get("modification_ok") is True
            )
        )
    }
    required = {str(item) for item in brief.get("source_asset_ids", [])}
    missing = sorted(required - accepted_ids)
    blockers = [f"thumbnail_source_not_human_accepted:{item}" for item in missing]
    if not assets:
        blockers.append("evidence_intake_missing_or_empty")
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "required_source_asset_ids": sorted(required),
        "accepted_source_asset_ids": sorted(accepted_ids),
        "source_intake": display_path(intake_path),
        "proposed_source_assets": proposed_assets,
        "blockers": blockers,
        "rule": "A general city map or photo cannot be promoted as exact neighborhood proof without an explicit accepted source binding.",
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "thumbnail-source-adequacy.json"
    proposal_path = approval / "thumbnail-source-acceptance-proposal.json"
    md_path = approval / "thumbnail-source-adequacy.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    proposal_path.write_text(json.dumps({
        "generated_at": payload["generated_at"],
        "video_id": video_id,
        "status": "pending_human_acceptance" if proposed_assets else "blocked",
        "assets": proposed_assets,
        "instruction": "Copy only verified accepted rows into source-packet/evidence-intake.json and set human_accepted=true plus a passing rights_status. Never approve from this proposal automatically.",
        "youtube_mutation": "not_performed",
    }, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Thumbnail Source Adequacy: {video_id}", "", f"Status: {payload['status']}", "", "## Blockers", ""]
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))


if __name__ == "__main__":
    main()
