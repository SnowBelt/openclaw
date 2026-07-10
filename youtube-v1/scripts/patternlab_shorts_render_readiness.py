#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_audio_economy import build_audio_economy_report
from patternlab_shorts_boundary_quality import build_boundary_quality_report
from patternlab_shorts_engagement_loop import build_engagement_loop_report
from patternlab_shorts_first_frame_quality import build_first_frame_quality_report
from patternlab_shorts_pacing_quality import build_pacing_quality_report
from patternlab_shorts_reliability_common import write_report
from patternlab_shorts_script_package import build_shorts_script_package
from patternlab_shorts_toolchain_handoff import build_toolchain_handoff


def status_from(payload):
    return str(payload.get("status") or "missing")


def build_render_readiness_report(video_id: str):
    root = output_root(video_id)
    blockers: list[str] = []
    warnings: list[str] = []
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    script_package, script_json, script_md = build_shorts_script_package(video_id)
    audio, audio_json, audio_md = build_audio_economy_report(video_id)
    boundary, boundary_json, boundary_md = build_boundary_quality_report(video_id)
    first_frame, first_json, first_md = build_first_frame_quality_report(video_id)
    pacing, pacing_json, pacing_md = build_pacing_quality_report(video_id)
    engagement, engagement_json, engagement_md = build_engagement_loop_report(video_id)
    toolchain, toolchain_json, toolchain_md = build_toolchain_handoff(video_id)
    gate_rows = [
        ("shorts_script_package", script_package, script_md),
        ("shorts_audio_economy", audio, audio_md),
        ("shorts_boundary_quality", boundary, boundary_md),
        ("shorts_first_frame_quality", first_frame, first_md),
        ("shorts_pacing_quality", pacing, pacing_md),
        ("shorts_engagement_loop", engagement, engagement_md),
        ("shorts_toolchain_handoff", toolchain, toolchain_md),
    ]
    for name, payload, report in gate_rows:
        if payload.get("status") != "pass":
            blockers.append(f"{name} is not passing: {display_path(report)}.")
    if not long_form.exists():
        blockers.append("long-form draft is missing")
    if any(row.get("owner_approval_required_before_external_call") for row in audio.get("shorts", [])):
        warnings.append("Hybrid ElevenLabs wrapper policy is planned, but no ElevenLabs call may run without exact owner approval.")
    status = "render-ready" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "blockers": blockers,
        "warnings": warnings,
        "long_form_draft": display_path(long_form),
        "long_form_exists": long_form.exists(),
        "public_youtube_mutation": "not_performed",
        "external_elevenlabs_call_performed": False,
        "render_performed": False,
        "gates": [
            {"name": name, "status": status_from(payload), "report": display_path(report)}
            for name, payload, report in gate_rows
        ],
    }
    sections = [
        ("Pre-Render Gates", [f"- {row['name']}: {row['status']} ({row['report']})" for row in payload["gates"]]),
        ("Render Boundary", ["- No Shorts were rendered by this readiness check.", "- Rendering is blocked until all gates pass and the long-form draft exists."]),
    ]
    return write_report(video_id, "shorts-render-readiness-report", "Pattern Lab Shorts Render Readiness Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Check Pattern Lab Shorts render readiness.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_render_readiness_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Render readiness report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] in {"render-ready", "blocked"} else 1)


if __name__ == "__main__":
    main()
