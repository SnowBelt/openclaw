#!/usr/bin/env python3
"""Inspect final Pattern Lab video pixels for black/frozen/dim/unexpected overlays."""
from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, require_city
from patternlab_common import display_path, ensure_dir, ffmpeg_cmd, ffprobe_cmd, launch_root, output_root, utc_now
from patternlab_media_qa_common import load_policy, normalize_tokens, read_json, strict_score, write_report
from patternlab.state import sha256_file
from patternlab_thumbnail_pixel_quality import image_metrics, ocr_measurement


@lru_cache(maxsize=32)
def episode_city(video_id: str) -> str:
    package = read_json(launch_root(video_id) / "package.json")
    try:
        return require_city(package.get("city"), source=f"video_{video_id}_package")
    except CityContractError:
        return ""


def _ocr_native_image(image: Image.Image) -> set[str]:
    """Read native source text at multiple layouts without trusting render text."""
    try:
        import pytesseract
    except ImportError:
        return set()
    prepared = image.convert("RGB")
    prepared.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
    tokens: set[str] = set()
    for page_mode in (6, 11, 12):
        try:
            tokens.update(
                token
                for token in normalize_tokens(
                    pytesseract.image_to_string(prepared, config=f"--psm {page_mode}")
                )
                if len(token) >= 4 and token.isalpha()
            )
        except Exception:
            continue
    return tokens


@lru_cache(maxsize=256)
def _still_native_tokens(path_value: str) -> tuple[str, ...]:
    path = Path(path_value)
    if not path.is_file():
        return ()
    try:
        with Image.open(path) as image:
            return tuple(sorted(_ocr_native_image(image)))
    except Exception:
        return ()


@lru_cache(maxsize=512)
def _video_native_tokens(path_value: str, seconds_millis: int) -> tuple[str, ...]:
    """OCR the exact rights-reviewed source-video moment used by the render."""
    path = Path(path_value)
    if not path.is_file():
        return ()
    seconds = max(0.0, seconds_millis / 1000.0)
    result = subprocess.run(
        [
            ffmpeg_cmd(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-vf",
            "scale='min(1920,iw)':-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ],
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode or not result.stdout:
        return ()
    try:
        with Image.open(io.BytesIO(result.stdout)) as image:
            return tuple(sorted(_ocr_native_image(image)))
    except Exception:
        return ()


@lru_cache(maxsize=8)
def _render_plan(root_value: str) -> tuple[dict[str, Any], ...]:
    root = Path(root_value)
    plan = read_json(root / "approval" / "canonical-render-plan.json")
    return tuple(row for row in plan.get("beats", []) if isinstance(row, dict))


def beat_for_second(root: Path, seconds: float) -> dict[str, Any]:
    beats = _render_plan(str(root))
    for beat in beats:
        start = float(beat.get("start_seconds", 0.0))
        end = float(beat.get("end_seconds", start))
        if start <= seconds < end or (beat is beats[-1] and seconds <= end):
            return beat
    return {}


def native_source_tokens(root: Path, seconds: float) -> set[str]:
    """Return only text present in the source pixels for the current beat.

    This prevents archival title cards, maps, newspapers, and signs from being
    mistaken for random renderer overlays while keeping unrelated text fail-
    closed.  It intentionally does not whitelist text from other beats.
    """
    beat = beat_for_second(root, seconds)
    relative = str(beat.get("asset_path") or "")
    source = root / relative
    if not source.is_file():
        return set()
    kind = str(beat.get("asset_kind") or "").lower()
    if kind in {"film", "modern_video", "source_motion", "video"} or source.suffix.lower() in {
        ".mp4",
        ".mov",
        ".mkv",
        ".webm",
    }:
        clip_start = float(beat.get("clip_start_seconds") or 0.0)
        offset = max(0.0, seconds - float(beat.get("start_seconds") or 0.0))
        return set(_video_native_tokens(str(source), int(round((clip_start + offset) * 1000))))
    return set(_still_native_tokens(str(source)))


def approved_overlay_tokens(root: Path, seconds: float, video_id: str) -> set[str]:
    """Return only deliberately authored text allowed on the current frame."""
    beat = beat_for_second(root, seconds)
    values: list[str] = ["Pattern Lab", "Source", episode_city(video_id)]
    values.append(str(beat.get("editorial_callout") or ""))
    values.append(str(beat.get("source_label") or ""))
    values.append(str(beat.get("context_disclosure") or ""))
    values.append(str(beat.get("ai_disclosure") or ""))
    chapter = beat.get("chapter_label")
    if isinstance(chapter, list):
        values.extend(str(item) for item in chapter)
    elif chapter:
        values.append(str(chapter))
    return set(normalize_tokens(" ".join(values)))


def remove_ocr_matches(tokens: set[str], allowed: set[str]) -> set[str]:
    """Remove exact and conservative OCR-near matches to approved source text."""
    remaining: set[str] = set()
    for token in tokens:
        matched = False
        for candidate in allowed:
            if token == candidate:
                matched = True
                break
            if min(len(token), len(candidate)) >= 4 and (
                token.startswith(candidate) or candidate.startswith(token)
            ):
                matched = True
                break
            common_prefix = 0
            for left, right in zip(token, candidate):
                if left != right:
                    break
                common_prefix += 1
            if common_prefix >= 4 and abs(len(token) - len(candidate)) <= 3:
                matched = True
                break
            if abs(len(token) - len(candidate)) <= 2 and SequenceMatcher(
                None, token, candidate
            ).ratio() >= 0.82:
                matched = True
                break
        if not matched:
            remaining.add(token)
    return remaining


def video_probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [ffprobe_cmd(), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    payload = json.loads(result.stdout)
    stream = (payload.get("streams") or [{}])[0]
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "duration_seconds": float(stream.get("duration") or payload.get("format", {}).get("duration") or 0),
    }


def segment_detection(path: Path, policy: dict[str, Any]) -> dict[str, list[dict[str, float]]]:
    black_min = float(policy["black_segment_minimum_seconds"])
    freeze_min = float(policy["freeze_segment_minimum_seconds"])
    result = subprocess.run(
        [
            ffmpeg_cmd(), "-hide_banner", "-nostats", "-i", str(path), "-an",
            "-vf", f"blackdetect=d={black_min}:pix_th=0.08,freezedetect=n=-50dB:d={freeze_min}",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    black = [
        {"start": float(start), "end": float(end), "duration": float(duration)}
        for start, end, duration in re.findall(r"black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)", result.stderr)
    ]
    starts = [float(value) for value in re.findall(r"freeze_start:\s*([0-9.]+)", result.stderr)]
    ends = [(float(end), float(duration)) for end, duration in re.findall(r"freeze_end:\s*([0-9.]+)\s*\|\s*freeze_duration:\s*([0-9.]+)", result.stderr)]
    # ffmpeg may emit a trailing ``freeze_start`` at a cut without a matching
    # ``freeze_end``.  The old parser converted that incomplete diagnostic into
    # a zero-second freeze and blocked a healthy render.  Only completed
    # intervals that actually meet the configured duration are defects.
    frozen = []
    for index, start in enumerate(starts):
        if index >= len(ends):
            continue
        end, duration = ends[index]
        if duration + 1e-6 < freeze_min:
            continue
        frozen.append({"start": start, "end": end, "duration": duration})
    return {"black_segments": black, "freeze_segments": frozen}


def extract_samples(path: Path, interval: float, directory: Path) -> list[Path]:
    target = directory / "frame-%05d.jpg"
    subprocess.run(
        [ffmpeg_cmd(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-vf", f"fps=1/{interval},scale=640:-2", "-q:v", "3", str(target)],
        capture_output=True,
        text=True,
        timeout=900,
        check=True,
    )
    return sorted(directory.glob("frame-*.jpg"))


def sample_center_seconds(sample_index: int, interval: float) -> float:
    """Return the source-time represented by FFmpeg's interval sample.

    The ``fps=1/interval`` filter chooses the frame nearest the center of each
    output interval. Treating that frame as the interval start can bind a frame
    just after a visual cut to the preceding evidence beat. The midpoint keeps
    OCR, source provenance, and narration matching on the same timeline.
    """
    return (max(0, int(sample_index)) + 0.5) * float(interval)


def authored_overlay_unsafe_boxes(
    boxes: list[dict[str, Any]],
    *,
    expected_tokens: set[str],
    native_tokens: set[str],
) -> list[dict[str, Any]]:
    """Keep unsafe boxes only when their approved words are renderer-authored.

    Rights-reviewed maps, archive cards, storefronts, and documents may contain
    words such as ``SOURCE`` or ``DETROIT`` at their native image edge. Those
    pixels remain subject to semantic and artifact QA, but are not a Pattern Lab
    overlay-margin defect. A matching authored word that is absent from the
    native source remains fail-closed.
    """
    unsafe: list[dict[str, Any]] = []
    for box in boxes:
        box_tokens = {
            token
            for token in normalize_tokens(str(box.get("text", "")))
            if len(token) >= 3
        }
        authored_matches = box_tokens & expected_tokens
        if authored_matches and remove_ocr_matches(authored_matches, native_tokens):
            unsafe.append(box)
    return unsafe


def expected_words(
    root: Path,
    video_id: str,
    *,
    kind: str,
    index: int | None,
    seconds: float = 0.0,
) -> list[str]:
    values = ["Pattern Lab", "Source", episode_city(video_id)]
    if kind == "short":
        package = read_json(root / "approval" / "shorts-script-package.json")
        for item in package.get("shorts", []):
            if int(item.get("index") or 0) == int(index or 0):
                for key in ["title", "first_frame_text", "hook", "script", "proof_visual", "payoff", "related_video_promise", "bridge"]:
                    values.append(str(item.get(key) or ""))
                break
    else:
        # Full narration is intentionally not approved overlay text.  If a
        # renderer accidentally burns a narration sentence into a random box,
        # the unexpected-text gate must still catch it.
        values.extend(approved_overlay_tokens(root, seconds, video_id))
    return normalize_tokens(" ".join(values))


def evaluate_render_metrics(metrics: dict[str, Any], policy: dict[str, Any], *, kind: str) -> list[str]:
    blockers: list[str] = []
    if len(metrics.get("black_segments", [])) > int(policy["maximum_black_segments"]):
        blockers.append("black_segment_detected")
    if len(metrics.get("freeze_segments", [])) > int(policy["maximum_freeze_segments"]):
        blockers.append("freeze_segment_detected")
    if float(metrics.get("dim_sample_ratio", 1)) > float(policy["maximum_dim_sample_ratio"]):
        blockers.append("too_many_dim_or_flat_frames")
    if metrics.get("unsafe_text_box_count", 0):
        blockers.append("caption_or_overlay_outside_safe_margin")
    if metrics.get("persistent_unknown_large_tokens"):
        blockers.append("unexpected_large_text_or_random_box_detected")
    max_gap_key = "maximum_visual_event_gap_seconds_short" if kind == "short" else "maximum_visual_event_gap_seconds_long_form"
    if float(metrics.get("maximum_unchanged_visual_gap_seconds", 0)) > float(policy[max_gap_key]):
        blockers.append("visual_event_gap_above_policy")
    if not metrics.get("sample_count"):
        blockers.append("rendered_frame_samples_missing")
    return sorted(set(blockers))


def temporally_persistent_unknown_tokens(
    frame_rows: list[dict[str, Any]],
    *,
    minimum_samples: int,
    maximum_span_seconds: float,
) -> list[str]:
    """Return overlay tokens repeated closely enough to be the same defect.

    OCR can independently hallucinate the same common word on unrelated
    archive frames hundreds of seconds apart. A renderer-created random box,
    by contrast, persists across adjacent samples. Persistence is therefore a
    temporal condition, not a whole-video token count.
    """
    occurrences: dict[str, list[float]] = {}
    for row in frame_rows:
        seconds = float(row.get("seconds") or 0.0)
        for token in row.get("unknown_large_tokens", []):
            occurrences.setdefault(str(token), []).append(seconds)
    persistent: list[str] = []
    required = max(2, int(minimum_samples))
    for token, values in occurrences.items():
        ordered = sorted(values)
        for start in range(0, len(ordered) - required + 1):
            if ordered[start + required - 1] - ordered[start] <= maximum_span_seconds:
                persistent.append(token)
                break
    return sorted(set(persistent))


def analyze_asset(path: Path, *, root: Path, video_id: str, kind: str, index: int | None, policy: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, Any] = {}
    if not path.is_file():
        blockers.append("media_file_missing")
    else:
        try:
            metrics.update(video_probe(path))
            metrics.update(segment_detection(path, policy))
            interval = float(policy["short_sample_interval_seconds"] if kind == "short" else policy["long_form_sample_interval_seconds"])
            with tempfile.TemporaryDirectory(prefix="patternlab-media-qa-") as temp:
                samples = extract_samples(path, interval, Path(temp))
                frame_rows: list[dict[str, Any]] = []
                previous: np.ndarray | None = None
                unchanged_run = 0.0
                max_unchanged = 0.0
                unsafe_count = 0
                dim_count = 0
                ocr_policy = {
                    "minimum_ocr_confidence": 45,
                    "large_text_height_ratio": 0.07,
                    "minimum_text_safe_margin_ratio": float(policy["caption_safe_margin_ratio"]),
                }
                for sample_index, sample in enumerate(samples):
                    sample_seconds = sample_center_seconds(sample_index, interval)
                    expected = expected_words(
                        root,
                        video_id,
                        kind=kind,
                        index=index,
                        seconds=sample_seconds,
                    )
                    frame_metrics = image_metrics(sample)
                    is_dim = (
                        frame_metrics["mean_luma"] < float(policy["minimum_frame_mean_luma"])
                        or frame_metrics["luma_standard_deviation"] < float(policy["minimum_frame_luma_standard_deviation"])
                        or frame_metrics["sharpness_variance"] < float(policy["minimum_frame_sharpness_variance"])
                    )
                    dim_count += int(is_dim)
                    with Image.open(sample) as source:
                        image = source.convert("RGB")
                        try:
                            ocr = ocr_measurement(image, expected, ocr_policy)
                        except Exception as exc:
                            ocr = {"unknown_large_tokens": [], "unsafe_large_text_boxes": [], "error": type(exc).__name__}
                            blockers.append(f"rendered_frame_ocr_failed:{type(exc).__name__}")
                        current = np.asarray(image.resize((160, 90), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
                    # A historical map, newspaper, or source card legitimately
                    # contains native text.  It must not be mistaken for a
                    # renderer-created random box.  Margin enforcement applies
                    # only to recognized Pattern Lab overlay/caption words;
                    # native source text remains subject to the semantic VLM
                    # judge and rights/evidence gates.
                    expected_set = set(expected)
                    # Single-character OCR fragments and isolated source labels
                    # are common in archive scans.  A deterministic unexpected-
                    # overlay signal must be a substantive alphabetic token.
                    substantive_unknown = {
                        token
                        for token in ocr.get("unknown_large_tokens", [])
                        if len(token) >= 4 and token.isalpha()
                    }
                    substantive_unknown = remove_ocr_matches(substantive_unknown, expected_set)
                    # Native-source OCR is comparatively expensive.  Resolve
                    # it only when the rendered frame contains substantive
                    # text that is not an approved Pattern Lab overlay.
                    native_tokens: set[str] = set()
                    if kind == "long_form" and (
                        substantive_unknown or ocr.get("unsafe_large_text_boxes")
                    ):
                        native_tokens = native_source_tokens(root, sample_seconds)
                    overlay_unsafe = authored_overlay_unsafe_boxes(
                        list(ocr.get("unsafe_large_text_boxes", [])),
                        expected_tokens=expected_set,
                        native_tokens=native_tokens,
                    )
                    if substantive_unknown and kind == "long_form":
                        substantive_unknown = remove_ocr_matches(
                            substantive_unknown,
                            native_tokens,
                        )
                    unsafe_count += len(overlay_unsafe)
                    difference = 1.0 if previous is None else float(np.abs(current - previous).mean())
                    if previous is not None and difference < float(policy["minimum_frame_change_mean_absolute_difference"]):
                        unchanged_run += interval
                    else:
                        unchanged_run = 0.0
                    max_unchanged = max(max_unchanged, unchanged_run)
                    previous = current
                    frame_rows.append({
                        "sample_index": sample_index,
                        "seconds": round(sample_seconds, 3),
                        "mean_luma": frame_metrics["mean_luma"],
                        "contrast": frame_metrics["luma_standard_deviation"],
                        "sharpness": frame_metrics["sharpness_variance"],
                        "dim_or_flat": is_dim,
                        "frame_change": round(difference, 5),
                        "unknown_large_tokens": sorted(substantive_unknown),
                        "unsafe_text_boxes": len(overlay_unsafe),
                    })
                persistent_count = int(policy["persistent_unknown_large_text_sample_count"])
                persistent_unknown = temporally_persistent_unknown_tokens(
                    frame_rows,
                    minimum_samples=persistent_count,
                    maximum_span_seconds=interval * max(1, persistent_count),
                )
                metrics.update({
                    "sample_interval_seconds": interval,
                    "sample_count": len(frame_rows),
                    "dim_sample_count": dim_count,
                    "dim_sample_ratio": round(dim_count / len(frame_rows), 4) if frame_rows else 1.0,
                    "maximum_unchanged_visual_gap_seconds": round(max_unchanged, 3),
                    "persistent_unknown_large_tokens": persistent_unknown,
                    "unsafe_text_box_count": unsafe_count,
                    "frame_samples": frame_rows,
                })
            blockers.extend(evaluate_render_metrics(metrics, policy, kind=kind))
        except Exception as exc:
            blockers.append(f"rendered_media_analysis_failed:{type(exc).__name__}")
    blockers = sorted(set(blockers))
    score = strict_score(blockers, warnings)
    return {
        "kind": kind,
        "index": index,
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
    run_checks: bool = True,
    include_shorts: bool = True,
    report_stem: str = "rendered-media-quality-report",
) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy_all = load_policy()
    policy = policy_all.get("rendered_media", {})
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    short_paths = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if include_shorts and (root / "shorts").exists() else []
    assets: list[dict[str, Any]] = []
    if run_checks:
        assets.append(analyze_asset(long_form, root=root, video_id=video_id, kind="long_form", index=None, policy=policy))
        for index, path in enumerate(short_paths, 1):
            assets.append(analyze_asset(path, root=root, video_id=video_id, kind="short", index=index, policy=policy))
    blockers = [f"{Path(row['path']).name}:{item}" for row in assets for item in row["blockers"]]
    warnings = [f"{Path(row['path']).name}:{item}" for row in assets for item in row["warnings"]]
    if not episode_city(video_id):
        blockers.append("episode_city_missing")
    if not run_checks:
        blockers.append("rendered_media_checks_not_run")
    if include_shorts and len(short_paths) < 3:
        blockers.append(f"rendered_short_count_below_three:{len(short_paths)}")
    minimum = int(policy_all.get("minimum_asset_score", 93))
    if any(row["score"] < minimum for row in assets):
        blockers.append("one_or_more_rendered_media_scores_below_93")
    if policy_all.get("warnings_block_release") and warnings:
        blockers.append("rendered_media_warnings_must_be_resolved")
    blockers = sorted(set(blockers))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if assets and not blockers else "blocked",
        "minimum_asset_score": minimum,
        "minimum_score_observed": min((row["score"] for row in assets), default=0),
        "run_checks": run_checks,
        "include_shorts": include_shorts,
        "assets": assets,
        "blockers": blockers,
        "warnings": warnings,
        "youtube_mutation": "not_performed",
    }
    json_path, md_path = write_report(
        approval,
        report_stem,
        f"Pattern Lab Final Rendered-Media QA: Video {video_id}",
        payload,
        extra_lines=["## Assets", "", *[f"- {row['path']}: {row['status']} — {row['score']}/100" for row in assets]],
    )
    shorts_receipt = {
        "generated_at": payload["generated_at"],
        "video_id": video_id,
        "status": "pass" if short_paths and all(row["status"] == "pass" for row in assets if row["kind"] == "short") else "blocked",
        "minimum_asset_score": minimum,
        "shorts": [row for row in assets if row["kind"] == "short"],
        "youtube_mutation": "not_performed",
    }
    if include_shorts:
        (approval / "shorts-render-inspection.json").write_text(json.dumps(shorts_receipt, indent=2) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run strict Pattern Lab rendered-video QA.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--no-run", action="store_true")
    parser.add_argument("--long-form-only", action="store_true")
    parser.add_argument("--report-stem", default="rendered-media-quality-report")
    args = parser.parse_args()
    payload, _, md_path = build_report(
        args.video_id.zfill(2),
        run_checks=not args.no_run,
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
