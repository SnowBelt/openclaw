#!/usr/bin/env python3
"""Aggregate strict Pattern Lab final visual/audio QA without averaging failures."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_audio_quality import build_report as build_audio_report
from patternlab_ai_motion_quality import build_report as build_ai_motion_report
from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import load_policy, qa_contract_hash, read_json, report_reference, write_report
from patternlab_rendered_media_quality import build_report as build_rendered_media_report
from patternlab_historical_motion_quality import build_all_report as build_historical_motion_report
from patternlab_shorts_quality import build_shorts_quality_report
from patternlab_source_rights import build_source_rights_report
from patternlab_synthetic_disclosure import build_synthetic_disclosure_report
from patternlab_thumbnail_font_quality import build_font_quality_report
from patternlab_thumbnail_pixel_quality import build_report as build_thumbnail_pixel_report
from patternlab_thumbnail_semantic_quality import build_report as build_thumbnail_semantic_report
from patternlab_thumbnail_worldclass import build_report as build_thumbnail_worldclass_report
from patternlab_visual_judge import build_report as build_visual_judge_report
from patternlab_visual_retention_quality import build_report as build_visual_retention_report
from patternlab_voice_visual_match import build_voice_visual_match_report
from patternlab.state import sha256_file
from patternlab.thumbnail import load_thumbnail_candidate_manifest


def report_inputs_current(report: dict[str, Any]) -> bool:
    rows = report.get("input_hashes")
    if not isinstance(rows, dict) or not rows:
        return False
    for row in rows.values():
        if not isinstance(row, dict):
            return False
        path = Path(str(row.get("path") or "")).expanduser()
        if not path.is_absolute():
            path = YOUTUBE_ROOT / path
        if not path.is_file() or row.get("sha256") != sha256_file(path):
            return False
    scans = report.get("generic_surface_scans")
    if not isinstance(scans, list) or not scans:
        return False
    for row in scans:
        if not isinstance(row, dict):
            return False
        path = YOUTUBE_ROOT / str(row.get("path") or "")
        if not path.is_file() or row.get("sha256") != sha256_file(path):
            return False
    return True


def artifact_rows(root: Path, video_id: str) -> list[dict[str, Any]]:
    paths = [root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"]
    paths.extend(sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if (root / "shorts").exists() else [])
    for candidate in load_thumbnail_candidate_manifest(root).candidates:
        path = Path(str(candidate.get("path", "")))
        if not path.is_absolute():
            from patternlab_common import BASE

            path = BASE / path
        paths.append(path)
    return [
        {"path": display_path(path), "exists": path.is_file(), "sha256": sha256_file(path) if path.is_file() else ""}
        for path in paths
    ]


def current_rendered_report(approval: Path, root: Path, video_id: str) -> tuple[dict[str, Any], Path]:
    """Reuse, but never self-certify, a prior expensive rendered-pixel inspection."""
    path = approval / "rendered-media-quality-report.json"
    report = read_json(path)
    expected_paths = [root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"]
    expected_paths.extend(sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")))
    inspected = {
        str(row.get("path", "")): row
        for row in report.get("assets", [])
        if isinstance(row, dict)
    }
    current = bool(
        report.get("status") == "pass"
        and not report.get("blockers")
        and expected_paths
        and all(
            path.is_file()
            and str(path) in inspected
            and inspected[str(path)].get("status") == "pass"
            and inspected[str(path)].get("sha256") == sha256_file(path)
            for path in expected_paths
        )
    )
    if current:
        return report, path
    return {
        "status": "blocked",
        "assets": report.get("assets", []),
        "blockers": ["current_hash_bound_rendered_media_report_missing_or_stale"],
        "warnings": [],
    }, path


def build_report(video_id: str, *, run_rendered_checks: bool = True) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = load_policy()
    minimum = int(policy.get("minimum_asset_score", 93))
    harness_path = Path(__file__).resolve().parents[1] / "local-output" / "qa" / "media-qa-defect-harness.json"
    harness = read_json(harness_path)

    thumbnail_pixel, thumbnail_pixel_path, _ = build_thumbnail_pixel_report(video_id)
    thumbnail_semantic, thumbnail_semantic_path, _ = build_thumbnail_semantic_report(video_id)
    thumbnail_font, thumbnail_font_path, _ = build_font_quality_report(video_id)
    thumbnail_worldclass, thumbnail_worldclass_path, _ = build_thumbnail_worldclass_report(video_id)
    audio, audio_path, _ = build_audio_report(video_id)
    if run_rendered_checks:
        rendered, rendered_path, _ = build_rendered_media_report(video_id, run_checks=True)
    else:
        rendered, rendered_path = current_rendered_report(approval, root, video_id)
    shorts, shorts_md = build_shorts_quality_report(video_id)
    shorts_path = approval / "shorts-quality-report.json"
    source_rights, source_rights_path, _ = build_source_rights_report(video_id)
    synthetic, synthetic_path, _ = build_synthetic_disclosure_report(video_id)
    visual_judge, visual_judge_path, _ = build_visual_judge_report(video_id)
    voice_visual, voice_visual_path, _ = build_voice_visual_match_report(video_id)
    historical_motion, historical_motion_path, _ = build_historical_motion_report(video_id)
    ai_motion, ai_motion_path, _ = build_ai_motion_report(video_id)
    visual_retention, visual_retention_path, _ = build_visual_retention_report(video_id)
    prompt_plan = read_json(approval / "local-visual-prompt-plan.json")
    still_tournament = read_json(approval / "local-still-tournament-report.json")
    generation_required = int(prompt_plan.get("generation_beat_count", 0) or 0) > 0
    local_still_status = "pass" if not generation_required or still_tournament.get("status") == "pass" else "blocked"
    local_still_report = approval / "local-still-tournament-report.json"
    city_portability_path = approval / "city-portability-report.json"
    city_portability = read_json(city_portability_path)
    visual_contract_path = approval / "visual-contract-report.json"
    visual_contract = read_json(visual_contract_path)
    visual_acquisition_path = approval / "visual-acquisition-quality-report.json"
    visual_acquisition = read_json(visual_acquisition_path)
    visual_system_path = approval / "visual-system-gate-report.json"
    visual_system = read_json(visual_system_path)
    long_form_path = approval / "long-form-media-qa-report.json"
    long_form = read_json(long_form_path)

    required = [
        ("city_portability", city_portability, city_portability_path, "status"),
        ("visual_contract", visual_contract, visual_contract_path, "status"),
        ("visual_acquisition", visual_acquisition, visual_acquisition_path, "status"),
        ("visual_system", visual_system, visual_system_path, "status"),
        ("long_form_final_quality", long_form, long_form_path, "status"),
        ("thumbnail_final_pixels", thumbnail_pixel, thumbnail_pixel_path, "status"),
        ("thumbnail_semantics", thumbnail_semantic, thumbnail_semantic_path, "status"),
        ("thumbnail_fonts", thumbnail_font, thumbnail_font_path, "status"),
        ("thumbnail_worldclass_prepublication", thumbnail_worldclass, thumbnail_worldclass_path, "prepublication_status"),
        ("final_audio", audio, audio_path, "status"),
        ("final_rendered_media", rendered, rendered_path, "status"),
        ("shorts_final_quality", shorts, shorts_path, "status"),
        ("source_rights", source_rights, source_rights_path, "status"),
        ("synthetic_disclosure", synthetic, synthetic_path, "status"),
        ("local_visual_judge", visual_judge, visual_judge_path, "status"),
        ("voice_visual_match", voice_visual, voice_visual_path, "status"),
        ("historical_source_motion", historical_motion, historical_motion_path, "status"),
        ("local_ai_motion", ai_motion, ai_motion_path, "status"),
        ("visual_retention", visual_retention, visual_retention_path, "status"),
        (
            "local_still_tournament",
            {"status": local_still_status, "warnings": [], "minimum_asset_score": 93},
            local_still_report,
            "status",
        ),
    ]
    checks = []
    blockers: list[str] = []
    warnings: list[str] = []
    harness_passed = harness.get("status") == "pass" and harness.get("qa_contract_sha256") == qa_contract_hash()
    checks.append({
        "name": "adversarial_defect_harness",
        "status": harness.get("status", "missing"),
        "passed": harness_passed,
        "report": report_reference(harness_path, harness),
        "warning_count": 0,
    })
    if not harness_passed:
        blockers.append("adversarial_media_qa_harness_missing_stale_or_blocked")
    for name, report, path, status_key in required:
        actual = report.get(status_key, "missing")
        report_warnings = report.get("warnings", []) if isinstance(report.get("warnings", []), list) else []
        passed = actual == "pass" and (not policy.get("warnings_block_release") or not report_warnings)
        checks.append({
            "name": name,
            "status": actual,
            "passed": passed,
            "report": report_reference(path, report),
            "warning_count": len(report_warnings),
        })
        if not passed:
            blockers.append(f"{name}_not_pass:{actual}")
        warnings.extend(f"{name}:{item}" for item in report_warnings)

    score_rows = []
    for group_name, report in [("thumbnail", thumbnail_pixel), ("audio", audio), ("rendered_media", rendered)]:
        rows = report.get("candidates", report.get("assets", []))
        for row in rows if isinstance(rows, list) else []:
            score = int(row.get("score", 0) or 0)
            score_rows.append({"group": group_name, "path": row.get("path", row.get("id", "")), "score": score, "status": row.get("status", "missing")})
            if score < minimum:
                blockers.append(f"asset_score_below_{minimum}:{group_name}:{row.get('path', row.get('id', 'unknown'))}:{score}")
    artifacts = artifact_rows(root, video_id)
    if any(not row["exists"] or not row["sha256"] for row in artifacts):
        blockers.append("one_or_more_required_final_artifacts_missing_or_unhashed")
    if not report_inputs_current(city_portability):
        blockers.append("city_portability_report_missing_or_stale_input_hashes")
    long_form_video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if long_form.get("video_sha256") != (sha256_file(long_form_video) if long_form_video.is_file() else ""):
        blockers.append("long_form_final_quality_report_stale")
    if long_form.get("qa_contract_sha256") != qa_contract_hash():
        blockers.append("long_form_final_quality_contract_stale")
    if warnings and policy.get("warnings_block_release"):
        blockers.append("qa_warnings_must_be_resolved_before_owner_review")
    blockers = sorted(set(blockers))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if checks and not blockers else "blocked",
        "minimum_asset_score": minimum,
        "no_average_pass": True,
        "warnings_block_release": bool(policy.get("warnings_block_release")),
        "checks": checks,
        "asset_scores": score_rows,
        "artifacts": artifacts,
        "blockers": blockers,
        "warnings": warnings,
        "owner_review_rule": "Owner preference review may begin only after this report passes. Owner approval cannot override a hard technical, rights, hash, or score failure.",
        "youtube_mutation": "not_performed",
    }
    json_path, md_path = write_report(
        approval,
        "media-qa-report",
        f"Pattern Lab Strict Media QA: Video {video_id}",
        payload,
        extra_lines=[
            "## Gates",
            "",
            *[f"- {row['name']}: {'pass' if row['passed'] else 'blocked'} ({row['status']})" for row in checks],
            "",
            "## Asset Scores",
            "",
            *([f"- {row['group']} — {row['path']}: {row['score']}/100 ({row['status']})" for row in score_rows] or ["- none"]),
        ],
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the strict aggregate Pattern Lab visual/audio QA gate.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--no-rendered-checks", action="store_true")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), run_rendered_checks=not args.no_rendered_checks)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
