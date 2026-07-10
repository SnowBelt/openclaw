#!/usr/bin/env python3
import argparse
import json
import re

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now

CATEGORIES = [
    "proof_hook_strength",
    "first_30_second_payoff",
    "by_the_end_promise",
    "local_specificity",
    "cliffhanger_transitions",
    "source_density",
    "human_consequence",
    "hidden_system_clarity",
    "shareable_lines",
    "earned_subscribe_cta",
    "comment_source_lead_prompt",
]

LOCAL_TERMS = (
    "detroit", "black bottom", "paradise valley", "hastings", "st. antoine", "gratiot", "brush", "lafayette park", "i-375", "chrysler freeway", "ford field", "orchestra hall", "brewster", "jeffries", "paradise theater", "club harlem", "flame show bar", "horseshoe"
)
SOURCE_TERMS = ("source", "proof", "map", "archive", "record", "document", "photo", "ledger", "historical society")
HUMAN_TERMS = ("family", "business", "church", "child", "customers", "workers", "musician", "residents", "relocated", "notice", "homes", "memory")
SYSTEM_TERMS = ("system", "freeway", "urban renewal", "restrictive", "covenants", "segregation", "housing", "highway", "clearance", "condemnation", "federal")
SHAREABLE_LINES = (
    "black bottom was not empty",
    "detroit erased a living district",
    "the map changed",
    "no source, no story",
    "city, source, system",
    "a freeway is never just a line",
    "the map made it look normal",
    "the city needed the people",
)
CLIFFHANGER_TERMS = (
    "but the", "this is where", "here is where", "the question", "the contradiction", "what most", "the simple version", "the source-backed version", "the hidden system", "the visual payoff", "think about", "in a few minutes"
)


def words(text):
    return re.findall(r"[A-Za-z0-9']+", str(text or ""))


def count_contains(text, terms):
    lower = text.lower()
    return sum(1 for term in terms if term in lower)


def score_scale(value, thresholds):
    score = 0
    for threshold in thresholds:
        if value >= threshold:
            score += 1
    return min(5, score)


def build_score(video_id):
    path = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    approval = ensure_dir(output_root(video_id) / "approval")
    clean = strip_markdown_for_voiceover(read_text(path)) if path.exists() else ""
    lower = clean.lower()
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", clean) if paragraph.strip()]
    first = paragraphs[0] if paragraphs else ""
    first_1200 = lower[:1200]
    last_1100 = lower[-1100:]

    raw = {
        "proof_hook_strength": int(bool(first) and len(words(first)) <= 28 and "pattern lab" not in first.lower())
        + score_scale(count_contains(first_1200, SOURCE_TERMS), [1, 2, 3, 4]),
        "first_30_second_payoff": score_scale(count_contains(first_1200, ("detroit", "black bottom", "paradise valley", "source", "proof", "map")), [2, 3, 4, 5, 6]),
        "by_the_end_promise": 5 if any(term in first_1200 for term in ("by the end", "you will see", "you'll see", "you will understand", "in a few minutes")) else 0,
        "local_specificity": score_scale(count_contains(lower, LOCAL_TERMS), [4, 7, 10, 13, 16]),
        "cliffhanger_transitions": score_scale(count_contains(lower, CLIFFHANGER_TERMS), [3, 5, 7, 9, 11]),
        "source_density": score_scale(sum(lower.count(term) for term in SOURCE_TERMS), [8, 12, 16, 20, 24]),
        "human_consequence": score_scale(count_contains(lower, HUMAN_TERMS), [4, 6, 8, 10, 12]),
        "hidden_system_clarity": score_scale(count_contains(lower, SYSTEM_TERMS), [4, 6, 8, 10, 12]),
        "shareable_lines": score_scale(count_contains(lower, SHAREABLE_LINES), [2, 3, 4, 5, 6]),
        "earned_subscribe_cta": 5 if "subscribe" in last_1100 and ("city file" in last_1100 or "source trail" in last_1100) else 0,
        "comment_source_lead_prompt": 5 if "leave the name" in last_1100 and "source trail" in last_1100 else 0,
    }
    scores = {category: min(5, max(0, int(raw.get(category, 0)))) for category in CATEGORIES}
    remediation = []
    for category, score in scores.items():
        if score < 3:
            remediation.append({"category": category, "score": score, "fix": REMEDIATION[category]})
    total = sum(scores.values())
    blockers = []
    if total < 42:
        blockers.append(f"total_score_below_threshold: {total}/55; minimum is 42/55")
    for item in remediation:
        blockers.append(f"category_below_3: {item['category']} scored {item['score']}/5; {item['fix']}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "script": display_path(path),
        "total_score": total,
        "max_score": 55,
        "minimum_total_score": 42,
        "scores": scores,
        "remediation": remediation,
        "blockers": blockers,
        "word_count": len(words(clean)),
    }
    json_path = approval / "transcript-watchtime-score-report.json"
    md_path = approval / "transcript-watchtime-score-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Transcript Watch-Time Score: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Score: {total}/55",
        "",
        "## Category Scores",
        "",
    ]
    for category in CATEGORIES:
        lines.append(f"- {category}: {scores[category]}/5")
    lines.extend(["", "## Remediation", ""])
    if remediation:
        for item in remediation:
            lines.append(f"- {item['category']}: {item['fix']}")
    else:
        lines.append("- none")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


REMEDIATION = {
    "proof_hook_strength": "Rewrite the first paragraph as a short proof/mystery hook before channel branding.",
    "first_30_second_payoff": "Add city, place, proof, and map/source payoff language to the first 30 seconds.",
    "by_the_end_promise": "Add a first-45-second promise such as 'By the end, you will see...'.",
    "local_specificity": "Add more streets, neighborhoods, landmarks, buildings, businesses, or local institutions.",
    "cliffhanger_transitions": "Add curiosity bridges every 45-75 seconds.",
    "source_density": "Add visible source, map, archive, record, document, or proof references.",
    "human_consequence": "Add family, business, residents, churches, workers, customers, or relocation consequences.",
    "hidden_system_clarity": "Name the mechanism: policy, freeway, housing, industry, water, rail, renewal, or other system.",
    "shareable_lines": "Add short repeatable lines a viewer could quote or comment.",
    "earned_subscribe_cta": "Tie subscribe to the next city file/source trail instead of a generic ask.",
    "comment_source_lead_prompt": "Ask locals to leave names, places, or sources as future source-trail leads.",
}


def main():
    parser = argparse.ArgumentParser(description="Score Pattern Lab transcript watch-time readiness.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_score(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Transcript watch-time score report: {display_path(md_path)}")
    print(f"Score: {payload['total_score']}/{payload['max_score']}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
