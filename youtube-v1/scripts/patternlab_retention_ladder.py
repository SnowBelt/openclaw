#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now


REQUIRED_BEATS = [
    ("hook", 0, 5, "result, contradiction, or visible artifact"),
    ("proof", 0, 20, "visible source proof"),
    ("source_context", 45, 120, "source context that makes the city file credible"),
    ("lost_place_or_system", 120, 240, "lost place, infrastructure choice, industry pattern, or turning point"),
    ("city_evidence", 240, 420, "artifact-driven city evidence movement"),
    ("shorts_bridge", 420, 540, "Shorts funnel logic from the same city-history proof"),
    ("subscribe_bridge", 540, 720, "earned subscribe bridge tied to the next city file"),
    ("outro", 560, 840, "repeatable Pattern Lab outro"),
]
GENERIC_INTRO_PHRASES = (
    "welcome back",
    "in today's video",
    "before we get started",
    "smash the like",
)


def package_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "package.json"


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def default_ladder(video_id, package=None):
    package = package or {}
    artifact = package.get("artifact_type") or "original Pattern Lab artifact"
    return {
        "version": "2026-05-pattern-lab-retention-ladder-v1",
        "video_id": video_id,
        "purpose": "Protect long-form watch time and subscriber conversion by forcing source proof, pacing, payoffs, and a repeatable city-history outro.",
        "rules": {
            "first_5_seconds": "Open with a result, contradiction, or visible artifact before channel context.",
            "first_20_seconds": f"Show the source proof on screen: {artifact}.",
            "max_seconds_without_new_beat": 75,
            "preferred_major_beat_window_seconds": "45-75",
            "visual_change_rule": "Change visuals only when the narration changes source, place, time period, proof, or payoff.",
            "generic_intro_blocked": True,
            "consistent_outro_required": True,
            "subscribe_cta_required": True,
        },
        "beats": [
            {
                "beat_id": beat_id,
                "target_start_seconds": start,
                "target_end_seconds": end,
                "purpose": purpose,
                "visual_requirement": "Narration-matched source, map, historical photo, table, timeline, or decision visual.",
                "payoff_required": True,
            }
            for beat_id, start, end, purpose in REQUIRED_BEATS
        ],
        "outro": {
            "required_phrase": "That is the pattern: city, source, system.",
            "signoff": "No source, no story.",
            "next_viewer_action": "Subscribe for the next evidence-backed city file.",
        },
    }


def words(text):
    return re.findall(r"[A-Za-z0-9']+", text)


def validate_ladder(video_id, package=None, script_text=""):
    blockers = []
    warnings = []
    checks = []
    package = package or {}
    ladder = package.get("retention_ladder")
    if not ladder:
        blockers.append("Package is missing machine-readable retention_ladder.")
        ladder = default_ladder(video_id, package)
    rules = ladder.get("rules", {})
    beats = ladder.get("beats") or []
    clean = strip_markdown_for_voiceover(script_text) if script_text else ""
    lower = clean.lower()
    first_900 = lower[:900]
    last_1000 = lower[-1000:]

    def check(name, passed, detail, blocker=True):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed and blocker:
            blockers.append(detail)
        if not passed and not blocker:
            warnings.append(detail)

    check("first_5_seconds_rule", bool(rules.get("first_5_seconds")), "Retention ladder must define the first 5 second hook rule.")
    check("first_20_seconds_rule", bool(rules.get("first_20_seconds")), "Retention ladder must define the first 20 second proof rule.")
    max_gap = rules.get("max_seconds_without_new_beat")
    check(
        "max_gap_rule",
        isinstance(max_gap, (int, float)) and float(max_gap) <= 75,
        "Retention ladder must block more than 75 seconds without a new beat.",
    )
    check("visual_change_rule", bool(rules.get("visual_change_rule")), "Retention ladder must define when visuals are allowed to change.")
    check("beat_count", len(beats) >= 8, f"Retention ladder needs at least 8 beats; found {len(beats)}.")
    for beat in beats:
        start = beat.get("target_start_seconds")
        end = beat.get("target_end_seconds")
        beat_id = beat.get("beat_id", "unknown")
        valid_window = isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start
        check(f"beat_window_{beat_id}", valid_window, f"Beat {beat_id} needs numeric start/end seconds.")
        if valid_window and end - start > 140:
            check(f"beat_window_width_{beat_id}", False, f"Beat {beat_id} target window is too broad.", blocker=False)
        check(f"beat_payoff_{beat_id}", bool(beat.get("payoff_required")), f"Beat {beat_id} must require a payoff.")

    if script_text:
        first_paragraph = clean.split("\n\n", 1)[0] if clean else ""
        hook_ok = first_paragraph and len(words(first_paragraph)) <= 18 and "pattern lab" not in first_paragraph.lower()
        check("script_hook_first", hook_ok, "Script must open with a concise hook before channel context.")
        proof_ok = any(term in first_900 for term in ("proof", "artifact", "source", "map", "archive", "photo", "scorecard", "table", "teardown"))
        check("script_proof_first_20", proof_ok, "Script must name the source proof near the opening.")
        generic = any(phrase in first_900 for phrase in GENERIC_INTRO_PHRASES)
        check("script_no_generic_intro", not generic, "Script opening contains generic YouTube filler.")
        city_outro_ok = "that is the pattern" in last_1000 and "city, source, system" in last_1000 and "no source, no story" in last_1000
        outro_ok = city_outro_ok
        check("script_consistent_outro", outro_ok, "Script must end with the repeatable Pattern Lab or city-file outro and signoff.")
        subscribe_ok = "subscribe" in last_1000 and ("next" in last_1000 or "city file" in last_1000 or "teardown" in last_1000)
        check("script_subscribe_cta", subscribe_ok, "Script must include an earned subscribe CTA tied to the next video or city file.")

    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "retention_ladder": ladder,
    }


def build_retention_ladder_report(video_id, backfill_package=False):
    package_file = package_path(video_id)
    script_file = script_path(video_id)
    package = read_json(package_file) or {}
    if backfill_package and package_file.exists() and "retention_ladder" not in package:
        package["retention_ladder"] = default_ladder(video_id, package)
        package_file.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    script_text = read_text(script_file) if script_file.exists() else ""
    payload = validate_ladder(video_id, package, script_text)
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    json_path = approval / "retention-ladder-report.json"
    md_path = approval / "retention-ladder-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Retention Ladder: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Required Rules",
        "",
    ]
    for key, value in payload["retention_ladder"].get("rules", {}).items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Checks", ""])
    for check in payload["checks"]:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in payload["warnings"]] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate the machine-readable Pattern Lab retention ladder.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--backfill-package", action="store_true")
    args = parser.parse_args()
    payload, report = build_retention_ladder_report(args.video_id, backfill_package=args.backfill_package)
    print(f"Status: {payload['status']}")
    print(f"Retention ladder report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
