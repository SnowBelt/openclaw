"""City-generic visual truth, diversity, and package-completeness contracts.

This module is deliberately deterministic. Local or hosted models may propose
media, but they cannot weaken the release rules implemented here.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


TOKEN_RE = re.compile(r"[a-z0-9]+")
VIDEO_KINDS = frozenset({"film", "modern_video", "source_motion"})
PROOF_ROLES = frozenset({"source_proof", "map_system", "archive_evidence", "document_detail", "then_now"})


@dataclass(frozen=True)
class EpisodeIdentity:
    city: str
    question: str
    proof_object: str
    payoff: str


def _text(value: Any) -> str:
    return str(value or "").strip()


def _first_text(*values: Any) -> str:
    return next((_text(value) for value in values if _text(value)), "")


def resolve_episode_identity(package: dict[str, Any], evidence: dict[str, Any]) -> tuple[EpisodeIdentity, list[str]]:
    """Resolve one explicit city without guessing from a title or video id."""
    city_terms = [_text(item) for item in evidence.get("required_city_terms", []) if _text(item)]
    city = _first_text(package.get("city"), package.get("active_city"))
    blockers: list[str] = []
    if not city:
        blockers.append("episode_city_missing_explicit_package_field")
    if len({item.casefold() for item in city_terms}) != 1:
        blockers.append("evidence_requires_exactly_one_city_term")
    elif city and city.casefold() != city_terms[0].casefold():
        blockers.append("package_city_and_evidence_city_mismatch")
    question = _first_text(package.get("hidden_history_question"), package.get("public_angle"))
    proof_object = _first_text(
        package.get("proof_object"),
        (package.get("guru_growth_system") or {}).get("outlier_topic_mining", {}).get("proof_object"),
        package.get("artifact_type"),
    )
    payoff = _first_text(
        package.get("visual_payoff"),
        (package.get("guru_growth_system") or {}).get("packaging_lock_before_script", {}).get("locked_fields", {}).get("first_30_second_payoff"),
    )
    if not question:
        blockers.append("episode_hidden_history_question_missing")
    if not proof_object:
        blockers.append("episode_visible_proof_object_missing")
    if not payoff:
        blockers.append("episode_visual_payoff_missing")
    return EpisodeIdentity(city=city, question=question, proof_object=proof_object, payoff=payoff), blockers


def flatten_route(route: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for segment_index, segment in enumerate(route.get("segments", []) if isinstance(route.get("segments"), list) else [], start=1):
        if not isinstance(segment, dict):
            continue
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        entries = segment.get("entries") if isinstance(segment.get("entries"), list) else []
        duration = (end - start) / max(1, len(entries))
        for entry_index, entry in enumerate(entries, start=1):
            if not isinstance(entry, dict):
                continue
            rows.append(
                {
                    **entry,
                    "beat_id": _first_text(entry.get("beat_id"), f"segment-{segment_index:03d}-{entry_index:02d}"),
                    "start_seconds": float(entry.get("start_seconds", start + (entry_index - 1) * duration)),
                    "end_seconds": float(entry.get("end_seconds", start + entry_index * duration)),
                    "claim_id": _first_text(entry.get("claim_id"), segment.get("claim_id")),
                    "narration_intent": _first_text(entry.get("narration_intent"), segment.get("narration_intent")),
                }
            )
    return rows


def presentation_identity(row: dict[str, Any], asset: dict[str, Any]) -> str:
    asset_id = _text(row.get("asset_id"))
    if _text(asset.get("asset_kind")) in VIDEO_KINDS:
        start = float(row.get("clip_start", row.get("clip_start_seconds", 0.0)) or 0.0)
        end = row.get("clip_end", row.get("clip_end_seconds"))
        end_text = "" if end is None else f"{float(end):.3f}"
        return f"{asset_id}@{start:.3f}:{end_text}"
    return asset_id


def source_family(asset: dict[str, Any]) -> str:
    url = _text(asset.get("source_url"))
    if url:
        match = re.match(r"https?://([^/]+)", url.casefold())
        if match:
            return match.group(1)
    return _first_text(asset.get("source_id"), asset.get("archive_or_platform"), "unknown").casefold()


def diversity_findings(
    rows: Iterable[dict[str, Any]],
    ledger_by_id: dict[str, dict[str, Any]],
    policy: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    rows = list(rows)
    blockers: list[str] = []
    presentations = [presentation_identity(row, ledger_by_id.get(_text(row.get("asset_id")), {})) for row in rows]
    unique_presentations = {item for item in presentations if item}
    ratio = len(unique_presentations) / len(rows) if rows else 0.0
    floor = float(policy.get("minimum_unique_presentation_ratio", 0.8))
    required = math.ceil(len(rows) * floor)
    if len(unique_presentations) < required:
        blockers.append(f"visual_unique_presentations_below_floor:{len(unique_presentations)}/{required}")

    by_asset: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        asset_id = _text(row.get("asset_id"))
        if not asset_id:
            blockers.append("visual_route_asset_id_missing")
            continue
        if asset_id not in ledger_by_id:
            blockers.append(f"visual_route_asset_missing_from_ledger:{asset_id}")
        by_asset[asset_id].append(row)

    for asset_id, uses in sorted(by_asset.items()):
        asset = ledger_by_id.get(asset_id, {})
        kind = _text(asset.get("asset_kind"))
        source_class = _text(asset.get("source_class"))
        roles = {_text(row.get("role")) for row in uses}
        if source_class in {"modern_context", "ai_reconstruction"} and len(uses) > 1:
            blockers.append(f"nonproof_asset_reused:{asset_id}:{len(uses)}")
        if kind in VIDEO_KINDS:
            ceiling = int(policy.get("maximum_native_video_source_uses", 2))
            if len(uses) > ceiling:
                blockers.append(f"native_video_source_uses_above_ceiling:{asset_id}:{len(uses)}")
            starts = sorted(float(row.get("clip_start", row.get("clip_start_seconds", 0.0)) or 0.0) for row in uses)
            separation = float(policy.get("minimum_native_video_clip_separation_seconds", 30.0))
            for prior, current in zip(starts, starts[1:]):
                if current - prior + 1e-6 < separation:
                    blockers.append(f"native_video_clips_not_distinct:{asset_id}:{prior:.3f}:{current:.3f}")
            continue
        proof_only = bool(roles) and roles <= PROOF_ROLES
        ceiling = int(policy.get("maximum_proof_static_uses", 2) if proof_only else policy.get("maximum_static_uses", 1))
        if len(uses) > ceiling:
            blockers.append(f"static_asset_uses_above_ceiling:{asset_id}:{len(uses)}")
        if len(uses) > 1:
            ordered = sorted(uses, key=lambda row: float(row.get("start_seconds", 0.0)))
            for prior, current in zip(ordered, ordered[1:]):
                if not _text(current.get("reuse_reason")):
                    blockers.append(f"proof_reprise_reason_missing:{asset_id}")
                if not _text(current.get("presentation_variant")):
                    blockers.append(f"proof_reprise_presentation_missing:{asset_id}")
                gap = float(current.get("start_seconds", 0.0)) - float(prior.get("end_seconds", 0.0))
                minimum_gap = float(policy.get("minimum_proof_reprise_gap_seconds", 180.0))
                if gap + 1e-6 < minimum_gap:
                    blockers.append(f"proof_reprise_gap_below_floor:{asset_id}:{gap:.3f}")

    families = [source_family(ledger_by_id.get(_text(row.get("asset_id")), {})) for row in rows]
    max_run = int(policy.get("maximum_same_source_family_run", 2))
    previous = ""
    run = 0
    for index, family in enumerate(families, start=1):
        run = run + 1 if family == previous else 1
        previous = family
        if run > max_run:
            blockers.append(f"same_source_family_run_above_ceiling:{family}:{index}:{run}")

    metrics = {
        "placement_count": len(rows),
        "unique_presentation_count": len(unique_presentations),
        "minimum_unique_presentation_count": required,
        "unique_presentation_ratio": round(ratio, 5),
        "asset_use_counts": dict(sorted(Counter(_text(row.get("asset_id")) for row in rows).items())),
    }
    return metrics, sorted(set(blockers))


def semantic_tokens(value: str) -> set[str]:
    stop = {"the", "and", "that", "this", "with", "from", "into", "were", "was", "have", "city", "show"}
    return {token for token in TOKEN_RE.findall(value.casefold()) if len(token) >= 3 and token not in stop}


def narration_asset_match(narration: str, asset: dict[str, Any], required_terms: Iterable[str] = ()) -> dict[str, Any]:
    narration_terms = semantic_tokens(narration) | {term.casefold() for term in required_terms if _text(term)}
    asset_text = " ".join(
        _text(asset.get(key))
        for key in ("source_title", "source_description", "entity_terms", "subjects", "context_action", "context_emotion", "narration_fit")
    )
    asset_terms = semantic_tokens(asset_text)
    overlap = sorted(narration_terms & asset_terms)
    score = len(overlap) / max(1, min(len(narration_terms), 8))
    return {"score": round(score, 4), "overlap_terms": overlap, "narration_terms": sorted(narration_terms), "asset_terms": sorted(asset_terms)}


def package_counts(root: Path, video_id: str) -> dict[str, int]:
    return {
        "long_form": int((root / "video" / f"pattern-lab-video-{video_id}-draft.mp4").is_file()),
        "shorts": len(list((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4"))) if (root / "shorts").is_dir() else 0,
        "thumbnail_candidates": len(list((root / "images").glob("thumbnail_candidate_*.png"))) if (root / "images").is_dir() else 0,
        "closed_caption_files": len(list((root / "captions").glob("*.srt"))) if (root / "captions").is_dir() else 0,
    }
