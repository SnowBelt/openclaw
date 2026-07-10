#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now
from patternlab_first5_hook import build_first5_hook_report
from validate_james_persona import build_james_persona_report
from patternlab_retention_ladder import build_retention_ladder_report


GENERIC_INTRO_PHRASES = (
    "welcome back",
    "in today's video",
    "before we get started",
    "do not forget to like",
    "smash the like",
)
STALE_FRAMING_PHRASES = (
    ("patterns" + ", criteria, proof", "retired Pattern Lab proof tagline"),
    ("no " + "artifact, no upload", "retired artifact-upload signoff"),
    ("artifact-backed " + "growth analysis", "retired online-growth positioning"),
    ("creator-" + "growth", "retired online-growth positioning"),
    ("creator " + "strategy", "retired maker-strategy framing"),
    ("ai " + "tooling", "retired automation-tool framing"),
    ("platform-" + "pattern", "retired platform pattern framing"),
)
REQUIRED_VISUAL_ROLES = (
    "source_proof",
    "map_system",
    "archive_evidence",
    "then_now",
    "context_only",
    "city_file_cta",
)


def words(text):
    return re.findall(r"[A-Za-z0-9']+", text)


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def stale_framing_hits(text):
    lower = text.lower()
    return [label for phrase, label in STALE_FRAMING_PHRASES if phrase in lower]


def script_quality(video_id):
    path = script_path(video_id)
    checks = []
    if not path.exists():
        return {
            "status": "blocked",
            "path": display_path(path),
            "checks": [{"name": "script_exists", "passed": False, "detail": "final script is missing"}],
            "blockers": ["Final script is missing."],
            "warnings": [],
        }

    raw = read_text(path)
    clean = strip_markdown_for_voiceover(raw)
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", clean) if paragraph.strip()]
    lower = clean.lower()
    first_700 = clean[:700].lower()
    first_1000 = clean[:1000].lower()
    last_900 = clean[-900:].lower()
    blockers = []
    warnings = []
    stale_hits = stale_framing_hits(clean)
    checks.append(
        {
            "name": "no_stale_identity_framing",
            "passed": not stale_hits,
            "detail": "active scripts reject retired growth-channel and artifact-upload framing",
        }
    )
    for hit in stale_hits:
        blockers.append(f"Script contains stale active Pattern Lab framing: {hit}.")

    hook_first = bool(paragraphs) and "pattern lab" not in paragraphs[0].lower() and len(words(paragraphs[0])) <= 18
    checks.append(
        {
            "name": "hook_before_intro",
            "passed": hook_first,
            "detail": "opening line creates topic tension before channel branding",
        }
    )
    if not hook_first:
        blockers.append("Script must open with a concise content hook before the Pattern Lab intro.")

    intro_present = "pattern lab" in first_700 and ("i am " in first_1000 or "i'm " in first_1000 or "this is pattern lab" in first_1000)
    checks.append(
        {
            "name": "brief_human_channel_intro",
            "passed": intro_present,
            "detail": "first 700 characters identify the speaker/channel without a long branded intro",
        }
    )
    if not intro_present:
        blockers.append("Script must briefly introduce the speaker and Pattern Lab near the opening.")

    generic_intro = any(phrase in first_1000 for phrase in GENERIC_INTRO_PHRASES)
    checks.append(
        {
            "name": "no_generic_intro",
            "passed": not generic_intro,
            "detail": "opening avoids generic YouTube filler phrases",
        }
    )
    if generic_intro:
        blockers.append("Script opening contains generic intro filler.")

    proof_early = any(term in first_1000 for term in ("proof", "artifact", "source", "map", "archive", "photo", "scorecard", "table", "teardown"))
    checks.append(
        {
            "name": "proof_named_early",
            "passed": proof_early,
            "detail": "opening names the proof/source artifact early",
        }
    )
    if not proof_early:
        blockers.append("Script must name the proof/source artifact in the opening.")

    city_outro_present = "that is the pattern" in last_900 and "city, source, system" in last_900 and "no source, no story" in last_900
    checks.append(
        {
            "name": "consistent_outro",
            "passed": city_outro_present,
            "detail": "ending uses the city-file outro and No source, no story signoff",
        }
    )
    if not city_outro_present:
        blockers.append("Script must end with the city-file outro: city, source, system; No source, no story.")

    subscribe_cta = "subscribe" in last_900 and ("next" in last_900 or "city file" in last_900 or "teardown" in last_900)
    checks.append(
        {
            "name": "subscribe_cta",
            "passed": subscribe_cta,
            "detail": "ending includes an earned subscribe CTA tied to the next video or city file",
        }
    )
    if not subscribe_cta:
        blockers.append("Script must include an earned subscribe CTA near the ending.")

    if len(words(clean)) < 1100:
        blockers.append("Script is too short for the 8-14 minute long-form target.")
    if len(words(clean)) > 2300:
        warnings.append("Script is long enough to risk exceeding the 14 minute target.")

    return {
        "status": "pass" if not blockers else "blocked",
        "path": display_path(path),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "word_count": len(words(clean)),
    }


def visual_plan_quality(root, video_id):
    plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    checks = []
    if not plan.exists():
        return {
            "status": "blocked",
            "path": display_path(plan),
            "checks": [{"name": "visual_plan_exists", "passed": False, "detail": "visual beat plan is missing"}],
            "blockers": ["Visual beat plan is missing."],
            "warnings": [],
        }

    text = plan.read_text(encoding="utf-8")
    lower_text = text.lower()
    beat_count = len(re.findall(r"^- \d+:", text, flags=re.MULTILINE))
    matched_count = text.count("Matched narration")
    source_proof_index = text.find("role=source_proof")
    context_only_index = text.find("role=context_only")
    declared_roles = all(role in text for role in REQUIRED_VISUAL_ROLES)
    blockers = []
    warnings = []
    required_checks = [
        ("script_aware_timeline", "Voiceover/script: script-aware timeline" in text, "visuals are planned against the script timeline"),
        ("intentional_change_strategy", "change visuals only when the narration changes topic" in text, "plan states intentional image-change rule"),
        ("best_practice_rules", "## Best-Practice Rules Applied" in text, "plan records opening, intro, and outro rules"),
        ("source_context_roles_declared", declared_roles, "plan declares source/context roles for proof, maps, archives, then/now, context, and CTA"),
        ("source_proof_first", source_proof_index >= 0 and (context_only_index < 0 or source_proof_index < context_only_index), "source_proof appears before any context_only beat"),
        ("context_broll_not_proof", "stock/context b-roll is context only and cannot carry historical claims" in lower_text, "plan prevents stock/context B-roll from carrying historical claims"),
        ("narration_excerpts", "Excerpt:" in text and matched_count >= 8, f"{matched_count} matched narration beats"),
        ("sufficient_beat_count", beat_count >= 12, f"{beat_count} visual beats"),
    ]
    for name, passed, detail in required_checks:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            blockers.append(f"Visual plan gate failed: {detail}.")

    if beat_count > 75:
        warnings.append("Visual plan has many beats; review for over-cutting.")

    return {
        "status": "pass" if not blockers else "blocked",
        "path": display_path(plan),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "beat_count": beat_count,
        "matched_count": matched_count,
        "source_context_roles": list(REQUIRED_VISUAL_ROLES),
        "source_proof_before_context_only": source_proof_index >= 0 and (context_only_index < 0 or source_proof_index < context_only_index),
    }


def build_content_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    script = script_quality(video_id)
    visual = visual_plan_quality(root, video_id)
    first5, _first5_json, first5_report = build_first5_hook_report(video_id)
    retention, retention_report = build_retention_ladder_report(video_id)
    persona, persona_report = build_james_persona_report(video_id)
    blockers = (
        script["blockers"]
        + visual["blockers"]
        + first5.get("blockers", [])
        + retention.get("blockers", [])
        + persona.get("failures", [])
    )
    warnings = (
        script.get("warnings", [])
        + visual.get("warnings", [])
        + first5.get("warnings", [])
        + retention.get("warnings", [])
        + persona.get("warnings", [])
    )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "script": script,
        "visual_plan": visual,
        "first5_hook": {
            "status": first5.get("status"),
            "report": display_path(first5_report),
            "checks": first5.get("checks", []),
        },
        "retention_ladder": {
            "status": retention.get("status"),
            "report": display_path(retention_report),
            "checks": retention.get("checks", []),
        },
        "james_persona": {
            "status": persona.get("status"),
            "report": display_path(persona_report) if persona_report else "",
            "persona_moment_count": persona.get("script_details", {}).get("persona_moment_count"),
        },
        "blockers": blockers,
        "warnings": warnings,
    }
    json_path = approval / "content-quality-report.json"
    md_path = approval / "content-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Content Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Script Structure",
        "",
        f"- Path: {script['path']}",
        f"- Word count: {script.get('word_count', 'missing')}",
    ]
    for check in script["checks"]:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Visual Plan", "", f"- Path: {visual['path']}"])
    if "beat_count" in visual:
        lines.append(f"- Beats: {visual['beat_count']}")
        lines.append(f"- Matched narration beats: {visual['matched_count']}")
    for check in visual["checks"]:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## First-5 Hook", "", f"- Report: {display_path(first5_report)}", f"- Status: {first5.get('status')}"])
    for check in first5.get("checks", []):
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Retention Ladder", "", f"- Report: {display_path(retention_report)}"])
    for check in retention.get("checks", []):
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(
        [
            "",
            "## James Persona",
            "",
            f"- Report: {display_path(persona_report) if persona_report else 'missing'}",
            f"- Status: {persona.get('status')}",
            f"- Persona moments: {persona.get('script_details', {}).get('persona_moment_count', 'not checked')}",
        ]
    )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab script structure and visual beat intent.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, report = build_content_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Content quality report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()
