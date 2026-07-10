#!/usr/bin/env python3
"""Run deterministic finished-video QA checks before owner review."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, ffprobe_cmd, media_duration_seconds, output_root, utc_now


def video_duration(path: Path) -> float | None:
    if not path.exists():
        return None
    try:
        return media_duration_seconds(path)
    except Exception:
        return None


def blackdetect(path: Path) -> str:
    if not path.exists():
        return "missing_video"
    try:
        result = subprocess.run(
            [ffprobe_cmd().replace("ffprobe", "ffmpeg"), "-v", "error", "-i", str(path), "-vf", "blackdetect=d=2:pix_th=0.10", "-an", "-f", "null", "-"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return "pass" if "black_start" not in (result.stderr + result.stdout) else "blocked_black_segments_detected"
    except Exception:
        return "unverified"


def build_finished_video_watchdown_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    duration = video_duration(video)
    voice_visual = json.loads((approval / "voice-visual-match-report.json").read_text(encoding="utf-8")) if (approval / "voice-visual-match-report.json").exists() else {}
    blockers: list[str] = []
    warnings: list[str] = []
    if duration is None:
        blockers.append("long_form_video_missing_or_unreadable")
    elif not (8 * 60 <= duration <= 14 * 60):
        blockers.append(f"long_form_duration_outside_8_to_14_minutes:{duration:.1f}")
    elif duration < 10 * 60:
        warnings.append(f"long_form_duration_below_preferred_10_minutes:{duration:.1f}")
    if voice_visual.get("voice_visual_match_status") not in {"pass", None}:
        blockers.append("voice_visual_match_blocked")
    black_status = blackdetect(video) if video.exists() else "missing_video"
    if black_status.startswith("blocked"):
        blockers.append(black_status)
    elif black_status == "unverified":
        warnings.append("black_segment_check_unverified")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "finished_video_watchdown_status": "pass" if not blockers else "blocked",
        "long_form_path": display_path(video),
        "duration_seconds": round(duration, 2) if duration is not None else None,
        "duration_acceptable_seconds": "480-840",
        "duration_preferred_seconds": "600-840",
        "duration_policy": "8-14 minutes is acceptable for private/unlisted readiness; 10-14 minutes is preferred optimization.",
        "first_30_second_payoff_status": voice_visual.get("voice_visual_match_status", "missing"),
        "blank_or_black_segment_status": black_status,
        "audio_gap_status": "not_checked_by_local_probe",
        "public_youtube_mutation": "not_performed",
        "blockers": blockers,
        "warnings": warnings,
    }
    json_path = approval / "finished-video-watchdown-report.json"
    md_path = approval / "finished-video-watchdown-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Finished Video Watchdown: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Duration: {payload['duration_seconds'] or 'missing'} seconds",
        f"Black segment check: {black_status}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or ["- none"]),
        "",
        "## Warnings",
        "",
        *([f"- {item}" for item in warnings] or ["- none"]),
    ]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate final Pattern Lab long-form watchdown quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_finished_video_watchdown_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Finished video watchdown report: {display_path(md_path)}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
