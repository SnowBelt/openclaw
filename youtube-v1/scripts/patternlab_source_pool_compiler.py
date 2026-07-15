#!/usr/bin/env python3
"""Compile a rights-checked source pool for any Pattern Lab city episode."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, city_from_sources
from patternlab.rights import acceptance_blockers, acceptance_mode, truthy
from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


REQUIRED_FIELDS = (
    "asset_id", "source_id", "relative_path", "source_url", "source_title", "creator",
    "rights_basis", "source_class", "evidence_fit", "asset_kind", "editorial_role",
    "geographic_scope", "claim_ids",
)
VIDEO_KINDS = {"film", "modern_video", "source_motion"}
DISCLOSURE = "Dramatic reconstruction — not archival footage"


def read_json(path: Path, *, optional: bool = False) -> dict[str, Any]:
    if optional and not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid_json:{display_path(path)}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"json_object_required:{display_path(path)}")
    return value


def duration(path: Path) -> float:
    raw = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", str(path)],
        text=True,
    ).strip()
    return float(raw)


def recorded_path(raw: object, *, root: Path) -> Path | None:
    value = str(raw or "").strip()
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    for candidate in (YOUTUBE_ROOT / path, root / path):
        if candidate.is_file():
            return candidate
    return root / path


def local_ai_assets(video_id: str, root: Path, blockers: list[str]) -> list[dict[str, Any]]:
    """Promote only hash-bound 93+ local winners requested by the visual contract."""
    approval = root / "approval"
    plan_path = approval / "local-visual-prompt-plan.json"
    tournament_path = approval / "local-still-tournament-report.json"
    plan = read_json(plan_path, optional=True)
    generation_beats = [
        row for row in plan.get("beats", []) if isinstance(row, dict) and row.get("generation_allowed")
    ]
    if not generation_beats:
        return []
    tournament = read_json(tournament_path, optional=True)
    if tournament.get("status") != "pass" or tournament.get("blockers"):
        blockers.append("local_still_tournament_required_but_not_pass")
        return []
    tournament_rows = {
        str(row.get("beat_id") or ""): row
        for row in tournament.get("beats", [])
        if isinstance(row, dict)
    }
    assets: list[dict[str, Any]] = []
    for beat in generation_beats:
        beat_id = str(beat.get("beat_id") or "")
        asset_id = str(beat.get("planned_ai_asset_id") or "").strip()
        claims = [str(value) for value in beat.get("claim_ids", []) if str(value).strip()]
        row = tournament_rows.get(beat_id, {})
        winner = row.get("winner") if isinstance(row.get("winner"), dict) else {}
        selected = recorded_path(winner.get("selected_path"), root=root)
        receipt = recorded_path(winner.get("selection_receipt"), root=root)
        expected_asset_id = f"video-{video_id}-local-ai-{beat_id}"
        if asset_id != expected_asset_id:
            blockers.append(f"local_ai_asset_id_missing_or_noncanonical:{beat_id}")
        if not claims:
            blockers.append(f"local_ai_claim_ids_missing:{beat_id}")
        if row.get("status") != "pass" or not winner or selected is None or not selected.is_file():
            blockers.append(f"local_ai_winner_missing_or_not_pass:{beat_id}")
            continue
        if receipt is None or not receipt.is_file():
            blockers.append(f"local_ai_selection_receipt_missing:{beat_id}")
            continue
        try:
            relative_path = str(selected.relative_to(root))
        except ValueError:
            blockers.append(f"local_ai_selected_asset_outside_episode_root:{beat_id}")
            continue
        winner_hash = str(winner.get("selected_sha256") or "")
        receipt_hash = str(winner.get("selection_receipt_sha256") or "")
        if winner_hash != sha256_file(selected):
            blockers.append(f"local_ai_selected_asset_hash_mismatch:{beat_id}")
        if receipt_hash != sha256_file(receipt):
            blockers.append(f"local_ai_selection_receipt_hash_mismatch:{beat_id}")
        assets.append(
            {
                "asset_id": asset_id,
                "source_id": f"patternlab-local-ai-{beat_id}",
                "relative_path": relative_path,
                "sha256": sha256_file(selected),
                "source_url": f"patternlab://video-{video_id}/local-ai/{beat_id}",
                "source_title": f"Pattern Lab {beat_id} dramatic reconstruction",
                "creator": "Pattern Lab local generation",
                "rights_basis": "Pattern Lab original locally generated non-proof support",
                "source_class": "ai_reconstruction",
                "evidence_fit": "context_only",
                "asset_kind": "graphic",
                "editorial_role": "reconstruction",
                "geographic_scope": "generic",
                "may_imply_named_city": False,
                "entity_terms": [],
                "claim_ids": claims,
                "context_action": str(beat.get("prompt_fields", {}).get("visible_action") or "human consequence"),
                "context_emotion": str(beat.get("prompt_fields", {}).get("story_function") or "human consequence"),
                "on_screen_disclosure": DISCLOSURE,
                "commercial_use_ok": True,
                "modification_ok": True,
                "acceptance_mode": "patternlab_original_generated",
                "selection_receipt": display_path(receipt),
                "selection_receipt_sha256": sha256_file(receipt),
                "human_review_status": "pending_owner_package_review",
            }
        )
    return assets


def machine_accepted_context_assets(root: Path, blockers: list[str]) -> list[dict[str, Any]]:
    """Promote downloaded generic stock only after exact rights/hash verification."""
    assets: list[dict[str, Any]] = []
    receipt_root = root / "source-packet" / "stock-media" / "candidates"
    for receipt_path in sorted(receipt_root.glob("*.source.json")):
        receipt = read_json(receipt_path, optional=True)
        if str(receipt.get("acceptance_mode") or "") != "machine_verified_exact_license":
            continue
        asset_id = str(receipt.get("asset_id") or receipt_path.stem).strip()
        if (
            receipt.get("editorial_role") != "context_only"
            or receipt.get("geographic_scope") != "generic"
            or receipt.get("may_imply_named_city") is not False
        ):
            blockers.append(f"machine_context_scope_invalid:{asset_id}")
            continue
        rights_item = {
            **receipt,
            "asset_id": asset_id,
            "rights_basis": receipt.get("rights_basis") or receipt.get("license_or_rights_basis"),
            "relative_path": receipt.get("relative_path") or receipt.get("local_path"),
        }
        rights_errors = acceptance_blockers(rights_item, episode_root=root, youtube_root=YOUTUBE_ROOT)
        if rights_errors:
            blockers.extend(rights_errors)
            continue
        assets.append(
            {
                **rights_item,
                "asset_id": asset_id,
                "source_id": str(receipt.get("source_id") or f"stock-{asset_id}"),
                "relative_path": str(receipt.get("relative_path") or receipt.get("local_path") or ""),
                "source_title": str(receipt.get("source_title") or asset_id),
                "creator": str(receipt.get("creator") or ""),
                "source_class": "modern_context",
                "evidence_fit": "context_only",
                "asset_kind": str(receipt.get("asset_kind") or "modern_video"),
                "editorial_role": "context_only",
                "geographic_scope": "generic",
                "may_imply_named_city": False,
                "claim_ids": [
                    str(value)
                    for value in receipt.get("claim_ids", [])
                    if str(value).strip()
                ],
                "selection_reason": "exact generic-context query plus machine-verified provider rights",
            }
        )
    return assets


def build(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    launch = launch_root(video_id)
    approval = ensure_dir(root / "approval")
    pool_root = ensure_dir(root / "source-packet" / "production")
    receipts = ensure_dir(pool_root / "receipts")
    package = read_json(launch / "package.json")
    evidence = read_json(launch / "evidence-queries.json")
    route = read_json(launch / "long-form-visual-routing.json")
    base = read_json(root / "source-packet" / "evidence-intake.json")
    additions = read_json(launch / "long-form-source-additions.json", optional=True)
    city_terms = evidence.get("required_city_terms") if isinstance(evidence.get("required_city_terms"), list) else []
    evidence_city = city_terms[0] if len(city_terms) == 1 else ""
    blockers: list[str] = []
    try:
        city = city_from_sources(
            (("package", package.get("city")), ("evidence", evidence_city), ("route", route.get("city")))
        )
    except CityContractError as exc:
        city = ""
        blockers.append(str(exc))
    assets = [dict(row) for row in base.get("assets", []) if isinstance(row, dict)]
    assets.extend(dict(row) for row in additions.get("assets", []) if isinstance(row, dict))
    assets.extend(machine_accepted_context_assets(root, blockers))
    assets.extend(local_ai_assets(video_id, root, blockers))
    ids = [str(row.get("asset_id") or "") for row in assets]
    for asset_id, count in Counter(ids).items():
        if not asset_id or count > 1:
            blockers.append(f"source_pool_duplicate_or_blank_asset_id:{asset_id or 'blank'}:{count}")
    source_urls: set[str] = set()
    current_receipt_ids: list[str] = []
    for row in assets:
        asset_id = str(row.get("asset_id") or "missing")
        for field in REQUIRED_FIELDS:
            if row.get(field) in (None, "", []):
                blockers.append(f"source_pool_field_missing:{asset_id}:{field}")
        acceptance_errors = acceptance_blockers(row, episode_root=root, youtube_root=YOUTUBE_ROOT)
        blockers.extend(acceptance_errors)
        if not acceptance_errors:
            row["production_acceptance_status"] = "accepted"
            row["production_acceptance_mode"] = acceptance_mode(row)
        if row.get("source_class") == "ai_reconstruction" and row.get("editorial_role") not in {"reconstruction", "nonproof_support"}:
            blockers.append(f"source_pool_ai_role_invalid:{asset_id}")
        path = root / str(row.get("relative_path") or "")
        if not path.is_file():
            blockers.append(f"source_pool_file_missing:{asset_id}")
            continue
        digest = sha256_file(path)
        if row.get("sha256") and row.get("sha256") != digest:
            blockers.append(f"source_pool_hash_mismatch:{asset_id}")
        row["sha256"] = digest
        media_duration = None
        if row.get("asset_kind") in VIDEO_KINDS:
            try:
                media_duration = round(duration(path), 3)
            except (OSError, subprocess.SubprocessError, ValueError):
                blockers.append(f"source_pool_video_probe_failed:{asset_id}")
        source_url = str(row.get("source_url") or "")
        if source_url.startswith(("http://", "https://")):
            source_urls.add(source_url)
        receipt = {
            "schema_version": 1, "generated_at": utc_now(), "video_id": video_id,
            "city": city, "asset_id": asset_id, "source_url": source_url,
            "source_title": row.get("source_title"), "creator": row.get("creator"),
            "rights_basis": row.get("rights_basis"),
            "commercial_use_ok": truthy(row.get("commercial_use_ok")),
            "modification_ok": truthy(row.get("modification_ok")),
            "production_acceptance_status": row.get("production_acceptance_status", "blocked"),
            "relative_path": row.get("relative_path"),
            "sha256": digest, "duration_seconds": media_duration,
            "editorial_role": row.get("editorial_role"), "source_class": row.get("source_class"),
            "claim_ids": row.get("claim_ids"), "youtube_mutation": "not_performed",
            "production_acceptance_mode": row.get("production_acceptance_mode", "blocked"),
        }
        (receipts / f"{asset_id}.source.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        current_receipt_ids.append(asset_id)

    requirements = route.get("requirements") if isinstance(route.get("requirements"), dict) else {}
    floors = {
        "assets": int(requirements.get("minimum_source_pool_assets", 60)),
        "historical": int(requirements.get("minimum_historical_source_assets", 40)),
        "moving": int(requirements.get("minimum_moving_image_assets", 10)),
        "modern_video": int(requirements.get("minimum_modern_video_assets", 7)),
        "source_urls": int(requirements.get("minimum_distinct_source_urls", 52)),
    }
    counts = {
        "assets": len(assets),
        "historical": sum(row.get("source_class") == "historical_evidence" for row in assets),
        "moving": sum(row.get("asset_kind") in VIDEO_KINDS for row in assets),
        "modern_video": sum(row.get("asset_kind") == "modern_video" for row in assets),
        "source_urls": len(source_urls),
    }
    for name, floor in floors.items():
        if counts[name] < floor:
            blockers.append(f"source_pool_{name}_below_floor:{counts[name]}/{floor}")
    status = "pass" if not blockers else "blocked"
    output = {
        "schema_version": 1, "generated_at": utc_now(), "video_id": video_id, "city": city,
        "status": "accepted_for_production" if status == "pass" else "blocked",
        "assets": assets, "youtube_mutation": "not_performed",
    }
    output_path = pool_root / "evidence-intake-expanded.json"
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "city": city, "status": status,
        "source_pool": display_path(output_path), "counts": counts, "required": floors,
        "receipt_count": len(current_receipt_ids),
        "receipt_asset_ids": sorted(current_receipt_ids),
        "blockers": sorted(set(blockers)), "youtube_mutation": "not_performed",
    }
    report = approval / "long-form-source-pool-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report, output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile a city-generic Pattern Lab source pool.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    try:
        payload, report, _ = build(args.video_id.zfill(2))
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
