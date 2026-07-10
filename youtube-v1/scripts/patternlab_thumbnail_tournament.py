#!/usr/bin/env python3
"""Local-only Pattern Lab outside-the-box thumbnail tournament.

This script creates a strategy/ranking packet only. It does not call Canva,
paid tools, image generators, YouTube APIs, or publish/replace thumbnails.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import ensure_dir, output_root, utc_now, display_path


CONCEPTS: list[dict[str, Any]] = [
    {
        "id": "source_file_closeup",
        "format": "giant source-file closeup",
        "hook": "WHO SIGNED THIS?",
        "best_for": ["route decision", "demolition file", "redaction story"],
        "risk": "Can look fake if document text is generic.",
        "proof_object": "real document/map/photo with readable selective redaction",
        "scores": {"curiosity": 10, "clarity": 8, "visual_novelty": 9, "source_fit": 9, "phone_readability": 9, "owner_rules": 9},
    },
    {
        "id": "single_building_trial",
        "format": "one building on trial poster",
        "hook": "WHY SAVE THIS?",
        "best_for": ["preservation", "Art Deco", "landmark fight"],
        "risk": "Needs a visually strong building photo.",
        "proof_object": "dominant real city building photo plus small evidence tag",
        "scores": {"curiosity": 9, "clarity": 9, "visual_novelty": 8, "source_fit": 10, "phone_readability": 9, "owner_rules": 10},
    },
    {
        "id": "map_as_crime_scene",
        "format": "map crime-scene board without random arrows",
        "hook": "THE MAP DID IT",
        "best_for": ["redrawn map", "highway cut", "lost streets"],
        "risk": "Must avoid random arrows and decorative strings.",
        "proof_object": "real map/route/source image with one labeled route highlight",
        "scores": {"curiosity": 10, "clarity": 8, "visual_novelty": 9, "source_fit": 9, "phone_readability": 8, "owner_rules": 8},
    },
    {
        "id": "before_after_torn_edge",
        "format": "torn-edge then/now proof",
        "hook": "BEFORE IT VANISHED",
        "best_for": ["then now", "lost streets", "demolition"],
        "risk": "Median split must be exact; no NOW crossing into THEN.",
        "proof_object": "before photo and current source photo/map",
        "scores": {"curiosity": 9, "clarity": 9, "visual_novelty": 8, "source_fit": 9, "phone_readability": 8, "owner_rules": 9},
    },
    {
        "id": "waterline_receipt",
        "format": "flood/waterline receipt poster",
        "hook": "THE WATER WON",
        "best_for": ["shoreline", "bay", "river", "canal"],
        "risk": "Line must be a real waterline/land boundary, not decoration.",
        "proof_object": "real waterfront photo plus map/source boundary",
        "scores": {"curiosity": 9, "clarity": 9, "visual_novelty": 8, "source_fit": 10, "phone_readability": 9, "owner_rules": 9},
    },
    {
        "id": "neighborhood_missing_poster",
        "format": "missing-neighborhood poster",
        "hook": "WHO CUT IT?",
        "best_for": ["neighborhood displacement", "highway", "urban renewal"],
        "risk": "Needs human/place stakes without exploiting people.",
        "proof_object": "street-level neighborhood photo plus route/source proof",
        "scores": {"curiosity": 10, "clarity": 9, "visual_novelty": 8, "source_fit": 9, "phone_readability": 9, "owner_rules": 9},
    },
    {
        "id": "postcard_contradiction",
        "format": "tourist postcard contradiction",
        "hook": "NOT THE STORY",
        "best_for": ["tourist city myth", "preservation", "waterfront image"],
        "risk": "Hook can be too vague if title does not carry the payoff.",
        "proof_object": "recognizable real city postcard-like photo plus source contradiction",
        "scores": {"curiosity": 8, "clarity": 7, "visual_novelty": 9, "source_fit": 8, "phone_readability": 9, "owner_rules": 9},
    },
    {
        "id": "underground_cutaway",
        "format": "city-above / system-below cutaway",
        "hook": "UNDER MIAMI",
        "best_for": ["tunnel", "transit", "sewer", "water system"],
        "risk": "Needs actual source support or must be labeled non-proof support.",
        "proof_object": "real city street photo plus non-proof support cutaway",
        "scores": {"curiosity": 9, "clarity": 8, "visual_novelty": 10, "source_fit": 7, "phone_readability": 9, "owner_rules": 8},
    },
]


def score(concept: dict[str, Any]) -> float:
    values = [float(v) for v in concept["scores"].values()]
    return round(sum(values) / len(values), 2)


def build_tournament(video_id: str, city: str, topic: str) -> dict[str, Any]:
    ranked = []
    for concept in CONCEPTS:
        row = dict(concept)
        row["city"] = city
        row["topic"] = topic
        row["overall_score"] = score(concept)
        row["public_youtube_mutation"] = "not_authorized"
        row["paid_tools"] = "not_used"
        row["render_status"] = "strategy_only_not_rendered"
        ranked.append(row)
    ranked.sort(key=lambda item: (-item["overall_score"], item["id"]))
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
        item["selected_for_next_local_render"] = index <= 3
    return {
        "generated_at": utc_now(),
        "status": "pass",
        "mode": "local_strategy_tournament_only",
        "video_id": video_id,
        "city": city,
        "topic": topic,
        "approval_scope": "local outside-the-box thumbnail tournament; no paid tools, Canva, YouTube upload/replacement, or public publishing",
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
        "canva": "not_used",
        "concept_count": len(ranked),
        "selected_count": len([item for item in ranked if item["selected_for_next_local_render"]]),
        "winner_ids": [item["id"] for item in ranked[:3]],
        "concepts": ranked,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local-only Pattern Lab outside-the-box thumbnail tournament.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    parser.add_argument("--city", default="Miami")
    parser.add_argument("--topic", default="source-backed city mystery")
    args = parser.parse_args()
    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    payload = build_tournament(args.video_id, args.city, args.topic)
    json_path = approval / "thumbnail-outside-the-box-tournament-report.json"
    md_path = approval / "thumbnail-outside-the-box-tournament-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Outside-the-Box Thumbnail Tournament: {args.city}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Mode: {payload['mode']}",
        "Public YouTube mutation: not performed",
        "Paid tools / Canva: not used",
        "",
        "## Winners",
        "",
    ]
    for item in payload["concepts"][:3]:
        lines.append(f"- #{item['rank']} {item['id']} — {item['hook']} ({item['overall_score']}/10): {item['format']}")
    lines.extend(["", "## Full Ranking", ""])
    for item in payload["concepts"]:
        lines.append(f"- #{item['rank']} {item['id']} — {item['overall_score']}/10 — risk: {item['risk']}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "winners": payload["winner_ids"], "report": display_path(json_path)}, indent=2))


if __name__ == "__main__":
    main()
