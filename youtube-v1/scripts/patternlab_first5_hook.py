#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now


GENERIC_INTRO_PHRASES = (
    "welcome back",
    "in today's video",
    "before we get started",
    "do not forget to like",
    "smash the like",
    "hit that like",
    "subscribe and turn on notifications",
)
HOOK_CUES = (
    "not just",
    "didn't just",
    "wasn't just",
    "what changed",
    "what vanished",
    "why",
    "hidden",
    "proof",
    "source",
    "map",
    "receipts",
    "rewired",
    "decline",
    "problem",
)
PROOF_VISUAL_CUES = (
    "source_proof",
    "source-grounded",
    "source-packet/visual-rebuild",
    "historical/",
    "modern-context/",
    "map",
    "photo",
    "archive",
    "proof",
)
PROOF_TEXT_CUES = (
    "proof",
    "source",
    "map",
    "archive",
    "photo",
    "artifact",
    "evidence",
)
STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "its",
    "just",
    "not",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "with",
}


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def package_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "package.json"


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def words(text):
    return re.findall(r"[A-Za-z0-9']+", text)


def keyword_tokens(text):
    return {
        token.lower()
        for token in words(text)
        if len(token) >= 4 and token.lower() not in STOP_WORDS
    }


def first_paragraph(clean):
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", clean) if paragraph.strip()]
    return paragraphs[0] if paragraphs else ""


def visual_lines(plan_text):
    opening = []
    beats = []
    for line in plan_text.splitlines():
        if line.startswith("- 00:"):
            opening.append(line)
        elif re.match(r"^- \d{2}:", line):
            beats.append(line)
    return opening, beats


def title_thumbnail_payoff(metadata, clean):
    title = metadata.get("selected_title") or metadata.get("default_title") or ""
    thumbnail = metadata.get("default_thumbnail") or ""
    opening = clean[:1100].lower()
    tokens = keyword_tokens(title)
    title_hits = sorted(token for token in tokens if token in opening)
    city_hit = "detroit" in opening and "detroit" in title.lower()
    system_hit = any(term in opening for term in ("rewired", "rewiring", "decline", "map", "proof", "source", "system"))
    thumbnail_ok = bool(thumbnail) and any(term in opening for term in ("map", "proof", "source", "photo", "evidence"))
    return city_hit and system_hit and thumbnail_ok, {
        "title": title,
        "thumbnail": thumbnail,
        "title_keyword_hits": title_hits,
        "city_hit": city_hit,
        "system_hit": system_hit,
        "thumbnail_opening_payoff": thumbnail_ok,
    }


def add_check(checks, blockers, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})
    if not passed:
        blockers.append(f"{name}: {detail}")


def build_first5_hook_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    script_file = script_path(video_id)
    package_file = package_path(video_id)
    visual_plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    metadata_file = approval / "upload-metadata.json"

    checks = []
    blockers = []
    warnings = []

    raw_script = read_text(script_file) if script_file.exists() else ""
    clean = strip_markdown_for_voiceover(raw_script) if raw_script else ""
    lower = clean.lower()
    hook = first_paragraph(clean)
    hook_lower = hook.lower()
    first_20_text = clean[:900].lower()
    first_30_text = clean[:1300].lower()
    visual_text = read_text(visual_plan) if visual_plan.exists() else ""
    opening_visuals, beat_visuals = visual_lines(visual_text)
    first_visual = opening_visuals[0] if opening_visuals else (beat_visuals[0] if beat_visuals else "")
    first_matched_beat = beat_visuals[0] if beat_visuals else ""
    metadata = read_json(metadata_file) or {}
    package = read_json(package_file) or {}
    retention_rules = (package.get("retention_ladder") or {}).get("rules", {})

    add_check(checks, blockers, "script_exists", script_file.exists(), display_path(script_file))
    add_check(checks, blockers, "package_exists", package_file.exists(), display_path(package_file))
    add_check(checks, blockers, "visual_plan_exists", visual_plan.exists(), display_path(visual_plan))
    add_check(checks, blockers, "upload_metadata_exists", metadata_file.exists(), display_path(metadata_file))

    hook_before_branding = bool(hook) and "pattern lab" not in hook_lower and lower.find(hook_lower) < lower.find("pattern lab")
    add_check(checks, blockers, "hook_before_branding", hook_before_branding, "opening hook appears before Pattern Lab branding")

    hook_word_count = len(words(hook))
    concise_hook = 3 <= hook_word_count <= 18
    add_check(checks, blockers, "concise_first_hook", concise_hook, f"opening hook word count is {hook_word_count}")

    mystery_or_contradiction = any(cue in hook_lower or cue in first_20_text[:500] for cue in HOOK_CUES)
    add_check(
        checks,
        blockers,
        "mystery_or_contradiction",
        mystery_or_contradiction,
        "first 5 seconds create contradiction, mystery, result, or proof curiosity",
    )

    source_or_visual_proof_first = bool(first_visual) and any(cue in first_visual.lower() for cue in PROOF_VISUAL_CUES)
    add_check(
        checks,
        blockers,
        "source_or_visual_proof_first",
        source_or_visual_proof_first,
        "first visual beat is source/photo/map/proof backed",
    )

    first_visual_match_metadata = bool(first_matched_beat) and all(
        marker in first_matched_beat
        for marker in ("match_score=", "match_strength=", "match_dimensions=", "source_role=", "fallback_used=")
    )
    add_check(
        checks,
        blockers,
        "first_visual_match_metadata",
        first_visual_match_metadata,
        "first narration-matched beat carries visual match metadata",
    )

    generic_intro = any(phrase in first_30_text for phrase in GENERIC_INTRO_PHRASES)
    add_check(checks, blockers, "no_generic_intro", not generic_intro, "opening avoids generic YouTube intro phrases")

    payoff_ok, payoff_details = title_thumbnail_payoff(metadata, clean)
    add_check(
        checks,
        blockers,
        "title_thumbnail_payoff",
        payoff_ok,
        "opening pays off the title/thumbnail promise with city, system, and proof language",
    )

    source_proof_first_20 = (
        any(cue in first_20_text for cue in PROOF_TEXT_CUES)
        and "Opening proof clip: first 18s" in visual_text
        and "Opening source role: source_proof" in visual_text
    )
    add_check(checks, blockers, "source_proof_first_20", source_proof_first_20, "first 20 seconds point to source proof")

    first5_rule = bool(retention_rules.get("first_5_seconds"))
    add_check(checks, blockers, "retention_ladder_first5_rule", first5_rule, "retention ladder defines first 5 second rule")

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "inputs": {
            "script": display_path(script_file),
            "package": display_path(package_file),
            "visual_plan": display_path(visual_plan),
            "upload_metadata": display_path(metadata_file),
        },
        "opening_hook": hook,
        "opening_hook_word_count": hook_word_count,
        "first_visual": first_visual,
        "first_matched_visual_beat": first_matched_beat,
        "title_thumbnail_payoff": payoff_details,
        "public_publish": "blocked_until_explicit_owner_approval",
    }
    json_path = approval / "first5-hook-report.json"
    md_path = approval / "first5-hook-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab First-5 Hook Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "Public publish: blocked until explicit owner approval",
        "",
        "## Opening Hook",
        "",
        f"- Text: {hook or 'missing'}",
        f"- Word count: {hook_word_count}",
        "",
        "## First Visual Evidence",
        "",
        f"- First visual: {first_visual or 'missing'}",
        f"- First matched beat: {first_matched_beat or 'missing'}",
        "",
        "## Checks",
        "",
    ]
    for check in checks:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab's first-5-seconds hook contract.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_first5_hook_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"First-5 hook report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
