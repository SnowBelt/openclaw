#!/usr/bin/env python3
from __future__ import annotations

import argparse

from PIL import Image, ImageFilter, ImageStat

from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import (
    PROOF_TERMS,
    contains_any,
    minimum_script_package_ok,
    overlay_exists,
    package_local_terms,
    script_items,
    script_package,
    short_ref,
    word_count,
    write_report,
)


def build_first_frame_quality_report(
    video_id: str,
    *,
    plan_only: bool = False,
    report_stem: str = "shorts-first-frame-quality-report",
):
    root = output_root(video_id)
    package = script_package(video_id)
    city = str(package.get("city") or "").strip().lower()
    local_terms = package_local_terms(package)
    blockers = minimum_script_package_ok(package)
    planning_blockers = list(blockers)
    warnings: list[str] = []
    rows = []
    for item in script_items(package):
        first_frame_text = str(item.get("first_frame_text") or "").strip()
        hook = str(item.get("hook") or "")
        proof_visual = str(item.get("proof_visual") or "")
        combined = f"{first_frame_text} {hook} {proof_visual}"
        planning_row_blockers = []
        rendered_row_blockers = []
        words = word_count(first_frame_text)
        if words < 2 or words > 5:
            planning_row_blockers.append(f"first-frame text must be 2-5 words; found {words}")
        if not city or not contains_any(combined, local_terms):
            planning_row_blockers.append("first frame lacks city/neighborhood context")
        if not contains_any(combined, PROOF_TERMS):
            planning_row_blockers.append("first frame lacks a proof-object label")
        if "skyline" in proof_visual.lower() and not contains_any(proof_visual, PROOF_TERMS):
            planning_row_blockers.append("generic skyline-only proof visual is not allowed")
        if len(hook) > 120:
            planning_row_blockers.append("hook is too long for muted autoplay")
        first_frame = root / "shorts" / "qa-frames" / f"short-{int(item.get('index') or 0):02d}-first-frame.png"
        frame_status = "missing"
        frame_dimensions = ""
        frame_luma = 0.0
        frame_contrast = 0.0
        frame_edge = 0.0
        if first_frame.exists() and first_frame.stat().st_size > 0:
            try:
                with Image.open(first_frame) as image:
                    frame_dimensions = f"{image.width}x{image.height}"
                    gray = image.convert("L")
                    stats = ImageStat.Stat(gray)
                    frame_luma = float(stats.mean[0])
                    frame_contrast = float(stats.stddev[0])
                    frame_edge = float(ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0])
                    frame_status = "pass" if (
                        (image.width, image.height) == (1080, 1920)
                        and frame_luma >= 45.0
                        and frame_contrast >= 25.0
                        and frame_edge >= 6.0
                    ) else "blocked"
                if frame_dimensions != "1080x1920":
                    rendered_row_blockers.append(f"actual first frame must be 1080x1920; found {frame_dimensions}")
                if frame_luma < 45.0:
                    rendered_row_blockers.append(f"actual first frame is too dim: luma {frame_luma:.1f}")
                if frame_contrast < 25.0:
                    rendered_row_blockers.append(f"actual first frame is too flat: contrast {frame_contrast:.1f}")
                if frame_edge < 6.0:
                    rendered_row_blockers.append(f"actual first frame is too soft: edge {frame_edge:.1f}")
            except Exception as exc:
                frame_status = "blocked"
                rendered_row_blockers.append(f"actual first frame is unreadable: {type(exc).__name__}")
        else:
            rendered_row_blockers.append("rendered actual first frame is missing")
        planning_blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in planning_row_blockers)
        row_blockers = planning_row_blockers if plan_only else planning_row_blockers + rendered_row_blockers
        blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "first_frame_text": first_frame_text,
                "proof_visual": proof_visual,
                "first_frame_path": display_path(first_frame),
                "first_frame_status": frame_status,
                "first_frame_dimensions": frame_dimensions,
                "first_frame_luma": round(frame_luma, 2),
                "first_frame_contrast": round(frame_contrast, 2),
                "first_frame_edge": round(frame_edge, 2),
                "planning_status": "pass" if not planning_row_blockers else "blocked",
                "status": "pass" if not row_blockers else "blocked",
                "blockers": row_blockers,
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
        "actual_first_frame_checks_status": "pass" if rows and all(row["first_frame_status"] == "pass" for row in rows) else "blocked",
        "overlay_checks_status": "pass" if rows and all(row["first_frame_status"] == "pass" for row in rows) else "blocked",
        "shorts": rows,
    }
    sections = [
        (
            "First Frames",
            [
                f"- Short {row['index']}: {row['status']} — text='{row['first_frame_text']}' proof='{row['proof_visual']}' actual_frame={row['first_frame_status']}"
                for row in rows
            ],
        ),
        ("Muted Autoplay", ["- Planning and final-render status are separate. Final QA judges the actual exported first frame, not an unused overlay plan."]),
    ]
    return write_report(video_id, report_stem, "Pattern Lab Shorts First-Frame Quality Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts first-frame and muted-autoplay quality.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--report-stem", default="shorts-first-frame-quality-report")
    args = parser.parse_args()
    payload, _json_path, md_path = build_first_frame_quality_report(
        args.video_id,
        plan_only=args.plan_only,
        report_stem=args.report_stem,
    )
    print(f"Status: {payload['status']}")
    print(f"First-frame quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
