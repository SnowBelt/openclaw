#!/usr/bin/env python3
"""Adversarial local defect harness proving Pattern Lab QA fails closed."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_audio_quality import analyze_asset as analyze_audio_asset, evaluate_audio_metrics
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab_media_qa_common import load_policy, qa_contract_hash, strict_score, write_report
from patternlab_rendered_media_quality import evaluate_render_metrics, segment_detection
from patternlab_thumbnail_pixel_quality import evaluate_metrics, image_metrics, ocr_measurement, validate_candidate


def synthetic_video(path: Path, *, audio: bool) -> None:
    command = [ffmpeg_cmd(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=3"]
    if audio:
        command.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:a", "aac"])
    command.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)])
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)


def synthetic_quiet_audio_video(path: Path) -> None:
    subprocess.run(
        [
            ffmpeg_cmd(), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=3",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
            "-filter:a", "volume=0.001", "-shortest", "-c:v", "libx264", "-c:a", "aac",
            "-pix_fmt", "yuv420p", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    global_qa = ensure_dir(BASE / "local-output" / "qa")
    policy = load_policy()
    checks = []
    with tempfile.TemporaryDirectory(prefix="patternlab-qa-defects-") as temp:
        temp_root = Path(temp)
        dim_path = temp_root / "dim.png"
        Image.new("RGB", (1280, 720), (18, 19, 21)).save(dim_path)
        dim_blockers = evaluate_metrics(image_metrics(dim_path), policy["thumbnail"])
        checks.append({"name": "dim_flat_thumbnail_rejected", "passed": "thumbnail_mean_luma_below_floor" in dim_blockers and "thumbnail_contrast_below_floor" in dim_blockers})

        sharp = Image.new("RGB", (1280, 720), "white")
        sharp_draw = ImageDraw.Draw(sharp)
        for x in range(0, 1280, 80):
            sharp_draw.rectangle((x, 0, x + 40, 720), fill=(20, 80, 210))
        blurred_path = temp_root / "blurred.png"
        sharp.filter(ImageFilter.GaussianBlur(radius=24)).save(blurred_path)
        blur_blockers = evaluate_metrics(image_metrics(blurred_path), policy["thumbnail"])
        checks.append({"name": "blurred_thumbnail_rejected", "passed": "thumbnail_sharpness_below_floor" in blur_blockers, "observed": blur_blockers})

        text_path = temp_root / "random-text.png"
        image = Image.new("RGB", (1280, 720), (245, 185, 25))
        draw = ImageDraw.Draw(image)
        font_path = BASE / "resources" / "fonts" / "external" / "anton-google-regular.ttf"
        font = ImageFont.truetype(str(font_path), 180)
        draw.text((80, 230), "DETROIT RANDOM BOX", font=font, fill=(10, 10, 10))
        image.save(text_path)
        shelf = image.resize((320, 180), Image.Resampling.LANCZOS)
        ocr = ocr_measurement(shelf, ["DETROIT"], policy["thumbnail"])
        checks.append({"name": "unexpected_large_text_rejected", "passed": bool(set(ocr.get("unknown_large_tokens", [])) & {"random", "box"}), "observed": ocr.get("unknown_large_tokens", [])})

        clipped = Image.new("RGB", (320, 180), (245, 185, 25))
        clipped_draw = ImageDraw.Draw(clipped)
        clipped_font = ImageFont.truetype(str(font_path), 70)
        clipped_draw.text((-10, 50), "DETROIT", font=clipped_font, fill=(10, 10, 10))
        clipped_ocr = ocr_measurement(clipped, ["DETROIT"], policy["thumbnail"])
        checks.append({"name": "clipped_or_unsafe_text_rejected", "passed": bool(clipped_ocr.get("unsafe_large_text_boxes")), "observed": clipped_ocr.get("unsafe_large_text_boxes", [])})

        tampered = validate_candidate({"id": "tampered", "path": str(text_path), "sha256": "0" * 64, "public_text": ["DETROIT"]}, policy["thumbnail"])
        checks.append({"name": "stale_or_tampered_thumbnail_hash_rejected", "passed": "thumbnail_manifest_sha256_mismatch" in tampered["blockers"]})

        black_video = temp_root / "black.mp4"
        synthetic_video(black_video, audio=True)
        segments = segment_detection(black_video, policy["rendered_media"])
        render_blockers = evaluate_render_metrics({
            **segments,
            "sample_count": 2,
            "dim_sample_ratio": 1.0,
            "unsafe_text_box_count": 0,
            "persistent_unknown_large_tokens": [],
            "maximum_unchanged_visual_gap_seconds": 2.0,
        }, policy["rendered_media"], kind="short")
        checks.append({"name": "black_or_frozen_video_rejected", "passed": "black_segment_detected" in render_blockers or "freeze_segment_detected" in render_blockers, "segments": segments})

        no_audio_video = temp_root / "no-audio.mp4"
        synthetic_video(no_audio_video, audio=False)
        no_audio = analyze_audio_asset(no_audio_video, kind="short", policy=policy["audio"])
        checks.append({"name": "missing_audio_rejected", "passed": "audio_stream_missing" in no_audio["blockers"]})

        quiet_audio_video = temp_root / "quiet-audio.mp4"
        synthetic_quiet_audio_video(quiet_audio_video)
        quiet_audio = analyze_audio_asset(quiet_audio_video, kind="short", policy=policy["audio"])
        checks.append({
            "name": "actual_out_of_range_audio_rejected",
            "passed": "audio_integrated_loudness_out_of_range" in quiet_audio["blockers"],
            "observed": quiet_audio.get("metrics", {}),
        })

        bad_audio_metrics = {
            "audio_stream_present": True,
            "sample_rate_hz": 22050,
            "channel_count": 2,
            "integrated_loudness_lufs": -25,
            "true_peak_dbtp": 0.2,
            "loudness_range_lu": 20,
            "format_duration_seconds": 30,
            "silence_intervals": [{"start": 5, "end": 8, "duration": 3}],
            "av_duration_delta_seconds": 1.0,
        }
        bad_audio = evaluate_audio_metrics(bad_audio_metrics, policy["audio"], kind="short")
        expected_audio = {
            "audio_sample_rate_below_floor",
            "audio_integrated_loudness_out_of_range",
            "audio_true_peak_above_ceiling",
            "audio_loudness_range_out_of_range",
            "audio_internal_silence_or_dropout_detected",
            "audio_video_duration_desynchronization",
        }
        checks.append({"name": "bad_loudness_dropout_and_sync_rejected", "passed": expected_audio.issubset(set(bad_audio)), "observed": bad_audio})
        checks.append({"name": "hard_failure_cannot_score_93", "passed": strict_score(["defect"]) <= 92})

    blockers = [row["name"] for row in checks if not row["passed"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "purpose": "Adversarial negative fixtures must be rejected; this is proof of detector behavior, not approval of production media.",
        "checks": checks,
        "blockers": blockers,
        "warnings": [],
        "minimum_score": 93,
        "qa_contract_sha256": qa_contract_hash(),
        "youtube_mutation": "not_performed",
    }
    json_path, md_path = write_report(
        global_qa,
        "media-qa-defect-harness",
        f"Pattern Lab Media QA Adversarial Harness: Video {video_id}",
        payload,
        extra_lines=["## Negative Fixtures", "", *[f"- {row['name']}: {'caught' if row['passed'] else 'MISSED'}" for row in checks]],
    )
    # Keep a package-local copy for owner/debug review while the authoritative
    # harness remains global and hash-bound to the QA implementation.
    write_report(
        approval,
        "media-qa-defect-harness",
        f"Pattern Lab Media QA Adversarial Harness: Video {video_id}",
        payload,
        extra_lines=["## Negative Fixtures", "", *[f"- {row['name']}: {'caught' if row['passed'] else 'MISSED'}" for row in checks]],
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Prove Pattern Lab QA catches known visual/audio defects.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- missed defect: {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
