#!/usr/bin/env python3
import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now


MIN_DISTINCT_CATEGORIES = 5
MAX_CATEGORY_RUNTIME_SHARE = 0.45
MAX_CONSECUTIVE_SAME_IMAGE = 2
MAX_CONSECUTIVE_SAME_CATEGORY = 8

PEOPLE_TERMS = {
    "people",
    "person",
    "human",
    "worker",
    "workers",
    "mother",
    "children",
    "family",
    "families",
    "residents",
    "organizers",
    "musicians",
    "entrepreneurs",
    "planners",
    "community",
    "names",
    "lived",
}
PEOPLE_CATEGORIES = {"people_community", "neighborhoods_housing_street_life", "industry_workers_transport"}

PLACE_TERMS = {
    "attraction",
    "attractions",
    "landmark",
    "landmarks",
    "place",
    "places",
    "park",
    "parks",
    "building",
    "buildings",
    "church",
    "churches",
    "city",
    "cities",
    "identity",
    "street",
    "streets",
}
PLACE_CATEGORIES = {
    "attractions_landmarks_civic",
    "neighborhoods_housing_street_life",
    "geography_waterfront_routes",
    "skyline_cityscape_context",
}


def tokenize(text):
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def parse_kv_fields(raw_fields):
    fields = {}
    for field in raw_fields:
        field = field.strip()
        if "=" not in field:
            continue
        key, value = field.split("=", 1)
        fields[key.strip()] = value.strip()
    return fields


def parse_beats(path):
    beats = []
    if not path.exists():
        return beats
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^-\s*(\d+):\s*([0-9.]+)s-([0-9.]+)s\s*\|\s*([^|]+)\|\s*(.*)$", line)
        if not match:
            continue
        start = float(match.group(2))
        end = float(match.group(3))
        if end <= start:
            continue
        fields = parse_kv_fields(match.group(5).split("|"))
        excerpt = ""
        if "Excerpt:" in line:
            excerpt = line.split("Excerpt:", 1)[1].strip()
        beats.append(
            {
                "index": int(match.group(1)),
                "start": start,
                "end": end,
                "duration": end - start,
                "path": match.group(4).strip(),
                "role": fields.get("role", ""),
                "visual_category": fields.get("visual_category", ""),
                "visual_category_reason": fields.get("visual_category_reason", ""),
                "match_strength": fields.get("match_strength", ""),
                "source_role": fields.get("source_role", ""),
                "excerpt": excerpt,
            }
        )
    return beats


def longest_run(items, key):
    longest = 0
    current_key = None
    current = 0
    for item in items:
        value = item.get(key)
        if value == current_key:
            current += 1
        else:
            current_key = value
            current = 1
        longest = max(longest, current)
    return longest


def category_runtime(beats):
    runtime = defaultdict(float)
    for beat in beats:
        runtime[beat.get("visual_category") or "missing"] += beat["duration"]
    return dict(runtime)


def build_visual_variety_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    beats = parse_beats(plan)
    non_proof = [beat for beat in beats if beat.get("role") != "source_proof"]
    total_runtime = sum(beat["duration"] for beat in non_proof)
    runtime_by_category = category_runtime(non_proof)
    distinct_categories = sorted(category for category in runtime_by_category if category and category != "missing")
    max_category = None
    max_category_runtime = 0.0
    if runtime_by_category:
        max_category, max_category_runtime = max(runtime_by_category.items(), key=lambda item: item[1])
    max_category_share = max_category_runtime / total_runtime if total_runtime else 1
    missing_category_beats = [beat for beat in non_proof if not beat.get("visual_category")]
    unknown_category_beats = [beat for beat in non_proof if beat.get("visual_category") in {"", "missing", "unknown_context"}]
    image_counts = Counter(beat["path"] for beat in non_proof)
    category_counts = Counter(beat.get("visual_category") or "missing" for beat in non_proof)
    people_needed = [beat for beat in non_proof if tokenize(beat.get("excerpt", "")) & PEOPLE_TERMS]
    people_matched = [beat for beat in people_needed if beat.get("visual_category") in PEOPLE_CATEGORIES]
    place_needed = [beat for beat in non_proof if tokenize(beat.get("excerpt", "")) & PLACE_TERMS]
    place_matched = [beat for beat in place_needed if beat.get("visual_category") in PLACE_CATEGORIES]
    consecutive_same_image = longest_run(non_proof, "path")
    consecutive_same_category = longest_run(non_proof, "visual_category")

    checks = []

    def add_check(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    add_check("visual_plan_exists", plan.exists(), display_path(plan))
    add_check(
        "visual_category_metadata_complete",
        not missing_category_beats,
        f"{len(non_proof) - len(missing_category_beats)}/{len(non_proof)} non-proof beats have visual_category",
    )
    add_check(
        "no_unknown_visual_categories",
        not unknown_category_beats,
        f"{len(unknown_category_beats)} unknown-category beats",
    )
    add_check(
        "distinct_visual_categories",
        len(distinct_categories) >= MIN_DISTINCT_CATEGORIES,
        f"{len(distinct_categories)} distinct categories: {', '.join(distinct_categories)}",
    )
    add_check(
        "category_runtime_not_dominated",
        max_category_share <= MAX_CATEGORY_RUNTIME_SHARE,
        f"{max_category or 'none'} uses {max_category_share:.1%} of non-proof runtime",
    )
    add_check(
        "same_image_run_limit",
        consecutive_same_image <= MAX_CONSECUTIVE_SAME_IMAGE,
        f"longest same-image run {consecutive_same_image}",
    )
    add_check(
        "same_category_run_limit",
        consecutive_same_category <= MAX_CONSECUTIVE_SAME_CATEGORY,
        f"longest same-category run {consecutive_same_category}",
    )
    add_check(
        "people_narration_has_people_visuals",
        not people_needed or bool(people_matched),
        f"{len(people_matched)}/{len(people_needed)} people/community narration beats matched with people/community categories",
    )
    add_check(
        "place_narration_has_place_visuals",
        not place_needed or bool(place_matched),
        f"{len(place_matched)}/{len(place_needed)} place/landmark narration beats matched with place categories",
    )

    blockers = [f"{check['name']}: {check['detail']}" for check in checks if not check["passed"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "visual_plan": display_path(plan),
        "total_non_proof_beats": len(non_proof),
        "distinct_category_count": len(distinct_categories),
        "distinct_categories": distinct_categories,
        "category_counts": dict(sorted(category_counts.items())),
        "category_runtime_seconds": {key: round(value, 2) for key, value in sorted(runtime_by_category.items())},
        "max_category": max_category,
        "max_category_runtime_share": round(max_category_share, 4),
        "most_used_images": image_counts.most_common(8),
        "longest_same_image_run": consecutive_same_image,
        "longest_same_category_run": consecutive_same_category,
        "people_narration_beat_count": len(people_needed),
        "people_category_match_count": len(people_matched),
        "place_narration_beat_count": len(place_needed),
        "place_category_match_count": len(place_matched),
        "checks": checks,
        "blockers": blockers,
        "source_more_media_recommendation": (
            "none"
            if not blockers
            else "source more rights-safe people, attractions, landmarks, culture, neighborhood, or source-document visuals for the weak category lanes"
        ),
    }
    json_path = approval / "visual-variety-report.json"
    md_path = approval / "visual-variety-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Visual Variety: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Distinct categories: {payload['distinct_category_count']} ({', '.join(distinct_categories)})",
        f"Max category share: {max_category or 'none'} at {max_category_share:.1%}",
        f"Longest same-image run: {consecutive_same_image}",
        f"Longest same-category run: {consecutive_same_category}",
        f"People narration matches: {len(people_matched)}/{len(people_needed)}",
        f"Place narration matches: {len(place_matched)}/{len(place_needed)}",
        "",
        "## Category Runtime",
        "",
    ]
    for category, seconds in sorted(runtime_by_category.items(), key=lambda item: item[1], reverse=True):
        share = seconds / total_runtime if total_runtime else 0
        lines.append(f"- {category}: {seconds:.1f}s ({share:.1%})")
    lines.extend(["", "## Checks", ""])
    lines.extend([f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})" for check in checks])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab visual category relevance and variety.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_visual_variety_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Visual variety report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
