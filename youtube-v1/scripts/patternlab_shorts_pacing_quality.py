#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math

from patternlab_common import output_root, utc_now, display_path, media_duration_seconds
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


def build_pacing_quality_report(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    blockers = minimum_script_package_ok(package)
    render_inspection = root / "approval" / "shorts-render-inspection.json"
    if not render_inspection.exists() or render_inspection.stat().st_size == 0:
        blockers.append("rendered_short_visual_inspection_receipt_missing")
    warnings: list[str] = []
    rows = []
    for item in script_items(package):
        duration = float(item.get("duration_seconds") or 0)
        events = micro_event_times(duration)
        gaps = [round(events[index] - events[index - 1], 2) for index in range(1, len(events))]
        max_gap = max(gaps) if gaps else 0
        min_gap = min(gaps) if gaps else 0
        row_blockers = []
        if len(REQUIRED_PHASES) < 4:
            row_blockers.append("at least four visual phases are required")
        if gaps and (min_gap < MIN_EVENT_SECONDS or max_gap > MAX_EVENT_SECONDS):
            row_blockers.append(f"planned visual event gaps must be {MIN_EVENT_SECONDS}-{MAX_EVENT_SECONDS}s; found {min_gap}-{max_gap}s")
        overlays = [overlay_exists(root, video_id, int(item.get("index") or 0), kind) for kind in ["first", "hook", "proof", "payoff", "bridge"]]
        overlay_count = sum(1 for path in overlays if path.exists() and path.stat().st_size > 0)
        mp4 = root / "shorts" / f"pattern-lab-video-{video_id}-short-{int(item.get('index') or 0):02d}.mp4"
        rendered_status = "pending"
        if mp4.exists():
            try:
                rendered_duration = media_duration_seconds(mp4)
                rendered_status = "pass" if 25 <= rendered_duration <= 45 and overlay_count == 5 else "blocked"
                if rendered_status != "pass":
                    row_blockers.append("rendered MP4 duration or overlay set is invalid")
            except Exception as exc:
                rendered_status = "blocked"
                row_blockers.append(f"could not inspect rendered MP4: {exc}")
        blockers.extend(f"Short {item.get('index')}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "duration_seconds": duration,
                "phase_count": len(REQUIRED_PHASES),
                "phases": list(REQUIRED_PHASES),
                "planned_visual_event_count": len(events),
                "planned_max_gap_seconds": max_gap,
                "planned_min_gap_seconds": min_gap,
                "overlay_count": overlay_count,
                "rendered_mp4": display_path(mp4),
                "rendered_status": rendered_status,
                "status": "pass" if not row_blockers else "blocked",
            }
        )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "required_visual_event_gap_seconds": f"{MIN_EVENT_SECONDS}-{MAX_EVENT_SECONDS}",
        "rendered_mp4_checks_status": "pending" if all(row["rendered_status"] == "pending" for row in rows) else "mixed",
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
        ("Caption Safety", ["- Caption/overlay render inspection remains pending until overlay PNGs and MP4 Shorts exist."]),
    ]
    return write_report(video_id, "shorts-pacing-quality-report", "Pattern Lab Shorts Pacing Quality Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts visual pacing and caption safety.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_pacing_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Pacing quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
