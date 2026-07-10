#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from datetime import datetime

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_discord_feedback import parse_callback


REQUIRED_LONG_FORM_LABELS = {"Long-form draft video file", "Long-form approval controls"}
REQUIRED_GATE_LABEL = "Intro review gates"


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def controls_payload(step):
    raw = step.get("controls") or ""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"_parse_error": str(exc)}


def iter_buttons(control_payload):
    if not isinstance(control_payload, dict):
        return
    for block in control_payload.get("blocks", []):
        if isinstance(block, dict) and block.get("type") == "buttons":
            for button in block.get("buttons", []):
                yield button


def validate_manifest(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest_path = approval / "discord-review-delivery-plan.json"
    delivery_report_path = approval / "discord-review-delivery-report.json"
    manifest = read_json(manifest_path)
    delivery_report = read_json(delivery_report_path) or {}
    blockers = []
    warnings = []
    callback_results = []
    labels = []
    kind_counts = Counter()
    short_videos = 0
    short_controls = 0
    thumbnail_images = 0
    thumbnail_controls = 0
    public_publish_callbacks = 0

    if not manifest:
        blockers.append("Discord review delivery plan is missing or invalid JSON.")
        steps = []
    else:
        steps = manifest.get("steps", [])
        if not manifest.get("channel_only"):
            blockers.append("Discord review target is not channel-only.")
        if manifest.get("video_delivery") != "plain_discord_attachments":
            blockers.append("Video delivery must remain plain Discord attachments.")

    for step in steps:
        label = step.get("label", "")
        labels.append(label)
        kind_counts[step.get("kind", "missing")] += 1
        if label.startswith("Short ") and label.endswith("video file"):
            short_videos += 1
        if label.startswith("Short ") and label.endswith("approval controls"):
            short_controls += 1
        if label.startswith("Thumbnail candidate"):
            thumbnail_images += 1
            if step.get("controls"):
                thumbnail_controls += 1
        if label == "Long-form approval controls" and not step.get("controls"):
            blockers.append("Long-form approval controls are missing their control payload.")
        if label.startswith("Short ") and label.endswith("approval controls") and not step.get("controls"):
            blockers.append(f"{label} is missing its control payload.")
        if label.startswith("Thumbnail candidate") and not step.get("controls"):
            blockers.append(f"{label} is missing its thumbnail controls.")
        control = controls_payload(step)
        if control and control.get("_parse_error"):
            blockers.append(f"{label} controls are invalid JSON: {control['_parse_error']}.")
            continue
        for button in iter_buttons(control):
            value = button.get("value", "")
            if not value.startswith("patternlab:"):
                blockers.append(f"Button callback does not use patternlab prefix: {label} / {button.get('label','')}.")
                continue
            try:
                parsed = parse_callback(value)
                callback_results.append({"label": label, "button": button.get("label", ""), "callback": parsed})
                if parsed.get("action") == "approve_public_publish":
                    public_publish_callbacks += 1
                    if parsed.get("reason") != "owner_approved_public_publish_after_youtube_checks":
                        blockers.append("Public publish control is missing the explicit owner YouTube-check reason.")
                    if parsed.get("repair_scope") != "public_publish_gate":
                        blockers.append("Public publish control is not scoped to public_publish_gate.")
            except Exception as exc:
                blockers.append(f"Button callback failed taxonomy validation: {label} / {button.get('label','')}: {exc}.")

    missing_labels = sorted(REQUIRED_LONG_FORM_LABELS - set(labels))
    for label in missing_labels:
        blockers.append(f"Required long-form review packet step is missing: {label}.")
    if REQUIRED_GATE_LABEL not in labels:
        blockers.append("Package gate controls are missing.")
    if short_videos < 3:
        blockers.append(f"Each rendered Short needs its own message; found {short_videos} Short video messages.")
    if short_controls < 3:
        blockers.append(f"Each rendered Short needs its own controls; found {short_controls} Short control messages.")
    if thumbnail_images < 3:
        blockers.append(f"Thumbnail review images are incomplete; found {thumbnail_images} candidate messages.")
    if thumbnail_controls < 3:
        blockers.append(f"Thumbnail controls are incomplete; found {thumbnail_controls} candidate control payloads.")
    if public_publish_callbacks:
        warnings.append("Public publish control is present but remains gate-scoped; processing still blocks until live YouTube verification and explicit owner public approval preconditions pass.")
    manifest_time = parse_time((manifest or {}).get("generated_at"))
    delivery_time = parse_time(delivery_report.get("generated_at") or delivery_report.get("sent_at"))
    if not delivery_report:
        live_packet_state = "not_sent"
    elif manifest_time and delivery_time and delivery_time < manifest_time:
        live_packet_state = "resend_required"
        warnings.append("Latest dry-run Discord review packet is newer than the last sent Discord packet; resend is required before relying on live buttons.")
    else:
        live_packet_state = "sent_current_or_timestamp_unavailable"

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "manifest": display_path(manifest_path) if manifest_path.exists() else "missing",
        "step_count": len(steps),
        "kind_counts": dict(kind_counts),
        "long_form_labels_present": sorted(set(labels) & REQUIRED_LONG_FORM_LABELS),
        "short_video_messages": short_videos,
        "short_control_messages": short_controls,
        "thumbnail_image_messages": thumbnail_images,
        "thumbnail_control_payloads": thumbnail_controls,
        "callback_count": len(callback_results),
        "public_publish_callbacks": public_publish_callbacks,
        "live_discord_packet_state": live_packet_state,
        "last_delivery_report": display_path(delivery_report_path) if delivery_report_path.exists() else "missing",
        "warnings": warnings,
        "blockers": blockers,
        "callbacks": callback_results,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "discord-review-packet-quality-report.json"
    md_path = approval / "discord-review-packet-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Discord Review Packet Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Manifest: {payload['manifest']}",
        f"Callbacks validated: {payload['callback_count']}",
        "",
        "## Packet Counts",
        "",
        f"- Short video messages: {short_videos}",
        f"- Short controls: {short_controls}",
        f"- Thumbnail messages: {thumbnail_images}",
        f"- Thumbnail controls: {thumbnail_controls}",
        f"- Public publish callbacks: {public_publish_callbacks}",
        f"- Live Discord packet state: {live_packet_state}",
        "",
        "## Warnings",
        "",
    ]
    lines.extend([f"- {item}" for item in warnings] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    lines.extend(["", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Discord review packet manifest.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = validate_manifest(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Discord review packet quality report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
