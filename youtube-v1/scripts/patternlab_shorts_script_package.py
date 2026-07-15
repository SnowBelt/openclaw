#!/usr/bin/env python3
"""Build and validate standalone Pattern Lab Shorts scripts.

The goal is to stop Shorts from starting mid-sentence or existing only as weak
trailers. This script creates a deterministic micro-story package from the
long-form transcript and scores each candidate before rendering.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

import patternlab_script_bootstrap  # noqa: F401

from patternlab.city import CityContractError, require_city
from patternlab_comment_prompts import city_source_lead_comment
from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, read_text, strip_markdown_for_voiceover, utc_now

MIN_SCORE = 93
MIN_SECONDS = 25
MAX_SECONDS = 45
WORDS_PER_SECOND = 2.55
TARGET_SHORT_COUNT = 5
MAX_VISUAL_EVENT_SECONDS = 2.25
ENDING_BRIDGE_SECONDS = 2.4
CONTEXT_DEPENDENT_STARTS = (
    "that ",
    "this ",
    "these ",
    "those ",
    "but ",
    "and ",
    "so ",
    "then ",
    "now ",
    "it ",
    "they ",
    "there ",
    "here ",
)
TRAILER_ONLY_TERMS = (
    "subscribe for",
    "next pattern lab",
    "watch the full",
    "full city file",
    "this episode",
    "in this video",
    "i am james",
    "this is pattern lab",
    "by the end",
    "we study american cities",
    "maps, archives, photographs",
)
PROOF_TERMS = ("map", "proof", "source", "ledger", "evidence", "archive", "photo", "document", "street", "business")
PAYOFF_TERMS = ("shows", "means", "matters", "changed", "proves", "because", "not just", "never just")
REQUIRED_BLUEPRINT_FIELDS = (
    "title",
    "viewer_psychology",
    "first_frame_text",
    "hook",
    "proof_visual",
    "payoff",
    "source_keywords",
    "narration_sentences",
    "source_assets",
    "proof_label",
)


def clean_script(video_id: str) -> str:
    path = launch_root(video_id) / "final-script.md"
    return strip_markdown_for_voiceover(read_text(path)) if path.exists() else ""


def episode_package(video_id: str) -> dict[str, Any]:
    package_path = launch_root(video_id) / "package.json"
    try:
        value = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def infer_city(video_id: str) -> str:
    package = episode_package(video_id)
    metadata = package.get("upload_metadata") if isinstance(package.get("upload_metadata"), dict) else {}
    return require_city(
        package.get("city") or metadata.get("city") or metadata.get("active_city"),
        source=f"video_{video_id}_package",
    )


def episode_local_terms(video_id: str, package: dict[str, Any], city: str) -> tuple[str, ...]:
    evidence_path = launch_root(video_id) / "evidence-queries.json"
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        evidence = {}
    values = [city]
    for source in (package.get("local_terms", []), evidence.get("required_entity_terms", [])):
        if isinstance(source, list):
            values.extend(str(item).strip() for item in source if str(item).strip())
    return tuple(dict.fromkeys(item.casefold() for item in values if item))


def short_blueprints(package: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    rows = package.get("shorts_blueprints")
    blockers: list[str] = []
    if not isinstance(rows, list):
        return [], ["episode_shorts_blueprints_missing"]
    blueprints: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            blockers.append(f"short_blueprint_{index}:not_object")
            continue
        normalized = dict(row)
        normalized.setdefault("id_suffix", f"short-{index:02d}")
        missing = [field for field in REQUIRED_BLUEPRINT_FIELDS if not normalized.get(field)]
        if missing:
            blockers.extend(f"short_blueprint_{index}:missing_{field}" for field in missing)
        if not isinstance(normalized.get("source_keywords"), list) or len(normalized.get("source_keywords", [])) < 2:
            blockers.append(f"short_blueprint_{index}:source_keywords_below_two")
        if not isinstance(normalized.get("narration_sentences"), list) or len(normalized.get("narration_sentences", [])) < 2:
            blockers.append(f"short_blueprint_{index}:narration_sentences_below_two")
        duration = estimate_duration([str(item) for item in normalized.get("narration_sentences", [])])
        minimum_assets = max(4, math.ceil((duration + ENDING_BRIDGE_SECONDS) / MAX_VISUAL_EVENT_SECONDS))
        if not isinstance(normalized.get("source_assets"), list) or len(set(normalized.get("source_assets", []))) < minimum_assets:
            blockers.append(
                f"short_blueprint_{index}:distinct_source_assets_below_visual_event_floor:"
                f"{len(set(normalized.get('source_assets', [])))}/{minimum_assets}"
            )
        blueprints.append(normalized)
    if not 3 <= len(blueprints) <= 5:
        blockers.append(f"episode_shorts_blueprint_count_outside_3_5:{len(blueprints)}")
    return blueprints, blockers


def sentence_rows(text: str) -> list[dict[str, Any]]:
    sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]
    rows: list[dict[str, Any]] = []
    cursor = 0.0
    for index, sentence in enumerate(sentences):
        word_count = len(re.findall(r"[A-Za-z0-9']+", sentence))
        duration = max(1.5, word_count / WORDS_PER_SECOND)
        rows.append({"index": index, "text": sentence, "start": cursor, "end": cursor + duration, "words": word_count})
        cursor += duration
    return rows


def find_anchor(rows: list[dict[str, Any]], keywords: list[str]) -> dict[str, Any] | None:
    scored = []
    for row in rows:
        lower = row["text"].lower()
        score = sum(10 for keyword in keywords if keyword in lower)
        score += sum(2 for term in PROOF_TERMS if term in lower)
        if score:
            scored.append((score, row))
    if not scored:
        return None
    return sorted(scored, key=lambda item: (item[0], -item[1]["index"]), reverse=True)[0][1]


def supporting_sentences(rows: list[dict[str, Any]], anchor: dict[str, Any] | None, max_sentences: int = 4) -> list[str]:
    if anchor is None:
        return []
    start = max(0, anchor["index"] - 1)
    candidates = rows[start : min(len(rows), anchor["index"] + max_sentences)]
    selected = []
    for row in candidates:
        sentence = row["text"].strip()
        lower = sentence.lower()
        if any(term in lower for term in TRAILER_ONLY_TERMS):
            continue
        if selected and sentence.lower() == selected[-1].lower():
            continue
        selected.append(sentence)
        if len(selected) >= max_sentences:
            break
    return selected


def estimate_duration(script_lines: list[str]) -> float:
    words = sum(len(re.findall(r"[A-Za-z0-9']+", line)) for line in script_lines)
    return words / WORDS_PER_SECOND


def context_dependent_opening(text: str) -> bool:
    lower = text.strip().lower()
    return lower.startswith(CONTEXT_DEPENDENT_STARTS)


def score_short(item: dict[str, Any], local_terms: tuple[str, ...]) -> tuple[int, dict[str, int], list[str]]:
    text = " ".join(item.get(key, "") for key in ["hook", "script", "payoff", "proof_visual", "bridge_to_long_form", "comment_prompt"]).lower()
    blockers = []
    breakdown = {
        "hook_clarity": 20,
        "standalone_story": 20,
        "proof_object_visible": 15,
        "payoff_strength": 15,
        "local_specificity": 10,
        "visual_motion_readability": 10,
        "long_form_bridge": 5,
        "comment_source_lead_prompt": 5,
    }
    if not item.get("hook") or context_dependent_opening(item.get("hook", "")):
        breakdown["hook_clarity"] = 0
        blockers.append("hook is missing or context-dependent")
    if any(term in item.get("hook", "").lower() for term in TRAILER_ONLY_TERMS):
        breakdown["standalone_story"] = min(breakdown["standalone_story"], 5)
        blockers.append("hook is trailer-only")
    if any(term in item.get("script", "").lower() for term in TRAILER_ONLY_TERMS):
        breakdown["standalone_story"] = min(breakdown["standalone_story"], 8)
        blockers.append("script contains long-form intro, trailer, or subscribe-only language")
    if not any(term in text for term in PROOF_TERMS):
        breakdown["proof_object_visible"] = 0
        blockers.append("no visible proof object")
    if not any(term in text for term in PAYOFF_TERMS):
        breakdown["payoff_strength"] = 5
        blockers.append("payoff is weak or missing")
    if not any(term in text for term in local_terms):
        breakdown["local_specificity"] = 3
        blockers.append("local specificity is weak")
    if len(item.get("first_frame_text", "").split()) > 4:
        breakdown["visual_motion_readability"] = 6
        blockers.append("first-frame text should be 2-4 words")
    if "full" not in item.get("bridge_to_long_form", "").lower() and "long" not in item.get("bridge_to_long_form", "").lower():
        breakdown["long_form_bridge"] = 0
        blockers.append("long-form bridge missing")
    if "leave the name" not in item.get("comment_prompt", "").lower():
        breakdown["comment_source_lead_prompt"] = 0
        blockers.append("source-lead comment prompt missing")
    duration = float(item.get("duration_seconds") or 0)
    if duration < MIN_SECONDS or duration > MAX_SECONDS:
        blockers.append(f"duration outside {MIN_SECONDS}-{MAX_SECONDS}s: {duration:.1f}s")
        breakdown["standalone_story"] = min(breakdown["standalone_story"], 10)
    score = sum(breakdown.values())
    return score, breakdown, blockers


def build_short_item(
    video_id: str,
    city: str,
    template: dict[str, Any],
    rows: list[dict[str, Any]],
    index: int,
    local_terms: tuple[str, ...],
) -> dict[str, Any]:
    anchor = find_anchor(rows, list(template["source_keywords"]))
    lines = [str(item).strip() for item in template.get("narration_sentences", []) if str(item).strip()]
    normalized_script_sentences = {" ".join(norm.lower().split()) for norm in (row["text"] for row in rows)}
    missing_sentences = [line for line in lines if " ".join(line.lower().split()) not in normalized_script_sentences]
    comment_prompt = city_source_lead_comment(city)
    item = {
        "id": f"{video_id}-{template['id_suffix']}",
        "index": index,
        "title": template["title"],
        "viewer_psychology": template["viewer_psychology"],
        "first_frame_text": template["first_frame_text"],
        "hook": template["hook"],
        "script": " ".join(lines),
        "script_lines": lines,
        "narration_sentences": lines,
        "source_assets": list(template.get("source_assets", [])),
        "proof_label": template.get("proof_label", ""),
        "proof_visual": template["proof_visual"],
        "payoff": template["payoff"],
        "comment_prompt": comment_prompt,
        "bridge_to_long_form": "Full city file on Pattern Lab: the long-form video shows the complete source trail.",
        "related_video_promise": "The full video shows the map, sources, and hidden system behind the story.",
        "start_boundary": "word_aligned_complete_sentence",
        "end_boundary": "word_aligned_complete_sentence",
        "duration_seconds": round(estimate_duration(lines), 1),
        "source_sentence_index": anchor.get("index") if anchor else None,
        "source_excerpt": anchor.get("text") if anchor else "",
        "render_mode": "word_aligned_complete_sentences",
    }
    item["minimum_distinct_visual_assets"] = max(
        4,
        math.ceil((float(item["duration_seconds"]) + ENDING_BRIDGE_SECONDS) / MAX_VISUAL_EVENT_SECONDS),
    )
    score, breakdown, blockers = score_short(item, local_terms)
    blockers.extend(f"approved_script_sentence_missing:{sentence}" for sentence in missing_sentences)
    if lines and " ".join(template["hook"].lower().split()) != " ".join(lines[0].lower().split()):
        blockers.append("hook_must_equal_first_approved_narration_sentence")
    if len(set(item["source_assets"])) < item["minimum_distinct_visual_assets"]:
        blockers.append(
            "distinct_source_assets_below_visual_event_floor:"
            f"{len(set(item['source_assets']))}/{item['minimum_distinct_visual_assets']}"
        )
    item["score"] = score
    item["score_breakdown"] = breakdown
    item["blockers"] = blockers
    item["status"] = "pass" if score >= MIN_SCORE and not blockers else "blocked"
    return item


def build_shorts_script_package(video_id: str, target_count: int = TARGET_SHORT_COUNT) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    package = episode_package(video_id)
    package_blockers: list[str] = []
    try:
        city = infer_city(video_id)
    except CityContractError as exc:
        city = ""
        package_blockers.append(str(exc))
    templates, blueprint_blockers = short_blueprints(package)
    package_blockers.extend(blueprint_blockers)
    local_terms = episode_local_terms(video_id, package, city) if city else ()
    rows = sentence_rows(clean_script(video_id))
    shorts = [
        build_short_item(video_id, city, template, rows, index, local_terms)
        for index, template in enumerate(templates[:target_count], start=1)
    ]
    blockers = [f"{item['id']}: {blocker}" for item in shorts for blocker in item.get("blockers", [])]
    low_scores = [f"{item['id']}: score {item['score']}/100" for item in shorts if item.get("score", 0) < MIN_SCORE]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "local_terms": list(local_terms),
        "status": "pass" if not package_blockers and not blockers and not low_scores and len(shorts) >= 3 else "blocked",
        "minimum_score": MIN_SCORE,
        "shorts_count": len(shorts),
        "shorts": shorts,
        "blockers": package_blockers + blockers + low_scores,
        "public_youtube_mutation": "not_performed",
        "render_policy": "scripted Shorts are preferred; long-form cuts require sentence-boundary validation",
    }
    json_path = approval / "shorts-script-package.json"
    md_path = approval / "shorts-script-package.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Shorts Script Package: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {city}",
        "Public YouTube mutation: not_performed",
        "",
        "## Shorts",
        "",
    ]
    for item in shorts:
        lines.extend(
            [
                f"### Short {item['index']}: {item['title']}",
                f"- Status: {item['status']}",
                f"- Score: {item['score']}/100",
                f"- First-frame text: {item['first_frame_text']}",
                f"- Hook: {item['hook']}",
                f"- Proof visual: {item['proof_visual']}",
                f"- Payoff: {item['payoff']}",
                f"- Duration estimate: {item['duration_seconds']}s",
                f"- Comment prompt: {item['comment_prompt']}",
                f"- Bridge: {item['bridge_to_long_form']}",
                "- Transcript:",
                f"  {item['script']}",
                "",
            ]
        )
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def load_package(video_id: str) -> dict[str, Any]:
    path = output_root(video_id) / "approval" / "shorts-script-package.json"
    if not path.exists():
        payload, _json, _md = build_shorts_script_package(video_id)
        return payload
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build standalone Pattern Lab Shorts scripts.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--shorts-target", type=int, default=TARGET_SHORT_COUNT, choices=[3, 4, 5])
    args = parser.parse_args()
    payload, _json_path, md_path = build_shorts_script_package(args.video_id, args.shorts_target)
    print(f"Status: {payload['status']}")
    print(f"Shorts script package: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
