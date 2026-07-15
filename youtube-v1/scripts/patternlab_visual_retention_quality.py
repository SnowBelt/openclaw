#!/usr/bin/env python3
"""Fail-closed planning and rendered-proof gate for visual retention design."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, read_json, sha256_file


POLICY_PATH = BASE / "resources" / "media-qa-policy.json"


def longest_run(values: list[str]) -> int:
    longest = current = 0
    previous = None
    for value in values:
        current = current + 1 if value == previous else 1
        previous = value
        longest = max(longest, current)
    return longest


def build_report(video_id: str, *, require_render: bool = True) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    contract_path = root / "source-packet" / "visual-contract.json"
    contract = read_json(contract_path)
    policy = read_json(POLICY_PATH).get("retention", {})
    beats = [row for row in contract.get("beats", []) if isinstance(row, dict)]
    blockers: list[str] = []
    warnings: list[str] = []
    if contract.get("status") != "ready" or not beats:
        blockers.append("retention_visual_contract_not_ready")
    event_policy = contract.get("visual_event_policy", {})
    if not isinstance(event_policy, dict) or len(event_policy) < 4:
        blockers.append("retention_visual_event_policy_missing")
    for beat in beats:
        beat_id = str(beat.get("beat_id") or "unknown")
        if not str(beat.get("retention_function") or "").strip():
            blockers.append(f"{beat_id}:retention_function_missing")
        if not str(beat.get("motion_intent") or "").strip():
            blockers.append(f"{beat_id}:motion_intent_missing")
        if not str(beat.get("visual_change_rule") or "").strip():
            blockers.append(f"{beat_id}:visual_change_rule_missing")
    modes = [str(row.get("visual_mode") or "") for row in beats]
    if longest_run(modes) > int(policy.get("maximum_consecutive_same_visual_modes", 4)):
        blockers.append("retention_consecutive_same_visual_modes_above_ceiling")
    intents = {str(row.get("motion_intent") or "") for row in beats if row.get("motion_intent")}
    if len(intents) < int(policy.get("minimum_distinct_motion_intents", 5)):
        blockers.append("retention_motion_intent_variety_below_floor")
    if policy.get("first_three_beats_require_proof_or_system") and any(
        mode not in {"proof", "system"} for mode in modes[:3]
    ):
        blockers.append("retention_first_three_beats_do_not_lead_with_proof")
    reconstruction_seconds = sum(
        float(row.get("maximum_seconds") or 0)
        for row in beats
        if row.get("visual_mode") == "reconstruction"
    )
    rendered_path = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    rendered = read_json(approval / "rendered-media-quality-report.json")
    long_row = next(
        (row for row in rendered.get("assets", []) if isinstance(row, dict) and row.get("kind") == "long_form"),
        None,
    )
    render_status = "pending"
    render_metrics: dict[str, Any] = {}
    if rendered_path.is_file():
        if not long_row or long_row.get("sha256") != sha256_file(rendered_path):
            blockers.append("retention_rendered_media_receipt_missing_or_stale")
            render_status = "blocked"
        else:
            render_metrics = long_row.get("metrics", {}) if isinstance(long_row.get("metrics"), dict) else {}
            duration = float(render_metrics.get("duration_seconds") or 0)
            maximum_gap = float(render_metrics.get("maximum_unchanged_visual_gap_seconds") or 0)
            if maximum_gap > float(policy.get("maximum_visual_event_gap_seconds_remainder", 5)):
                blockers.append("retention_rendered_visual_event_gap_above_ceiling")
            if duration > 0 and reconstruction_seconds / duration > float(policy.get("maximum_ai_motion_share_long_form", 0.08)):
                blockers.append("retention_reconstruction_runtime_share_above_ceiling")
            render_status = "pass" if not any(item.startswith("retention_rendered") for item in blockers) else "blocked"
    else:
        warnings.append("rendered_retention_proof_pending_until_long_form_exists")
    plan_blockers = [item for item in blockers if not item.startswith("retention_rendered")]
    overall_status = (
        "blocked"
        if blockers
        else ("pass" if render_status == "pass" or not require_render else "pending")
    )
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": overall_status,
        "plan_status": "pass" if not plan_blockers else "blocked",
        "render_status": render_status,
        "render_required": require_render,
        "visual_contract": display_path(contract_path),
        "visual_contract_sha256": sha256_file(contract_path) if contract_path.is_file() else "",
        "beat_count": len(beats),
        "distinct_motion_intents": sorted(intents),
        "longest_same_visual_mode_run": longest_run(modes),
        "maximum_planned_reconstruction_seconds": reconstruction_seconds,
        "render_metrics": render_metrics,
        "blockers": sorted(set(blockers)),
        "warnings": warnings,
        "rule": "Meaningful visuals must change at feed-native pace; motion must reveal information and cannot conceal a narration mismatch.",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-retention-quality-report.json"
    md_path = approval / "visual-retention-quality-report.md"
    atomic_write_json(json_path, payload)
    atomic_write_text(
        md_path,
        "\n".join(
            [
                f"# Visual Retention Quality: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Plan: {payload['plan_status']}",
                f"Render: {render_status}",
                f"Motion intents: {len(intents)}",
                f"Longest same-mode run: {payload['longest_same_visual_mode_run']}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "## Warnings",
                "",
                *([f"- {item}" for item in warnings] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab visual retention planning and rendered proof.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), require_render=not args.plan_only)
    print(json.dumps({"status": payload["status"], "plan_status": payload["plan_status"], "render_status": payload["render_status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
