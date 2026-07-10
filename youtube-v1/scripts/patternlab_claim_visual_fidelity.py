#!/usr/bin/env python3
"""Fail closed when a claim's visual is generic, unlinked, or mislabeled.

Pattern Lab's claim ledger proves that a sentence has a research source.  This
separate gate proves that the visual assigned to that sentence is a relevant
evidence object rather than an unrelated city image.  It is local-only and
never fetches media or mutates YouTube.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now


ALLOWED_EVIDENCE_BASIS = {
    "direct_historical_media",
    "historical_map_or_document",
    "original_source_card_with_primary_or_museum_citation",
    "modern_then_now_context",
}

# A direct visual proof trail must include an actual historical object. A
# source card is useful explanation, but it cannot be the only proof.
DIRECT_PROOF_BASIS = {"direct_historical_media", "historical_map_or_document"}
RELEVANT_SOURCE_CLASSES = {"historical_evidence", "original_graphic", "modern_context"}


def read_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_ledger(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as handle:
        return {
            row.get("asset_id", "").strip(): row
            for row in csv.DictReader(handle)
            if row.get("asset_id", "").strip()
        }


def normalize_claims(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict) and isinstance(value.get("claims"), list):
        return [row for row in value["claims"] if isinstance(row, dict)]
    return []


def normalize_links(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict) and isinstance(value.get("links"), list):
        return [row for row in value["links"] if isinstance(row, dict)]
    return []


def build_claim_visual_fidelity_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    claims_path = approval / "claim-ledger.json"
    links_path = root / "source-packet" / "rebuild-v2" / "claim-visual-links.json"
    ledger_path = root / "rights-ledger.csv"
    claims = normalize_claims(read_json(claims_path))
    links = normalize_links(read_json(links_path))
    assets = read_ledger(ledger_path)
    links_by_claim: dict[str, list[dict[str, Any]]] = {}
    for link in links:
        claim_id = str(link.get("claim_id", "")).strip()
        if claim_id:
            links_by_claim.setdefault(claim_id, []).append(link)

    blockers: list[str] = []
    claim_reports: list[dict[str, Any]] = []
    for claim in claims:
        claim_id = str(claim.get("claim_id", "")).strip() or "unknown"
        claim_links = links_by_claim.get(claim_id, [])
        claim_blockers: list[str] = []
        direct_proof_count = 0
        approved_links: list[dict[str, Any]] = []
        if not claim_links:
            claim_blockers.append("missing_claim_visual_link")
        for link in claim_links:
            asset_id = str(link.get("asset_id", "")).strip()
            basis = str(link.get("evidence_basis", "")).strip()
            relevance = str(link.get("relevance_note", "")).strip()
            asset = assets.get(asset_id)
            link_issues: list[str] = []
            if not asset:
                link_issues.append("unknown_asset_id")
            elif asset.get("source_class", "").strip() not in RELEVANT_SOURCE_CLASSES:
                link_issues.append("unsupported_source_class")
            if basis not in ALLOWED_EVIDENCE_BASIS:
                link_issues.append("invalid_evidence_basis")
            if not relevance:
                link_issues.append("missing_relevance_note")
            if basis in DIRECT_PROOF_BASIS and asset and asset.get("source_class", "").strip() != "historical_evidence":
                link_issues.append("direct_proof_requires_historical_evidence_asset")
            if not link_issues and basis in DIRECT_PROOF_BASIS:
                direct_proof_count += 1
            approved_links.append({
                "asset_id": asset_id,
                "evidence_basis": basis,
                "relevance_note": relevance,
                "issues": link_issues,
            })
            claim_blockers.extend(link_issues)
        if claim.get("fact_checker_status") == "verified" and direct_proof_count == 0:
            claim_blockers.append("verified_claim_requires_direct_historical_visual_proof")
        claim_blockers = sorted(set(claim_blockers))
        blockers.extend(f"{claim_id}:{item}" for item in claim_blockers)
        claim_reports.append({
            "claim_id": claim_id,
            "linked_asset_count": len(claim_links),
            "direct_historical_proof_count": direct_proof_count,
            "status": "pass" if not claim_blockers else "blocked",
            "blockers": claim_blockers,
            "links": approved_links,
        })

    if not claims:
        blockers.append("claim_ledger_missing_or_empty")
    if not links:
        blockers.append("claim_visual_links_missing_or_empty")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "claim_ledger": display_path(claims_path),
        "claim_visual_links": display_path(links_path),
        "rights_ledger": display_path(ledger_path),
        "claim_count": len(claims),
        "linked_claim_count": sum(1 for item in claim_reports if item["linked_asset_count"]),
        "direct_proof_claim_count": sum(1 for item in claim_reports if item["direct_historical_proof_count"]),
        "claim_reports": claim_reports,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
        "network_access": "not_used_local_validation_only",
    }
    json_path = approval / "claim-visual-fidelity-report.json"
    md_path = approval / "claim-visual-fidelity-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Claim Visual Fidelity: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Claims: {payload['claim_count']}",
        f"Claims with links: {payload['linked_claim_count']}",
        f"Claims with direct historical proof: {payload['direct_proof_claim_count']}",
        "",
        "## Claim Checks",
        "",
    ]
    lines.extend(
        f"- {item['claim_id']}: {item['status']} links={item['linked_asset_count']} direct_proof={item['direct_historical_proof_count']}"
        for item in claim_reports
    )
    lines.extend(["", "## Blockers", ""])
    lines.extend(f"- {item}" for item in blockers) if blockers else lines.append("- none")
    lines.extend(["", "YouTube mutation: not performed", "Network access: not used; local validation only", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab claim-to-visual fidelity.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    payload, _json_path, md_path = build_claim_visual_fidelity_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
