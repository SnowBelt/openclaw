#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_discord_feedback import (
    GATE_REASONS,
    LEGACY_REASON_MAP,
    LONG_FORM_REASONS,
    POSITIVE_REASONS,
    REQUIRED_REASON_CODES,
    SHORT_REASONS,
    THUMBNAIL_REASONS,
    allowed_reasons,
    parse_callback,
)

REQUIRED_LONG_FORM = {
    "redo_hook",
    "visuals_mismatch",
    "pacing_needs_revision",
    "voice_needs_revision",
    "random_text_box",
    "fact_source_issue",
    "possible_private_info",
    "reject_topic",
}
REQUIRED_SHORTS = {
    "weak_hook",
    "starts_mid_sentence",
    "no_clear_point",
    "random_text_box",
    "bad_crop",
    "captions_unreadable",
    "visuals_mismatch",
    "too_slow",
    "audio_bad",
    "bad_loop",
    "does_not_bridge_to_long_form",
    "reject_concept",
}
REQUIRED_THUMBNAILS = {
    "thumbnail_not_clickable",
    "thumbnail_wrong_promise",
    "bad_font_color",
    "too_cluttered",
    "too_generic",
    "text_hard_to_read",
    "wrong_city_feel",
    "regenerate_same_idea",
    "regenerate_new_idea",
}
REQUIRED_POSITIVE = {
    "strong_hook",
    "good_pacing",
    "good_visual_match",
    "good_caption_style",
    "good_font_color",
    "good_thumbnail_style",
    "good_city_feel",
    "use_this_style_more",
    "strong_source_trail",
    "strong_short_loop",
}


def iter_manifest_callbacks(manifest_path):
    if not manifest_path.exists():
        return []
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    callbacks = []
    for step in payload.get("steps", []):
        controls = step.get("controls")
        if not controls:
            continue
        if isinstance(controls, str):
            controls = json.loads(controls)
        for block in controls.get("blocks", []):
            for button in block.get("buttons", []):
                value = button.get("value", "")
                if value.startswith("patternlab:"):
                    callbacks.append({"label": button.get("label", ""), "value": value})
    return callbacks


def build_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest = approval / "discord-review-delivery-plan.json"
    blockers = []
    missing = {
        "long_form": sorted(REQUIRED_LONG_FORM - set(LONG_FORM_REASONS)),
        "shorts": sorted(REQUIRED_SHORTS - set(SHORT_REASONS)),
        "thumbnails": sorted(REQUIRED_THUMBNAILS - set(THUMBNAIL_REASONS)),
        "positive": sorted(REQUIRED_POSITIVE - set(POSITIVE_REASONS)),
    }
    for key, values in missing.items():
        if values:
            blockers.append(f"Missing {key} reason codes: {', '.join(values)}")
    if not LEGACY_REASON_MAP:
        blockers.append("Legacy reason compatibility map is empty.")
    callback_errors = []
    callbacks = iter_manifest_callbacks(manifest)
    for callback in callbacks:
        try:
            parse_callback(callback["value"])
        except Exception as exc:
            callback_errors.append({"label": callback["label"], "error": str(exc)})
    if callback_errors:
        blockers.append(f"Invalid Discord callbacks found: {len(callback_errors)}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "required_reason_codes": REQUIRED_REASON_CODES,
        "allowed_reason_count": len(allowed_reasons()),
        "legacy_reason_map": LEGACY_REASON_MAP,
        "gate_reasons": sorted(GATE_REASONS),
        "manifest": display_path(manifest) if manifest.exists() else "missing",
        "manifest_callback_count": len(callbacks),
        "callback_errors": callback_errors,
        "blockers": blockers,
    }
    json_path = approval / "discord-feedback-taxonomy-report.json"
    md_path = approval / "discord-feedback-taxonomy-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Discord Feedback Taxonomy: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Allowed reasons: {payload['allowed_reason_count']}",
        f"Manifest callbacks checked: {payload['manifest_callback_count']}",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Discord feedback taxonomy.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Discord feedback taxonomy report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
