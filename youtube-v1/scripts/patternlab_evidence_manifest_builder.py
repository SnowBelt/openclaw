#!/usr/bin/env python3
"""Build the hash-bound visual manifest consumed by the canonical renderer.

Video 04 uses an explicit narration-window routing file.  The builder never
chooses from a tiny implicit pool, never treats a prose reuse reason as proof of
visual variety, and never starts a moving source at an implicit timestamp.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.schemas import EpisodeManifest
from patternlab.rights import acceptance_blockers
from patternlab.state import sha256_file
from patternlab.visual_system import resolve_episode_identity
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


PROOF_ROLES = {"source_proof", "map_system", "archive_evidence", "document_detail"}
ACCEPTED_SOURCE_CLASSES = {"historical_evidence", "modern_context", "original_graphic", "ai_reconstruction"}
DIRECT_SOURCE_CLASS = "historical_evidence"
ROLE_ASSET_KINDS = {
    "map_system": {"map", "document"},
    "document_detail": {"document"},
    "archive_evidence": {"photo", "film", "source_motion"},
    "source_proof": {"photo", "map", "document", "film", "source_motion"},
    "then_now": {"photo", "map", "modern_video", "film", "source_motion"},
}
VIDEO_KINDS = {"film", "modern_video", "source_motion"}
FOCUS_VARIANTS = (
    (0.50, 0.50, 1.02, 1.10),
    (0.38, 0.42, 1.05, 1.16),
    (0.62, 0.48, 1.03, 1.14),
    (0.50, 0.62, 1.07, 1.18),
)


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


def route_claims(route: dict) -> list[dict]:
    rows = route.get("claims") if isinstance(route.get("claims"), list) else []
    if not rows:
        raise ValueError("long_form_visual_route_claims_missing")
    claims: list[dict] = []
    previous_end = 0.0
    seen: set[str] = set()
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"long_form_visual_route_claim_not_object:{index}")
        claim_id = str(row.get("claim_id") or "").strip()
        text = str(row.get("text") or "").strip()
        entities = [str(value).strip().lower() for value in row.get("required_entity_terms", []) if str(value).strip()]
        role = str(row.get("role") or "").strip()
        start = float(row.get("start", -1))
        end = float(row.get("end", -1))
        if not claim_id or claim_id in seen:
            raise ValueError(f"long_form_visual_route_claim_id_missing_or_duplicate:{claim_id or index}")
        if len(text) < 12 or not entities or role not in PROOF_ROLES | {"then_now"}:
            raise ValueError(f"long_form_visual_route_claim_invalid:{claim_id}")
        if abs(start - previous_end) > 0.002 or end <= start:
            raise ValueError(f"long_form_visual_route_claim_timing_invalid:{claim_id}:{start}:{end}")
        claims.append({
            "claim_id": claim_id,
            "text": text,
            "entities": entities,
            "role": role,
            "start": start,
            "end": end,
        })
        seen.add(claim_id)
        previous_end = end
    return claims


def planned_claims(video_id: str) -> list[dict]:
    """Compatibility helper backed by the episode-owned route contract."""
    route_path = launch_root(video_id) / "long-form-visual-routing.json"
    return route_claims(read_json(route_path))


def asset_blockers(
    item: dict,
    root: Path,
    required_entities: list[str],
    proof: bool,
    *,
    require_entities: bool = True,
) -> list[str]:
    asset_id = str(item.get("asset_id") or "unknown")
    errors: list[str] = []
    for field in ("asset_id", "source_id", "relative_path", "source_url", "source_title", "creator", "rights_basis"):
        if not str(item.get(field) or "").strip():
            errors.append(f"asset_missing_{field}:{asset_id}")
    errors.extend(acceptance_blockers(item, episode_root=root, youtube_root=YOUTUBE_ROOT))
    source_class = str(item.get("source_class") or "")
    if source_class not in ACCEPTED_SOURCE_CLASSES:
        errors.append(f"asset_source_class_invalid:{asset_id}")
    evidence_fit = str(item.get("evidence_fit") or "")
    if proof and (source_class != DIRECT_SOURCE_CLASS or evidence_fit != "direct"):
        errors.append(f"proof_asset_not_direct_historical_evidence:{asset_id}")
    if source_class == "ai_reconstruction" and evidence_fit == "direct":
        errors.append(f"ai_reconstruction_cannot_be_direct_evidence:{asset_id}")
    if str(item.get("asset_kind") or "") not in {"photo", "map", "document", "film", "modern_video", "source_motion", "graphic"}:
        errors.append(f"asset_kind_invalid:{asset_id}")
    path = root / str(item.get("relative_path") or "")
    if not path.is_file():
        errors.append(f"asset_local_file_missing:{asset_id}")
    elif item.get("sha256") and sha256_file(path) != str(item["sha256"]):
        errors.append(f"asset_declared_hash_mismatch:{asset_id}")
    text = " ".join([str(item.get("source_title") or ""), *[str(value) for value in item.get("entity_terms", [])]]).lower()
    missing_entities = [term for term in required_entities if term.lower() not in text] if require_entities else []
    if missing_entities:
        errors.append(f"asset_missing_required_entity_terms:{asset_id}:{','.join(missing_entities)}")
    return errors


def source_family(item: dict) -> str:
    parsed = urlparse(str(item.get("source_url") or ""))
    if parsed.netloc:
        return f"{parsed.netloc.lower().removeprefix('www.')}{parsed.path.rstrip('/')}"
    return str(item.get("source_id") or "unknown")


def manifest_asset(item: dict, root: Path) -> dict:
    return {
        "asset_id": str(item["asset_id"]),
        "source_id": str(item["source_id"]),
        "source_class": str(item["source_class"]),
        "rights_status": "approved",
        "evidence_fit": str(item["evidence_fit"]),
        "visual_fit": "approved",
        "relative_path": str(item["relative_path"]),
        "sha256": sha256_file(root / str(item["relative_path"])),
        "entity_terms": tuple(str(value) for value in item.get("entity_terms", [])),
        "asset_kind": str(item["asset_kind"]),
        "editorial_role": str(item.get("editorial_role") or ("proof" if item["evidence_fit"] == "direct" else "context_only")),
        "geographic_scope": str(item.get("geographic_scope") or "city_specific"),
        "may_imply_named_city": bool(item.get("may_imply_named_city", True)),
        "context_action": str(item.get("context_action") or ""),
        "context_emotion": str(item.get("context_emotion") or ""),
        "on_screen_disclosure": str(item.get("on_screen_disclosure") or ""),
        "derivative_source_sha256": str(item.get("derivative_source_sha256") or ""),
        "motion_receipt_sha256": str(item.get("motion_receipt_sha256") or ""),
    }


def apply_historical_motion_selection(
    root: Path,
    assets: dict[str, dict],
    blockers: list[str],
) -> dict[str, dict]:
    report_path = root / "approval" / "historical-motion-selection-report.json"
    if not report_path.is_file():
        return assets
    try:
        report = read_json(report_path)
    except ValueError as exc:
        blockers.append(str(exc))
        return assets
    if report.get("mode") != "rendered":
        return assets
    if report.get("status") != "pass":
        blockers.append("historical_motion_selection_not_pass")
        return assets
    updated = {asset_id: dict(item) for asset_id, item in assets.items()}
    for row in report.get("selected_assets", []):
        if not isinstance(row, dict):
            blockers.append("historical_motion_selection_row_invalid")
            continue
        asset_id = str(row.get("source_asset_id") or "")
        item = updated.get(asset_id)
        if item is None:
            blockers.append(f"historical_motion_source_asset_missing:{asset_id or 'blank'}")
            continue
        original = root / str(item.get("relative_path") or "")
        output = root / str(row.get("output_relative_path") or "")
        receipt_text = str(row.get("receipt") or "")
        receipt = YOUTUBE_ROOT / receipt_text if receipt_text and not Path(receipt_text).is_absolute() else Path(receipt_text)
        if not original.is_file() or sha256_file(original) != str(row.get("source_sha256") or ""):
            blockers.append(f"historical_motion_source_hash_mismatch:{asset_id}")
            continue
        if not output.is_file() or sha256_file(output) != str(row.get("output_sha256") or ""):
            blockers.append(f"historical_motion_output_hash_mismatch:{asset_id}")
            continue
        if not receipt.is_file() or sha256_file(receipt) != str(row.get("receipt_sha256") or ""):
            blockers.append(f"historical_motion_receipt_hash_mismatch:{asset_id}")
            continue
        item.update(
            {
                "relative_path": str(output.relative_to(root)),
                "sha256": str(row["output_sha256"]),
                "asset_kind": "source_motion",
                "derivative_source_sha256": str(row["source_sha256"]),
                "motion_receipt_sha256": str(row["receipt_sha256"]),
                "motion_source_asset_id": asset_id,
            }
        )
    return updated


def presentation_fields(asset_id: str, use_number: int, *, moving: bool, clip_start: float | None) -> dict:
    focus_x, focus_y, zoom_start, zoom_end = FOCUS_VARIANTS[(use_number - 1) % len(FOCUS_VARIANTS)]
    variant = f"{asset_id}-clip-{clip_start:.3f}" if moving and clip_start is not None else f"{asset_id}-region-{use_number:02d}"
    return {
        "presentation_variant": variant,
        "focus_x": focus_x,
        "focus_y": focus_y,
        "zoom_start": zoom_start,
        "zoom_end": zoom_end,
    }


def explicit_route_beats(
    route: dict,
    assets: dict[str, dict],
    claims_by_id: dict[str, dict],
    blockers: list[str],
) -> tuple[list[dict], dict]:
    requirements = route.get("requirements") if isinstance(route.get("requirements"), dict) else {}
    segments = route.get("segments") if isinstance(route.get("segments"), list) else []
    if not segments:
        blockers.append("long_form_visual_route_segments_missing")
        return [], requirements
    beats: list[dict] = []
    uses: Counter[str] = Counter()
    previous_end = 0.0
    previous_asset = ""
    for segment_index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            blockers.append(f"long_form_visual_route_segment_not_object:{segment_index}")
            continue
        start = float(segment.get("start", -1))
        end = float(segment.get("end", -1))
        if abs(start - previous_end) > 0.002:
            blockers.append(f"long_form_visual_route_gap_or_overlap:{previous_end:.3f}:{start:.3f}")
        if end <= start:
            blockers.append(f"long_form_visual_route_invalid_window:{segment_index}")
            continue
        entries = segment.get("entries") if isinstance(segment.get("entries"), list) else []
        if not entries:
            blockers.append(f"long_form_visual_route_entries_missing:{segment_index}")
            continue
        duration = (end - start) / len(entries)
        if start < 30.0 and duration > 2.5001:
            blockers.append(f"hook_visual_event_too_long:{segment_index}:{duration:.3f}")
        if start >= 30.0 and duration > 5.0001:
            blockers.append(f"body_visual_event_too_long:{segment_index}:{duration:.3f}")
        for entry_index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                blockers.append(f"long_form_visual_route_entry_not_object:{segment_index}:{entry_index + 1}")
                continue
            asset_id = str(entry.get("asset_id") or "")
            item = assets.get(asset_id)
            if item is None:
                blockers.append(f"long_form_visual_route_asset_missing:{asset_id or 'blank'}")
                continue
            item_claims = [str(value) for value in item.get("claim_ids", []) if str(value) in claims_by_id]
            segment_claim = str(segment.get("claim_id") or "")
            explicit_claim = str(entry.get("claim_id") or "")
            requested_claim = explicit_claim or segment_claim
            if requested_claim not in item_claims:
                blockers.append(
                    "long_form_visual_route_claim_not_supported:"
                    f"{asset_id}:{requested_claim or 'blank'}:"
                    f"{','.join(item_claims) or 'none'}"
                )
                continue
            narration_fit = str(entry.get("narration_fit") or "").strip()
            if explicit_claim and explicit_claim != segment_claim and not narration_fit:
                blockers.append(
                    f"long_form_visual_route_cross_claim_rationale_missing:{asset_id}:"
                    f"{segment_claim or 'blank'}:{explicit_claim}"
                )
                continue
            claim_id = requested_claim
            if claim_id not in claims_by_id:
                blockers.append(f"long_form_visual_route_claim_invalid:{asset_id}:{claim_id or 'blank'}")
                continue
            role = str(entry.get("role") or "context_only")
            is_direct = item.get("source_class") == DIRECT_SOURCE_CLASS and item.get("evidence_fit") == "direct"
            if role in PROOF_ROLES and not is_direct:
                blockers.append(f"route_proof_role_not_direct:{asset_id}:{role}")
            required_kinds = ROLE_ASSET_KINDS.get(role, set())
            if required_kinds and str(item.get("asset_kind") or "") not in required_kinds:
                blockers.append(f"route_asset_kind_incompatible:{asset_id}:{role}")
            beat_start = start + entry_index * duration
            beat_end = end if entry_index == len(entries) - 1 else start + (entry_index + 1) * duration
            moving = str(item.get("asset_kind") or "") in VIDEO_KINDS
            clip_start = float(entry.get("clip_start", 0.0)) if moving else None
            clip_end = clip_start + (beat_end - beat_start) if moving and clip_start is not None else None
            uses[asset_id] += 1
            fields = presentation_fields(asset_id, uses[asset_id], moving=moving, clip_start=clip_start)
            reuse_reason = ""
            if uses[asset_id] > 1:
                reuse_reason = (
                    f"Distinct source clip beginning at {clip_start:.3f}s."
                    if moving and clip_start is not None
                    else f"Distinct deterministic crop region {uses[asset_id]} with new focus coordinates."
                )
            if previous_asset == asset_id:
                blockers.append(f"adjacent_visual_asset_repeat:{asset_id}:{segment_index}:{entry_index + 1}")
            previous_asset = asset_id
            requires_context_disclosure = str(item.get("geographic_scope") or "") == "generic"
            callout = (
                str(entry.get("callout") or "")
                if (beat_start < 30.0 or entry_index == 0 or requires_context_disclosure)
                else ""
            )
            beats.append(
                {
                    "beat_id": f"visual-{len(beats) + 1:03d}",
                    "claim_ids": (claim_id,),
                    "segment_claim_id": segment_claim,
                    "asset_ids": (asset_id,),
                    "role": role,
                    "start_seconds": round(beat_start, 3),
                    "end_seconds": round(beat_end, 3),
                    "reuse_reason": reuse_reason,
                    **fields,
                    "clip_start_seconds": clip_start,
                    "clip_end_seconds": round(clip_end, 3) if clip_end is not None else None,
                    "editorial_callout": callout,
                    "narration_fit": narration_fit,
                }
            )
        previous_end = end
    expected_end = max(float(item["end"]) for item in claims_by_id.values())
    if abs(previous_end - expected_end) > 0.002:
        blockers.append(f"long_form_visual_route_does_not_cover_audio:{previous_end:.3f}:{expected_end:.3f}")

    minimum_unique = int(requirements.get("minimum_unique_assets", 0))
    minimum_unique_ratio = float(requirements.get("minimum_unique_asset_ratio", 0.0))
    maximum_uses = int(requirements.get("maximum_uses_per_asset", 999))
    maximum_static_uses = int(requirements.get("maximum_uses_per_static_asset", maximum_uses))
    minimum_static_gap = float(requirements.get("minimum_static_asset_reuse_gap_seconds", 0.0))
    maximum_share = float(requirements.get("maximum_runtime_share_per_asset", 1.0))
    if len(uses) < minimum_unique:
        blockers.append(f"long_form_visual_route_unique_assets:{len(uses)}/{minimum_unique}")
    if beats and len(uses) / len(beats) + 1e-6 < minimum_unique_ratio:
        blockers.append(
            "long_form_visual_route_unique_asset_ratio:"
            f"{len(uses) / len(beats):.4f}/{minimum_unique_ratio:.4f}"
        )
    for asset_id, count in uses.items():
        if count > maximum_uses:
            blockers.append(f"long_form_visual_route_asset_overused:{asset_id}:{count}/{maximum_uses}")
        if str(assets[asset_id].get("asset_kind") or "") not in VIDEO_KINDS and count > maximum_static_uses:
            blockers.append(
                f"long_form_visual_route_static_asset_overused:{asset_id}:{count}/{maximum_static_uses}"
            )
        asset_beats = [row for row in beats if row["asset_ids"][0] == asset_id]
        if str(assets[asset_id].get("asset_kind") or "") not in VIDEO_KINDS and len(asset_beats) > 1:
            for prior, current in zip(asset_beats, asset_beats[1:]):
                gap = float(current["start_seconds"]) - float(prior["end_seconds"])
                if gap + 1e-6 < minimum_static_gap:
                    blockers.append(
                        "long_form_visual_route_static_asset_reuse_gap:"
                        f"{asset_id}:{gap:.3f}/{minimum_static_gap:.3f}"
                    )
        runtime = sum(float(row["end_seconds"]) - float(row["start_seconds"]) for row in beats if row["asset_ids"][0] == asset_id)
        if previous_end and runtime / previous_end > maximum_share + 1e-6:
            blockers.append(f"long_form_visual_route_runtime_share:{asset_id}:{runtime / previous_end:.4f}/{maximum_share:.4f}")
    map_document_beats = sum(
        1 for row in beats if str(assets[row["asset_ids"][0]].get("asset_kind") or "") in {"map", "document"}
    )
    moving_beats = sum(
        1 for row in beats if str(assets[row["asset_ids"][0]].get("asset_kind") or "") in VIDEO_KINDS
    )
    beat_count = len(beats)
    maximum_map_document_share = float(requirements.get("maximum_map_document_share", 1.0))
    minimum_moving_image_share = float(requirements.get("minimum_moving_image_share", 0.0))
    if beat_count and map_document_beats / beat_count > maximum_map_document_share + 1e-6:
        blockers.append(
            "long_form_visual_route_map_document_share:"
            f"{map_document_beats / beat_count:.4f}/{maximum_map_document_share:.4f}"
        )
    if beat_count and moving_beats / beat_count + 1e-6 < minimum_moving_image_share:
        blockers.append(
            "long_form_visual_route_moving_image_share:"
            f"{moving_beats / beat_count:.4f}/{minimum_moving_image_share:.4f}"
        )
    if requirements.get("ai_visuals_allowed") is False:
        for asset_id in uses:
            if assets[asset_id].get("source_class") == "ai_reconstruction":
                blockers.append(f"ai_visual_entered_no_ai_replacement_route:{asset_id}")
    families = [source_family(assets[row["asset_ids"][0]]) for row in beats]
    maximum_family_run = int(requirements.get("maximum_same_source_family_run", 999))
    run = 0
    previous_family = ""
    for index, family in enumerate(families, start=1):
        run = run + 1 if family == previous_family else 1
        previous_family = family
        if run > maximum_family_run:
            blockers.append(f"same_source_family_run_exceeded:{family}:{index}:{run}/{maximum_family_run}")
    return beats, requirements


def fallback_beats(
    claims: list[dict],
    by_claim: dict[str, list[dict]],
    blockers: list[str],
) -> list[dict]:
    """Compatibility route for isolated fixtures that do not install a route file."""
    beats: list[dict] = []
    uses: Counter[str] = Counter()
    for claim in claims:
        candidates = by_claim[claim["claim_id"]]
        direct = [item for item in candidates if item.get("source_class") == DIRECT_SOURCE_CLASS and item.get("evidence_fit") == "direct"]
        context = [item for item in candidates if item not in direct]
        if not direct:
            blockers.append(f"claim_missing_accepted_direct_visual:{claim['claim_id']}")
            continue
        start = float(claim["start"])
        index = 0
        while start < float(claim["end"]):
            duration = 2.5 if start < 30 else 5.0
            end = min(float(claim["end"]), start + duration)
            item = direct[0] if index == 0 or not context else context[(index - 1) % len(context)]
            asset_id = str(item["asset_id"])
            uses[asset_id] += 1
            moving = str(item.get("asset_kind") or "") in VIDEO_KINDS
            clip_start = float((uses[asset_id] - 1) * duration) if moving else None
            fields = presentation_fields(asset_id, uses[asset_id], moving=moving, clip_start=clip_start)
            beats.append(
                {
                    "beat_id": f"visual-{claim['claim_id']}-{index + 1:02d}",
                    "claim_ids": (claim["claim_id"],),
                    "asset_ids": (asset_id,),
                    "role": claim["role"] if index == 0 else "context_only",
                    "start_seconds": start,
                    "end_seconds": end,
                    "reuse_reason": "" if uses[asset_id] == 1 else "Distinct deterministic compatibility-fixture presentation.",
                    **fields,
                    "clip_start_seconds": clip_start,
                    "clip_end_seconds": clip_start + duration if clip_start is not None else None,
                    "editorial_callout": "",
                }
            )
            start = end
            index += 1
    return beats


def build_manifest(video_id: str, intake_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    launch = launch_root(video_id)
    generic_expanded = root / "source-packet" / "production" / "evidence-intake-expanded.json"
    episode_expanded = root / "source-packet" / "long-form-rebuild" / "evidence-intake-expanded.json"
    if intake_path is None:
        intake_path = next(
            (
                candidate
                for candidate in (generic_expanded, episode_expanded)
                if candidate.is_file()
            ),
            root / "source-packet" / "evidence-intake.json",
        )
    route_path = launch / "long-form-visual-routing.json"
    manifest_path = approval / "evidence-manifest.json"
    ledger_path = approval / "evidence-asset-ledger.json"
    binding_path = approval / "evidence-manifest-binding.json"
    report_path = approval / "evidence-manifest-builder-report.json"
    blockers: list[str] = []
    package = read_json(launch / "package.json") if (launch / "package.json").is_file() else {}
    evidence_queries = read_json(launch / "evidence-queries.json") if (launch / "evidence-queries.json").is_file() else {}
    identity, identity_blockers = resolve_episode_identity(package, evidence_queries)
    blockers.extend(identity_blockers)
    try:
        route = read_json(route_path)
        claims = route_claims(route)
    except ValueError as exc:
        route = {}
        claims = []
        blockers.append(str(exc))
    if str(route.get("video_id") or "").zfill(2) != video_id:
        blockers.append("long_form_visual_route_video_id_mismatch")
    if identity.city and str(route.get("city") or "").strip().casefold() != identity.city.casefold():
        blockers.append("long_form_visual_route_city_mismatch")
    claims_by_id = {item["claim_id"]: item for item in claims}
    script_path = launch / "final-script.md"
    script_hash = sha256_file(script_path) if script_path.is_file() else ""
    if not script_hash:
        blockers.append("approved_script_missing")
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
    by_claim: dict[str, list[dict]] = {claim_id: [] for claim_id in claims_by_id}
    valid_assets: dict[str, dict] = {}
    accepted_assets: list[dict] = []
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
        is_direct = item.get("source_class") == DIRECT_SOURCE_CLASS and item.get("evidence_fit") == "direct"
        entities = sorted({term for claim_id in asset_claims for term in claims_by_id[claim_id]["entities"]})
        errors = asset_blockers(item, root, entities, is_direct, require_entities=is_direct)
        if errors:
            blockers.extend(errors)
            continue
        asset_id = str(item.get("asset_id") or "")
        if asset_id in valid_assets:
            blockers.append(f"duplicate_asset_id:{asset_id}")
            continue
        valid_assets[asset_id] = item
        accepted_assets.append(item)
        for claim_id in asset_claims:
            by_claim[claim_id].append(item)
    for claim in claims:
        if not any(item.get("source_class") == DIRECT_SOURCE_CLASS and item.get("evidence_fit") == "direct" for item in by_claim[claim["claim_id"]]):
            blockers.append(f"claim_missing_accepted_direct_visual:{claim['claim_id']}")

    valid_assets = apply_historical_motion_selection(root, valid_assets, blockers)
    accepted_assets = [valid_assets.get(str(item.get("asset_id") or ""), item) for item in accepted_assets]

    route_requirements: dict = {}
    if route_path.is_file() and claims:
        beats, route_requirements = explicit_route_beats(route, valid_assets, claims_by_id, blockers)
    else:
        beats = []
        blockers.append("long_form_visual_route_required")

    used_ids = {str(row["asset_ids"][0]) for row in beats}
    manifest_assets = [manifest_asset(valid_assets[asset_id], root) for asset_id in sorted(used_ids) if asset_id in valid_assets]
    manifest_payload = {
        "episode_id": video_id,
        "title": str(package.get("working_title") or package.get("title") or "").strip(),
        "claims": [
            {
                "claim_id": item["claim_id"],
                "text": item["text"],
                "fact_checker_status": "verified",
                "source_ids": tuple(sorted({str(asset["source_id"]) for asset in by_claim[item["claim_id"]]})),
                "required_entity_terms": tuple(item["entities"]),
            }
            for item in claims
        ],
        "assets": manifest_assets,
        "visual_beats": beats,
    }
    if not blockers:
        try:
            EpisodeManifest.model_validate(manifest_payload)
        except ValueError as exc:
            blockers.append(f"evidence_manifest_schema_invalid:{exc}")
    status = "pass" if not blockers else "blocked"
    counts = Counter(str(row["asset_ids"][0]) for row in beats)
    report = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "intake": display_path(intake_path),
        "visual_route": display_path(route_path) if route_path.is_file() else "compatibility_fixture_route",
        "approved_script": display_path(script_path),
        "script_sha256": script_hash,
        "city": identity.city,
        "hidden_history_question": identity.question,
        "proof_object": identity.proof_object,
        "visual_payoff": identity.payoff,
        "claims_planned": len(claims),
        "assets_available": len(valid_assets),
        "assets_used": len(counts),
        "visual_beat_count": len(beats),
        "maximum_asset_uses": max(counts.values(), default=0),
        "unique_asset_ratio": round(len(counts) / len(beats), 5) if beats else 0.0,
        "maximum_static_asset_uses": max(
            (
                count
                for asset_id, count in counts.items()
                if str(valid_assets[asset_id].get("asset_kind") or "") not in VIDEO_KINDS
            ),
            default=0,
        ),
        "minimum_static_asset_reuse_gap_seconds": min(
            (
                float(current["start_seconds"]) - float(prior["end_seconds"])
                for asset_id in counts
                if str(valid_assets[asset_id].get("asset_kind") or "") not in VIDEO_KINDS
                for prior, current in zip(
                    [row for row in beats if row["asset_ids"][0] == asset_id],
                    [row for row in beats if row["asset_ids"][0] == asset_id][1:],
                )
            ),
            default=None,
        ),
        "map_document_beat_count": sum(
            1
            for row in beats
            if str(valid_assets[str(row["asset_ids"][0])].get("asset_kind") or "") in {"map", "document"}
        ),
        "moving_image_beat_count": sum(
            1
            for row in beats
            if str(valid_assets[str(row["asset_ids"][0])].get("asset_kind") or "") in VIDEO_KINDS
        ),
        "route_requirements": route_requirements,
        "caption_mode": route_requirements.get("caption_mode", "closed_captions_plus_selective_editorial_text"),
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not blockers:
        manifest_path.write_text(json.dumps(manifest_payload, indent=2) + "\n", encoding="utf-8")
        ledger_path.write_text(json.dumps({"version": 2, "video_id": video_id, "assets": accepted_assets, "generated_at": utc_now()}, indent=2) + "\n", encoding="utf-8")
        binding = {
            "version": 2,
            "video_id": video_id,
            "status": "pass",
            "generated_at": utc_now(),
            "script_sha256": script_hash,
            "manifest_sha256": sha256_file(manifest_path),
            "intake_path": display_path(intake_path),
            "intake_sha256": sha256_file(intake_path),
            "visual_route_sha256": sha256_file(route_path) if route_path.is_file() else "",
            "plan_sha256": sha256_text(json.dumps(claims, sort_keys=True)),
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
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
