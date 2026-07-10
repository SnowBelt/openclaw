#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import (
    GENERIC_COMMENT_PROMPTS,
    SOURCE_LEAD_TERMS,
    contains_any,
    minimum_script_package_ok,
    read_json,
    script_items,
    script_package,
    short_ref,
    write_report,
)


def build_engagement_loop_report(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    upload_plan = root / "approval" / "shorts-upload-plan.md"
    upload_plan_text = upload_plan.read_text(encoding="utf-8") if upload_plan.exists() else ""
    blockers = minimum_script_package_ok(package)
    warnings: list[str] = []
    rows = []
    if not upload_plan.exists():
        blockers.append(f"Shorts upload plan is missing: {display_path(upload_plan)}.")
    for item in script_items(package):
        comment_prompt = str(item.get("comment_prompt") or "")
        bridge = str(item.get("bridge_to_long_form") or "")
        payoff = str(item.get("payoff") or "")
        related = str(item.get("related_video_promise") or "")
        row_blockers = []
        if not contains_any(comment_prompt, SOURCE_LEAD_TERMS):
            row_blockers.append("comment prompt lacks local source-lead terms")
        if any(term in comment_prompt.lower() for term in GENERIC_COMMENT_PROMPTS):
            row_blockers.append("generic comment prompt is blocked")
        if "full" not in bridge.lower() and "long-form" not in bridge.lower():
            row_blockers.append("long-form bridge is missing")
        if not related:
            row_blockers.append("Related Video promise is missing")
        if not payoff or not payoff.strip().endswith("."):
            row_blockers.append("loop-friendly payoff sentence is missing")
        if upload_plan_text and "Related-video checklist:" not in upload_plan_text:
            row_blockers.append("upload plan lacks Related Video checklist")
        blockers.extend(f"{short_ref(item)}: {blocker}." for blocker in row_blockers)
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "comment_prompt": comment_prompt,
                "bridge_to_long_form": bridge,
                "related_video_promise": related,
                "loop_friendly_ending": payoff,
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
        "upload_plan": display_path(upload_plan),
        "public_youtube_mutation": "not_performed",
        "youtube_comments_pins_related_video_changes": "not_performed; exact owner approval required",
        "shorts": rows,
    }
    sections = [
        (
            "Engagement Loops",
            [
                f"- Short {row['index']}: {row['status']} — source prompt + bridge + related-video checklist"
                for row in rows
            ],
        ),
        ("Public Mutation Boundary", ["- No comment, pin, Related Video, upload, or publish action was performed."]),
    ]
    return write_report(video_id, "shorts-engagement-loop-report", "Pattern Lab Shorts Engagement Loop Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts engagement loop and source-lead prompts.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_engagement_loop_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Engagement loop report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
