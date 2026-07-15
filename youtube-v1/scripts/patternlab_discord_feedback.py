#!/usr/bin/env python3
"""Shared Pattern Lab Discord owner-feedback taxonomy and helpers."""
import json
import re
import uuid
from collections import Counter
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now


LONG_FORM_REASONS = {
    "redo_hook": "long_form_hook_only",
    "visuals_mismatch": "long_form_visuals_only",
    "pacing_needs_revision": "long_form_visuals_only",
    "voice_needs_revision": "long_form_voice_only",
    "random_text_box": "long_form_visuals_only",
    "fact_source_issue": "long_form_visuals_only",
    "possible_private_info": "long_form_visuals_only",
    "reject_topic": "topic_replacement",
}
SHORT_REASONS = {
    "weak_hook": "this_short_only",
    "starts_mid_sentence": "this_short_only",
    "no_clear_point": "this_short_only",
    "random_text_box": "this_short_only",
    "bad_crop": "this_short_only",
    "captions_unreadable": "this_short_only",
    "visuals_mismatch": "this_short_only",
    "too_slow": "this_short_only",
    "audio_bad": "this_short_only",
    "bad_loop": "this_short_only",
    "does_not_bridge_to_long_form": "this_short_only",
    "reject_concept": "this_short_only",
}
THUMBNAIL_REASONS = {
    "thumbnail_not_clickable": "thumbnail_new_idea",
    "thumbnail_wrong_promise": "thumbnail_new_idea",
    "bad_font_color": "thumbnail_same_idea",
    "too_cluttered": "thumbnail_same_idea",
    "too_generic": "thumbnail_new_idea",
    "text_hard_to_read": "thumbnail_same_idea",
    "wrong_city_feel": "thumbnail_new_idea",
    "regenerate_same_idea": "thumbnail_same_idea",
    "regenerate_new_idea": "thumbnail_new_idea",
}
POSITIVE_REASONS = {
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
GATE_REASONS = {
    "owner_approved_full_review_package",
    "owner_approved_private_or_unlisted_upload",
    "owner_approved_public_publish_after_youtube_checks",
}
SUPPORT_REASONS = {
    "manual_note",
    "owner_review",
    "avatar_style_not_approved",
    "owner_requested_avatar_variant",
    "owner_requested_image_variants",
    "voice_needs_revision",
}

REPAIR_SCOPES = {
    "this_short_only",
    "all_shorts",
    "long_form_hook_only",
    "long_form_visuals_only",
    "long_form_voice_only",
    "thumbnail_same_idea",
    "thumbnail_new_idea",
    "topic_replacement",
    "asset_only",
    "review_package_gate",
    "private_upload_gate",
    "public_publish_gate",
}

LEGACY_REASON_MAP = {
    "owner_requested_short_variant": "reject_concept",
    "owner_requested_thumbnail_variant": "regenerate_same_idea",
    "thumbnail_does_not_hold_attention_or_match_promise": "thumbnail_not_clickable",
    "owner_requested_hook_revision": "redo_hook",
    "owner_rejected_topic": "reject_topic",
    "visuals_need_revision": "visuals_mismatch",
    "bad_captions": "captions_unreadable",
    "caption_bad": "captions_unreadable",
}

ASSET_REASON_DEFAULTS = {
    "video": LONG_FORM_REASONS,
    "short": SHORT_REASONS,
    "thumbnail": THUMBNAIL_REASONS,
}

REQUIRED_REASON_CODES = sorted(
    set(LONG_FORM_REASONS)
    | set(SHORT_REASONS)
    | set(THUMBNAIL_REASONS)
    | POSITIVE_REASONS
)

APPROVAL_ACTIONS = {"approve", "approve_review_package", "approve_private_upload", "approve_public_publish"}
NEGATIVE_ACTIONS = {"reject", "repair", "regenerate", "revise_hook", "kill_topic"}


def normalize_reason(reason):
    reason = (reason or "owner_review").strip()
    return LEGACY_REASON_MAP.get(reason, reason)


def reason_known(reason):
    normalized = normalize_reason(reason)
    return normalized in (
        set(LONG_FORM_REASONS)
        | set(SHORT_REASONS)
        | set(THUMBNAIL_REASONS)
        | POSITIVE_REASONS
        | GATE_REASONS
        | SUPPORT_REASONS
    )


def allowed_reasons():
    return sorted(
        set(LONG_FORM_REASONS)
        | set(SHORT_REASONS)
        | set(THUMBNAIL_REASONS)
        | POSITIVE_REASONS
        | GATE_REASONS
        | SUPPORT_REASONS
        | set(LEGACY_REASON_MAP)
    )


def sentiment_for(action, reason):
    normalized = normalize_reason(reason)
    if action in {"approve_review_package", "approve_private_upload", "approve_public_publish"} or normalized in GATE_REASONS:
        return "gate"
    if normalized in POSITIVE_REASONS or action == "approve":
        return "positive"
    return "negative"


def default_repair_scope(asset_type, action, reason):
    normalized = normalize_reason(reason)
    if action == "approve_review_package":
        return "review_package_gate"
    if action == "approve_private_upload":
        return "private_upload_gate"
    if action == "approve_public_publish":
        return "public_publish_gate"
    if normalized == "reject_topic" or asset_type == "topic" or action == "kill_topic":
        return "topic_replacement"
    if normalized == "redo_hook":
        return "long_form_hook_only"
    if normalized in LONG_FORM_REASONS and asset_type == "video":
        return LONG_FORM_REASONS[normalized]
    if normalized in SHORT_REASONS and asset_type == "short":
        return SHORT_REASONS[normalized]
    if normalized in THUMBNAIL_REASONS and asset_type == "thumbnail":
        return THUMBNAIL_REASONS[normalized]
    if asset_type == "voiceover":
        return "long_form_voice_only"
    return "asset_only"


def validate_repair_scope(scope):
    if scope not in REPAIR_SCOPES:
        raise ValueError(f"unknown repair scope: {scope}")
    return scope


def validate_reason(action, asset_type, reason, freeform_note=""):
    normalized = normalize_reason(reason)
    if not reason_known(normalized):
        if freeform_note:
            return "manual_note"
        raise ValueError(f"unknown Pattern Lab feedback reason: {reason}")
    if normalized in POSITIVE_REASONS:
        return normalized
    if action in APPROVAL_ACTIONS and normalized in {"owner_review", *GATE_REASONS}:
        return normalized
    if asset_type in ASSET_REASON_DEFAULTS and normalized in ASSET_REASON_DEFAULTS[asset_type]:
        return normalized
    if normalized in SUPPORT_REASONS or normalized in GATE_REASONS:
        return normalized
    if normalized == "reject_topic" and asset_type in {"topic", "video", ""}:
        return normalized
    # Shared visual/pacing reasons may apply to both video and short.
    if normalized in {"visuals_mismatch", "random_text_box"} and asset_type in {"video", "short"}:
        return normalized
    if normalized in {"voice_needs_revision", "possible_private_info"} and asset_type in {"video", "voiceover"}:
        return normalized
    raise ValueError(f"reason {normalized} is not valid for asset_type={asset_type or 'missing'} action={action}")


def parse_callback(raw):
    if raw.startswith("patternlab:"):
        raw = raw[len("patternlab:") :]
    payload = json.loads(raw)
    action = payload.get("action", "")
    asset_type = payload.get("assetType") or payload.get("asset_type") or ""
    reason = validate_reason(action, asset_type, payload.get("reason", "owner_review"), payload.get("freeformNote", ""))
    repair_scope = payload.get("repairScope") or payload.get("repair_scope") or default_repair_scope(asset_type, action, reason)
    validate_repair_scope(repair_scope)
    release_candidate_id = payload.get("releaseCandidateId") or payload.get("release_candidate_id") or ""
    release_candidate_sha256 = payload.get("releaseCandidateSha256") or payload.get("release_candidate_sha256") or ""
    artifact_sha256 = payload.get("artifactSha256") or payload.get("artifact_sha256") or ""
    if not release_candidate_id or not release_candidate_sha256:
        raise ValueError("unbound_discord_callback_release")
    if asset_type and asset_type != "topic" and not artifact_sha256:
        raise ValueError("unbound_discord_callback_artifact")
    return {
        "video_id": payload.get("videoId") or payload.get("video_id") or "",
        "action": action,
        "asset_type": asset_type,
        "asset_id": payload.get("assetId") or payload.get("asset_id") or "",
        "filename": payload.get("filename", ""),
        "reason": reason,
        "original_reason": payload.get("reason", reason),
        "repair_scope": repair_scope,
        "freeform_note": payload.get("freeformNote") or payload.get("freeform_note") or "",
        "timestamp_start": payload.get("timestampStart") or payload.get("timestamp_start") or "",
        "timestamp_end": payload.get("timestampEnd") or payload.get("timestamp_end") or "",
        "release_candidate_id": release_candidate_id,
        "release_candidate_sha256": release_candidate_sha256,
        "artifact_sha256": artifact_sha256,
    }


def callback_value(action, asset_type, video_id, asset_id=None, filename=None, reason=None, repair_scope=None, freeform_note=None, release_candidate_id=None, release_candidate_sha256=None, artifact_sha256=None):
    reason = validate_reason(action, asset_type, reason or "owner_review", freeform_note or "")
    repair_scope = repair_scope or default_repair_scope(asset_type, action, reason)
    validate_repair_scope(repair_scope)
    payload = {"action": action, "videoId": video_id, "reason": reason, "repairScope": repair_scope}
    if asset_type:
        payload["assetType"] = asset_type
    if asset_id:
        payload["assetId"] = asset_id
    if filename:
        payload["filename"] = filename
    if freeform_note:
        payload["freeformNote"] = freeform_note
    if release_candidate_id:
        payload["releaseCandidateId"] = release_candidate_id
    if release_candidate_sha256:
        payload["releaseCandidateSha256"] = release_candidate_sha256
    if artifact_sha256:
        payload["artifactSha256"] = artifact_sha256
    return "patternlab:" + json.dumps(payload, separators=(",", ":"))


def owner_feedback_event(video_id, action, asset_type="", asset_id="", filename="", reason="owner_review", repair_scope="", source="discord", freeform_note="", timestamp_start="", timestamp_end="", original_reason=""):
    reason = validate_reason(action, asset_type, reason, freeform_note)
    repair_scope = repair_scope or default_repair_scope(asset_type, action, reason)
    validate_repair_scope(repair_scope)
    event = {
        "event_id": uuid.uuid4().hex,
        "created_at": utc_now(),
        "video_id": video_id,
        "asset_type": asset_type,
        "asset_id": asset_id or "",
        "filename": filename or "",
        "action": action,
        "reason": reason,
        "repair_scope": repair_scope,
        "sentiment": sentiment_for(action, reason),
        "source": source,
        "freeform_note": freeform_note or "",
        "timestamp_start": timestamp_start or "",
        "timestamp_end": timestamp_end or "",
    }
    if original_reason and original_reason != reason:
        event["original_reason"] = original_reason
    return event


def append_owner_feedback(root, event):
    path = ensure_dir(root / "approval") / "owner-feedback.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, separators=(",", ":")) + "\n")
    return path


def read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def parse_timestamp(value):
    if not value:
        return ""
    parts = value.split(":")
    if len(parts) == 2 and all(part.isdigit() for part in parts):
        minutes, seconds = [int(part) for part in parts]
        return f"{minutes:02d}:{seconds:02d}"
    return value


def infer_reason(text, asset_type):
    lower = text.lower()
    if "random" in lower and ("box" in lower or "text" in lower):
        return "random_text_box"
    if "mid" in lower and "sentence" in lower:
        return "starts_mid_sentence"
    if "no point" in lower or "clear point" in lower:
        return "no_clear_point"
    if "visual" in lower and ("match" in lower or "wrong" in lower):
        return "visuals_mismatch"
    if "crop" in lower:
        return "bad_crop"
    if "caption" in lower:
        return "captions_unreadable"
    if "slow" in lower:
        return "too_slow"
    if "audio" in lower or "sound" in lower:
        return "audio_bad"
    if "loop" in lower or "ending" in lower:
        return "bad_loop"
    if "bridge" in lower or "full video" in lower or "long-form" in lower:
        return "does_not_bridge_to_long_form"
    if "hook" in lower:
        return "weak_hook" if asset_type == "short" else "redo_hook"
    if "source" in lower or "fact" in lower:
        return "fact_source_issue"
    if "font" in lower or "color" in lower or "colour" in lower:
        return "bad_font_color"
    if "hard to read" in lower or "readable" in lower:
        return "text_hard_to_read"
    if "generic" in lower:
        return "too_generic"
    if "click" in lower:
        return "thumbnail_not_clickable"
    return "manual_note"


def parse_owner_note(video_id, text):
    raw = text.strip()
    # Split only on separator dashes surrounded by whitespace so labels such as
    # "Long-form" stay intact.
    parts = [part.strip() for part in re.split(r"\s+[—–-]\s+", raw) if part.strip()]
    head = parts[0] if parts else raw
    note = parts[-1] if len(parts) > 1 else raw
    timestamp = ""
    if len(parts) >= 3 and re.fullmatch(r"\d{1,2}:\d{2}", parts[1]):
        timestamp = parse_timestamp(parts[1])
        note = " - ".join(parts[2:])
    asset_type = "note"
    asset_id = ""
    filename = ""
    action = "repair"
    lower_head = head.lower()
    if lower_head.startswith("short"):
        match = re.search(r"(\d+)", lower_head)
        index = int(match.group(1)) if match else 0
        asset_type = "short"
        asset_id = f"video-{video_id}-short-{index:02d}" if index else ""
    elif lower_head.startswith("long") or lower_head.startswith("video"):
        asset_type = "video"
        asset_id = f"video-{video_id}-long-form"
    elif lower_head.startswith("thumbnail"):
        asset_type = "thumbnail"
        match = re.search(r"thumbnail\s+([a-z])", lower_head)
        if match:
            label = match.group(1).lower()
            filename = f"images/thumbnail_candidate_{label}.png"
            asset_id = f"video-{video_id}-thumbnail-{label}"
    reason = infer_reason(note, asset_type)
    if asset_type == "note":
        action = "note"
        reason = "manual_note"
        repair_scope = "asset_only"
    else:
        repair_scope = default_repair_scope(asset_type, action, reason)
    return owner_feedback_event(
        video_id,
        action,
        asset_type=asset_type,
        asset_id=asset_id,
        filename=filename,
        reason=reason,
        repair_scope=repair_scope,
        freeform_note=raw,
        timestamp_start=timestamp,
    )


def unresolved_repairs(root):
    rows = read_jsonl(root / "approval" / "repair-queue.jsonl")
    return [row for row in rows if row.get("status", "queued") not in {"resolved", "closed", "cancelled", "dry-run"}]


def write_report(root, name, payload, title):
    approval = ensure_dir(root / "approval")
    json_path = approval / f"{name}.json"
    md_path = approval / f"{name}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [f"# {title}", "", f"Generated: {payload.get('generated_at', '')}", f"Status: {payload.get('status', '')}", ""]
    if payload.get("summary"):
        lines.extend(["## Summary", ""])
        for item in payload["summary"]:
            lines.append(f"- {item}")
        lines.append("")
    if payload.get("blockers"):
        lines.extend(["## Blockers", ""])
        lines.extend([f"- {item}" for item in payload["blockers"]])
    else:
        lines.extend(["## Blockers", "", "- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def summarize_events(events):
    return {
        "count": len(events),
        "by_sentiment": dict(Counter(event.get("sentiment", "missing") for event in events)),
        "by_asset_type": dict(Counter(event.get("asset_type", "missing") for event in events)),
        "by_reason": dict(Counter(event.get("reason", "missing") for event in events)),
    }
