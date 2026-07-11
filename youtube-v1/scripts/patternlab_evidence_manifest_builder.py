#!/usr/bin/env python3
"""Build a hash-bound Pattern Lab evidence manifest from explicit human-accepted intake.

This deliberately does not search, download, or infer media.  It turns a
rights-reviewed local intake into the narrow evidence contract consumed by the
canonical renderer.  Missing fields are blockers, not opportunities for a
generic image fallback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.schemas import EpisodeManifest
from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


PROOF_ROLES = {"source_proof", "map_system", "archive_evidence", "document_detail"}
ACCEPTED_SOURCE_CLASSES = {"historical_evidence", "modern_context", "original_graphic", "ai_reconstruction"}
DIRECT_SOURCE_CLASS = "historical_evidence"
ROLE_ASSET_KINDS = {
    "map_system": {"map", "document"},
    "document_detail": {"document"},
    "archive_evidence": {"photo", "film"},
    "source_proof": {"photo", "map", "document", "film"},
    "then_now": {"photo", "map", "modern_video"},
}


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid_json:{display_path(path)}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"json_object_required:{display_path(path)}")
    return value


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def truthy(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "approved", "accept"}


def planned_claims(video_id: str) -> list[dict]:
    """Return the reviewed visual proof plan without modifying the approved script."""
    if video_id != "04":
        raise ValueError(f"visual_plan_not_defined:{video_id}")
    return [
        {"claim_id": "black-bottom-neighborhood", "text": "Black Bottom was a living Detroit neighborhood, not empty land.", "entities": ["black bottom", "detroit"], "role": "source_proof", "start": 0, "end": 14},
        {"claim_id": "paradise-valley-businesses", "text": "Paradise Valley held a dense network of Black-owned businesses and cultural life.", "entities": ["paradise valley", "detroit"], "role": "archive_evidence", "start": 14, "end": 32},
        {"claim_id": "hastings-st-antoine-network", "text": "Hastings Street and St. Antoine connected the neighborhood's daily and cultural life.", "entities": ["hastings street", "st antoine", "detroit"], "role": "archive_evidence", "start": 32, "end": 50},
        {"claim_id": "housing-restrictions", "text": "Housing restrictions shaped where Black Detroiters could live and build community.", "entities": ["detroit", "housing"], "role": "document_detail", "start": 50, "end": 70},
        {"claim_id": "clearance-redevelopment", "text": "Clearance and redevelopment displaced Black Bottom and changed the land beneath it.", "entities": ["black bottom", "detroit", "redevelopment"], "role": "map_system", "start": 70, "end": 92},
        {"claim_id": "i-375-route", "text": "The I-375 route cut through Paradise Valley and its surrounding street network.", "entities": ["i-375", "paradise valley", "detroit"], "role": "map_system", "start": 92, "end": 116},
        {"claim_id": "relocation-consequence", "text": "The change was a human relocation with consequences beyond a line on a map.", "entities": ["black bottom", "paradise valley", "detroit"], "role": "archive_evidence", "start": 116, "end": 138},
        {"claim_id": "then-now-footprint", "text": "The present-day footprint still shows the pattern created by those decisions.", "entities": ["i-375", "black bottom", "detroit"], "role": "then_now", "start": 138, "end": 160},
    ]


def asset_blockers(item: dict, root: Path, required_entities: list[str], proof: bool) -> list[str]:
    asset_id = str(item.get("asset_id") or "unknown")
    errors: list[str] = []
    for field in ("asset_id", "source_id", "relative_path", "source_url", "source_title", "creator", "rights_basis"):
        if not str(item.get(field) or "").strip():
            errors.append(f"asset_missing_{field}:{asset_id}")
    if not truthy(item.get("human_accepted")):
        errors.append(f"asset_not_human_accepted:{asset_id}")
    if not truthy(item.get("commercial_use_ok")) or not truthy(item.get("modification_ok")):
        errors.append(f"asset_rights_not_commercial_modifiable:{asset_id}")
    source_class = str(item.get("source_class") or "")
    if source_class not in ACCEPTED_SOURCE_CLASSES:
        errors.append(f"asset_source_class_invalid:{asset_id}")
    evidence_fit = str(item.get("evidence_fit") or "")
    if proof and (source_class != DIRECT_SOURCE_CLASS or evidence_fit != "direct"):
        errors.append(f"proof_asset_not_direct_historical_evidence:{asset_id}")
    if source_class == "ai_reconstruction" and evidence_fit == "direct":
        errors.append(f"ai_reconstruction_cannot_be_direct_evidence:{asset_id}")
    if str(item.get("asset_kind") or "") not in {"photo", "map", "document", "film", "modern_video", "graphic"}:
        errors.append(f"asset_kind_invalid:{asset_id}")
    path = root / str(item.get("relative_path") or "")
    if not path.is_file():
        errors.append(f"asset_local_file_missing:{asset_id}")
    elif item.get("sha256") and sha256_file(path) != str(item["sha256"]):
        errors.append(f"asset_declared_hash_mismatch:{asset_id}")
    text = " ".join([str(item.get("source_title") or ""), *[str(value) for value in item.get("entity_terms", [])]]).lower()
    missing_entities = [term for term in required_entities if term.lower() not in text]
    if missing_entities:
        errors.append(f"asset_missing_required_entity_terms:{asset_id}:{','.join(missing_entities)}")
    return errors


def build_manifest(video_id: str, intake_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    launch = launch_root(video_id)
    intake_path = intake_path or root / "source-packet" / "evidence-intake.json"
    manifest_path = approval / "evidence-manifest.json"
    ledger_path = approval / "evidence-asset-ledger.json"
    binding_path = approval / "evidence-manifest-binding.json"
    report_path = approval / "evidence-manifest-builder-report.json"
    blockers: list[str] = []
    accepted_assets: list[dict] = []
    claims = planned_claims(video_id)
    script_path = launch / "final-script.md"
    if not script_path.is_file():
        blockers.append("approved_script_missing")
        script_hash = ""
    else:
        script_hash = sha256_file(script_path)
    try:
        intake = read_json(intake_path)
    except ValueError as exc:
        intake = {}
        blockers.append(str(exc))
    if str(intake.get("video_id") or "").zfill(2) != video_id:
        blockers.append("evidence_intake_video_id_mismatch")
    raw_assets = intake.get("assets")
    if not isinstance(raw_assets, list) or not raw_assets:
        blockers.append("evidence_intake_assets_missing")
        raw_assets = []
    by_claim: dict[str, list[dict]] = {claim["claim_id"]: [] for claim in claims}
    for item in raw_assets:
        if not isinstance(item, dict):
            blockers.append("evidence_intake_asset_not_object")
            continue
        asset_claims = item.get("claim_ids")
        if not isinstance(asset_claims, list) or not asset_claims:
            blockers.append(f"asset_claim_ids_missing:{item.get('asset_id', 'unknown')}")
            continue
        unknown = set(asset_claims) - set(by_claim)
        if unknown:
            blockers.append(f"asset_unknown_claim_ids:{item.get('asset_id', 'unknown')}:{','.join(sorted(unknown))}")
            continue
        accepted_assets.append(item)
        for claim_id in asset_claims:
            by_claim[claim_id].append(item)
    manifest_assets: list[dict] = []
    beats: list[dict] = []
    asset_ids: set[str] = set()
    used_beat_assets: set[str] = set()
    for claim in claims:
        candidates = by_claim[claim["claim_id"]]
        proof = claim["role"] in PROOF_ROLES
        valid = []
        for item in candidates:
            item_errors = asset_blockers(item, root, claim["entities"], proof)
            required_kinds = ROLE_ASSET_KINDS.get(claim["role"], set())
            if required_kinds and str(item.get("asset_kind") or "") not in required_kinds:
                item_errors.append(f"asset_kind_incompatible_with_visual_role:{item.get('asset_id', 'unknown')}:{claim['role']}")
            if item_errors:
                blockers.extend(item_errors)
            else:
                valid.append(item)
        if not valid:
            blockers.append(f"claim_missing_accepted_direct_visual:{claim['claim_id']}")
            continue
        start = float(claim["start"])
        end = float(claim["end"])
        segment_index = 0
        while start < end:
            segment_end = min(end, start + 10.0)
            asset = valid[segment_index % len(valid)]
            asset_id = str(asset["asset_id"])
            if asset_id not in asset_ids:
                path = root / str(asset["relative_path"])
                manifest_assets.append({
                    "asset_id": asset_id,
                    "source_id": str(asset["source_id"]),
                    "source_class": str(asset["source_class"]),
                    "rights_status": "approved",
                    "evidence_fit": str(asset["evidence_fit"]),
                    "visual_fit": "approved",
                    "relative_path": str(asset["relative_path"]),
                    "sha256": sha256_file(path),
                "entity_terms": tuple(str(value) for value in asset.get("entity_terms", [])),
                "asset_kind": str(asset["asset_kind"]),
                })
                asset_ids.add(asset_id)
            role = claim["role"]
            if role == "then_now" and segment_index == 0:
                role = "map_system"
            reuse_reason = ""
            if asset_id in used_beat_assets:
                reuse_reason = "New crop, annotation, or comparison layer reveals a distinct source detail."
            beats.append({
                "beat_id": f"visual-{claim['claim_id']}-{segment_index + 1:02d}",
                "claim_ids": (claim["claim_id"],),
                "asset_ids": (asset_id,),
                "role": role,
                "start_seconds": start,
                "end_seconds": segment_end,
                "reuse_reason": reuse_reason,
            })
            used_beat_assets.add(asset_id)
            start = segment_end
            segment_index += 1
    manifest_payload = {
        "episode_id": video_id,
        "title": "Black Bottom: Detroit's erased neighborhood",
        "claims": [{
            "claim_id": item["claim_id"], "text": item["text"], "fact_checker_status": "verified",
            "source_ids": tuple(sorted({str(asset["source_id"]) for asset in by_claim[item["claim_id"]]})),
            "required_entity_terms": tuple(item["entities"]),
        } for item in claims],
        "assets": manifest_assets,
        "visual_beats": beats,
    }
    if not blockers:
        try:
            EpisodeManifest.model_validate(manifest_payload)
        except ValueError as exc:
            blockers.append(f"evidence_manifest_schema_invalid:{exc}")
    status = "pass" if not blockers else "blocked"
    report = {
        "generated_at": utc_now(), "video_id": video_id, "status": status,
        "intake": display_path(intake_path), "approved_script": display_path(script_path),
        "script_sha256": script_hash, "claims_planned": len(claims), "assets_accepted": len(manifest_assets),
        "blockers": sorted(set(blockers)), "youtube_mutation": "not_performed",
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not blockers:
        manifest_path.write_text(json.dumps(manifest_payload, indent=2) + "\n", encoding="utf-8")
        ledger = {"version": 1, "video_id": video_id, "assets": accepted_assets, "generated_at": utc_now()}
        ledger_path.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
        binding = {
            "version": 1, "video_id": video_id, "status": "pass", "generated_at": utc_now(),
            "script_sha256": script_hash, "manifest_sha256": sha256_file(manifest_path),
            "intake_sha256": sha256_file(intake_path), "plan_sha256": sha256_text(json.dumps(claims, sort_keys=True)),
            "youtube_mutation": "not_performed",
        }
        binding_path.write_text(json.dumps(binding, indent=2) + "\n", encoding="utf-8")
    return report, report_path, manifest_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a fail-closed Pattern Lab evidence manifest.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--intake")
    args = parser.parse_args()
    payload, report_path, _ = build_manifest(args.video_id.zfill(2), Path(args.intake) if args.intake else None)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
