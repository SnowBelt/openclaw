#!/usr/bin/env python3
"""Create reviewed toggleable captions without burning narration into video."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, output_root, utc_now


CORRECTIONS = (
    ("the live neighborhood", "the lived neighborhood"),
    ("close to Greshet", "close to Gratiot"),
    ("a black neighborhood", "a Black neighborhood"),
    ("black Detroiters", "Black Detroiters"),
    ("black-owned businesses", "Black-owned businesses"),
    ("black owned businesses", "Black-owned businesses"),
    ("black performers", "Black performers"),
    ("black economy", "Black economy"),
    ("black cultural district", "Black cultural district"),
    ("a black cultural", "a Black cultural"),
    ("Hasting Street", "Hastings Street"),
    ("gets noticed to leave", "gets notice to leave"),
    ("Brewster Douglas", "Brewster-Douglass"),
    ("Jeffery's Homes", "Jeffries Homes"),
)


def parse_timestamp(value: str) -> float:
    hours, minutes, tail = value.split(":")
    seconds, millis = tail.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def build(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    source = root / "captions" / "word-aligned.srt"
    target = root / "captions" / "closed-captions-final.srt"
    report_path = approval / "closed-captions-report.json"
    md_path = approval / "closed-captions-report.md"
    blockers: list[str] = []
    applied: list[dict] = []
    if not source.is_file():
        blockers.append("word_aligned_caption_source_missing")
        text = ""
    else:
        text = source.read_text(encoding="utf-8", errors="replace")
    for old, new in CORRECTIONS:
        count = text.count(old)
        if count:
            text = text.replace(old, new)
            applied.append({"from": old, "to": new, "count": count})
    blocks = re.split(r"\n\s*\n", text.strip()) if text.strip() else []
    previous_end = 0.0
    for index, block in enumerate(blocks, start=1):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timing = next((line for line in lines if " --> " in line), "")
        if not timing:
            blockers.append(f"caption_timing_missing:{index}")
            continue
        try:
            start_raw, end_raw = timing.split(" --> ", 1)
            start = parse_timestamp(start_raw)
            end = parse_timestamp(end_raw)
        except (TypeError, ValueError):
            blockers.append(f"caption_timing_invalid:{index}")
            continue
        if end <= start or start + 0.001 < previous_end:
            blockers.append(f"caption_timing_overlap_or_reverse:{index}")
        previous_end = end
    forbidden = [old for old, _ in CORRECTIONS if old in text]
    if forbidden:
        blockers.extend(f"caption_known_transcription_error_remaining:{value}" for value in forbidden)
    if text:
        target.write_text(text.rstrip() + "\n", encoding="utf-8")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "caption_mode": "toggleable_closed_captions",
        "source": display_path(source),
        "source_sha256": sha256_file(source) if source.is_file() else "",
        "output": display_path(target),
        "output_sha256": sha256_file(target) if target.is_file() else "",
        "caption_count": len(blocks),
        "corrections": applied,
        "burned_in_full_narration": False,
        "selective_editorial_text_allowed": True,
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Closed Captions: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                "Mode: toggleable closed captions; full narration is not burned into the long-form pixels.",
                f"Caption cues: {len(blocks)}",
                f"Corrections: {sum(row['count'] for row in applied)}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, report_path, target


def main() -> None:
    parser = argparse.ArgumentParser(description="Build reviewed Pattern Lab toggleable closed captions.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
