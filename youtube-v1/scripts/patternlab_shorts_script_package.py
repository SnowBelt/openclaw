#!/usr/bin/env python3
"""Build and validate standalone Pattern Lab Shorts scripts.

The goal is to stop Shorts from starting mid-sentence or existing only as weak
trailers. This script creates a deterministic micro-story package from the
long-form transcript and scores each candidate before rendering.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from patternlab_comment_prompts import city_source_lead_comment
from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, read_text, strip_markdown_for_voiceover, utc_now

MIN_SCORE = 90
MIN_SECONDS = 25
MAX_SECONDS = 45
WORDS_PER_SECOND = 2.55
TARGET_SHORT_COUNT = 5
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
LOCAL_TERMS = ("detroit", "black bottom", "paradise valley", "hastings", "st. antoine", "i-375", "lafayette park")
PAYOFF_TERMS = ("shows", "means", "matters", "changed", "proves", "because", "not just", "never just")

SHORT_TEMPLATES = [
    {
        "id_suffix": "short-01",
        "title": "Black Bottom Was Not Empty",
        "viewer_psychology": "curiosity",
        "first_frame_text": "DETROIT WAS NOT EMPTY",
        "hook": "Black Bottom was not empty. Detroit erased a living district.",
        "proof_visual": "Detroit map plus source ledger for Black Bottom and Paradise Valley",
        "payoff": "The map changes the story from empty land to a lived neighborhood.",
        "source_keywords": ["black bottom", "empty", "living district", "map", "paradise valley"],
    },
    {
        "id_suffix": "short-02",
        "title": "Black Bottom Name Myth",
        "viewer_psychology": "utility",
        "first_frame_text": "BLACK BOTTOM MYTH",
        "hook": "Black Bottom was not named because it became a Black neighborhood.",
        "proof_visual": "Black Bottom name-origin source card plus Detroit map label",
        "payoff": "The name points to older bottomland soil history, while the later Black neighborhood story reveals a different layer.",
        "source_keywords": ["not named", "dark", "bottomland", "soil", "river savoyard"],
    },
    {
        "id_suffix": "short-03",
        "title": "300 Black-Owned Businesses",
        "viewer_psychology": "identity",
        "first_frame_text": "DETROIT 300 BUSINESSES",
        "hook": "Paradise Valley had more than 300 Black-owned businesses.",
        "proof_visual": "Detroit Paradise Valley business source board with count highlighted",
        "payoff": "That number turns the story from clearance zone into commercial ecosystem.",
        "source_keywords": ["300", "black-owned", "business", "paradise valley", "commercial ecosystem"],
    },
    {
        "id_suffix": "short-04",
        "title": "A Freeway Is Never Just A Line",
        "viewer_psychology": "system",
        "first_frame_text": "FREEWAY CUT DETROIT",
        "hook": "A freeway is never just a line on a map.",
        "proof_visual": "Detroit I-375 route trace over the old neighborhood footprint",
        "payoff": "At street level, that line means addresses, businesses, and routes disappear.",
        "source_keywords": ["freeway", "never just a line", "addresses disappear", "street level", "i-375"],
    },
    {
        "id_suffix": "short-05",
        "title": "What Detroit Lost",
        "viewer_psychology": "emotion",
        "first_frame_text": "WHAT DETROIT LOST",
        "hook": "Detroit did not just lose buildings here.",
        "proof_visual": "Detroit then-now map board of businesses, churches, clubs, housing, and neighborhood footprint",
        "payoff": "The larger loss was a network of Black business, music, housing, churches, workers, and memory.",
        "source_keywords": ["vanished", "not only architecture", "network", "businesses", "memory"],
    },
]


def clean_script(video_id: str) -> str:
    path = launch_root(video_id) / "final-script.md"
    return strip_markdown_for_voiceover(read_text(path)) if path.exists() else ""


def infer_city(video_id: str) -> str:
    package_path = launch_root(video_id) / "package.json"
    if package_path.exists():
        try:
            data = json.loads(package_path.read_text(encoding="utf-8"))
            metadata = data.get("upload_metadata") or {}
            return str(metadata.get("city") or metadata.get("active_city") or data.get("city") or "Detroit")
        except json.JSONDecodeError:
            return "Detroit"
    return "Detroit"


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


def score_short(item: dict[str, Any]) -> tuple[int, dict[str, int], list[str]]:
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
    if not any(term in text for term in LOCAL_TERMS):
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


def build_short_item(video_id: str, city: str, template: dict[str, Any], rows: list[dict[str, Any]], index: int) -> dict[str, Any]:
    anchor = find_anchor(rows, list(template["source_keywords"]))
    lines = [template["hook"]]
    hook_lower = template["hook"].lower()
    for sentence in supporting_sentences(rows, anchor):
        lower_sentence = sentence.lower()
        if lower_sentence == hook_lower or hook_lower in lower_sentence or lower_sentence in hook_lower:
            continue
        lines.append(sentence)
    lines.append(template["payoff"])
    # Keep the transcript focused and within duration by trimming middle evidence if needed.
    while estimate_duration(lines) > MAX_SECONDS and len(lines) > 3:
        lines.pop(-2)
    if estimate_duration(lines) < MIN_SECONDS:
        lines.insert(-1, f"For {city}, the source trail matters because it shows the place before the simplified story took over.")
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
        "proof_visual": template["proof_visual"],
        "payoff": template["payoff"],
        "comment_prompt": comment_prompt,
        "bridge_to_long_form": "Full city file on Pattern Lab: the long-form video shows the complete source trail.",
        "related_video_promise": "The full video shows the map, sources, and hidden system behind the story.",
        "start_boundary": "scripted_short_no_long_form_cut",
        "end_boundary": "scripted_short_no_long_form_cut",
        "duration_seconds": round(estimate_duration(lines), 1),
        "source_sentence_index": anchor.get("index") if anchor else None,
        "source_excerpt": anchor.get("text") if anchor else "",
        "render_mode": "scripted_short_preferred",
    }
    score, breakdown, blockers = score_short(item)
    item["score"] = score
    item["score_breakdown"] = breakdown
    item["blockers"] = blockers
    item["status"] = "pass" if score >= MIN_SCORE and not blockers else "blocked"
    return item


def build_shorts_script_package(video_id: str, target_count: int = TARGET_SHORT_COUNT) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    city = infer_city(video_id)
    rows = sentence_rows(clean_script(video_id))
    shorts = [build_short_item(video_id, city, template, rows, index) for index, template in enumerate(SHORT_TEMPLATES[:target_count], start=1)]
    blockers = [f"{item['id']}: {blocker}" for item in shorts for blocker in item.get("blockers", [])]
    low_scores = [f"{item['id']}: score {item['score']}/100" for item in shorts if item.get("score", 0) < MIN_SCORE]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "pass" if not blockers and not low_scores and len(shorts) >= 3 else "blocked",
        "minimum_score": MIN_SCORE,
        "shorts_count": len(shorts),
        "shorts": shorts,
        "blockers": blockers + low_scores,
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
