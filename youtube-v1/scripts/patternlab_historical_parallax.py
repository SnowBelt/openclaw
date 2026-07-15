#!/usr/bin/env python3
"""Render source-preserving documentary parallax without frame-file sprawl."""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, execution_context, exclusive_process_lock, sha256_file


SWIFT_SOURCE = BASE / "scripts" / "patternlab_vision_foreground_mask.swift"

PRESETS: dict[str, dict[str, Any]] = {
    "documentary_depth": {
        "background_scale": [1.02, 1.10],
        "foreground_scale": [1.00, 1.035],
        "background_x": [-0.015, 0.015],
        "foreground_x": [-0.004, 0.004],
        "background_fill": "telea_inpaint",
        "description": "Foreground subject moves gently while the background travels faster, documentary-style.",
    },
    "safe_subject_push": {
        "background_scale": [1.00, 1.035],
        "foreground_scale": [1.01, 1.075],
        "background_x": [0.0, 0.0],
        "foreground_x": [-0.004, 0.004],
        "background_fill": "none",
        "description": "Foreground grows slightly faster and covers the source subject, minimizing invented background.",
    },
    "lateral_depth": {
        "background_scale": [1.035, 1.075],
        "foreground_scale": [1.02, 1.045],
        "background_x": [-0.02, 0.02],
        "foreground_x": [-0.006, 0.006],
        "background_fill": "telea_inpaint",
        "description": "Separated lateral movement for beams, workers, storefronts, and similar strong silhouettes.",
    },
}


def compile_mask_helper(cache_root: Path) -> Path:
    cache_root.mkdir(parents=True, exist_ok=True)
    digest = sha256_file(SWIFT_SOURCE)[:16]
    binary = cache_root / f"patternlab-foreground-mask-{digest}"
    if binary.is_file():
        return binary
    temporary = binary.with_name(f".{binary.name}.{os.getpid()}.tmp")
    command = [
        "xcrun", "swiftc", "-O", str(SWIFT_SOURCE), "-o", str(temporary),
        "-framework", "Vision", "-framework", "CoreImage", "-framework", "ImageIO",
        "-framework", "UniformTypeIdentifiers",
    ]
    environment = os.environ.copy()
    module_cache = cache_root / "swift-module-cache"
    module_cache.mkdir(parents=True, exist_ok=True)
    environment["CLANG_MODULE_CACHE_PATH"] = str(module_cache)
    environment["SWIFT_MODULE_CACHE_PATH"] = str(module_cache)
    result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False, env=environment)
    if result.returncode != 0 or not temporary.is_file():
        raise RuntimeError(f"Apple Vision mask helper compilation failed: {result.stderr[-1000:]}")
    temporary.chmod(0o755)
    temporary.replace(binary)
    return binary


def generate_mask(image: Path, mask: Path, cache_root: Path) -> dict[str, Any]:
    helper = compile_mask_helper(cache_root)
    mask.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(helper), str(image), str(mask)], capture_output=True, text=True, timeout=180, check=False)
    if result.returncode != 0 or not mask.is_file():
        raise RuntimeError(f"Apple Vision foreground segmentation failed: {result.stderr[-1000:]}")
    return {"engine": "Apple Vision VNGenerateForegroundInstanceMaskRequest", "helper_sha256": sha256_file(helper)}


def cover_resize(image: np.ndarray, width: int, height: int, interpolation: int) -> np.ndarray:
    source_height, source_width = image.shape[:2]
    scale = max(width / source_width, height / source_height)
    resized = cv2.resize(image, (round(source_width * scale), round(source_height * scale)), interpolation=interpolation)
    y = max(0, (resized.shape[0] - height) // 2)
    x = max(0, (resized.shape[1] - width) // 2)
    return resized[y:y + height, x:x + width]


def smoothstep(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def transform(image: np.ndarray, scale: float, x_fraction: float) -> np.ndarray:
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), 0, scale)
    matrix[0, 2] += x_fraction * width
    return cv2.warpAffine(image, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)


def prepare_layers(image: np.ndarray, mask: np.ndarray, preset: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    normalized = np.clip(mask.astype(np.float32) / 255.0, 0, 1)
    normalized = cv2.GaussianBlur(normalized, (0, 0), sigmaX=1.8)
    hard = (normalized >= 0.4).astype(np.uint8) * 255
    coverage = float(np.mean(hard > 0))
    if coverage < 0.015 or coverage > 0.75:
        raise RuntimeError(f"Foreground mask coverage is unsafe: {coverage:.4f}")
    background = image.copy()
    if preset["background_fill"] == "telea_inpaint":
        kernel = np.ones((9, 9), np.uint8)
        inpaint_mask = cv2.dilate(hard, kernel, iterations=2)
        background = cv2.inpaint(image, inpaint_mask, 5, cv2.INPAINT_TELEA)
    foreground = image.copy()
    component_count, labels, stats, _centroids = cv2.connectedComponentsWithStats((hard > 0).astype(np.uint8), 8)
    component_areas = [int(value) for value in stats[1:, cv2.CC_STAT_AREA]] if component_count > 1 else []
    total_foreground = sum(component_areas)
    largest_component_ratio = max(component_areas, default=0) / max(1, total_foreground)
    edge_density = float(np.mean(cv2.Canny(hard, 50, 150) > 0))
    return background, foreground, normalized, {
        "mask_coverage": round(coverage, 5),
        "foreground_component_count": max(0, component_count - 1),
        "largest_foreground_component_ratio": round(largest_component_ratio, 5),
        "foreground_edge_density": round(edge_density, 5),
        "background_fill": preset["background_fill"],
        "background_fill_is_nonproof": preset["background_fill"] != "none",
    }


def render(
    image_path: Path,
    mask_path: Path,
    output: Path,
    *,
    preset_name: str,
    duration: float,
    fps: int,
    width: int,
    height: int,
) -> dict[str, Any]:
    preset = PRESETS[preset_name]
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if image is None or mask is None:
        raise RuntimeError("Input image or mask could not be decoded")
    image = cover_resize(image, width, height, cv2.INTER_LANCZOS4)
    mask = cover_resize(mask, width, height, cv2.INTER_LINEAR)
    background, foreground, alpha, layer_metrics = prepare_layers(image, mask, preset)
    frame_count = max(2, round(duration * fps))
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.stem}.{os.getpid()}{output.suffix}")
    command = [
        ffmpeg_cmd(), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(temporary),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for index in range(frame_count):
            progress = smoothstep(index / max(1, frame_count - 1))
            bg_scale = np.interp(progress, [0, 1], preset["background_scale"])
            fg_scale = np.interp(progress, [0, 1], preset["foreground_scale"])
            bg_x = np.interp(progress, [0, 1], preset["background_x"])
            fg_x = np.interp(progress, [0, 1], preset["foreground_x"])
            bg = transform(background, float(bg_scale), float(bg_x))
            fg = transform(foreground, float(fg_scale), float(fg_x))
            fg_alpha = transform(alpha, float(fg_scale), float(fg_x))[:, :, None]
            frame = np.clip(fg.astype(np.float32) * fg_alpha + bg.astype(np.float32) * (1 - fg_alpha), 0, 255).astype(np.uint8)
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
        returncode = process.wait(timeout=max(60, round(duration * 20)))
    except Exception:
        process.kill()
        temporary.unlink(missing_ok=True)
        raise
    if returncode != 0 or not temporary.is_file() or temporary.stat().st_size == 0:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg parallax render failed: {stderr[-1000:]}")
    temporary.replace(output)
    return {"frame_count": frame_count, "duration_seconds": duration, "fps": fps, "width": width, "height": height, **layer_metrics}


def build(
    video_id: str,
    image: Path,
    output: Path,
    *,
    mask: Path | None,
    preset: str,
    duration: float,
    fps: int,
    width: int,
    height: int,
    usage_status: str = "canary_only",
) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    receipt_dir = ensure_dir(root / "approval" / "historical-motion-receipts")
    generated_mask = mask is None
    mask_path = mask or output.with_suffix(".foreground-mask.png")
    mask_engine: dict[str, Any] = {"engine": "provided_mask"}
    if generated_mask:
        if not execution_context()["metal_generation_trusted"]:
            raise RuntimeError(
                "Apple Vision subject segmentation requires the native user runtime; rerun outside the Codex Seatbelt sandbox or provide an approved mask."
            )
        mask_engine = generate_mask(image, mask_path, BASE / "local-output" / "tools")
    lock = BASE / "local-output" / "locks" / "historical-parallax.lock"
    with exclusive_process_lock(lock, timeout_seconds=30):
        metrics = render(image, mask_path, output, preset_name=preset, duration=duration, fps=fps, width=width, height=height)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass",
        "usage_status": usage_status,
        "engine": "Pattern Lab deterministic two-plane documentary parallax",
        "preset": preset,
        "preset_definition": PRESETS[preset],
        "source_image": display_path(image),
        "source_image_sha256": sha256_file(image),
        "foreground_mask": display_path(mask_path),
        "foreground_mask_sha256": sha256_file(mask_path),
        "mask_generation": mask_engine,
        "output": display_path(output),
        "output_sha256": sha256_file(output),
        "metrics": metrics,
        "source_truth": {
            "source_pixels_remain_authoritative": True,
            "new_people_objects_signs_or_architecture": False,
            "background_fill_is_not_evidence": metrics["background_fill_is_nonproof"],
            "editorial_role": "source_presentation_motion",
            "requires_reconstruction_label": False,
        },
        "storage": {"intermediate_frame_files": 0, "streamed_directly_to_ffmpeg": True},
        "execution_context": execution_context(),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    receipt = receipt_dir / f"{output.stem}.json"
    atomic_write_json(receipt, payload)
    atomic_write_text(receipt.with_suffix(".md"), "\n".join([
        f"# Historical Motion Receipt: {output.name}", "", "Status: pass", f"Preset: {preset}",
        f"Source: {display_path(image)}", f"Output SHA-256: {payload['output_sha256']}",
        f"Mask coverage: {metrics['mask_coverage']:.1%}", "Intermediate frame files: 0", "YouTube mutation: not performed", "",
    ]))
    return payload, receipt


def main() -> None:
    parser = argparse.ArgumentParser(description="Create source-preserving documentary parallax from a historical still.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mask", type=Path)
    parser.add_argument("--preset", choices=sorted(PRESETS), default="documentary_depth")
    parser.add_argument("--duration", type=float, default=4.0)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument(
        "--usage-status",
        choices=["canary_only", "owner_review_candidate", "production_selected"],
        default="canary_only",
        help="Production QA ignores canaries and unselected review candidates.",
    )
    args = parser.parse_args()
    payload, receipt = build(args.video_id.zfill(2), args.input.resolve(), args.output.resolve(), mask=args.mask.resolve() if args.mask else None, preset=args.preset, duration=args.duration, fps=args.fps, width=args.width, height=args.height, usage_status=args.usage_status)
    print(json.dumps({"status": payload["status"], "output": payload["output"], "receipt": display_path(receipt)}, indent=2))


if __name__ == "__main__":
    main()
