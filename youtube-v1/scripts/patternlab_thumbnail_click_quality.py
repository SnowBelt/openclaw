#!/usr/bin/env python3
"""Pattern Lab click-quality gates for topic, hook, source, and thumbnail briefs."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import BASE, ensure_dir, output_root, utc_now

CLICK_SCORE_MINIMUM = 8.0
MIN_RENDERABLE_TOPICS = 3
SOURCE_TAGS = [
    "skyline",
    "street-level",
    "neighborhood",
    "map",
    "document",
    "highway",
    "water",
    "preservation",
    "transit",
    "industry",
    "housing",
]
REJECT_REASONS = {
    "random_arrow": "Arrow is decorative or does not point to a concrete route, flow, or source feature.",
    "unexplained_line": "Line/divider appears without a source/story purpose.",
    "weak_topic": "Topic lacks enough curiosity, conflict, visual proof, or source availability.",
    "generic_photo": "Photo does not directly support the hook.",
    "city_missing": "City name is missing from the thumbnail/brief.",
    "text_over_text": "Public text overlaps or competes with other text.",
    "unreadable_text": "Text is not readable at search-shelf size.",
    "fake_proof": "Visual implies proof that is not real source-backed evidence.",
    "decorative_black_box": "Box/backplate is decorative or unlabeled instead of supporting readability or source context.",
    "missing_brief": "Hook-first thumbnail brief is missing.",
    "low_click_score": "Pre-render click score is below 8/10.",
    "source_tag_mismatch": "Required source tags do not match visible source tags.",
}
ALLOWED_SHAPE_PURPOSES = {
    "headline_backplate",
    "subtitle_backplate",
    "source_document",
    "selective_redaction",
    "waterline",
    "photo_frame",
    "vignette",
    "contrast_overlay",
    "route_highlight",
    "map_boundary",
    "proof_callout",
}
OWNER_LIKED_FORMATS_V2 = [
    {
        "id": "source_backed_map_plus_city_inset_v2",
        "status": "owner_liked_for_ab_tests",
        "best_use_cases": ["redrawn map", "river route", "street grid", "lost streets"],
        "do_not_use_cases": ["every topic in a unique set", "non-map preservation story"],
        "required_proof_object": "map, route, or source document",
        "allowed_variation_range": "change hook, source photo, color, and crop; preserve map-plus-city logic only for AB tests",
        "owner_rating_source": "owner rated map/redrawn examples highly and requested controlled reuse only",
    },
    {
        "id": "document_redaction_real_sentence_v2",
        "status": "owner_liked_when_selective_and_readable",
        "best_use_cases": ["who decided", "route memo", "city file", "demolition/preservation record"],
        "do_not_use_cases": ["generic background decoration", "black bars without readable words"],
        "required_proof_object": "document prop with readable sentence fragments and whole-word redactions",
        "allowed_variation_range": "may change document scale/crop; must keep real sentence fragments visible",
        "owner_rating_source": "owner liked redacted concept only when redactions were selective and intentional",
    },
    {
        "id": "real_photo_city_mystery_v2",
        "status": "owner_required_source_backed_default",
        "best_use_cases": ["neighborhood", "water", "preservation", "infrastructure", "street-level history"],
        "do_not_use_cases": ["source media unavailable", "photo unrelated to hook"],
        "required_proof_object": "dominant real city photo matching the hook",
        "allowed_variation_range": "change crop, headline, proof object, and contrast; do not reuse as blind template",
        "owner_rating_source": "owner explicitly rejected design-only mockups when real photos exist",
    },
]

CITY_SPECIFIC_TOPICS: dict[str, list[dict[str, Any]]] = {
    "miami": [
        {"hook": "THE WATER WON", "topic": "Miami's fight with Biscayne Bay and low land", "sentence": "This episode shows how water, fill, canals, and low elevation shaped Miami's growth.", "tags": ["water", "map", "skyline"], "proof_object": "Biscayne Bay skyline/source map", "tension": "city vs water", "scores": [10, 9, 9, 9]},
        {"hook": "WHO CUT OVERTOWN?", "topic": "The route decisions that damaged Overtown", "sentence": "This episode follows the source trail behind how highway routing changed Overtown.", "tags": ["neighborhood", "highway", "street-level"], "proof_object": "Overtown street photo and route/source memo", "tension": "neighborhood vs route", "scores": [10, 9, 9, 10]},
        {"hook": "SAVED FROM DEMOLITION", "topic": "Miami Beach Art Deco preservation fight", "sentence": "This episode shows how Miami Beach's Art Deco district survived demolition pressure.", "tags": ["preservation", "document", "street-level"], "proof_object": "Art Deco HABS photo and preservation file", "tension": "demolition vs preservation", "scores": [9, 9, 10, 9]},
        {"hook": "MIAMI BUILT OVER THIS", "topic": "Miami's built environment over wetlands and water systems", "sentence": "This episode reveals what the skyline was built above and why that matters now.", "tags": ["water", "map", "skyline"], "proof_object": "waterfront skyline and map/source overlay", "tension": "glamour vs ground truth", "scores": [9, 9, 9, 9]},
        {"hook": "THE MAP WAS WRONG", "topic": "Miami's map promised dry land while water kept shaping the city", "sentence": "This episode compares source maps to the city's physical water problem.", "tags": ["map", "water", "document"], "proof_object": "map and water source record", "tension": "paper plan vs physical city", "scores": [9, 8, 9, 9]},
    ]
}
GENERIC_PATTERNS = [
    ("WHO MOVED {CITY}?", "A source trail behind a route, boundary, or district shift", ["map", "document"], "map/source file", "official plan vs lived city", [9, 8, 9, 9]),
    ("{CITY} HID THIS", "A hidden system under a familiar city story", ["document", "street-level"], "source file and real photo", "visible city vs hidden system", [9, 8, 8, 8]),
    ("THE STREET VANISHED", "A street-grid change that erased a familiar place", ["map", "street-level"], "old/new street proof", "lost place vs current map", [9, 8, 9, 8]),
    ("WHO DREW THIS?", "A planning decision with a human consequence", ["document", "map"], "route memo or map", "decision-maker vs neighborhood", [9, 8, 8, 9]),
    ("BEFORE THE HIGHWAY", "The neighborhood before a route cut through it", ["highway", "neighborhood"], "before/after route source", "homes vs infrastructure", [8, 8, 9, 9]),
    ("THE OLD CITY LOST", "A specific older city fabric replaced by a newer system", ["street-level", "document"], "historic photo and source note", "old city vs redevelopment", [8, 8, 8, 9]),
    ("THE RIVER DECIDED", "A river or waterfront that shaped the city more than leaders admitted", ["water", "map"], "waterfront map/photo", "nature vs city plan", [9, 8, 9, 8]),
    ("SAVED AT THE END", "A building, district, or source record saved just before loss", ["preservation", "document"], "preservation file", "demolition vs rescue", [8, 8, 9, 9]),
    ("THE LINE WASN'T RANDOM", "A route or boundary that explains a city scar", ["map", "highway"], "source-labeled route", "abstract line vs real consequence", [8, 8, 8, 9]),
    ("WHY HERE?", "A location choice that reveals the city's hidden system", ["map", "document"], "location proof", "obvious place vs hidden reason", [8, 8, 8, 8]),
    ("THE CITY SPLIT", "A division created by infrastructure, zoning, water, or industry", ["map", "neighborhood"], "split map/photo", "one city vs two outcomes", [9, 8, 8, 9]),
    ("THIS BLOCK EXPLAINS IT", "One block that reveals a larger city pattern", ["street-level", "document"], "street-level source photo", "small detail vs big pattern", [8, 8, 8, 8]),
    ("THE PLAN FAILED", "A city plan that collided with geography or residents", ["document", "map"], "planning document", "promise vs result", [8, 8, 9, 8]),
    ("THE SOURCE CHANGED IT", "A document that changes the common story", ["document", "map"], "source document", "myth vs source record", [9, 8, 8, 8]),
    ("THE PHOTO EXPOSES IT", "A real photo that shows what a generic history misses", ["street-level", "document"], "photo plus source label", "image vs myth", [8, 8, 9, 8]),
    ("THE BORDER MATTERED", "A border, ward, highway, or water edge with lasting consequences", ["map", "neighborhood"], "border map", "line vs life", [8, 8, 8, 8]),
    ("THE STATION MOVED", "A transit or station decision that shifted development", ["transit", "map"], "station map/photo", "transit choice vs city growth", [8, 7, 8, 8]),
    ("INDUSTRY LEFT THIS", "Industrial geography that still marks the city", ["industry", "map"], "industrial photo/map", "jobs vs scar", [8, 8, 8, 8]),
    ("HOUSING WAS THE MAP", "Housing policy visible in streets and buildings", ["housing", "map"], "housing map/photo", "policy vs street", [8, 8, 8, 8]),
    ("THE WATER KEPT RECEIPTS", "Waterfront evidence behind a city myth", ["water", "map"], "waterfront source", "water vs official story", [9, 8, 9, 8]),
    ("THE DEMOLITION FILE", "A demolition record that explains what disappeared", ["preservation", "document"], "demolition/source file", "loss vs source proof", [8, 8, 9, 9]),
    ("THE ROUTE WON", "A route decision that overpowered a neighborhood", ["highway", "neighborhood"], "route photo/map", "route vs residents", [9, 8, 9, 9]),
    ("THE MAP LIED", "A map or plan that hid the consequence", ["map", "document"], "map/source file", "official map vs real cost", [9, 8, 8, 9]),
    ("THE CITY PAID", "The human cost of a city system decision", ["neighborhood", "document"], "neighborhood source photo", "system vs people", [9, 8, 8, 9]),
    ("THIS WAS NO ACCIDENT", "A pattern that looks natural but came from decisions", ["document", "map"], "decision source", "accident vs intent", [9, 8, 8, 9]),
    ("THE OLD ROUTE WON", "An old route still controlling modern shape", ["map", "street-level"], "old route map/photo", "past vs present", [8, 8, 8, 8]),
    ("THE NEIGHBORHOOD REMEMBERS", "A local place that still carries the earlier decision", ["neighborhood", "street-level"], "neighborhood photo", "memory vs official story", [8, 8, 8, 8]),
    ("THE FILE WAS BURIED", "A source record hidden behind a familiar city story", ["document", "map"], "source file", "buried proof vs popular story", [9, 8, 8, 8]),
    ("THE GRID TELLS", "The street grid reveals a hidden decision", ["map", "street-level"], "street-grid map", "grid vs myth", [8, 8, 8, 8]),
    ("THE SHORE MOVED", "A shoreline, river, or land-fill story that changed the city", ["water", "map"], "shoreline map/photo", "shoreline vs city image", [8, 8, 9, 8]),
]
WEAK_REJECTS = [
    "{city} Was Built on Water",
    "The History of {city}",
    "Old Photos of {city}",
    "{city} Explained",
]


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def topic_score(scores: list[int | float]) -> float:
    return round(sum(float(score) for score in scores) / len(scores), 2)


def city_topic_seeds(city: str) -> list[dict[str, Any]]:
    seeds = CITY_SPECIFIC_TOPICS.get(city.lower(), [])
    rows: list[dict[str, Any]] = []
    for seed in seeds:
        rows.append({**seed})
    for hook, topic, tags, proof, tension, scores in GENERIC_PATTERNS:
        rows.append({
            "hook": hook.format(CITY=city.upper(), City=city),
            "topic": f"{city}: {topic}",
            "sentence": f"This episode follows source photos, maps, and records to show {topic.lower()} in {city}.",
            "tags": tags,
            "proof_object": proof,
            "tension": tension,
            "scores": scores,
        })
    return rows


def build_topic_bank(city: str, video_id: str | None = None) -> dict[str, Any]:
    candidates = []
    for index, seed in enumerate(city_topic_seeds(city), start=1):
        curiosity, source_availability, visual_proof, conflict_tension = [float(v) for v in seed["scores"]]
        overall = topic_score([curiosity, source_availability, visual_proof, conflict_tension])
        candidates.append({
            "rank": 0,
            "id": f"{city.lower()}-topic-{index:02d}",
            "city": city,
            "hook": seed["hook"],
            "topic": seed["topic"],
            "sentence": seed["sentence"],
            "source_tags_required": seed["tags"],
            "proof_object": seed["proof_object"],
            "emotional_tension": seed["tension"],
            "curiosity_score": curiosity,
            "source_availability_score": source_availability,
            "visual_proof_score": visual_proof,
            "conflict_tension_score": conflict_tension,
            "overall_score": overall,
            "renderable": overall >= CLICK_SCORE_MINIMUM,
            "reject_reasons": [] if overall >= CLICK_SCORE_MINIMUM else ["weak_topic"],
        })
    candidates.sort(key=lambda row: (-row["overall_score"], row["hook"], row["id"]))
    for rank, row in enumerate(candidates, start=1):
        row["rank"] = rank
    rejected = [
        {"title": item.format(city=city), "reject_reasons": ["weak_topic"], "overall_score": 5.0}
        for item in WEAK_REJECTS
    ]
    top = [row for row in candidates if row["renderable"]][:MIN_RENDERABLE_TOPICS]
    status = "pass" if len(candidates) >= 30 and len(top) >= MIN_RENDERABLE_TOPICS else "blocked"
    payload = {
        "generated_at": utc_now(),
        "status": status,
        "video_id": video_id or "topic-bank",
        "city": city,
        "candidate_count": len(candidates),
        "renderable_topic_count": len([row for row in candidates if row["renderable"]]),
        "minimum_renderable_topics_required": MIN_RENDERABLE_TOPICS,
        "minimum_click_score": CLICK_SCORE_MINIMUM,
        "recommended_topics": top,
        "candidates": candidates,
        "rejected_examples": rejected,
    }
    return payload


def required_brief_fields() -> list[str]:
    return [
        "city",
        "topic",
        "click_question",
        "emotional_tension",
        "proof_object",
        "required_source_photo_type",
        "thumbnail_text",
        "city_text",
        "forbidden_visual_elements",
        "first_30_second_payoff",
        "source_tags_required",
        "visible_source_tags",
        "scores",
        "visual_elements",
        "public_words",
        "title_thumbnail_promise",
    ]


def validate_brief(brief: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    reject_reasons: list[str] = []
    for field in required_brief_fields():
        if field not in brief or brief.get(field) in (None, "", []):
            blockers.append(f"missing required brief field: {field}")
            if field == "city":
                reject_reasons.append("city_missing")
            if field == "proof_object":
                reject_reasons.append("generic_photo")
    city = str(brief.get("city", "")).strip()
    city_text = str(brief.get("city_text", "")).strip()
    if not city or city.lower() not in city_text.lower():
        blockers.append("city_text must contain the active city name")
        reject_reasons.append("city_missing")
    hook_words = word_count(str(brief.get("thumbnail_text", "")))
    if hook_words < 1 or hook_words > 4:
        blockers.append("thumbnail_text must be a 1-4 word hook separate from the city name")
        reject_reasons.append("weak_topic")
    scores = brief.get("scores", {}) or {}
    score_fields = [
        "curiosity",
        "clarity",
        "source_photo_fit",
        "visual_novelty",
        "title_thumbnail_promise",
        "first_30_second_payoff",
    ]
    missing_scores = [field for field in score_fields if field not in scores]
    if missing_scores:
        blockers.append(f"missing click score fields: {', '.join(missing_scores)}")
    numeric_scores = [float(scores.get(field, 0)) for field in score_fields]
    click_score = round(sum(numeric_scores) / len(score_fields), 2)
    if click_score < CLICK_SCORE_MINIMUM:
        blockers.append(f"click score {click_score} is below {CLICK_SCORE_MINIMUM}")
        reject_reasons.append("low_click_score")
    source_match = source_tag_match(brief)
    if source_match["status"] != "pass":
        blockers.extend(source_match["blockers"])
        reject_reasons.append("source_tag_mismatch")
    intentionality = intentionality_gate(brief)
    if intentionality["status"] != "pass":
        blockers.extend(intentionality["blockers"])
        reject_reasons.extend(intentionality["reject_reasons"])
    return {
        "status": "pass" if not blockers else "blocked",
        "click_score": click_score,
        "blockers": blockers,
        "reject_reasons": sorted(set(reject_reasons)),
        "source_tag_match": source_match,
        "intentionality": intentionality,
    }


def source_tag_match(brief: dict[str, Any]) -> dict[str, Any]:
    required = {str(tag).strip().lower() for tag in brief.get("source_tags_required", []) if str(tag).strip()}
    visible = {str(tag).strip().lower() for tag in brief.get("visible_source_tags", []) if str(tag).strip()}
    unknown = sorted((required | visible) - set(SOURCE_TAGS) - {"overtown", "art_deco", "waterfront", "source-file"})
    blockers = []
    if not required:
        blockers.append("brief has no required source tags")
    if not visible:
        blockers.append("brief has no visible source tags")
    if required and visible and not required.intersection(visible):
        blockers.append(f"visible source tags {sorted(visible)} do not match required tags {sorted(required)}")
    return {"status": "pass" if not blockers else "blocked", "required": sorted(required), "visible": sorted(visible), "unknown_tags": unknown, "blockers": blockers}


def intentionality_gate(brief: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    reject_reasons: list[str] = []
    for element in brief.get("visual_elements", []):
        kind = str(element.get("kind", "")).strip().lower()
        purpose = str(element.get("purpose", "")).strip().lower()
        label = str(element.get("label", kind or "element"))
        if not purpose:
            blockers.append(f"visual element `{label}` has no purpose")
            reject_reasons.append("decorative_black_box" if kind in {"box", "backplate"} else "unexplained_line")
            continue
        if purpose not in ALLOWED_SHAPE_PURPOSES:
            blockers.append(f"visual element `{label}` uses unsupported purpose `{purpose}`")
            if kind == "arrow":
                reject_reasons.append("random_arrow")
            elif kind in {"line", "divider"}:
                reject_reasons.append("unexplained_line")
            elif kind in {"box", "backplate"}:
                reject_reasons.append("decorative_black_box")
        if kind == "arrow" and purpose not in {"route_highlight", "proof_callout"}:
            blockers.append(f"arrow `{label}` is not tied to route_highlight or proof_callout")
            reject_reasons.append("random_arrow")
        if kind in {"line", "divider"} and purpose not in {"waterline", "map_boundary", "route_highlight", "photo_frame"}:
            blockers.append(f"line `{label}` is not tied to a concrete map/water/route/photo purpose")
            reject_reasons.append("unexplained_line")
    for word in brief.get("public_words", []):
        text = str(word.get("text", "")).strip()
        purpose = str(word.get("purpose", "")).strip()
        if not text or not purpose:
            blockers.append(f"public word `{text or 'missing'}` has no click purpose")
            reject_reasons.append("weak_topic")
    return {"status": "pass" if not blockers else "blocked", "blockers": blockers, "reject_reasons": sorted(set(reject_reasons))}


def brief_for_topic(city: str, topic: dict[str, Any], variant: dict[str, Any], source_tags: list[str], visual_elements: list[dict[str, str]]) -> dict[str, Any]:
    hook = str(variant["main"])
    return {
        "city": city,
        "topic": topic["title"],
        "click_question": topic.get("click_question") or f"Why would {hook.lower()} matter in {city}?",
        "emotional_tension": topic["emotional_tension"],
        "proof_object": variant["proof_object"],
        "required_source_photo_type": variant["required_source_photo_type"],
        "thumbnail_text": hook,
        "city_text": city.upper(),
        "forbidden_visual_elements": ["random arrows", "unexplained line", "decorative black box", "generic photo", "fake proof"],
        "first_30_second_payoff": variant["first_30_second_payoff"],
        "source_tags_required": topic["source_tags_required"],
        "visible_source_tags": source_tags,
        "scores": variant["scores"],
        "visual_elements": visual_elements,
        "public_words": [
            {"text": city.upper(), "purpose": "city anchor"},
            {"text": hook, "purpose": "curiosity hook"},
            {"text": variant.get("sub", ""), "purpose": "source payoff"},
        ],
        "title_thumbnail_promise": variant["title_thumbnail_promise"],
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_ab_readiness_packet(video_id: str, city: str, briefs: list[dict[str, Any]], output_dir: Path | None = None) -> dict[str, Any]:
    variants = []
    for index, brief in enumerate(briefs[:3], start=1):
        variants.append({
            "variant": chr(ord("A") + index - 1),
            "title": brief["topic"],
            "thumbnail_text": f"{brief['city_text']} / {brief['thumbnail_text']}",
            "click_question": brief["click_question"],
            "watch_time_hypothesis": brief["first_30_second_payoff"],
        })
    payload = {
        "generated_at": utc_now(),
        "status": "ready_for_owner_review" if len(variants) == 3 else "blocked",
        "video_id": video_id,
        "city": city,
        "public_youtube_mutation": "not_authorized",
        "youtube_native_ab_test_rule": "Prepare up to 3 title/thumbnail variants; YouTube winner should be judged by watch time share, not CTR alone.",
        "variants": variants,
    }
    if output_dir:
        write_json(output_dir / "youtube-ab-readiness-packet.json", payload)
        lines = [
            f"# Pattern Lab YouTube A/B Readiness Packet: {city}",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {payload['status']}",
            "Public YouTube mutation: not authorized",
            "",
            "## Rule",
            "",
            f"- {payload['youtube_native_ab_test_rule']}",
            "- Owner approval is required before any YouTube upload, thumbnail replacement, or public publish action.",
            "",
            "## Variants",
            "",
        ]
        for variant in variants:
            lines.extend([
                f"### Variant {variant['variant']}",
                "",
                f"- Title: {variant['title']}",
                f"- Thumbnail text: {variant['thumbnail_text']}",
                f"- Click question: {variant['click_question']}",
                f"- Watch-time hypothesis: {variant['watch_time_hypothesis']}",
                "",
            ])
        (output_dir / "youtube-ab-readiness-packet.md").write_text("\n".join(lines), encoding="utf-8")
    return payload


def write_topic_bank(city: str, video_id: str) -> dict[str, Any]:
    payload = build_topic_bank(city, video_id)
    root = output_root(video_id)
    write_json(root / "approval" / "thumbnail-topic-bank.json", payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and validate Pattern Lab thumbnail click-quality gates.")
    parser.add_argument("--city", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--brief")
    parser.add_argument("--write-topic-bank", action="store_true")
    args = parser.parse_args()
    result: dict[str, Any] = {}
    if args.write_topic_bank:
        result["topic_bank"] = write_topic_bank(args.city, args.video_id)
    if args.brief:
        brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
        result["brief_validation"] = validate_brief(brief)
    if not result:
        result["topic_bank"] = write_topic_bank(args.city, args.video_id)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
