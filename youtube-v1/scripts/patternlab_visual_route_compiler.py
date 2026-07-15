#!/usr/bin/env python3
"""Validate an episode-owned narration-to-visual route for any city.

The research/visual-planning stage owns the route contents.  This compiler is
the reusable production seam: it refuses stale identity, incomplete beats, or
weak diversity requirements and never manufactures a city-specific route from
a hidden template.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, city_from_sources
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid_json:{display_path(path)}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"json_object_required:{display_path(path)}")
    return value


def validate(video_id: str) -> tuple[dict[str, Any], Path]:
    launch = launch_root(video_id)
    route_path = launch / "long-form-visual-routing.json"
    route = read_json(route_path)
    package = read_json(launch / "package.json")
    evidence = read_json(launch / "evidence-queries.json")
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
    if str(route.get("video_id") or "").zfill(2) != video_id:
        blockers.append("visual_route_video_id_mismatch")
    claims = route.get("claims") if isinstance(route.get("claims"), list) else []
    claim_ids = {str(row.get("claim_id") or "") for row in claims if isinstance(row, dict)}
    if not claims or "" in claim_ids:
        blockers.append("visual_route_claims_missing_or_invalid")
    segments = route.get("segments") if isinstance(route.get("segments"), list) else []
    if not segments:
        blockers.append("visual_route_segments_missing")
    previous_end = 0.0
    placement_count = 0
    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            blockers.append(f"visual_route_segment_not_object:{index}")
            continue
        try:
            start, end = float(segment.get("start")), float(segment.get("end"))
        except (TypeError, ValueError):
            blockers.append(f"visual_route_segment_time_invalid:{index}")
            continue
        if start < 0 or end <= start or start + 0.01 < previous_end:
            blockers.append(f"visual_route_segment_timeline_invalid:{index}:{start}:{end}")
        previous_end = max(previous_end, end)
        claim_id = str(segment.get("claim_id") or "")
        if claim_id not in claim_ids:
            blockers.append(f"visual_route_segment_claim_invalid:{index}:{claim_id or 'missing'}")
        if not str(segment.get("narration_intent") or "").strip():
            blockers.append(f"visual_route_narration_intent_missing:{index}")
        entries = segment.get("entries") if isinstance(segment.get("entries"), list) else []
        if not entries:
            blockers.append(f"visual_route_entries_missing:{index}")
        for entry_index, entry in enumerate(entries, start=1):
            placement_count += 1
            if not isinstance(entry, dict) or not str(entry.get("asset_id") or "").strip():
                blockers.append(f"visual_route_asset_id_missing:{index}:{entry_index}")
            if not str((entry or {}).get("role") or "").strip():
                blockers.append(f"visual_route_role_missing:{index}:{entry_index}")
    requirements = route.get("requirements") if isinstance(route.get("requirements"), dict) else {}
    required_contract = {
        "minimum_unique_asset_ratio": 0.8,
        "maximum_uses_per_static_asset": 1,
        "maximum_uses_per_proof_static_asset": 2,
        "minimum_static_asset_reuse_gap_seconds": 180.0,
        "minimum_historical_motion_assets": 4,
        "strict_claim_binding": True,
        "cross_claim_rationale_required": True,
    }
    for field, expected in required_contract.items():
        value = requirements.get(field)
        if isinstance(expected, bool):
            if value is not expected:
                blockers.append(f"visual_route_requirement_invalid:{field}:{value}")
        elif float(value or 0) < float(expected):
            blockers.append(f"visual_route_requirement_below_floor:{field}:{value}/{expected}")
    if str(requirements.get("caption_mode") or "") != "closed_captions_plus_selective_editorial_text":
        blockers.append("visual_route_caption_mode_invalid")
    if requirements.get("split_screen_allowed") is not False:
        blockers.append("visual_route_split_screen_must_be_false")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "pass" if not blockers else "blocked",
        "claim_count": len(claims),
        "segment_count": len(segments),
        "placement_count": placement_count,
        "duration_seconds": round(previous_end, 3),
        "route": display_path(route_path),
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(output_root(video_id) / "approval") / "visual-route-compiler-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate an episode-owned Pattern Lab visual route.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    try:
        payload, report = validate(video_id)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(payload, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)
    print(f"Report: {display_path(report)}")


if __name__ == "__main__":
    main()
