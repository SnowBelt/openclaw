#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from patternlab_common import display_path, ensure_dir, media_duration_seconds, output_root, utc_now


DOCUMENTARY_MOTION_STYLES = {
    "ken_burns_push",
    "ken_burns_pan_right",
    "ken_burns_pan_left",
    "slow_context_pan",
    "map_zoom_trace",
    "document_closeup",
    "source_highlight",
    "source_closeup",
    "then_now_reveal",
    "then_now_split",
    "subtle_parallax",
    "cta_push",
}
LEGACY_GENERATED_SLIDES = {
    "images/city_source_map.png",
    "images/archival_evidence_board.png",
    "images/then_now_structure.png",
    "images/subscribe_city_file_card.png",
}


def read_json(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def parse_z(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_beats(plan):
    if not plan.exists():
        return []
    beats = []
    for line in plan.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^-\s*(\d+):\s*([0-9.]+)s-([0-9.]+)s\s*\|\s*([^|]+)\|\s*role=([^|]+)\|", line)
        if not match:
            continue
        motion_match = re.search(r"\|\s*motion_style=([^|]+)\|\s*motion_reason=([^|]+)\|", line)
        source_role_match = re.search(r"\|\s*source_role=([^|]+)\|", line)
        visual_category_match = re.search(r"\|\s*visual_category=([^|]+)\|", line)
        start = float(match.group(2))
        end = float(match.group(3))
        beats.append({
            "index": int(match.group(1)),
            "start": start,
            "end": end,
            "duration": max(0, end - start),
            "path": match.group(4).strip(),
            "role": match.group(5).strip(),
            "source_role": source_role_match.group(1).strip() if source_role_match else "",
            "visual_category": visual_category_match.group(1).strip() if visual_category_match else "",
            "motion_style": motion_match.group(1).strip() if motion_match else "",
            "motion_reason": motion_match.group(2).strip() if motion_match else "",
            "line": line,
        })
    return beats


def upload_report_paths(root):
    approval = root / "approval"
    return [
        approval / "youtube-upload-report.json",
        approval / "youtube-upload-report-short-01.json",
        approval / "youtube-upload-report-short-02.json",
        approval / "youtube-upload-report-short-03.json",
    ]


def newest_upload_time(root):
    times = []
    for path in upload_report_paths(root):
        payload = read_json(path) or {}
        uploaded = parse_z(payload.get("uploaded_at") or payload.get("generated_at"))
        if uploaded:
            times.append(uploaded.timestamp())
    return max(times) if times else None


def add_check(checks, blockers, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})
    if not passed:
        blockers.append(f"{name}: {detail}")


def is_generated_slide(beat):
    path = beat["path"]
    return path in LEGACY_GENERATED_SLIDES or (path.startswith("images/") and "source-packet/visual-rebuild" not in path)


def is_modern_context(beat):
    path = beat["path"]
    return beat["role"] == "context_only" or beat.get("source_role") == "modern_context" or "modern-context" in path


def build_motion_polish_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    public_approval = approval / "public-publish-approval.json"
    beats = parse_beats(plan)
    non_proof = [beat for beat in beats if beat["role"] != "source_proof"]
    motion_beats = [beat for beat in beats if beat["motion_style"]]
    documentary = [beat for beat in motion_beats if beat["motion_style"] in DOCUMENTARY_MOTION_STYLES]
    static_only = [beat for beat in beats if beat["motion_style"] in {"", "static_only"}]
    static_only_non_proof = [beat for beat in non_proof if beat["motion_style"] in {"", "static_only"}]
    generated_slide_motion = [beat for beat in beats if is_generated_slide(beat)]
    modern_context_beats = [beat for beat in beats if is_modern_context(beat)]
    max_non_proof_duration = max((beat["duration"] for beat in non_proof), default=0)
    has_ken_burns = any(beat["motion_style"].startswith("ken_burns") for beat in beats)
    has_source_document_closeup = any(
        beat["motion_style"] in {"source_highlight", "document_closeup", "source_closeup"}
        for beat in beats
    )
    has_map_or_then_now = any(
        beat["motion_style"] in {"map_zoom_trace", "then_now_reveal", "then_now_split"}
        for beat in beats
    )
    has_modern_context_motion = not modern_context_beats or any(
        beat["motion_style"] in {"slow_context_pan", "subtle_parallax"}
        for beat in modern_context_beats
    )
    share = len(documentary) / len(beats) if beats else 0
    upload_time = newest_upload_time(root)
    local_video_time = long_form.stat().st_mtime if long_form.exists() else None
    local_rerender_requires_review_upload = bool(upload_time and local_video_time and local_video_time > upload_time)

    checks = []
    blockers = []
    warnings = []
    add_check(checks, blockers, "visual_plan_exists", plan.exists(), display_path(plan))
    add_check(checks, blockers, "long_form_draft_exists", long_form.exists(), display_path(long_form))
    if long_form.exists():
        try:
            duration = media_duration_seconds(long_form)
            add_check(checks, blockers, "long_form_duration_readable", duration >= 60, f"duration {duration:.1f}s")
        except Exception as exc:
            add_check(checks, blockers, "long_form_duration_readable", False, str(exc))
    add_check(checks, blockers, "motion_metadata_complete", len(motion_beats) == len(beats), f"{len(motion_beats)}/{len(beats)} visual beats")
    add_check(checks, blockers, "documentary_motion_share", share >= 0.95, f"documentary motion share {share:.1%}")
    add_check(checks, blockers, "static_only_visual_beat_count", len(static_only) == 0, f"{len(static_only)} static-only visual beats")
    add_check(checks, blockers, "static_only_non_proof_count", len(static_only_non_proof) == 0, f"{len(static_only_non_proof)} static-only non-proof beats")
    add_check(checks, blockers, "no_generated_slide_motion", len(generated_slide_motion) == 0, f"{len(generated_slide_motion)} generated slide beats")
    add_check(checks, blockers, "ken_burns_motion_present", has_ken_burns, "at least one historical Ken Burns movement")
    add_check(checks, blockers, "source_document_closeup_or_highlight_present", has_source_document_closeup, "at least one source/document closeup or source highlight movement")
    add_check(checks, blockers, "map_or_then_now_motion_present", has_map_or_then_now, "map or then/now movement present")
    add_check(checks, blockers, "modern_context_pan_or_parallax_present", has_modern_context_motion, f"{len(modern_context_beats)} modern context beats")
    add_check(checks, blockers, "max_non_proof_beat_duration", max_non_proof_duration <= 12.0, f"max non-proof beat {max_non_proof_duration:.1f}s")
    public_publish_approval_status = "approved" if public_approval.exists() else "blocked_until_explicit_owner_approval"
    checks.append({
        "name": "public_publish_approval_separate_gate",
        "passed": True,
        "detail": f"{display_path(public_approval)} ({public_publish_approval_status}); not counted against local motion polish",
    })
    if local_rerender_requires_review_upload:
        warnings.append("Local motion-polished render is newer than the current private YouTube upload; replacement review/upload is required before public publish.")

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "visual_plan": display_path(plan),
        "long_form": display_path(long_form),
        "visual_beat_count": len(beats),
        "motion_beat_count": len(motion_beats),
        "non_proof_beat_count": len(non_proof),
        "documentary_motion_share": round(share, 4),
        "static_only_visual_beat_count": len(static_only),
        "static_only_non_proof_count": len(static_only_non_proof),
        "generated_slide_motion_count": len(generated_slide_motion),
        "max_non_proof_beat_seconds": round(max_non_proof_duration, 2),
        "modern_context_beat_count": len(modern_context_beats),
        "local_rerender_requires_review_upload": local_rerender_requires_review_upload,
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "motion_styles": sorted({beat["motion_style"] for beat in motion_beats}),
        "public_publish": public_publish_approval_status,
        "public_publish_approval_required_before_public_mutation": not public_approval.exists(),
    }
    json_path = approval / "motion-polish-report.json"
    md_path = approval / "motion-polish-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Motion Polish: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Public publish: {payload['public_publish']}",
        f"Motion beats: {payload['motion_beat_count']}/{payload['visual_beat_count']}",
        f"Documentary motion share: {payload['documentary_motion_share']:.1%}",
        f"Static-only visual beats: {payload['static_only_visual_beat_count']}",
        f"Static-only non-proof beats: {payload['static_only_non_proof_count']}",
        f"Generated slide motion beats: {payload['generated_slide_motion_count']}",
        f"Max non-proof beat: {payload['max_non_proof_beat_seconds']:.1f}s",
        f"Modern context beats: {payload['modern_context_beat_count']}",
        f"Replacement review/upload required: {payload['local_rerender_requires_review_upload']}",
        "",
        "## Motion Styles",
        "",
    ]
    lines.extend([f"- {style}" for style in payload["motion_styles"]] or ["- none"])
    lines.extend(["", "## Checks", ""])
    lines.extend([f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})" for check in checks])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab documentary motion polish.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_motion_polish_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Motion polish report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
