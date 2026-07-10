#!/usr/bin/env python3
"""Build a local Shorts follow-up packet for a Pattern Lab long-form package."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_comment_prompts import city_source_lead_comment
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def launch_metadata(video_id: str) -> dict[str, Any]:
    package = read_json(launch_root(video_id) / "package.json")
    return package.get("upload_metadata", package)


def default_short_rows(video_id: str, city: str) -> list[dict[str, str]]:
    return [
        {
            "id": f"{video_id}-short-01",
            "title": f"The Hidden Map Under {city}",
            "hook": f"One {city} map changes the story.",
            "pinned_comment": city_source_lead_comment(city),
            "related_video_instruction": "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio.",
        },
        {
            "id": f"{video_id}-short-02",
            "title": f"What Old {city} Photos Reveal",
            "hook": f"Old {city} photos show the proof before the myth.",
            "pinned_comment": city_source_lead_comment(city),
            "related_video_instruction": "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio.",
        },
        {
            "id": f"{video_id}-short-03",
            "title": f"Why {city}'s Streets Changed",
            "hook": f"The street clue explains what changed in {city}.",
            "pinned_comment": city_source_lead_comment(city),
            "related_video_instruction": "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio.",
        },
        {
            "id": f"{video_id}-short-04",
            "title": f"The Hidden System Behind {city}",
            "hook": f"A visible {city} clue points to the system underneath.",
            "pinned_comment": city_source_lead_comment(city),
            "related_video_instruction": "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio.",
        },
        {
            "id": f"{video_id}-short-05",
            "title": f"The {city} Place That Vanished",
            "hook": f"One vanished {city} place changes the whole story.",
            "pinned_comment": city_source_lead_comment(city),
            "related_video_instruction": "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio.",
        },
    ]


def normalize_short(row: dict[str, Any], video_id: str, city: str, index: int) -> dict[str, Any]:
    related = row.get("related_video_instruction") or row.get("related_video_checklist") or "After the long-form URL exists, set this Short's Related Video to the long-form episode in YouTube Studio."
    return {
        "id": str(row.get("id") or f"{video_id}-short-{index:02d}"),
        "title": str(row.get("title") or f"{city} Source Clue #{index}"),
        "hook": str(row.get("hook") or row.get("related_video_promise") or "Source proof connects this Short to the long-form episode."),
        "pinned_comment": str(row.get("pinned_comment") or city_source_lead_comment(city)),
        "related_video_instruction": str(related),
        "points_back_to_long_form_after_url_exists": True,
        "upload_or_publish": "not_performed",
    }


def build_shorts_followup_packet(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    metadata = launch_metadata(video_id)
    city = str(metadata.get("city") or metadata.get("active_city") or "the city")
    default_rows = default_short_rows(video_id, city)
    shorts = list(metadata.get("shorts") or [])
    if len(shorts) < 5:
        shorts.extend(default_rows[len(shorts):])
    rows = [normalize_short(row, video_id, city, index) for index, row in enumerate(shorts[:5], start=1)]
    blockers: list[str] = []
    if len(rows) < 3:
        blockers.append(f"shorts_count_below_minimum:{len(rows)}")
    if len(rows) > 5:
        blockers.append(f"shorts_count_above_maximum:{len(rows)}")
    for row in rows:
        if not row.get("title"):
            blockers.append(f"{row['id']}:missing_title")
        if not row.get("hook"):
            blockers.append(f"{row['id']}:missing_hook")
        if not row.get("pinned_comment"):
            blockers.append(f"{row['id']}:missing_pinned_comment")
        if "Related Video" not in row.get("related_video_instruction", ""):
            blockers.append(f"{row['id']}:missing_related_video_instruction")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "pass" if not blockers else "blocked",
        "shorts_followup_packet_status": "pass" if not blockers else "blocked",
        "shorts_count": len(rows),
        "minimum_shorts_count": 3,
        "maximum_shorts_count": 5,
        "long_form_url_status": "pending_until_private_or_public_upload_exists",
        "public_youtube_mutation": "not_performed",
        "upload_or_publish": "not_performed",
        "thumbnail_replacement": "not_performed",
        "shorts": rows,
        "blockers": blockers,
    }
    json_path = approval / "shorts-followup-packet.json"
    md_path = approval / "shorts-followup-packet.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Shorts Follow-Up Packet: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {city}",
        "Upload/publish: not_performed",
        "Related-video rule: connect each Short to the long-form episode after the long-form URL exists.",
        "",
        "## Shorts",
        "",
    ]
    for row in rows:
        lines.extend(
            [
                f"### {row['id']}",
                f"- Title: {row['title']}",
                f"- Hook: {row['hook']}",
                f"- Pinned comment: {row['pinned_comment']}",
                f"- Related-video instruction: {row['related_video_instruction']}",
                "",
            ]
        )
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab Shorts follow-up packet.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, json_path, _md_path = build_shorts_followup_packet(args.video_id)
    print(json.dumps({"status": payload["status"], "shorts_count": payload["shorts_count"], "report": display_path(json_path)}, indent=2))


if __name__ == "__main__":
    main()
