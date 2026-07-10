#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now

GENERIC_INTRO_PHRASES = (
    "welcome back",
    "in today's video",
    "in todays video",
    "before we get started",
    "smash the like",
    "do not forget to like",
)

PROOF_TERMS = (
    "proof",
    "source",
    "map",
    "archive",
    "photo",
    "record",
    "document",
    "ledger",
)

PAYOFF_PROMISE_TERMS = (
    "by the end",
    "you will see",
    "you'll see",
    "you will understand",
    "you'll understand",
    "in a few minutes",
)

CLIFFHANGER_TERMS = (
    "but the",
    "this is where",
    "here is where",
    "the problem is",
    "the question is",
    "what most people miss",
    "what gets missed",
    "that is where",
    "then the map",
    "the map looks clean",
    "the simple version",
    "the harder question",
    "the source-backed version",
    "this is the part",
    "and this is",
    "that is the contradiction",
    "the hidden system",
    "the visual payoff",
    "think about",
)


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def words(text):
    return re.findall(r"[A-Za-z0-9']+", str(text or ""))


def paragraphs(clean):
    return [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", clean) if paragraph.strip()]


def count_terms(text, terms):
    lower = str(text or "").lower()
    return sum(1 for term in terms if term in lower)


def find_host_intro(clean):
    lower = clean.lower()
    candidates = [index for token in ("pattern lab", "i am james", "i'm james") if (index := lower.find(token)) >= 0]
    return min(candidates) if candidates else -1


def build_transcript_viral_report(video_id):
    path = script_path(video_id)
    approval = ensure_dir(output_root(video_id) / "approval")
    checks = []
    blockers = []
    warnings = []

    def check(name, passed, detail, blocker=True):
        checks.append({"name": name, "passed": bool(passed), "detail": detail, "blocker": bool(blocker)})
        if passed:
            return
        if blocker:
            blockers.append(f"{name}: {detail}")
        else:
            warnings.append(f"{name}: {detail}")

    if not path.exists():
        check("script_exists", False, f"missing {display_path(path)}")
        clean = ""
        paras = []
    else:
        clean = strip_markdown_for_voiceover(read_text(path))
        paras = paragraphs(clean)
        check("script_exists", True, display_path(path))

    first_para = paras[0] if paras else ""
    first_700 = clean[:700].lower()
    first_1200 = clean[:1200].lower()
    last_1000 = clean[-1000:].lower()
    host_index = find_host_intro(clean)
    generic_hits = [phrase for phrase in GENERIC_INTRO_PHRASES if phrase in first_1200]
    cliffhanger_count = count_terms(clean, CLIFFHANGER_TERMS)
    payoff_count = count_terms(first_1200, PAYOFF_PROMISE_TERMS)
    proof_count = count_terms(first_700, PROOF_TERMS)

    check(
        "proof_hook_before_intro",
        bool(first_para) and len(words(first_para)) <= 28 and "pattern lab" not in first_para.lower() and host_index > len(first_para),
        f"first paragraph words={len(words(first_para))}; host_intro_index={host_index}",
    )
    check(
        "host_intro_delayed_but_early",
        90 <= host_index <= 900,
        f"host_intro_index={host_index}; expected after proof setup and before long exposition",
    )
    check("proof_terms_in_first_700_chars", proof_count >= 2, f"{proof_count} proof/source/map/archive terms")
    check("by_the_end_payoff_promise", payoff_count >= 1, f"{payoff_count} payoff promise phrase(s) in first ~45 seconds")
    check(
        "first_30_title_thumbnail_payoff",
        any(term in first_1200 for term in ("black bottom", "paradise valley", "detroit")) and proof_count >= 2,
        "opening ties Detroit/Black Bottom/Paradise Valley to proof/map/source payoff",
    )
    check("no_generic_youtube_filler", not generic_hits, ", ".join(generic_hits) or "none")
    check("cliffhanger_transition_density", cliffhanger_count >= 5, f"{cliffhanger_count} cliffhanger/curiosity transition phrase(s)")
    check(
        "consistent_pattern_lab_outro",
        "city, source, system" in last_1000 and "no source, no story" in last_1000,
        "requires City, Source, System and No source, no story near ending",
    )
    check(
        "earned_subscribe_cta",
        "subscribe" in last_1000 and ("city file" in last_1000 or "next" in last_1000),
        "subscribe CTA must point to next city file/source trail",
    )
    check(
        "comment_source_lead_prompt",
        "leave the name" in last_1000 and ("source trail" in last_1000 or "comments" in last_1000),
        "ending must ask locals for names/source leads before subscribe CTA",
    )

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "script": display_path(path),
        "metrics": {
            "word_count": len(words(clean)),
            "host_intro_index": host_index,
            "proof_term_count_first_700": proof_count,
            "payoff_promise_count_first_1200": payoff_count,
            "cliffhanger_transition_count": cliffhanger_count,
            "generic_intro_hits": generic_hits,
        },
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
    }
    json_path = approval / "transcript-viral-quality-report.json"
    md_path = approval / "transcript-viral-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Transcript Viral Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Checks",
        "",
    ]
    for item in checks:
        lines.append(f"- {item['name']}: {'pass' if item['passed'] else 'fail'} ({item['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Metrics", ""])
    for key, value in payload["metrics"].items():
        lines.append(f"- {key}: {value}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab transcript viral/watch-time structure.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_transcript_viral_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Transcript viral quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
