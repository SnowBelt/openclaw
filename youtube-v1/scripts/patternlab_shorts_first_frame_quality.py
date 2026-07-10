#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import (
    LOCAL_TERMS,
    PROOF_TERMS,
    contains_any,
    minimum_script_package_ok,
    overlay_exists,
    script_items,
    script_package,
    short_ref,
    word_count,
    write_report,
)


def build_first_frame_quality_report(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    city = str(package.get("city") or "").strip().lower()
    blockers = minimum_script_package_ok(package)
    warnings: list[str] = []
    rows = []
    for item in script_items(package):
        first_frame_text = str(item.get("first_frame_text") or "").strip()
        hook = str(item.get("hook") or "")
        proof_visual = str(item.get("proof_visual") or "")
        combined = f"{first_frame_text} {hook} {proof_visual} {city}"
        row_blockers = []
        words = word_count(first_frame_text)
        if words < 2 or words > 5:
            row_blockers.append(f"first-frame text must be 2-5 words; found {words}")
        if not contains_any(combined, LOCAL_TERMS) and city not in combined.lower():
            row_blockers.append("first frame lacks city/neighborhood context")
        if not contains_any(combined, PROOF_TERMS):
            row_blockers.append("first frame lacks a proof-object label")
        if "skyline" in proof_visual.lower() and not contains_any(proof_visual, PROOF_TERMS):
            row_blockers.append("generic skyline-only proof visual is not allowed")
        if len(hook) > 120:
            row_blockers.append("hook is too long for muted autoplay")
        overlay = overlay_exists(root, video_id, int(item.get("index") or 0), "first")
        overlay_status = "present" if overlay.exists() and overlay.stat().st_size > 0 else "pending"
        blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "first_frame_text": first_frame_text,
                "proof_visual": proof_visual,
                "overlay_path": display_path(overlay),
                "overlay_status": overlay_status,
                "status": "pass" if not row_blockers else "blocked",
                "blockers": row_blockers,
            }
        )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "overlay_checks_status": "pending" if any(row["overlay_status"] == "pending" for row in rows) else "pass",
        "shorts": rows,
    }
    sections = [
        (
            "First Frames",
            [
                f"- Short {row['index']}: {row['status']} — text='{row['first_frame_text']}' proof='{row['proof_visual']}' overlay={row['overlay_status']}"
                for row in rows
            ],
        ),
        ("Muted Autoplay", ["- Text/proof/local checks pass before render; overlay PNG checks remain pending until overlays exist."]),
    ]
    return write_report(video_id, "shorts-first-frame-quality-report", "Pattern Lab Shorts First-Frame Quality Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts first-frame and muted-autoplay quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_first_frame_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"First-frame quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
