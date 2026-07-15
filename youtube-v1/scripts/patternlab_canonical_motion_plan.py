#!/usr/bin/env python3
"""Derive role-specific documentary motion from a canonical evidence render plan."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now


MOTION_BY_ROLE = {
    "source_proof": ("source_highlight", "Reveal the exact source detail before context."),
    "archive_evidence": ("ken_burns_push", "Move to the relevant person, storefront, or street detail."),
    "document_detail": ("document_closeup", "Guide attention across the named clause or boundary."),
    "map_system": ("map_zoom_trace", "Trace the system route or boundary through the historical map."),
    "then_now": ("then_now_single_source", "Show one hash-bound historic or present-day source at a time; comparison happens across cuts, never by split-screen compositing."),
    "context_only": ("slow_context_pan", "Add modern context without presenting it as proof."),
    "labeled_reconstruction": ("reconstruction_slow_push", "Keep the reconstruction clearly labeled as explanatory support; a flat push is never described as parallax."),
    "city_file_cta": ("cta_push", "End with a short source-first city-file invitation."),
}


def motion_profile(role: str, asset_kind: str) -> tuple[str, str] | None:
    if asset_kind in {"film", "modern_video", "source_motion"}:
        if role in {"source_proof", "archive_evidence"}:
            return "native_video_source", "Use the verified archival clip itself and preserve its evidentiary meaning."
        return "native_video_context", "Use the verified context clip itself without presenting it as historical proof."
    return MOTION_BY_ROLE.get(role)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    render_plan_path = approval / "canonical-render-plan.json"
    render_plan = read_json(render_plan_path)
    blockers: list[str] = []
    if render_plan.get("status") != "pass":
        blockers.append("canonical_render_plan_not_pass")
    beats = render_plan.get("beats") if isinstance(render_plan.get("beats"), list) else []
    if not beats:
        blockers.append("canonical_render_plan_beats_missing")
    motion_beats = []
    for beat in beats:
        role = beat.get("role")
        profile = motion_profile(str(role), str(beat.get("asset_kind") or ""))
        if not profile:
            blockers.append(f"visual_role_has_no_motion_profile:{role}")
            continue
        if role == "map_system" and beat.get("asset_kind") not in {"map", "document"}:
            blockers.append(f"map_motion_requires_map_or_document:{beat.get('beat_id', 'unknown')}")
        if role == "document_detail" and beat.get("asset_kind") != "document":
            blockers.append(f"document_motion_requires_document:{beat.get('beat_id', 'unknown')}")
        motion_beats.append({
            "beat_id": beat.get("beat_id"), "asset_id": beat.get("asset_id"), "asset_kind": beat.get("asset_kind"),
            "role": role, "start_seconds": beat.get("start_seconds"), "end_seconds": beat.get("end_seconds"),
            "motion_style": profile[0], "motion_reason": profile[1],
        })
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "canonical_render_plan": display_path(render_plan_path), "beats": motion_beats,
        "blockers": sorted(set(blockers)), "youtube_mutation": "not_performed",
    }
    json_path = approval / "canonical-motion-plan.json"
    md_path = approval / "canonical-motion-plan.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Canonical Motion Plan: Video {video_id}", "", f"Status: {payload['status']}", "", "## Beats", "",
        *[f"- {item['beat_id']}: {item['motion_style']} ({item['motion_reason']})" for item in motion_beats],
        "", "## Blockers", "", *([f"- {item}" for item in payload["blockers"]] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a source-bound Pattern Lab documentary motion plan.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
