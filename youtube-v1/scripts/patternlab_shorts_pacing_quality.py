#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import output_root, utc_now, display_path, media_duration_seconds
from patternlab.state import sha256_file
from patternlab_shorts_reliability_common import minimum_script_package_ok, overlay_exists, script_items, script_package, write_report

MIN_EVENT_SECONDS = 1.5
MAX_EVENT_SECONDS = 3.0
REQUIRED_PHASES = ("proof/opening", "hook", "evidence", "payoff/bridge")


def micro_event_times(duration: float) -> list[float]:
    if duration <= 0:
        return []
    # Choose an even grid so the final event does not create a sub-1.5s tail.
    segment_count = max(1, math.ceil(duration / MAX_EVENT_SECONDS))
    step = duration / segment_count
    if step < MIN_EVENT_SECONDS:
        segment_count = max(1, math.floor(duration / MIN_EVENT_SECONDS))
        step = duration / segment_count
    return [round(index * step, 2) for index in range(segment_count)] + [round(duration, 2)]


def build_pacing_quality_report(
    video_id: str,
    *,
    plan_only: bool = False,
    report_stem: str = "shorts-pacing-quality-report",
):
    root = output_root(video_id)
    package = script_package(video_id)
    blockers = minimum_script_package_ok(package)
    planning_blockers = list(blockers)
    render_inspection = root / "approval" / "shorts-render-inspection.json"
    inspection = {}
    if not plan_only and (not render_inspection.exists() or render_inspection.stat().st_size == 0):
        blockers.append("rendered_short_visual_inspection_receipt_missing")
    elif not plan_only:
        try:
            inspection = json.loads(render_inspection.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            blockers.append("rendered_short_visual_inspection_receipt_unreadable")
    warnings: list[str] = []
    dedicated_render = {}
    dedicated_path = root / "approval" / "shorts-render-report.json"
    if dedicated_path.is_file():
        try:
            dedicated_render = json.loads(dedicated_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            dedicated_render = {}
    dedicated_by_index = {
        int(row.get("index") or 0): row
        for row in dedicated_render.get("shorts", [])
        if isinstance(row, dict)
    }
    rows = []
    for item in script_items(package):
        duration = float(item.get("duration_seconds") or 0)
        events = micro_event_times(duration)
        gaps = [round(events[index] - events[index - 1], 2) for index in range(1, len(events))]
        max_gap = max(gaps) if gaps else 0
        min_gap = min(gaps) if gaps else 0
        planning_row_blockers = []
        rendered_row_blockers = []
        actual_phases = [
            name
            for name, value in [
                ("proof/opening", item.get("first_frame_text") or item.get("proof_visual")),
                ("hook", item.get("hook")),
                ("evidence", item.get("script") or item.get("proof_visual")),
                ("payoff/bridge", item.get("payoff") and (item.get("bridge_to_long_form") or item.get("related_video_promise"))),
            ]
            if value
        ]
        if len(actual_phases) < 4:
            planning_row_blockers.append("at least four visual phases are required")
        if gaps and (min_gap < MIN_EVENT_SECONDS or max_gap > MAX_EVENT_SECONDS):
            planning_row_blockers.append(f"planned visual event gaps must be {MIN_EVENT_SECONDS}-{MAX_EVENT_SECONDS}s; found {min_gap}-{max_gap}s")
        short_index = int(item.get("index") or 0)
        overlay_count = 0
        mp4 = root / "shorts" / f"pattern-lab-video-{video_id}-short-{short_index:02d}.mp4"
        dedicated = dedicated_by_index.get(short_index, {})
        embedded_overlay_contract = (
            mp4.is_file()
            and dedicated.get("sha256") == sha256_file(mp4)
            and float(dedicated.get("visual_event_max_seconds") or 999) <= 2.5
            and dedicated.get("narration_mode") == "exact_complete_sentences_from_approved_james_voiceover"
        )
        if embedded_overlay_contract:
            # The generic exact-alignment renderer burns hook/proof, mobile
            # captions, and the long-form bridge into the final pixels.
            # Separate legacy PNG overlays are intentionally non-authoritative.
            overlay_count = 5
        rendered_status = "pending"
        if mp4.exists():
            try:
                rendered_duration = media_duration_seconds(mp4)
                rendered_status = "pass" if 25 <= rendered_duration <= 45 and embedded_overlay_contract else "blocked"
                if rendered_status != "pass":
                    rendered_row_blockers.append("rendered MP4 duration or exact aligned render contract is invalid")
            except Exception as exc:
                rendered_status = "blocked"
                rendered_row_blockers.append(f"could not inspect rendered MP4: {exc}")
        else:
            rendered_status = "missing"
            rendered_row_blockers.append("rendered MP4 is missing")
        planning_blockers.extend(f"Short {item.get('index')}: {blocker}." for blocker in planning_row_blockers)
        inspected = next(
            (
                row
                for row in inspection.get("shorts", [])
                if isinstance(row, dict) and int(row.get("index") or 0) == int(item.get("index") or 0)
            ),
            {},
        )
        if not plan_only and mp4.exists() and inspected.get("status") != "pass":
            rendered_row_blockers.append("rendered inspection is not passing")
        row_blockers = planning_row_blockers if plan_only else planning_row_blockers + rendered_row_blockers
        blockers.extend(f"Short {item.get('index')}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "duration_seconds": duration,
                "phase_count": len(actual_phases),
                "phases": actual_phases,
                "planned_visual_event_count": len(events),
                "planned_max_gap_seconds": max_gap,
                "planned_min_gap_seconds": min_gap,
                "overlay_count": overlay_count,
                "rendered_mp4": display_path(mp4),
                "rendered_status": rendered_status,
                "rendered_inspection_status": inspected.get("status", "missing"),
                "planning_status": "pass" if not planning_row_blockers else "blocked",
                "status": "pass" if not row_blockers else "blocked",
            }
        )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "planning_status": "pass" if not planning_blockers else "blocked",
        "plan_only": plan_only,
        "blockers": blockers,
        "warnings": warnings,
        "required_visual_event_gap_seconds": f"{MIN_EVENT_SECONDS}-{MAX_EVENT_SECONDS}",
        "rendered_mp4_checks_status": "pass" if rows and all(row["rendered_status"] == "pass" and row["rendered_inspection_status"] == "pass" for row in rows) else "blocked",
        "render_inspection_receipt": display_path(render_inspection),
        "shorts": rows,
    }
    sections = [
        (
            "Pacing Plan",
            [
                f"- Short {row['index']}: {row['planned_visual_event_count']} planned events, max gap {row['planned_max_gap_seconds']}s, rendered={row['rendered_status']}"
                for row in rows
            ],
        ),
        ("Caption Safety", ["- Final QA requires a parsed, current rendered-media inspection receipt for every Short; a plan cannot self-certify the final pixels."]),
    ]
    return write_report(video_id, report_stem, "Pattern Lab Shorts Pacing Quality Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts visual pacing and caption safety.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--report-stem", default="shorts-pacing-quality-report")
    args = parser.parse_args()
    payload, _json_path, md_path = build_pacing_quality_report(
        args.video_id,
        plan_only=args.plan_only,
        report_stem=args.report_stem,
    )
    print(f"Status: {payload['status']}")
    print(f"Pacing quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
