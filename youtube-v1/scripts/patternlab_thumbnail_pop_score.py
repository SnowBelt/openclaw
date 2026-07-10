#!/usr/bin/env python3
"""Score Pattern Lab thumbnails for reference-level visual pop and click promise."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_thumbnail_reference_analyzer import build_reference_anatomy_report


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def collect_thumbnail_entries(root: Path) -> list[dict[str, Any]]:
    summary = read_json(root / "approval" / "miami-photo-backed-thumbnail-report.json")
    entries: list[dict[str, Any]] = []
    for topic in summary.get("reports", []):
        if not isinstance(topic, dict):
            continue
        for entry in topic.get("entries", []):
            if isinstance(entry, dict):
                combined = dict(entry)
                combined["topic_id"] = topic.get("id", "")
                combined["topic_title"] = topic.get("title", "")
                combined["click_question"] = topic.get("click_question", "")
                entries.append(combined)
    return entries


def score_entry(entry: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    score = 0.0
    if entry.get("city_name_present") is True:
        score += 1.4
    else:
        reasons.append("city_name_missing")
    if entry.get("real_photo_backed") is True:
        score += 1.4
    else:
        reasons.append("real_photo_missing")
    if entry.get("random_arrows_used") is False:
        score += 1.0
    else:
        reasons.append("random_arrow")
    if str(entry.get("intentionality_status")) == "pass":
        score += 1.2
    else:
        reasons.append("intentionality_failed")
    if str(entry.get("source_photo_tag_match")) == "pass":
        score += 1.1
    else:
        reasons.append("source_photo_tag_mismatch")
    if str(entry.get("main_title_font_family", "")).strip() and entry.get("impact_fallback_used") is False:
        score += 1.1
    else:
        reasons.append("font_not_premium")
    click_score = float(entry.get("click_score", 0) or 0)
    score += min(2.2, max(0.0, click_score / 10.0 * 2.2))
    title_promise = str(entry.get("title_thumbnail_promise", "")).strip()
    if len(title_promise) >= 20:
        score += 0.8
    else:
        reasons.append("title_thumbnail_promise_missing")
    tags = entry.get("source_tags", []) if isinstance(entry.get("source_tags"), list) else []
    if tags:
        score += 0.8
    else:
        reasons.append("source_tags_missing")
    final = round(min(10.0, score), 2)
    return {
        "file": entry.get("file", "missing"),
        "path": entry.get("path", "missing"),
        "topic_id": entry.get("topic_id", ""),
        "topic_title": entry.get("topic_title", ""),
        "score": final,
        "status": "pass" if final >= 8.0 and not reasons else "blocked",
        "reasons": reasons,
        "city_name_present": bool(entry.get("city_name_present")),
        "real_photo_backed": bool(entry.get("real_photo_backed")),
        "source_tags": tags,
        "main_title_font_family": entry.get("main_title_font_family", ""),
    }


def build_pop_score_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    anatomy, anatomy_json, _anatomy_md = build_reference_anatomy_report(video_id)
    entries = collect_thumbnail_entries(root)
    scored = [score_entry(entry) for entry in entries]
    scores = [float(item["score"]) for item in scored]
    failing = [item for item in scored if item["status"] != "pass"]
    heuristic_status = "pass" if scored and not failing and min(scores) >= 8.0 else "blocked"
    reference_available = anatomy.get("reference_anatomy_status") == "pass"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if reference_available and heuristic_status == "pass" else "blocked_missing_owner_reference_images" if not reference_available else "blocked",
        "openclaw_heuristic_status": heuristic_status,
        "reference_match_score_status": "pass" if reference_available else "blocked_missing_owner_reference_images",
        "reference_anatomy_report": display_path(anatomy_json),
        "thumbnail_count": len(scored),
        "average_pop_score": round(mean(scores), 2) if scores else 0,
        "minimum_pop_score": min(scores) if scores else 0,
        "pass_threshold": 8.0,
        "failing_count": len(failing),
        "blocked_by_missing_owner_references": not reference_available,
        "copy_boundary": "Reference matching compares principles only. It must not copy reference thumbnails.",
        "entries": scored,
        "blockers": ["blocked_missing_owner_reference_images"] if not reference_available else [f"{item['file']}:{','.join(item['reasons'])}" for item in failing],
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
    }
    json_report = approval / "thumbnail-pop-score-report.json"
    md_report = approval / "thumbnail-pop-score-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Thumbnail Pop Score: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"OpenClaw heuristic status: {payload['openclaw_heuristic_status']}",
        f"Reference match status: {payload['reference_match_score_status']}",
        f"Average score: {payload['average_pop_score']}/10",
        f"Minimum score: {payload['minimum_pop_score']}/10",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
    ]
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab thumbnail reference/pop score report.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_pop_score_report(args.video_id)
    print(json.dumps({"status": payload["status"], "openclaw_heuristic_status": payload["openclaw_heuristic_status"], "reference_match_score_status": payload["reference_match_score_status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
