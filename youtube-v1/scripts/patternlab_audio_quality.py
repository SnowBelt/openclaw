#!/usr/bin/env python3
"""Measure final Pattern Lab audio streams, loudness, silence, and A/V sync."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, ffmpeg_cmd, ffprobe_cmd, output_root, utc_now
from patternlab_media_qa_common import load_policy, strict_score, write_report
from patternlab.state import sha256_file


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [ffprobe_cmd(), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    value = json.loads(result.stdout)
    return value if isinstance(value, dict) else {}


def loudness(path: Path) -> dict[str, float]:
    result = subprocess.run(
        [
            ffmpeg_cmd(), "-hide_banner", "-nostats", "-i", str(path), "-vn",
            "-af", "loudnorm=I=-16:TP=-1.0:LRA=11:print_format=json", "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    matches = re.findall(r"\{\s*\"input_i\".*?\}", result.stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError("loudnorm_json_missing")
    raw = json.loads(matches[-1])
    return {
        "integrated_loudness_lufs": float(raw["input_i"]),
        "true_peak_dbtp": float(raw["input_tp"]),
        "loudness_range_lu": float(raw["input_lra"]),
        "threshold_lufs": float(raw["input_thresh"]),
    }


def silence_intervals(path: Path, policy: dict[str, Any]) -> list[dict[str, float]]:
    minimum = float(policy["maximum_internal_silence_seconds"])
    threshold = float(policy["silence_threshold_db"])
    result = subprocess.run(
        [
            ffmpeg_cmd(), "-hide_banner", "-nostats", "-i", str(path), "-vn",
            "-af", f"silencedetect=noise={threshold}dB:d={minimum}", "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    starts = [float(value) for value in re.findall(r"silence_start:\s*([0-9.]+)", result.stderr)]
    ends = [(float(end), float(duration)) for end, duration in re.findall(r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)", result.stderr)]
    rows = []
    for index, start in enumerate(starts):
        end, duration = ends[index] if index < len(ends) else (start, 0.0)
        rows.append({"start": round(start, 3), "end": round(end, 3), "duration": round(duration, 3)})
    return rows


def evaluate_audio_metrics(metrics: dict[str, Any], policy: dict[str, Any], *, kind: str) -> list[str]:
    blockers: list[str] = []
    if not metrics.get("audio_stream_present"):
        return ["audio_stream_missing"]
    if int(metrics.get("sample_rate_hz", 0)) < int(policy["minimum_sample_rate_hz"]):
        blockers.append("audio_sample_rate_below_floor")
    if int(metrics.get("channel_count", 0)) not in {int(value) for value in policy["allowed_channel_counts"]}:
        blockers.append("audio_channel_count_invalid")
    integrated = float(metrics.get("integrated_loudness_lufs", -999))
    if not float(policy["integrated_loudness_lufs_min"]) <= integrated <= float(policy["integrated_loudness_lufs_max"]):
        blockers.append("audio_integrated_loudness_out_of_range")
    if float(metrics.get("true_peak_dbtp", 999)) > float(policy["true_peak_dbtp_max"]):
        blockers.append("audio_true_peak_above_ceiling")
    loudness_range = float(metrics.get("loudness_range_lu", -1))
    if not float(policy["loudness_range_lu_min"]) <= loudness_range <= float(policy["loudness_range_lu_max"]):
        blockers.append("audio_loudness_range_out_of_range")
    maximum_silence = float(policy["maximum_internal_silence_seconds"])
    duration = float(metrics.get("format_duration_seconds", 0))
    for row in metrics.get("silence_intervals", []):
        internal = float(row.get("start", 0)) > 0.5 and float(row.get("end", duration)) < max(0, duration - 0.5)
        if internal and float(row.get("duration", 0)) > maximum_silence:
            blockers.append("audio_internal_silence_or_dropout_detected")
            break
    delta = float(metrics.get("av_duration_delta_seconds", 0))
    ceiling_key = "maximum_av_duration_delta_seconds_short" if kind == "short" else "maximum_av_duration_delta_seconds_long_form"
    if delta > float(policy[ceiling_key]):
        blockers.append("audio_video_duration_desynchronization")
    return sorted(set(blockers))


def analyze_asset(path: Path, *, kind: str, policy: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, Any] = {}
    if not path.is_file():
        blockers.append("media_file_missing")
    else:
        try:
            info = probe(path)
            streams = info.get("streams", [])
            audio_streams = [row for row in streams if row.get("codec_type") == "audio"]
            video_streams = [row for row in streams if row.get("codec_type") == "video"]
            format_duration = float(info.get("format", {}).get("duration") or 0)
            audio_duration = float(audio_streams[0].get("duration") or format_duration) if audio_streams else 0.0
            video_duration = float(video_streams[0].get("duration") or format_duration) if video_streams else format_duration
            metrics.update({
                "audio_stream_present": bool(audio_streams),
                "sample_rate_hz": int(audio_streams[0].get("sample_rate") or 0) if audio_streams else 0,
                "channel_count": int(audio_streams[0].get("channels") or 0) if audio_streams else 0,
                "audio_codec": str(audio_streams[0].get("codec_name") or "") if audio_streams else "",
                "format_duration_seconds": round(format_duration, 3),
                "audio_duration_seconds": round(audio_duration, 3),
                "video_duration_seconds": round(video_duration, 3),
                "av_duration_delta_seconds": round(abs(audio_duration - video_duration), 3),
            })
            if audio_streams:
                metrics.update(loudness(path))
                metrics["silence_intervals"] = silence_intervals(path, policy)
                blockers.extend(evaluate_audio_metrics(metrics, policy, kind=kind))
            else:
                blockers.append("audio_stream_missing")
        except Exception as exc:
            blockers.append(f"audio_analysis_failed:{type(exc).__name__}")
    blockers = sorted(set(blockers))
    score = strict_score(blockers, warnings)
    return {
        "kind": kind,
        "path": display_path(path),
        "sha256": sha256_file(path) if path.is_file() else "",
        "status": "pass" if not blockers and score >= 93 else "blocked",
        "score": score,
        "metrics": metrics,
        "blockers": blockers,
        "warnings": warnings,
    }


def build_report(
    video_id: str,
    *,
    include_shorts: bool = True,
    report_stem: str = "audio-quality-report",
) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = load_policy()
    audio_policy = policy.get("audio", {})
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    short_paths = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if include_shorts and (root / "shorts").exists() else []
    assets = [analyze_asset(long_form, kind="long_form", policy=audio_policy)]
    assets.extend(analyze_asset(path, kind="short", policy=audio_policy) for path in short_paths)
    blockers = [f"{Path(row['path']).name}:{item}" for row in assets for item in row["blockers"]]
    warnings = [f"{Path(row['path']).name}:{item}" for row in assets for item in row["warnings"]]
    if include_shorts and len(short_paths) < 3:
        blockers.append(f"rendered_short_count_below_three:{len(short_paths)}")
    minimum = int(policy.get("minimum_asset_score", 93))
    if any(row["score"] < minimum for row in assets):
        blockers.append("one_or_more_audio_asset_scores_below_93")
    if policy.get("warnings_block_release") and warnings:
        blockers.append("audio_warnings_must_be_resolved")
    blockers = sorted(set(blockers))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if assets and not blockers else "blocked",
        "minimum_asset_score": minimum,
        "minimum_score_observed": min((row["score"] for row in assets), default=0),
        "assets": assets,
        "include_shorts": include_shorts,
        "blockers": blockers,
        "warnings": warnings,
        "youtube_mutation": "not_performed",
    }
    json_path, md_path = write_report(
        approval,
        report_stem,
        f"Pattern Lab Final Audio QA: Video {video_id}",
        payload,
        extra_lines=["## Assets", "", *[f"- {row['path']}: {row['status']} — {row['score']}/100" for row in assets]],
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run strict Pattern Lab final-media audio QA.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--long-form-only", action="store_true")
    parser.add_argument("--report-stem", default="audio-quality-report")
    args = parser.parse_args()
    payload, _, md_path = build_report(
        args.video_id.zfill(2),
        include_shorts=not args.long_form_only,
        report_stem=args.report_stem,
    )
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
