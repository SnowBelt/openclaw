#!/usr/bin/env python3
"""Generate no-network research briefs for queued Pattern Lab topics."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, utc_now
from patternlab_topic_qualification_queue import build_topic_qualification_queue


OUTPUT_ROOT = BASE / "local-output" / "operations" / "topic-research"


def write_brief(row: dict[str, Any]) -> tuple[Path, Path]:
    video_id = row["video_id"]
    city = str(row.get("city") or "").strip()
    blockers = [*row.get("topic_blockers", []), *row.get("source_pack_blockers", [])]
    providers = [
        "Library of Congress", "National Archives", "Wikimedia Commons (commercial-use-compatible only)",
        f"{city} public library/local history collection (rights clear only)",
        f"{city} historical society or city archive (research only unless image rights are explicit)",
    ]
    required_assets = [
        "opening proof map or document", "neighborhood/street map", "historical place photo", "human-consequence document", "system/route map", "then-and-now comparison", "modern context clip", "source card with rights basis",
    ]
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "city": city, "working_title": row.get("working_title"),
        "status": "research_required", "topic_score": row.get("topic_score"),
        "current_blockers": blockers, "research_sources_to_search": providers,
        "required_visual_evidence": required_assets,
        "promotion_gate": [
            "Narrow one hidden-history question before scripting.",
            "Create rights-ledger rows for every prospective asset.",
            "Build a source pack with at least eight relevant assets from at least two providers.",
            "Pass claim-to-visual fidelity before video assembly.",
        ],
        "not_performed": ["web research", "paid calls", "media generation", "YouTube mutation"],
    }
    root = ensure_dir(OUTPUT_ROOT / f"video-{video_id}")
    json_path, md_path = root / "research-brief.json", root / "research-brief.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Pattern Lab Research Brief: Video {video_id}", "", f"Title: {payload['working_title']}", f"Generated: {payload['generated_at']}", "", "## Current Blockers", ""]
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    lines.extend(["", "## Required Visual Evidence", ""] + [f"- {item}" for item in required_assets])
    lines.extend(["", "## Promotion Gate", ""] + [f"- {item}" for item in payload["promotion_gate"]])
    lines.extend(["", "No web research, paid calls, media generation, or YouTube mutation was performed.", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create no-network briefs for Pattern Lab research-queue topics.")
    parser.add_argument("--video-id", help="Optional zero-padded topic id; default processes all research-queue topics.")
    args = parser.parse_args()
    queue, _, _ = build_topic_qualification_queue()
    rows = [row for row in queue["rows"] if row["topic_status"] == "research_queue"]
    if args.video_id:
        rows = [row for row in rows if row["video_id"] == str(args.video_id).zfill(2)]
    if not rows:
        raise SystemExit("No research-queue topic matched. Nothing was generated.")
    for row in rows:
        _, path = write_brief(row)
        print(f"Research brief: {display_path(path)}")
    print("YouTube mutation: not performed")


if __name__ == "__main__":
    main()
