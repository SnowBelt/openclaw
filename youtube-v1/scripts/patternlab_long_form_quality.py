#!/usr/bin/env python3
import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

from patternlab_common import (
    display_path,
    ensure_dir,
    ffprobe_cmd,
    media_duration_seconds,
    output_root,
    utc_now,
)
from patternlab_content_quality import build_content_quality_report
from patternlab_episode_standard import build_episode_standard_report


MIN_LONG_FORM_SECONDS = 8 * 60
MAX_LONG_FORM_SECONDS = 14 * 60
REQUIRED_WIDTH = 1920
REQUIRED_HEIGHT = 1080
MAX_PROOF_SECONDS = 20.0
MIN_TITLE_OPTIONS = 5
MIN_CHAPTERS = 4
MIN_VISUAL_BEATS = 12
MIN_MATCHED_BEATS = 8
MAX_VISUAL_BEAT_SECONDS = 20.0
REQUIRED_LEDGER_TYPES = ("voiceover", "proof_footage", "video")
REQUIRED_VISUAL_ROLES = (
    "source_proof",
    "map_system",
    "archive_evidence",
    "then_now",
    "context_only",
    "city_file_cta",
)


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_ledger(path):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def add_check(checks, name, passed, detail, blocker=True):
    checks.append(
        {
            "name": name,
            "passed": bool(passed),
            "detail": detail,
            "blocker": bool(blocker),
        }
    )


def ffprobe_streams(path):
    result = subprocess.run(
        [
            ffprobe_cmd(),
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout or "{}").get("streams", [])


def video_dimensions(path):
    for stream in ffprobe_streams(path):
        if stream.get("codec_type") == "video":
            return int(stream.get("width", 0)), int(stream.get("height", 0))
    return 0, 0


def has_audio_stream(path):
    return any(stream.get("codec_type") == "audio" for stream in ffprobe_streams(path))


def parse_visual_plan(path):
    metrics = {
        "exists": path.exists(),
        "opening_proof_seconds": None,
        "script_aware": False,
        "intentional_changes": False,
        "best_practice_rules": False,
        "beat_count": 0,
        "matched_count": 0,
        "max_beat_seconds": None,
        "average_beat_seconds": None,
        "declared_source_context_roles": False,
        "source_proof_before_context_only": False,
        "context_broll_not_proof": False,
        "source_proof_role_count": 0,
        "context_only_role_count": 0,
        "beats": [],
    }
    if not path.exists():
        return metrics
    text = path.read_text(encoding="utf-8")
    proof_match = re.search(r"Opening proof clip: first ([0-9.]+)s", text)
    if proof_match:
        metrics["opening_proof_seconds"] = float(proof_match.group(1))
    metrics["script_aware"] = "Voiceover/script: script-aware timeline" in text
    metrics["intentional_changes"] = "change visuals only when the narration changes topic" in text
    metrics["best_practice_rules"] = "## Best-Practice Rules Applied" in text
    metrics["matched_count"] = text.count("Matched narration")
    source_proof_index = text.find("role=source_proof")
    context_only_index = text.find("role=context_only")
    metrics["declared_source_context_roles"] = all(role in text for role in REQUIRED_VISUAL_ROLES)
    metrics["source_proof_before_context_only"] = source_proof_index >= 0 and (
        context_only_index < 0 or source_proof_index < context_only_index
    )
    metrics["context_broll_not_proof"] = (
        "stock/context b-roll is context only and cannot carry historical claims" in text.lower()
    )
    metrics["source_proof_role_count"] = text.count("role=source_proof")
    metrics["context_only_role_count"] = text.count("role=context_only")
    for match in re.finditer(r"^- \d+:\s+([0-9.]+)s-([0-9.]+)s\s+\|", text, flags=re.MULTILINE):
        start = float(match.group(1))
        end = float(match.group(2))
        if end > start:
            metrics["beats"].append({"start": start, "end": end, "duration": end - start})
    metrics["beat_count"] = len(metrics["beats"])
    if metrics["beats"]:
        durations = [beat["duration"] for beat in metrics["beats"]]
        metrics["max_beat_seconds"] = max(durations)
        metrics["average_beat_seconds"] = sum(durations) / len(durations)
    return metrics


def validate_metadata(path):
    metadata = read_json(path)
    checks = []
    if not metadata:
        add_check(checks, "metadata_exists", False, "upload metadata is missing or invalid")
        return checks, metadata
    title_options = metadata.get("title_options") or []
    default_title = metadata.get("default_title") or ""
    default_thumbnail = metadata.get("default_thumbnail") or ""
    description = metadata.get("description") or ""
    tags = metadata.get("tags") or []
    chapters = metadata.get("chapters") or []
    pinned = metadata.get("pinned_comment") or ""
    synthetic = metadata.get("synthetic_disclosure_decision") or ""
    add_check(checks, "title_options", len(title_options) >= MIN_TITLE_OPTIONS, f"{len(title_options)} title options")
    add_check(checks, "default_title", bool(default_title), "default title present")
    add_check(checks, "default_thumbnail", bool(default_thumbnail), "default thumbnail present")
    add_check(checks, "description", bool(description), "description present")
    add_check(checks, "tags", len(tags) >= 5, f"{len(tags)} tags")
    add_check(checks, "chapters", len(chapters) >= MIN_CHAPTERS, f"{len(chapters)} chapters")
    add_check(checks, "pinned_comment", bool(pinned), "pinned comment present")
    add_check(checks, "synthetic_disclosure_decision", bool(synthetic), "synthetic disclosure decision present")
    if default_title:
        add_check(
            checks,
            "title_length",
            35 <= len(default_title) <= 75,
            f"default title is {len(default_title)} characters",
            blocker=False,
        )
    return checks, metadata


def validate_ledger(path):
    rows = read_ledger(path)
    checks = []
    add_check(checks, "rights_ledger_exists", bool(rows), "rights ledger has rows")
    for asset_type in REQUIRED_LEDGER_TYPES:
        typed = [row for row in rows if row.get("asset_type") == asset_type]
        add_check(checks, f"ledger_{asset_type}", bool(typed), f"{len(typed)} {asset_type} rows")
        pending_or_approved = [
            row
            for row in typed
            if row.get("human_review_status", "").lower() in {"pending", "approved"}
            and row.get("human_review_required", "").lower() == "yes"
        ]
        if typed:
            add_check(
                checks,
                f"ledger_{asset_type}_review_state",
                len(pending_or_approved) == len(typed),
                f"{len(pending_or_approved)}/{len(typed)} rows require human review and are pending or approved",
            )
    return checks, rows


def build_long_form_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    proof = root / "proof-footage" / "artifact-proof-clip.mp4"
    visual_plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    metadata_path = approval / "upload-metadata.json"
    ledger_path = root / "rights-ledger.csv"
    review_packet = root / "review" / "owner-review-packet.md"
    discord_proxy = root / "review" / f"pattern-lab-video-{video_id}-draft-discord-review.mp4"
    checks = []
    warnings = []

    add_check(checks, "long_form_exists", long_form.exists(), f"{display_path(long_form)} {'exists' if long_form.exists() else 'is missing'}")
    duration = None
    if long_form.exists():
        try:
            duration = media_duration_seconds(long_form)
            add_check(
                checks,
                "long_form_duration",
                MIN_LONG_FORM_SECONDS <= duration <= MAX_LONG_FORM_SECONDS,
                f"{duration:.1f}s",
            )
        except Exception as exc:
            add_check(checks, "long_form_duration", False, f"could not read duration: {exc}")
        try:
            width, height = video_dimensions(long_form)
            add_check(
                checks,
                "long_form_dimensions",
                width == REQUIRED_WIDTH and height == REQUIRED_HEIGHT,
                f"{width}x{height}",
            )
        except Exception as exc:
            add_check(checks, "long_form_dimensions", False, f"could not read dimensions: {exc}")
        try:
            add_check(checks, "long_form_audio_stream", has_audio_stream(long_form), "audio stream present")
        except Exception as exc:
            add_check(checks, "long_form_audio_stream", False, f"could not read audio streams: {exc}")

    add_check(checks, "proof_footage_exists", proof.exists(), f"{display_path(proof)} {'exists' if proof.exists() else 'is missing'}")
    plan = parse_visual_plan(visual_plan)
    add_check(checks, "visual_plan_exists", plan["exists"], f"{display_path(visual_plan)} {'exists' if plan['exists'] else 'is missing'}")
    if plan["exists"]:
        proof_seconds = plan["opening_proof_seconds"]
        proof_detail = (
            f"opening proof clip is {proof_seconds:.1f}s"
            if proof_seconds is not None
            else "opening proof clip is missing"
        )
        add_check(
            checks,
            "proof_in_first_20_seconds",
            proof_seconds is not None and 0 < proof_seconds <= MAX_PROOF_SECONDS,
            proof_detail,
        )
        add_check(checks, "script_aware_visual_plan", plan["script_aware"], "visual plan is script-aware")
        add_check(checks, "intentional_visual_changes", plan["intentional_changes"], "visual changes are tied to narration changes")
        add_check(checks, "visual_best_practice_rules", plan["best_practice_rules"], "best-practice rules are recorded")
        add_check(checks, "visual_source_context_roles", plan["declared_source_context_roles"], "source/context role labels are declared")
        add_check(checks, "source_proof_before_context_only", plan["source_proof_before_context_only"], "source proof appears before context-only visuals")
        add_check(checks, "stock_context_not_historical_proof", plan["context_broll_not_proof"], "stock/context B-roll cannot carry historical claims")
        add_check(checks, "visual_beat_count", plan["beat_count"] >= MIN_VISUAL_BEATS, f"{plan['beat_count']} beats")
        add_check(checks, "matched_narration_beats", plan["matched_count"] >= MIN_MATCHED_BEATS, f"{plan['matched_count']} matched narration beats")
        if plan["max_beat_seconds"] is not None:
            add_check(
                checks,
                "visual_beat_density",
                plan["max_beat_seconds"] <= MAX_VISUAL_BEAT_SECONDS,
                f"max beat {plan['max_beat_seconds']:.1f}s, average {plan['average_beat_seconds']:.1f}s",
            )

    content_quality, content_quality_report = build_content_quality_report(video_id)
    add_check(
        checks,
        "script_and_visual_content_quality",
        content_quality.get("status") == "pass",
        f"{content_quality.get('status')} at {display_path(content_quality_report)}",
    )
    episode_standard, episode_standard_json_report, episode_standard_md_report = build_episode_standard_report(video_id)
    add_check(
        checks,
        "episode_standard_pass",
        episode_standard.get("status") == "pass",
        f"{episode_standard.get('status')} at {display_path(episode_standard_md_report)}",
    )
    metadata_checks, metadata = validate_metadata(metadata_path)
    checks.extend(metadata_checks)
    ledger_checks, rows = validate_ledger(ledger_path)
    checks.extend(ledger_checks)
    add_check(checks, "owner_review_packet", review_packet.exists(), f"{display_path(review_packet)} {'exists' if review_packet.exists() else 'is missing'}", blocker=False)

    if discord_proxy.exists() and long_form.exists() and duration is not None:
        try:
            proxy_duration = media_duration_seconds(discord_proxy)
            add_check(
                checks,
                "discord_proxy_duration",
                proxy_duration + 5 >= duration,
                f"proxy {proxy_duration:.1f}s vs draft {duration:.1f}s",
            )
        except Exception as exc:
            warnings.append(f"Could not verify Discord proxy duration: {exc}.")

    blockers = [
        f"{check['name']}: {check['detail']}"
        for check in checks
        if check["blocker"] and not check["passed"]
    ]
    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "duration_seconds": duration,
        "long_form": display_path(long_form),
        "visual_plan": {
            key: value
            for key, value in plan.items()
            if key != "beats"
        },
        "metadata_present": bool(metadata),
        "ledger_rows": len(rows),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "reports": {
            "content_quality": display_path(content_quality_report),
            "episode_standard": display_path(episode_standard_json_report),
            "episode_standard_md": display_path(episode_standard_md_report),
        },
    }
    json_path = approval / "long-form-quality-report.json"
    md_path = approval / "long-form-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Long-Form Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {status}",
        f"Draft: {payload['long_form']}",
        f"Duration: {duration:.1f}s" if duration is not None else "Duration: missing",
        "",
        "## Strategy",
        "",
        "- Target: 8-14 minute watch-hour asset.",
        "- Opening: result, source proof, or contradiction before branding.",
        "- Proof: source proof appears in the first 20 seconds.",
        "- Visuals: change only when the narration changes topic, proof state, example, or decision.",
        "- Review: owner approval remains required before private/unlisted upload and public publishing.",
        "",
        "## Checks",
        "",
    ]
    for check in checks:
        lines.append(
            f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab long-form video quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, report = build_long_form_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Long-form quality report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()
