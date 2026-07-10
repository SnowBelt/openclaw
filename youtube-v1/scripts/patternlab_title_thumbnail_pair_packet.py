#!/usr/bin/env python3
"""Build a local title + thumbnail pair packet for owner review / future YouTube tests."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now
from patternlab_owner_rating_learning import build_owner_rating_learning_report
from patternlab_poster_depth_renderer import build_poster_depth_package

TITLE_OPTIONS = {
    "poster_depth_01_miami_who_cut_it.jpg": {
        "title": "Who Cut Overtown? The Route Decision Miami Still Carries",
        "click_question": "Who decided the route should cut through Overtown?",
        "first_30_second_payoff": "Open on the Overtown source photo, then show the route/source-file question immediately.",
    },
    "poster_depth_02_miami_water_won.jpg": {
        "title": "The Water Won: Why Miami's Map Still Fights the Bay",
        "click_question": "Why does Miami's skyline still depend on water decisions most viewers never see?",
        "first_30_second_payoff": "Open on Biscayne Bay and explain why the waterline is the source trail, not decoration.",
    },
    "poster_depth_03_miami_almost_erased.jpg": {
        "title": "Almost Erased: Miami's Art Deco Fight Was Closer Than You Think",
        "click_question": "How close did Miami come to losing the look everyone recognizes?",
        "first_30_second_payoff": "Open on the Art Deco source photo and frame demolition versus preservation before the intro.",
    },
}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def title_options_for_video(video_id: str) -> list[str]:
    package = read_json(launch_root(video_id) / "package.json")
    metadata = package.get("upload_metadata", package)
    options = metadata.get("title_options") or []
    if isinstance(options, list) and options:
        return [str(item) for item in options]
    city = str(metadata.get("city") or metadata.get("active_city") or "This City")
    return [
        f"Who Cut {city}? The Source Trail Behind The Map",
        f"The Hidden Map Under {city}",
        f"Why {city}'s Old Photos Change The Story",
    ]


def chat_preview_by_variant(html_report: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in html_report.get("chat_delivery_artifacts", []):
        variant = str(item.get("variant_id") or "")
        if variant:
            out[variant] = str(item.get("chat_preview_path") or item.get("path") or "")
    return out


def variants_from_html_renderer(video_id: str, html_report: dict[str, Any]) -> list[dict[str, Any]]:
    titles = title_options_for_video(video_id)
    chat_previews = chat_preview_by_variant(html_report)
    angle_labels = ["emotional_mystery", "map_system_proof", "contrarian_history_angle"]
    variants: list[dict[str, Any]] = []
    first30_rows = html_report.get("first_30_second_payoff_report", {}).get("rows", [])
    for index, entry in enumerate(html_report.get("entries", [])[:3], start=1):
        variant_id = str(entry.get("variant_id") or f"chrome_thumb_{index:02d}")
        payoff_row = first30_rows[index - 1] if index - 1 < len(first30_rows) else {}
        variants.append(
            {
                "variant": chr(64 + index),
                "angle": angle_labels[index - 1] if index - 1 < len(angle_labels) else "alternate_hook",
                "title": titles[index - 1] if index - 1 < len(titles) else titles[0],
                "thumbnail_file": entry.get("path", ""),
                "chat_preview_file": chat_previews.get(variant_id, ""),
                "thumbnail_label": variant_id,
                "city_name_present": True,
                "hero_object": entry.get("proof_object", entry.get("topic_source_match", {}).get("proof_object", "")),
                "source_title": Path(str(entry.get("source_image", ""))).stem,
                "source_url": "rights-ledgered-local-source",
                "topic_source_match_status": entry.get("topic_source_match_status", "missing"),
                "selected_source_rank": entry.get("selected_source_rank", 999),
                "click_question": entry.get("main_text", "missing"),
                "first_30_second_payoff": payoff_row.get("matched_text", "") or "Open with the promised source proof in the first 30 seconds.",
                "first_30_second_payoff_status": payoff_row.get("status", html_report.get("first_30_second_payoff_status", "missing")),
                "watch_time_test_note": "Future YouTube Test & Compare should compare title+thumbnail by watch time first, then CTR and retention.",
                "public_youtube_mutation": "not_performed",
            }
        )
    return variants


def build_pair_packet(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    html_report = read_json(approval / "html-thumbnail-renderer-report.json")
    owner, owner_json, _owner_md = build_owner_rating_learning_report(video_id)
    poster: dict[str, Any] = {}
    poster_json = approval / "thumbnail-poster-depth-renderer-report.json"
    if html_report.get("status") == "pass" or html_report.get("html_renderer_status") == "pass":
        variants = variants_from_html_renderer(video_id, html_report)
    else:
        poster, poster_json, _poster_md = build_poster_depth_package(video_id)
        variants = []
        for index, entry in enumerate(poster.get("entries", []), start=1):
            file_name = str(entry.get("file", ""))
            title = TITLE_OPTIONS.get(file_name, {})
            variants.append(
                {
                    "variant": chr(64 + index),
                    "angle": ["emotional_mystery", "map_system_proof", "contrarian_history_angle"][min(index - 1, 2)],
                    "title": title.get("title", "Pattern Lab city file title pending"),
                    "thumbnail_file": entry.get("path", ""),
                    "chat_preview_file": "",
                    "thumbnail_label": file_name,
                    "city_name_present": entry.get("city_name_present", False),
                    "hero_object": entry.get("hero_object", ""),
                    "source_title": entry.get("source_title", ""),
                    "source_url": entry.get("source_url", ""),
                    "topic_source_match_status": "fallback_not_available",
                    "selected_source_rank": 999,
                    "click_question": title.get("click_question", "missing"),
                    "first_30_second_payoff": title.get("first_30_second_payoff", "missing"),
                    "first_30_second_payoff_status": "fallback_not_available",
                    "watch_time_test_note": "Future YouTube Test & Compare should compare title+thumbnail by watch time first, then CTR and retention.",
                    "public_youtube_mutation": "not_performed",
                }
            )
    blockers: list[str] = []
    if html_report:
        if html_report.get("status") != "pass":
            blockers.append("html_renderer_not_pass")
        if html_report.get("chat_delivery_surface_status") != "pass":
            blockers.append("chat_delivery_surface_not_pass")
        if html_report.get("topic_source_match_status") != "pass":
            blockers.append("topic_source_match_not_pass")
        if html_report.get("first_30_second_payoff_status") != "pass":
            blockers.append("first_30_second_payoff_not_pass")
    elif poster.get("status") != "pass":
        blockers.append("poster_depth_renderer_not_pass")
    if owner.get("status") != "pass":
        blockers.append("owner_rating_memory_not_pass")
    if len(variants) != 3:
        blockers.append(f"variant_count_not_three:{len(variants)}")
    if any(not item.get("city_name_present") for item in variants):
        blockers.append("city_name_missing_in_variant")
    if any(not item.get("chat_preview_file") for item in variants) and html_report:
        blockers.append("chat_preview_missing_in_variant")
    if any(item.get("first_30_second_payoff") == "missing" for item in variants):
        blockers.append("first_30_second_payoff_missing")
    if any(item.get("topic_source_match_status") not in {"pass", "fallback_not_available"} for item in variants):
        blockers.append("topic_source_match_missing_or_blocked")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "title_thumbnail_pair_packet_status": "pass" if not blockers else "blocked",
        "variant_count": len(variants),
        "variant_angles": [item.get("angle", "") for item in variants],
        "default_winner_variant": variants[0]["variant"] if variants else "",
        "youtube_native_test_ready": "owner_review_ready_no_upload" if not blockers else "blocked",
        "decision_metric": "watch_time_share_first_then_ctr_and_retention_after_owner_approved_public_test",
        "poster_depth_report": display_path(poster_json),
        "owner_rating_report": display_path(owner_json),
        "html_renderer_report": display_path(approval / "html-thumbnail-renderer-report.json") if html_report else "",
        "variants": variants,
        "blockers": blockers,
        "public_youtube_mutation": "not_performed",
        "upload_or_replacement": "not_performed",
        "paid_tools": "not_used",
    }
    json_report = approval / "title-thumbnail-pair-packet.json"
    md_report = approval / "title-thumbnail-pair-packet.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Title + Thumbnail Pair Packet: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "Public YouTube mutation: not performed",
        "Decision metric: watch-time winner after owner-approved public test",
        "",
        "## Variants",
        "",
    ]
    for item in variants:
        preview = item.get("chat_preview_file") or "missing"
        lines.append(
            f"- {item['variant']} ({item.get('angle', 'missing')}): {item['title']} | thumbnail={display_path(Path(item['thumbnail_file']))} | chat_preview={preview} | payoff={item['first_30_second_payoff']}"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab title + thumbnail pair packet.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_pair_packet(args.video_id)
    print(json.dumps({"status": payload["status"], "variant_count": payload["variant_count"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
