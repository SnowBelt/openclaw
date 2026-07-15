#!/usr/bin/env python3
"""Verify a hash-bound local visual-judge receipt; never synthesize a pass result."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, media_duration_seconds, output_root, utc_now
from patternlab_media_qa_common import load_policy as load_media_qa_policy, qa_contract_hash
from patternlab.state import sha256_file


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def build_report(video_id: str, receipt_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    rubric_path = BASE / "resources" / "visual-quality-rubric.json"
    receipt_path = receipt_path or approval / "local-visual-judge-receipt.json"
    rubric = read_json(rubric_path)
    media_policy = load_media_qa_policy()
    judge_policy = media_policy.get("visual_judge", {})
    receipt = read_json(receipt_path)
    blockers: list[str] = []
    if not rubric:
        blockers.append("visual_quality_rubric_missing")
    if not receipt:
        blockers.append("local_visual_judge_receipt_missing")
    if receipt.get("video_id") != video_id:
        blockers.append("local_visual_judge_video_id_mismatch")
    if not str(receipt.get("judge_model") or "").strip():
        blockers.append("local_visual_judge_model_missing")
    if receipt.get("judge_mode") != "local":
        blockers.append("local_visual_judge_not_local")
    if receipt.get("qa_contract_sha256") != qa_contract_hash():
        blockers.append("local_visual_judge_qa_contract_stale")
    benchmark = read_json(approval / "local-visual-model-benchmark-report.json")
    if judge_policy.get("benchmark_receipt_required") and benchmark.get("status") != "pass":
        blockers.append("local_visual_judge_model_benchmark_not_pass")
    if benchmark.get("status") == "pass" and receipt.get("judge_model") != benchmark.get("model_id"):
        blockers.append("local_visual_judge_model_does_not_match_benchmark")
    if benchmark.get("status") == "pass" and receipt.get("judge_model_sha256") != benchmark.get("model_sha256"):
        blockers.append("local_visual_judge_model_hash_does_not_match_benchmark")
    if benchmark.get("status") == "pass" and receipt.get("judge_mmproj_sha256") != benchmark.get("mmproj_sha256"):
        blockers.append("local_visual_judge_mmproj_hash_does_not_match_benchmark")
    allowed_models = set(judge_policy.get("preferred_model_ids", [])) | set(judge_policy.get("legacy_model_ids", []))
    if receipt.get("judge_model") and receipt.get("judge_model") not in allowed_models:
        blockers.append("local_visual_judge_model_not_allowlisted")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if not video.exists():
        blockers.append("canonical_rendered_video_missing")
    elif receipt.get("video_render_sha256") != sha256_file(video):
        blockers.append("local_visual_judge_render_hash_mismatch")
    frames = receipt.get("frames")
    if not isinstance(frames, list) or not frames:
        blockers.append("local_visual_judge_frames_missing")
        frames = []
    pass_score = max(int(rubric.get("pass_score", 101)), int(judge_policy.get("minimum_frame_score", 101)))
    dimension_minimum = float(judge_policy.get("minimum_dimension_score", pass_score))
    required_dimensions = list(judge_policy.get("required_dimensions", []))
    hard_failures = set(rubric.get("hard_fail_dimensions", []))
    rendered_media = read_json(approval / "rendered-media-quality-report.json")
    deterministic_render_passed = rendered_media.get("status") == "pass"
    rejected = []
    timestamps: list[float] = []
    for frame in frames:
        if not isinstance(frame, dict):
            rejected.append("invalid_frame_receipt")
            continue
        if float(frame.get("score", 0)) < pass_score:
            rejected.append(f"score_below_threshold:{frame.get('beat_id', 'unknown')}")
        frame_path_raw = str(frame.get("path") or "")
        frame_path = Path(frame_path_raw) if frame_path_raw else Path()
        if frame_path_raw and not frame_path.is_absolute():
            frame_path = BASE / frame_path
        if not frame_path_raw or not frame_path.is_file():
            rejected.append(f"frame_file_missing:{frame.get('beat_id', 'unknown')}")
        elif frame.get("sha256") != sha256_file(frame_path):
            rejected.append(f"frame_sha256_mismatch:{frame.get('beat_id', 'unknown')}")
        try:
            timestamp = float(frame.get("timestamp_seconds"))
            if timestamp < 0:
                raise ValueError
            timestamps.append(timestamp)
        except (TypeError, ValueError):
            rejected.append(f"frame_timestamp_missing_or_invalid:{frame.get('beat_id', 'unknown')}")
        dimensions = frame.get("dimension_scores")
        if not isinstance(dimensions, dict):
            rejected.append(f"frame_dimension_scores_missing:{frame.get('beat_id', 'unknown')}")
        else:
            for dimension in required_dimensions:
                try:
                    value = float(dimensions.get(dimension))
                except (TypeError, ValueError):
                    value = -1
                if value < dimension_minimum:
                    rejected.append(f"frame_dimension_below_threshold:{frame.get('beat_id', 'unknown')}:{dimension}")
        frame_fails = set(frame.get("hard_failures", [])) & hard_failures
        if frame_fails:
            rejected.append(f"hard_failure:{frame.get('beat_id', 'unknown')}:{','.join(sorted(frame_fails))}")
    if rejected:
        blockers.extend(rejected)
    if video.exists() and timestamps:
        duration = media_duration_seconds(video)
        ordered = sorted(set(round(value, 3) for value in timestamps))
        first_end = min(30.0, duration)
        first_points = [0.0, *[value for value in ordered if 0 <= value <= first_end], first_end]
        remainder_points = [30.0, *[value for value in ordered if 30 <= value <= duration], duration] if duration > 30 else []
        first_gap = max((b - a for a, b in zip(first_points, first_points[1:])), default=first_end)
        remainder_gap = max((b - a for a, b in zip(remainder_points, remainder_points[1:])), default=0.0)
        if first_gap > float(judge_policy.get("maximum_first_30_seconds_gap", 0)):
            blockers.append(f"local_visual_judge_first_30_coverage_gap:{first_gap:.2f}")
        if remainder_gap > float(judge_policy.get("maximum_remainder_gap", 0)):
            blockers.append(f"local_visual_judge_remainder_coverage_gap:{remainder_gap:.2f}")
    elif video.exists():
        blockers.append("local_visual_judge_timestamp_coverage_missing")
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked", "rubric": display_path(rubric_path),
        "receipt": display_path(receipt_path), "judge_model": receipt.get("judge_model", ""),
        "frames_reviewed": len(frames), "minimum_frame_score": pass_score,
        "minimum_dimension_score": dimension_minimum, "blockers": sorted(set(blockers)),
        "deterministic_render_qa_status": rendered_media.get("status", "missing"),
        "caption_only_reconciliations": [],
        "caption_reconciliation_policy": "forbidden; overlay text cannot rescue an unrelated visual",
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-judge-report.json"
    md_path = approval / "visual-judge-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Visual Judge: Video {video_id}", "", f"Status: {payload['status']}",
        f"Model: {payload['judge_model'] or 'missing'}", f"Frames reviewed: {len(frames)}",
        f"Deterministic render QA: {payload['deterministic_render_qa_status']}",
        f"Caption-only reconciliations: {len(payload['caption_only_reconciliations'])}", "", "## Blockers", "",
        *([f"- {item}" for item in payload["blockers"]] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Pattern Lab local visual-judge proof.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), Path(args.receipt) if args.receipt else None)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
