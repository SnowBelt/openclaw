#!/usr/bin/env python3
"""Index reusable generic context media without promoting it to city-specific proof."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import patternlab_script_bootstrap  # noqa: F401

from patternlab.rights import acceptance_blockers, acceptance_mode
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


TAXONOMY_PATH = BASE / "resources" / "generic-context-taxonomy.json"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def receipt_files(root: Path) -> list[Path]:
    return sorted((root / "source-packet" / "stock-media" / "candidates").glob("*.source.json"))


def validate_receipt(root: Path, receipt_path: Path, known_actions: set[str]) -> dict[str, Any]:
    receipt = read_json(receipt_path)
    blockers: list[str] = []
    required = [
        "source_title", "source_url", "download_url", "creator", "license_or_rights_basis",
        "license_url", "context_action", "context_emotion", "editorial_role", "geographic_scope",
        "source_role", "sha256", "local_path",
    ]
    for field in required:
        if not receipt.get(field):
            blockers.append(f"missing_{field}")
    if receipt.get("source_role") != "modern_context":
        blockers.append("source_role_not_modern_context")
    if receipt.get("editorial_role") != "context_only":
        blockers.append("editorial_role_not_context_only")
    if receipt.get("geographic_scope") != "generic":
        blockers.append("geographic_scope_not_generic")
    if receipt.get("may_imply_named_city") is not False:
        blockers.append("may_imply_named_city_must_be_false")
    if str(receipt.get("context_action") or "") not in known_actions:
        blockers.append("context_action_unknown")
    if receipt.get("commercial_use_ok") is not True or receipt.get("modification_ok") is not True:
        blockers.append("commercial_or_modification_rights_not_confirmed")
    local = root / str(receipt.get("local_path") or "")
    if not local.is_file() or local.stat().st_size == 0:
        blockers.append("local_asset_missing")
    else:
        if sha256(local) != receipt.get("sha256"):
            blockers.append("local_asset_hash_mismatch")
    review = str(receipt.get("human_review_status") or "pending")
    machine_or_human_accepted = (
        str(receipt.get("acceptance_mode") or "") == "machine_verified_exact_license"
        or review == "approved"
        or receipt.get("human_accepted") is True
    )
    if machine_or_human_accepted:
        rights_item = {
            **receipt,
            "rights_basis": receipt.get("rights_basis") or receipt.get("license_or_rights_basis"),
            "relative_path": receipt.get("relative_path") or receipt.get("local_path"),
            "human_accepted": receipt.get("human_accepted") is True or review == "approved",
        }
        blockers.extend(acceptance_blockers(rights_item, episode_root=root, youtube_root=BASE))
    reusable = not blockers and machine_or_human_accepted
    return {
        "asset_id": str(receipt.get("asset_id") or local.stem if local else receipt_path.stem),
        "receipt": display_path(receipt_path),
        "local_path": display_path(local) if local else "missing",
        "context_action": receipt.get("context_action", ""),
        "context_emotion": receipt.get("context_emotion", ""),
        "status": "reusable" if reusable else ("candidate_only" if not blockers else "blocked"),
        "production_acceptance_mode": acceptance_mode(receipt) if reusable else "pending",
        "blockers": blockers,
        "must_not_imply_named_city": True,
        "must_not_prove_historical_claim": True,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    taxonomy = read_json(TAXONOMY_PATH)
    known_actions = set((taxonomy.get("actions") or {}).keys())
    rows = [validate_receipt(root, path, known_actions) for path in receipt_files(root)]
    reusable = [row for row in rows if row["status"] == "reusable"]
    blocked = [row for row in rows if row["status"] == "blocked"]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blocked else "blocked",
        "taxonomy": display_path(TAXONOMY_PATH),
        "asset_count": len(rows),
        "reusable_asset_count": len(reusable),
        "candidate_only_asset_count": len(rows) - len(reusable) - len(blocked),
        "assets": rows,
        "reuse_rule": "Only reusable rows may be offered to a later episode, and only as generic context_only media. No row may become city-specific proof.",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    index = ensure_dir(root / "source-packet" / "context-media-library") / "index.json"
    index.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    json_path = approval / "context-media-library-report.json"
    md_path = approval / "context-media-library-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [f"# Pattern Lab Context Media Library: Video {video_id}", "", f"Status: {payload['status']}", f"Reusable assets: {len(reusable)}", "", "## Assets", ""]
            + [f"- {row['asset_id']}: {row['status']} ({', '.join(row['blockers']) or row['context_action']})" for row in rows]
            + ["", "No YouTube mutation or paid provider call was performed.", ""]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Index safe reusable Pattern Lab generic context media.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _json_path, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Context media library report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
