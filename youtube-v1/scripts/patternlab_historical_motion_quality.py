#!/usr/bin/env python3
"""Verify deterministic historical-photo motion against its exact source recipe."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw
from skimage.metrics import structural_similarity

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_historical_parallax import PRESETS, cover_resize, prepare_layers, smoothstep, transform
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, read_json, sha256_file
from patternlab_local_visual_judge_runner import run_model


POLICY_PATH = BASE / "resources" / "media-qa-policy.json"
MOTION_JUDGE_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "source_identity_preservation": {"type": "integer", "minimum": 0, "maximum": 100},
            "cutout_quality": {"type": "integer", "minimum": 0, "maximum": 100},
            "motion_naturalness": {"type": "integer", "minimum": 0, "maximum": 100},
            "hard_failures": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": [
            "score",
            "source_identity_preservation",
            "cutout_quality",
            "motion_naturalness",
            "hard_failures",
            "reason",
        ],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)


def motion_contact_sheet(source: np.ndarray, frames: list[np.ndarray], path: Path) -> None:
    cells = [source, *frames[:3]]
    canvas = Image.new("RGB", (1280, 720), "black")
    draw = ImageDraw.Draw(canvas)
    labels = ["SOURCE", "START", "MIDDLE", "END"]
    for index, frame in enumerate(cells):
        rgb = cv2.cvtColor(cv2.resize(frame, (640, 360), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        x = (index % 2) * 640
        y = (index // 2) * 360
        canvas.paste(Image.fromarray(rgb), (x, y))
        draw.rectangle((x + 8, y + 8, x + 132, y + 48), fill="black")
        draw.text((x + 18, y + 18), labels[index], fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, format="PNG", optimize=True)


def expected_frame(image: np.ndarray, mask: np.ndarray, preset: dict[str, Any], width: int, height: int, progress: float) -> np.ndarray:
    image = cover_resize(image, width, height, cv2.INTER_LANCZOS4)
    mask = cover_resize(mask, width, height, cv2.INTER_LINEAR)
    background, foreground, alpha, _ = prepare_layers(image, mask, preset)
    eased = smoothstep(progress)
    bg_scale = float(np.interp(eased, [0, 1], preset["background_scale"]))
    fg_scale = float(np.interp(eased, [0, 1], preset["foreground_scale"]))
    bg_x = float(np.interp(eased, [0, 1], preset["background_x"]))
    fg_x = float(np.interp(eased, [0, 1], preset["foreground_x"]))
    bg = transform(background, bg_scale, bg_x)
    fg = transform(foreground, fg_scale, fg_x)
    fg_alpha = transform(alpha, fg_scale, fg_x)[:, :, None]
    return np.clip(fg.astype(np.float32) * fg_alpha + bg.astype(np.float32) * (1 - fg_alpha), 0, 255).astype(np.uint8)


def analyze(
    receipt: dict[str, Any],
    policy: dict[str, Any],
    *,
    contact_sheet_path: Path | None = None,
    run_local_judge: bool = True,
) -> tuple[dict[str, Any], list[str]]:
    blockers: list[str] = []
    source = BASE / str(receipt.get("source_image") or "")
    mask_path = BASE / str(receipt.get("foreground_mask") or "")
    output = BASE / str(receipt.get("output") or "")
    for label, path, expected_hash in [
        ("source", source, receipt.get("source_image_sha256")),
        ("mask", mask_path, receipt.get("foreground_mask_sha256")),
        ("output", output, receipt.get("output_sha256")),
    ]:
        if not path.is_file() or not expected_hash or sha256_file(path) != expected_hash:
            blockers.append(f"historical_motion_{label}_missing_or_hash_mismatch")
    if blockers:
        return {}, blockers
    metrics = receipt.get("metrics", {})
    width, height = int(metrics.get("width", 0)), int(metrics.get("height", 0))
    preset_name = str(receipt.get("preset") or "")
    if preset_name not in PRESETS:
        blockers.append("historical_motion_preset_unknown")
        return {}, blockers
    capture = cv2.VideoCapture(str(output))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    if frame_count < 2 or fps <= 0:
        capture.release()
        return {}, ["historical_motion_video_cannot_be_decoded"]
    source_pixels = cv2.imread(str(source), cv2.IMREAD_COLOR)
    mask_pixels = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    sample_indices = sorted({0, frame_count // 2, frame_count - 1})
    sample_rows: list[dict[str, Any]] = []
    sample_frames: list[np.ndarray] = []
    all_differences: list[float] = []
    previous: np.ndarray | None = None
    for index in range(frame_count):
        ok, frame = capture.read()
        if not ok:
            blockers.append(f"historical_motion_frame_decode_failed:{index}")
            break
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (320, 180), interpolation=cv2.INTER_AREA)
        if previous is not None:
            all_differences.append(float(np.mean(cv2.absdiff(previous, small)) / 255.0))
        previous = small
        if index not in sample_indices:
            continue
        sample_frames.append(frame.copy())
        expected = expected_frame(source_pixels, mask_pixels, PRESETS[preset_name], width, height, index / max(1, frame_count - 1))
        mse = float(np.mean((frame.astype(np.float32) - expected.astype(np.float32)) ** 2))
        psnr = 99.0 if mse == 0 else float(10 * np.log10((255.0 ** 2) / mse))
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_expected = cv2.cvtColor(expected, cv2.COLOR_BGR2GRAY)
        ssim = float(structural_similarity(gray_frame, gray_expected, data_range=255))
        luma = float(np.mean(gray_frame) / 255.0)
        sample_rows.append({"index": index, "psnr_db": round(psnr, 4), "ssim": round(ssim, 6), "mean_luma": round(luma, 5)})
    capture.release()
    floor_psnr = float(policy["minimum_expected_frame_psnr_db"])
    floor_ssim = float(policy["minimum_expected_frame_ssim"])
    for row in sample_rows:
        if row["psnr_db"] < floor_psnr:
            blockers.append(f"historical_motion_expected_frame_psnr_below_floor:{row['index']}")
        if row["ssim"] < floor_ssim:
            blockers.append(f"historical_motion_expected_frame_ssim_below_floor:{row['index']}")
        if not policy["minimum_frame_mean_luma"] <= row["mean_luma"] <= policy["maximum_frame_mean_luma"]:
            blockers.append(f"historical_motion_frame_luma_out_of_range:{row['index']}")
    positive = [value for value in all_differences if value > 1e-6]
    median = float(np.median(positive)) if positive else 0.0
    maximum = max(all_differences, default=0.0)
    if median and maximum > median * float(policy["maximum_temporal_jump_multiplier"]):
        blockers.append("historical_motion_temporal_jump_detected")
    coverage = float(metrics.get("mask_coverage", -1))
    if not policy["minimum_mask_coverage"] <= coverage <= policy["maximum_mask_coverage"]:
        blockers.append("historical_motion_mask_coverage_out_of_range")
    if int(metrics.get("foreground_component_count", 0)) > int(policy["maximum_foreground_component_count"]):
        blockers.append("historical_motion_foreground_component_count_above_ceiling")
    if float(metrics.get("largest_foreground_component_ratio", 0)) < float(policy["minimum_largest_foreground_component_ratio"]):
        blockers.append("historical_motion_foreground_is_fragmented")
    if float(metrics.get("foreground_edge_density", 1)) > float(policy["maximum_foreground_edge_density"]):
        blockers.append("historical_motion_foreground_edge_is_too_complex")
    if receipt.get("storage", {}).get("intermediate_frame_files") != 0:
        blockers.append("historical_motion_intermediate_frame_sprawl_detected")
    if metrics.get("background_fill_is_nonproof") and not receipt.get("source_truth", {}).get("background_fill_is_not_evidence"):
        blockers.append("historical_motion_background_fill_not_marked_nonproof")
    local_judgment: dict[str, Any] = {"status": "not_run"}
    if run_local_judge and contact_sheet_path is not None and source_pixels is not None and len(sample_frames) == 3:
        motion_contact_sheet(source_pixels, sample_frames, contact_sheet_path)
        prompt = (
            "Judge only the documentary parallax treatment shown in this four-cell sheet. The first cell is the exact source; "
            "the next three are start, middle, and end. Ignore whether the source itself is attractive or historically accurate. "
            "Reject halos, double subjects, ghost people, torn limbs, missing body parts, warped architecture, visible inpaint seams, "
            "unnatural cutout edges, identity changes, or motion that feels like a cardboard sticker. Accept only subtle, premium, "
            "source-preserving documentary motion. Every numeric field is a 0-100 quality score, not a boolean. "
            "Score 93 or higher in every numeric field only with no hard failure. Return JSON only."
        )
        try:
            judgment, elapsed, output_hash, cache_status = run_model(
                contact_sheet_path,
                prompt,
                MOTION_JUDGE_SCHEMA,
                timeout=900,
                maximum_output_tokens=1024,
            )
            dimension_names = ["source_identity_preservation", "cutout_quality", "motion_naturalness"]
            judgment_passes = bool(
                judgment.get("score", 0) >= int(policy["minimum_local_visual_judge_score"])
                and all(judgment.get(name, 0) >= int(policy["minimum_local_visual_judge_score"]) for name in dimension_names)
                and not judgment.get("hard_failures")
            )
            local_judgment = {
                **judgment,
                "status": "pass" if judgment_passes else "blocked",
                "elapsed_seconds": round(elapsed, 3),
                "output_sha256": output_hash,
                "cache_status": cache_status,
                "contact_sheet": display_path(contact_sheet_path),
                "contact_sheet_sha256": sha256_file(contact_sheet_path),
            }
            if local_judgment["status"] != "pass":
                blockers.append("historical_motion_local_visual_judge_rejected")
        except RuntimeError as exc:
            local_judgment = {"status": "blocked", "error": str(exc)}
            blockers.append("historical_motion_local_visual_judge_failed")
    elif run_local_judge:
        blockers.append("historical_motion_local_visual_judge_input_missing")
    return {
        "frame_count": frame_count,
        "fps": fps,
        "samples": sample_rows,
        "median_consecutive_frame_difference": round(median, 7),
        "maximum_consecutive_frame_difference": round(maximum, 7),
        "local_visual_judgment": local_judgment,
    }, sorted(set(blockers))


def build_report(video_id: str, receipt_path: Path) -> tuple[dict[str, Any], Path, Path]:
    policy = read_json(POLICY_PATH).get("historical_motion", {})
    receipt = read_json(receipt_path)
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    sheet = approval / "historical-motion-contact-sheets" / f"{receipt_path.stem}.png"
    metrics, blockers = analyze(receipt, policy, contact_sheet_path=sheet)
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "receipt": display_path(receipt_path), "receipt_sha256": sha256_file(receipt_path) if receipt_path.is_file() else "",
        "output": receipt.get("output", "missing"), "metrics": metrics, "blockers": blockers,
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    usage = str(receipt.get("usage_status") or "canary_only")
    stem = "historical-motion-quality-report" if usage == "production_selected" else f"historical-motion-{usage}-quality-{receipt_path.stem}"
    json_path = approval / f"{stem}.json"
    md_path = approval / f"{stem}.md"
    atomic_write_json(json_path, payload)
    lines = [f"# Historical Motion Quality: Video {video_id}", "", f"Status: {payload['status']}", f"Receipt: {payload['receipt']}", "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", ""]
    atomic_write_text(md_path, "\n".join(lines))
    return payload, json_path, md_path


def build_all_report(video_id: str, *, production_only: bool = True, run_local_judge: bool = True) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH).get("historical_motion", {})
    visual_system_policy = read_json(BASE / "resources" / "patternlab-visual-system-policy.json").get("historical_motion", {})
    route = read_json(BASE / "launch" / f"video-{video_id}" / "long-form-visual-routing.json")
    requirements = route.get("requirements") if isinstance(route.get("requirements"), dict) else {}
    required_count = int(
        requirements.get("minimum_historical_motion_assets", 0)
        or visual_system_policy.get("default_minimum_production_selected_clips", 4)
    )
    selection_path = approval / "historical-motion-selection-report.json"
    selection = read_json(selection_path)
    assets: list[dict[str, Any]] = []
    selected_rows = selection.get("selected_assets") if isinstance(selection.get("selected_assets"), list) else []
    receipt_paths: list[Path] = []
    for row in selected_rows:
        if not isinstance(row, dict) or not str(row.get("receipt") or "").strip():
            continue
        value = Path(str(row["receipt"]))
        receipt_paths.append(value if value.is_absolute() else BASE / value)
    for receipt_path in receipt_paths:
        receipt = read_json(receipt_path)
        usage = str(receipt.get("usage_status") or "canary_only")
        if production_only and usage != "production_selected":
            continue
        sheet = approval / "historical-motion-contact-sheets" / f"{receipt_path.stem}.png"
        metrics, blockers = analyze(receipt, policy, contact_sheet_path=sheet, run_local_judge=run_local_judge)
        assets.append(
            {
                "asset_id": receipt_path.stem,
                "usage_status": usage,
                "receipt": display_path(receipt_path),
                "receipt_sha256": sha256_file(receipt_path),
                "output": receipt.get("output", "missing"),
                "metrics": metrics,
                "status": "pass" if not blockers else "blocked",
                "blockers": blockers,
            }
        )
    blockers = [f"{row['asset_id']}:{item}" for row in assets for item in row["blockers"]]
    if selection.get("mode") != "rendered" or selection.get("status") != "pass":
        blockers.append("historical_motion_selection_missing_or_not_rendered")
    if len(assets) < required_count:
        blockers.append(f"historical_motion_production_assets_below_floor:{len(assets)}/{required_count}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "production_only": production_only,
        "selection_report": display_path(selection_path),
        "selection_report_sha256": sha256_file(selection_path) if selection_path.is_file() else "",
        "asset_count": len(assets),
        "required_asset_count": required_count,
        "assets": assets,
        "blockers": blockers,
        "rule": "A requested documentary-parallax beat is mandatory. Every production-selected clip must use separate foreground/background layers, preserve source identity, and score at least 93.",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "historical-motion-quality-report.json"
    md_path = approval / "historical-motion-quality-report.md"
    atomic_write_json(json_path, payload)
    atomic_write_text(
        md_path,
        "\n".join(
            [
                f"# Historical Motion Quality: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Production assets: {len(assets)}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in blockers] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab deterministic historical-photo motion.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--all-production", action="store_true")
    args = parser.parse_args()
    if not args.all_production and args.receipt is None:
        parser.error("--receipt is required unless --all-production is used")
    payload, report, _ = build_all_report(args.video_id.zfill(2)) if args.all_production else build_report(args.video_id.zfill(2), args.receipt.resolve())
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
