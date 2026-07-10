#!/usr/bin/env python3
"""Reject production directions accidentally left in finished narration."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


PATTERNS = {
    "editorial_instruction": re.compile(
        r"\b(show on screen|the narration says|the visual should|the visual payoff|the editor should|the video should|this section needs|put this on screen)\b",
        re.IGNORECASE,
    ),
    "meta_visual_critique": re.compile(
        r"\bgeneric skyline would fail\b",
        re.IGNORECASE,
    ),
}


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    lines = script.read_text(encoding="utf-8").splitlines() if script.exists() else []
    hits = []
    for line_number, line in enumerate(lines, 1):
        for label, pattern in PATTERNS.items():
            if pattern.search(line):
                hits.append({"line": line_number, "rule": label, "excerpt": line.strip()})
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if script.exists() and not hits else "blocked",
        "script": display_path(script),
        "hits": hits,
        "blockers": [] if script.exists() and not hits else ["finished narration contains editorial or production directions"],
        "youtube_mutation": "not_performed",
    }
    approval = ensure_dir(output_root(video_id) / "approval")
    json_path = approval / "transcript-editorial-quality-report.json"
    md_path = approval / "transcript-editorial-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Transcript Editorial Quality: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                "",
                "## Findings",
                "",
                *([f"- line {hit['line']} [{hit['rule']}]: {hit['excerpt']}" for hit in hits] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")


if __name__ == "__main__":
    main()
