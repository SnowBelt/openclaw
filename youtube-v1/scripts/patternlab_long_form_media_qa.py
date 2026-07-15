#!/usr/bin/env python3
"""Fail-closed aggregate for one final Pattern Lab long-form review artifact.

This gate is deliberately independent from Shorts, thumbnails, uploads, and
public-release state.  It binds every required long-form proof surface to the
current MP4, render plan, evidence manifest, retained narration, and QA
contract.  A stale report is a blocker even when that report says ``pass``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.state import sha256_file
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import load_policy, qa_contract_hash, strict_score


DISCLOSURE = "Dramatic reconstruction — not archival footage"
AI_MOVING_KINDS = {"film", "modern_video"}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def status_check(
    blockers: list[str],
    approval: Path,
    name: str,
    *,
    allow_warnings: bool = False,
    allowed_statuses: tuple[str, ...] = ("pass",),
) -> tuple[dict[str, Any], Path]:
    path = approval / name
    report = read_json(path)
    prefix = name.removesuffix(".json").replace("-", "_")
    if not report:
        blockers.append(f"{prefix}_missing")
        return report, path
    if report.get("status") not in allowed_statuses:
        blockers.append(f"{prefix}_not_pass")
    if report.get("blockers"):
        blockers.append(f"{prefix}_contains_blockers")
    if not allow_warnings and report.get("warnings"):
        blockers.append(f"{prefix}_contains_warnings")
    return report, path


def matching_asset(report: dict[str, Any], video_sha256: str) -> dict[str, Any] | None:
    for row in report.get("assets", []):
        if not isinstance(row, dict):
            continue
        if row.get("kind") == "long_form" and row.get("sha256") == video_sha256:
            return row
    return None


def source_pool_count(report: dict[str, Any], legacy_field: str, generic_field: str) -> int:
    """Read both the legacy Video 04 report and the city-generic report shape."""
    counts = report.get("counts")
    if isinstance(counts, dict) and generic_field in counts:
        return int(counts.get(generic_field) or 0)
    return int(report.get(legacy_field) or 0)


def bound_path(raw: object) -> Path | None:
    value = str(raw or "").strip()
    if not value:
        return None
    path = Path(value).expanduser()
    return path if path.is_absolute() else BASE / path


def ai_route_blockers(
    *,
    video_id: str,
    plan: dict[str, Any],
    visual_policy: dict[str, Any],
    approval: Path,
) -> list[str]:
    """Validate bounded, disclosed non-proof AI actually present in final pixels."""
    blockers: list[str] = []
    beats = [row for row in plan.get("beats", []) if isinstance(row, dict)]
    ai_beats = [row for row in beats if row.get("source_class") == "ai_reconstruction"]
    if not ai_beats:
        return blockers
    ai_policy = visual_policy.get("ai_support", {}) if isinstance(visual_policy, dict) else {}
    maximum_clip = float(ai_policy.get("maximum_seconds_per_clip", 5.0))
    total_duration = sum(max(0.0, float(row.get("duration_seconds", 0.0) or 0.0)) for row in beats)
    ai_duration = sum(max(0.0, float(row.get("duration_seconds", 0.0) or 0.0)) for row in ai_beats)
    maximum_share = float(ai_policy.get("maximum_runtime_share_long_form", 0.08))
    if total_duration <= 0 or ai_duration / total_duration > maximum_share + 1e-6:
        blockers.append(f"ai_reconstruction_runtime_share_above_ceiling:{ai_duration:.3f}/{total_duration:.3f}/{maximum_share:.3f}")
    for row in ai_beats:
        beat_id = str(row.get("beat_id") or "unknown")
        asset_id = str(row.get("asset_id") or "missing")
        if row.get("role") != "labeled_reconstruction":
            blockers.append(f"ai_reconstruction_role_invalid:{beat_id}:{asset_id}")
        if row.get("editorial_role") != "reconstruction":
            blockers.append(f"ai_reconstruction_editorial_role_invalid:{beat_id}:{asset_id}")
        if row.get("evidence_fit") == "direct":
            blockers.append(f"ai_reconstruction_used_as_direct_evidence:{beat_id}:{asset_id}")
        if row.get("geographic_scope") != "generic" or row.get("may_imply_named_city") is not False:
            blockers.append(f"ai_reconstruction_geographic_scope_invalid:{beat_id}:{asset_id}")
        if row.get("ai_disclosure") != DISCLOSURE:
            blockers.append(f"ai_reconstruction_disclosure_missing:{beat_id}:{asset_id}")
        if float(row.get("duration_seconds", 0.0) or 0.0) > maximum_clip + 1e-6:
            blockers.append(f"ai_reconstruction_clip_above_ceiling:{beat_id}:{asset_id}")

    tournament = read_json(approval / "local-still-tournament-report.json")
    winner_ids = {
        f"video-{video_id}-local-ai-{row.get('beat_id')}"
        for row in tournament.get("beats", [])
        if isinstance(row, dict) and row.get("status") == "pass" and isinstance(row.get("winner"), dict)
    }
    still_ids = {str(row.get("asset_id") or "") for row in ai_beats if row.get("asset_kind") not in AI_MOVING_KINDS}
    if still_ids:
        if tournament.get("status") != "pass" or tournament.get("blockers"):
            blockers.append("ai_reconstruction_local_still_tournament_not_pass")
        for asset_id in sorted(still_ids - winner_ids):
            blockers.append(f"ai_reconstruction_missing_hash_bound_local_winner:{asset_id}")
    moving_ids = {str(row.get("asset_id") or "") for row in ai_beats if row.get("asset_kind") in AI_MOVING_KINDS}
    if moving_ids:
        motion = read_json(approval / "ai-motion-quality-report.json")
        passed_motion_ids = {
            str(row.get("asset_id") or "")
            for row in motion.get("assets", [])
            if isinstance(row, dict) and row.get("status") == "pass" and not row.get("blockers")
        }
        if motion.get("status") != "pass" or motion.get("blockers"):
            blockers.append("ai_reconstruction_motion_quality_not_pass")
        for asset_id in sorted(moving_ids - passed_motion_ids):
            blockers.append(f"ai_reconstruction_motion_asset_not_independently_passed:{asset_id}")
    return sorted(set(blockers))


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    captions = root / "captions" / "closed-captions-final.srt"
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    manifest_path = approval / "evidence-manifest.json"
    plan_path = approval / "canonical-render-plan.json"
    sequence_path = approval / "long-form-sequence-quality-report.json"
    blockers: list[str] = []
    warnings: list[str] = []
    video_sha = sha256_file(video) if video.is_file() else ""
    manifest_sha = sha256_file(manifest_path) if manifest_path.is_file() else ""
    plan_sha = sha256_file(plan_path) if plan_path.is_file() else ""
    contract_sha = qa_contract_hash()
    policy = load_policy()
    visual_policy = read_json(BASE / "resources" / "patternlab-visual-system-policy.json")
    source_policy = policy.get("long_form_source_pool", {})
    sequence_policy = policy.get("long_form_sequence", {})

    if not video_sha:
        blockers.append("long_form_video_missing")
    if not manifest_sha:
        blockers.append("evidence_manifest_missing")
    if not plan_sha:
        blockers.append("canonical_render_plan_missing")

    reports: list[dict[str, Any]] = []

    # These reports prove that the episode is city-portable, explicitly
    # planned, rights-safe, acquired, and motion-checked before final-pixel QA.
    for report_name, allowed_statuses in (
        ("city-portability-report.json", ("pass",)),
        ("visual-contract-report.json", ("pass",)),
        ("ai-support-plan-report.json", ("pass",)),
        ("free-stock-acquisition-report.json", ("planned", "pass")),
        ("open-archive-candidate-acquisition-report.json", ("planned", "pass")),
        ("visual-acquisition-quality-report.json", ("pass",)),
        ("historical-motion-quality-report.json", ("pass",)),
        ("ai-motion-quality-report.json", ("pass",)),
        ("visual-system-gate-report.json", ("pass",)),
    ):
        prerequisite, path = status_check(
            blockers,
            approval,
            report_name,
            allowed_statuses=allowed_statuses,
        )
        reports.append(
            {
                "name": path.name,
                "sha256": sha256_file(path) if path.is_file() else "",
                "status": prerequisite.get("status", "missing"),
            }
        )

    source_pool, path = status_check(blockers, approval, "long-form-source-pool-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": source_pool.get("status", "missing")})
    for legacy_field, generic_field, policy_field, blocker in (
        ("asset_count", "assets", "minimum_assets", "long_form_source_pool_below_floor"),
        ("historical_asset_count", "historical", "minimum_historical_assets", "long_form_historical_source_pool_below_floor"),
        ("moving_image_asset_count", "moving", "minimum_moving_image_assets", "long_form_moving_source_pool_below_floor"),
        ("modern_video_asset_count", "modern_video", "minimum_modern_video_assets", "long_form_modern_video_pool_below_floor"),
        ("distinct_source_url_count", "source_urls", "minimum_distinct_source_urls", "long_form_distinct_source_urls_below_floor"),
    ):
        if source_pool_count(source_pool, legacy_field, generic_field) < int(source_policy.get(policy_field, 0)):
            blockers.append(blocker)

    builder, path = status_check(blockers, approval, "evidence-manifest-builder-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": builder.get("status", "missing")})
    if int(builder.get("assets_used", 0)) < int(sequence_policy.get("minimum_unique_assets", 0)):
        blockers.append("evidence_manifest_assets_used_below_floor")
    if float(builder.get("unique_asset_ratio", 0.0)) + 1e-6 < float(sequence_policy.get("minimum_unique_asset_ratio", 0.0)):
        blockers.append("evidence_manifest_unique_asset_ratio_below_floor")
    if int(builder.get("maximum_asset_uses", 999)) > 4:
        blockers.append("evidence_manifest_asset_reuse_above_4")
    if int(builder.get("maximum_static_asset_uses", 999)) > int(sequence_policy.get("maximum_uses_per_static_asset", 3)):
        blockers.append("evidence_manifest_static_asset_reuse_above_ceiling")
    observed_static_gap = builder.get("minimum_static_asset_reuse_gap_seconds")
    if observed_static_gap is not None and float(observed_static_gap) + 1e-6 < float(sequence_policy.get("minimum_static_asset_reuse_gap_seconds", 0.0)):
        blockers.append("evidence_manifest_static_asset_reuse_gap_below_floor")
    beat_count = int(builder.get("visual_beat_count", 0))
    if beat_count:
        if int(builder.get("map_document_beat_count", beat_count)) / beat_count > float(sequence_policy.get("maximum_map_document_share", 1.0)) + 1e-6:
            blockers.append("evidence_manifest_map_document_share_above_ceiling")
        if int(builder.get("moving_image_beat_count", 0)) / beat_count + 1e-6 < float(sequence_policy.get("minimum_moving_image_share", 0.0)):
            blockers.append("evidence_manifest_moving_image_share_below_floor")
    if builder.get("caption_mode") != "closed_captions_plus_selective_editorial_text":
        blockers.append("evidence_manifest_caption_mode_wrong")

    binding, path = status_check(blockers, approval, "evidence-manifest-binding.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": binding.get("status", "missing")})
    if binding.get("manifest_sha256") != manifest_sha:
        blockers.append("evidence_manifest_binding_stale")
    route_path = BASE / "launch" / f"video-{video_id}" / "long-form-visual-routing.json"
    source_pool_path = bound_path(binding.get("intake_path"))
    if binding.get("visual_route_sha256") != (sha256_file(route_path) if route_path.is_file() else ""):
        blockers.append("evidence_manifest_visual_route_binding_stale")
    if source_pool_path is None or not source_pool_path.is_file():
        blockers.append("evidence_manifest_source_pool_binding_path_missing")
    if binding.get("intake_sha256") != (
        sha256_file(source_pool_path) if source_pool_path is not None and source_pool_path.is_file() else ""
    ):
        blockers.append("evidence_manifest_source_pool_binding_stale")

    plan = read_json(plan_path)
    if plan.get("status") != "pass" or plan.get("blockers"):
        blockers.append("canonical_render_plan_not_pass")
    if plan.get("caption_mode") != "closed_captions_plus_selective_editorial_text":
        blockers.append("canonical_render_plan_caption_mode_wrong")
    if plan.get("split_screen_compositing") != "forbidden":
        blockers.append("canonical_render_plan_split_screen_not_forbidden")
    blockers.extend(
        ai_route_blockers(
            video_id=video_id,
            plan=plan,
            visual_policy=visual_policy,
            approval=approval,
        )
    )

    motion, path = status_check(blockers, approval, "canonical-motion-plan.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": motion.get("status", "missing")})
    if any(row.get("motion_style") == "then_now_split" for row in motion.get("beats", []) if isinstance(row, dict)):
        blockers.append("forbidden_split_screen_motion_present")

    caption_report, path = status_check(blockers, approval, "closed-captions-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": caption_report.get("status", "missing")})
    if caption_report.get("caption_mode") != "toggleable_closed_captions":
        blockers.append("closed_captions_not_toggleable")
    if caption_report.get("burned_in_full_narration") is not False:
        blockers.append("full_narration_burned_in")
    if not captions.is_file() or caption_report.get("output_sha256") != (sha256_file(captions) if captions.is_file() else ""):
        blockers.append("closed_captions_missing_or_stale")

    narration, path = status_check(blockers, approval, "retained-narration-binding.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": narration.get("status", "missing")})
    if narration.get("approved_script", {}).get("sha256") != (sha256_file(script) if script.is_file() else ""):
        blockers.append("retained_narration_script_binding_stale")
    retained_audio = root / "audio" / "voiceover_full_normalized.mp3"
    if narration.get("retained_normalized_audio", {}).get("sha256") != (sha256_file(retained_audio) if retained_audio.is_file() else ""):
        blockers.append("retained_narration_audio_binding_stale")
    if narration.get("new_voice_generation_performed") is not False:
        blockers.append("unexpected_new_voice_generation")

    audio, path = status_check(blockers, approval, "long-form-audio-quality-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": audio.get("status", "missing")})
    audio_row = matching_asset(audio, video_sha)
    if not audio_row or audio_row.get("status") != "pass" or int(audio_row.get("score", 0)) < 93:
        blockers.append("long_form_audio_report_missing_stale_or_below_93")
    if audio.get("include_shorts") is not False:
        blockers.append("long_form_audio_report_not_scoped_to_long_form")

    rendered, path = status_check(blockers, approval, "long-form-rendered-media-quality-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": rendered.get("status", "missing")})
    rendered_row = matching_asset(rendered, video_sha)
    if not rendered_row or rendered_row.get("status") != "pass" or int(rendered_row.get("score", 0)) < 93:
        blockers.append("long_form_rendered_media_report_missing_stale_or_below_93")
    if rendered.get("include_shorts") is not False:
        blockers.append("rendered_media_report_not_scoped_to_long_form")

    render_quality, path = status_check(blockers, approval, "render-quality-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": render_quality.get("status", "missing")})
    if render_quality.get("video_render_sha256") != video_sha:
        blockers.append("render_quality_report_stale")
    if int(render_quality.get("score", 0)) < 93:
        blockers.append("render_quality_score_below_93")

    benchmark, path = status_check(blockers, approval, "local-visual-model-benchmark-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": benchmark.get("status", "missing")})
    benchmark_receipt = read_json(approval / "local-visual-model-benchmark-receipt.json")
    if benchmark_receipt.get("qa_contract_sha256") != contract_sha:
        blockers.append("local_visual_model_benchmark_contract_stale")

    visual_judge, path = status_check(blockers, approval, "visual-judge-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": visual_judge.get("status", "missing")})
    judge_receipt = read_json(approval / "local-visual-judge-receipt.json")
    if judge_receipt.get("video_render_sha256") != video_sha:
        blockers.append("local_visual_judge_render_stale")
    if judge_receipt.get("qa_contract_sha256") != contract_sha:
        blockers.append("local_visual_judge_contract_stale")
    if any(float(row.get("score", 0)) < 93 for row in judge_receipt.get("frames", []) if isinstance(row, dict)):
        blockers.append("local_visual_judge_frame_below_93")

    sequence, path = status_check(blockers, approval, "long-form-sequence-quality-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": sequence.get("status", "missing")})
    if sequence.get("video_sha256") != video_sha:
        blockers.append("long_form_sequence_report_stale")
    if sequence.get("canonical_render_plan_sha256") != plan_sha:
        blockers.append("long_form_sequence_plan_stale")
    if int(sequence.get("score", 0)) < 93:
        blockers.append("long_form_sequence_score_below_93")
    if int(sequence.get("unique_asset_count", 0)) < int(sequence_policy.get("minimum_unique_assets", 0)):
        blockers.append("long_form_sequence_unique_assets_below_floor")
    if float(sequence.get("unique_asset_ratio", 0.0)) + 1e-6 < float(sequence_policy.get("minimum_unique_asset_ratio", 0.0)):
        blockers.append("long_form_sequence_unique_asset_ratio_below_floor")
    if int(sequence.get("maximum_static_asset_uses", 999)) > int(sequence_policy.get("maximum_uses_per_static_asset", 3)):
        blockers.append("long_form_sequence_static_asset_reuse_above_ceiling")
    if float(sequence.get("map_document_share", 1.0)) > float(sequence_policy.get("maximum_map_document_share", 1.0)) + 1e-6:
        blockers.append("long_form_sequence_map_document_share_above_ceiling")
    if float(sequence.get("moving_image_share", 0.0)) + 1e-6 < float(sequence_policy.get("minimum_moving_image_share", 0.0)):
        blockers.append("long_form_sequence_moving_image_share_below_floor")

    sequence_judge, path = status_check(blockers, approval, "local-sequence-judge-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": sequence_judge.get("status", "missing")})
    if sequence_judge.get("video_sha256") != video_sha:
        blockers.append("local_sequence_judge_render_stale")
    if sequence_judge.get("qa_contract_sha256") != contract_sha:
        blockers.append("local_sequence_judge_contract_stale")
    if sequence_judge.get("sequence_quality_report_sha256") != (sha256_file(sequence_path) if sequence_path.is_file() else ""):
        blockers.append("local_sequence_judge_sequence_report_stale")
    for row in sequence_judge.get("judgments", []):
        if not isinstance(row, dict):
            continue
        if int(row.get("score", 0)) < 93 or row.get("blockers"):
            blockers.append(f"local_sequence_judge_sheet_not_pass:{row.get('sheet_index', 'unknown')}")

    voice_visual, path = status_check(blockers, approval, "voice-visual-match-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": voice_visual.get("status", "missing")})

    retention, path = status_check(blockers, approval, "visual-retention-quality-report.json")
    reports.append({"name": path.name, "sha256": sha256_file(path) if path.is_file() else "", "status": retention.get("status", "missing")})
    if retention.get("render_status") != "pass":
        blockers.append("visual_retention_render_not_pass")

    blockers = sorted(set(blockers))
    warnings = sorted(set(warnings))
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers and not warnings else "blocked",
        "minimum_score": int(policy.get("minimum_asset_score", 93)),
        "score": strict_score(blockers, warnings),
        "video": display_path(video),
        "video_sha256": video_sha,
        "captions": display_path(captions),
        "captions_sha256": sha256_file(captions) if captions.is_file() else "",
        "evidence_manifest_sha256": manifest_sha,
        "canonical_render_plan_sha256": plan_sha,
        "qa_contract_sha256": contract_sha,
        "reports": reports,
        "owner_quality_score": "pending_external_review",
        "blockers": blockers,
        "warnings": warnings,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report_path = approval / "long-form-media-qa-report.json"
    md_path = approval / "long-form-media-qa-report.md"
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Long-Form Media QA: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Automated score: {payload['score']}/100",
                "Owner quality score: pending external review",
                f"Video SHA-256: {video_sha or 'missing'}",
                "",
                "## Required reports",
                "",
                *[f"- {row['name']}: {row['status']} ({row['sha256'] or 'missing'})" for row in reports],
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in blockers] or ["- none"]),
                "",
                "## Warnings",
                "",
                *([f"- {item}" for item in warnings] or ["- none"]),
                "",
                "Paid provider calls: not performed",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, report_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify all current long-form-only Pattern Lab media QA receipts.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
