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

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
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
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if not video.exists():
        blockers.append("canonical_rendered_video_missing")
    elif receipt.get("video_render_sha256") != sha256_file(video):
        blockers.append("local_visual_judge_render_hash_mismatch")
    frames = receipt.get("frames")
    if not isinstance(frames, list) or not frames:
        blockers.append("local_visual_judge_frames_missing")
        frames = []
    pass_score = int(rubric.get("pass_score", 101))
    hard_failures = set(rubric.get("hard_fail_dimensions", []))
    rejected = []
    for frame in frames:
        if not isinstance(frame, dict):
            rejected.append("invalid_frame_receipt")
            continue
        if float(frame.get("score", 0)) < pass_score:
            rejected.append(f"score_below_threshold:{frame.get('beat_id', 'unknown')}")
        frame_fails = set(frame.get("hard_failures", [])) & hard_failures
        if frame_fails:
            rejected.append(f"hard_failure:{frame.get('beat_id', 'unknown')}:{','.join(sorted(frame_fails))}")
    if rejected:
        blockers.extend(rejected)
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked", "rubric": display_path(rubric_path),
        "receipt": display_path(receipt_path), "judge_model": receipt.get("judge_model", ""),
        "frames_reviewed": len(frames), "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-judge-report.json"
    md_path = approval / "visual-judge-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Visual Judge: Video {video_id}", "", f"Status: {payload['status']}",
        f"Model: {payload['judge_model'] or 'missing'}", f"Frames reviewed: {len(frames)}", "", "## Blockers", "",
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
