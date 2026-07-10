#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, read_text, strip_markdown_for_voiceover, utc_now


PERSONA_JSON = BASE / "resources" / "presenter" / "james-persona.json"
PERSONA_MD = BASE / "resources" / "presenter" / "james-persona.md"
INTRO = "I am James, and this is Pattern Lab."
REQUIRED_PERSONA_FIELDS = {
    "status",
    "presenter_name",
    "public_intro",
    "professional_background",
    "why_pattern_lab_exists",
    "approved_recurring_lines",
    "on_channel_familiarity_rules",
    "blocked_patterns",
}
DISALLOWED_SCRIPT_PATTERNS = (
    r"\bmy wife\b",
    r"\bmy husband\b",
    r"\bmy kids\b",
    r"\bmy children\b",
    r"\bmy son\b",
    r"\bmy daughter\b",
    r"\bmarried\b",
    r"\bdivorced\b",
    r"\bworked at [A-Z][A-Za-z0-9&. -]+",
    r"\bgraduated from [A-Z][A-Za-z0-9&. -]+",
    r"\bmade \d+(\.\d+)?\s*(million|billion|k)\b",
)


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def normalize(text):
    return re.sub(r"\s+", " ", text.strip().lower())


def phrase_count(text, phrase):
    return normalize(text).count(normalize(phrase))


def validate_persona_files():
    failures = []
    warnings = []
    persona = read_json(PERSONA_JSON)
    if not persona:
        failures.append("James persona JSON is missing or invalid.")
        persona = {}
    missing = sorted(REQUIRED_PERSONA_FIELDS - set(persona.keys()))
    if missing:
        failures.append(f"James persona JSON is missing fields: {', '.join(missing)}.")
    if persona.get("status") != "approved":
        failures.append("James persona JSON must be approved.")
    if persona.get("presenter_name") != "James":
        failures.append("James persona must identify the presenter as James.")
    if persona.get("public_intro") != INTRO:
        failures.append("James persona public intro has drifted.")
    if len(persona.get("approved_recurring_lines", [])) < 5:
        failures.append("James persona needs at least five approved recurring lines.")
    if "Scout" not in json.dumps(persona):
        warnings.append("James persona does not include the approved light Scout detail.")
    if not PERSONA_MD.exists():
        failures.append("James persona markdown reference is missing.")
    else:
        md = PERSONA_MD.read_text(encoding="utf-8")
        for required in [INTRO, "Moneyball", "Show me the artifact.", "Do not fabricate wife, kids"]:
            if required not in md:
                failures.append(f"James persona markdown is missing required detail: {required}")
    return failures, warnings, persona


def validate_script_persona(video_id, persona):
    failures = []
    warnings = []
    path = script_path(video_id)
    if not path.exists():
        failures.append(f"Video {video_id} final script is missing.")
        return failures, warnings, {}
    raw = read_text(path)
    clean = strip_markdown_for_voiceover(raw)
    lower = clean.lower()
    first_1000 = clean[:1000]
    recurring_lines = persona.get("approved_recurring_lines", [])
    moments = {line: phrase_count(clean, line) for line in recurring_lines}
    total_moments = sum(moments.values())

    if INTRO not in first_1000:
        failures.append(f"Video {video_id} must introduce James and Pattern Lab near the opening.")
    if total_moments < 1:
        failures.append(f"Video {video_id} needs one small approved James-flavored moment tied to the topic.")
    if total_moments > 4:
        failures.append(f"Video {video_id} overuses James persona moments; keep personality light-touch.")
    if lower.count("scout") > 1:
        failures.append(f"Video {video_id} overuses Scout; keep pet references occasional.")
    for pattern in DISALLOWED_SCRIPT_PATTERNS:
        if re.search(pattern, clean, flags=re.IGNORECASE):
            failures.append(f"Video {video_id} appears to include disallowed or unverifiable James biography: {pattern}.")
    if "show me the artifact" in lower and "artifact" not in lower[:1600]:
        warnings.append(f"Video {video_id} uses the artifact phrase before grounding the proof.")
    return failures, warnings, {"persona_moment_count": total_moments, "moments": moments}


def build_james_persona_report(video_id=None):
    failures, warnings, persona = validate_persona_files()
    script_details = {}
    if video_id:
        script_failures, script_warnings, script_details = validate_script_persona(video_id, persona)
        failures.extend(script_failures)
        warnings.extend(script_warnings)
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not failures else "blocked",
        "video_id": video_id or "",
        "persona_json": display_path(PERSONA_JSON),
        "persona_markdown": display_path(PERSONA_MD),
        "script_details": script_details,
        "failures": failures,
        "warnings": warnings,
    }
    report = None
    if video_id:
        approval = ensure_dir(BASE / "local-output" / f"video-{video_id}" / "approval")
        json_report = approval / "james-persona-validation.json"
        md_report = approval / "james-persona-validation.md"
        json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        lines = [
            f"# James Persona Validation: Video {video_id}",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {payload['status']}",
            "",
            "## Persona Moment Count",
            "",
            f"- {script_details.get('persona_moment_count', 'not checked')}",
            "",
            "## Failures",
            "",
            *([f"- {failure}" for failure in failures] or ["- none"]),
            "",
            "## Warnings",
            "",
            *([f"- {warning}" for warning in warnings] or ["- none"]),
            "",
        ]
        md_report.write_text("\n".join(lines), encoding="utf-8")
        report = md_report
    return payload, report


def main():
    parser = argparse.ArgumentParser(description="Validate the Pattern Lab James presenter persona contract.")
    parser.add_argument("--video-id", default="")
    args = parser.parse_args()
    payload, report = build_james_persona_report(args.video_id or None)
    if report:
        print(f"James persona validation: {display_path(report)}")
    print(f"Status: {payload['status']}")
    for failure in payload["failures"]:
        print(f"- {failure}")
    if payload["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
