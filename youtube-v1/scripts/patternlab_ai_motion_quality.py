#!/usr/bin/env python3
"""Fail-closed QA for short, non-proof local AI motion clips."""
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
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, read_json, sha256_file
from patternlab_local_visual_judge_runner import run_model
from patternlab_thumbnail_pixel_quality import ocr_measurement


POLICY_PATH = BASE / "resources" / "media-qa-policy.json"
JUDGE_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
        "identity_preservation": {"type": "integer", "minimum": 0, "maximum": 100},
        "geometry_stability": {"type": "integer", "minimum": 0, "maximum": 100},
        "narration_match": {"type": "integer", "minimum": 0, "maximum": 100},
        "hard_failures": {"type": "array", "items": {"type": "string"}},
        "reason": {"type": "string"},
    },
    "required": ["score", "identity_preservation", "geometry_stability", "narration_match", "hard_failures", "reason"],
    "additionalProperties": False,
}, separators=(",", ":"))


def contact_sheet(source: np.ndarray, frames: list[np.ndarray], path: Path) -> None:
    selected = [source, *frames[:11]]
    thumbs = [cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB) for frame in selected]
    canvas = Image.new("RGB", (1280, 540), "black")
    draw = ImageDraw.Draw(canvas)
    for index, array in enumerate(thumbs):
        x, y = (index % 4) * 320, (index // 4) * 180
        canvas.paste(Image.fromarray(array), (x, y))
        draw.rectangle((x + 4, y + 4, x + 48, y + 30), fill="black")
        draw.text((x + 10, y + 8), "SRC" if index == 0 else str(index), fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, format="PNG", optimize=True)


def sampled_frames(path: Path, minimum: int) -> tuple[list[np.ndarray], dict[str, Any]]:
    capture = cv2.VideoCapture(str(path))
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if count < 2 or fps <= 0:
        capture.release()
        return [], {}
    indices = sorted(set(np.linspace(0, count - 1, num=min(max(minimum, 3), count), dtype=int).tolist()))
    wanted = set(indices)
    frames: list[np.ndarray] = []
    for index in range(count):
        ok, frame = capture.read()
        if not ok:
            break
        if index in wanted:
            frames.append(frame)
    capture.release()
    return frames, {"frame_count": count, "fps": fps, "width": width, "height": height, "duration_seconds": count / fps}


def deterministic_metrics(frames: list[np.ndarray]) -> dict[str, Any]:
    lumas: list[float] = []
    edges: list[float] = []
    differences: list[float] = []
    previous: np.ndarray | None = None
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (320, 180), interpolation=cv2.INTER_AREA)
        lumas.append(float(np.mean(small) / 255.0))
        edges.append(float(np.mean(cv2.Canny(small, 80, 160) > 0)))
        if previous is not None:
            differences.append(float(np.mean(cv2.absdiff(previous, small)) / 255.0))
        previous = small
    median = float(np.median([item for item in differences if item > 1e-6])) if differences else 0.0
    return {
        "sample_count": len(frames),
        "luma_min": round(min(lumas, default=0), 5),
        "luma_max": round(max(lumas, default=0), 5),
        "luma_drift": round(max(lumas, default=0) - min(lumas, default=0), 5),
        "edge_density_min": round(min(edges, default=0), 5),
        "edge_density_max": round(max(edges, default=0), 5),
        "edge_density_drift": round(max(edges, default=0) - min(edges, default=0), 5),
        "median_frame_difference": round(median, 7),
        "maximum_frame_difference": round(max(differences, default=0), 7),
    }


def validate_receipt(receipt: dict[str, Any], root: Path, policy: dict[str, Any], sheet_dir: Path) -> dict[str, Any]:
    blockers: list[str] = []
    output = BASE / str(receipt.get("output") or "")
    source = BASE / str(receipt.get("source_image") or "")
    for label, path, digest in [("output", output, receipt.get("output_sha256")), ("source", source, receipt.get("source_image_sha256"))]:
        if not path.is_file() or not digest or sha256_file(path) != digest:
            blockers.append(f"ai_motion_{label}_missing_or_hash_mismatch")
    if not receipt.get("model_sha256") or not receipt.get("prompt_sha256"):
        blockers.append("ai_motion_model_or_prompt_hash_missing")
    if blockers:
        return {"asset_id": receipt.get("asset_id", "unknown"), "status": "blocked", "blockers": blockers}
    frames, probe = sampled_frames(output, int(policy["minimum_sampled_frames"]))
    metrics = deterministic_metrics(frames)
    source_pixels = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if source_pixels is None or not frames:
        blockers.append("ai_motion_source_or_frames_cannot_be_decoded")
    else:
        first = frames[0]
        source_fit = cv2.resize(source_pixels, (first.shape[1], first.shape[0]), interpolation=cv2.INTER_AREA)
        source_gray = cv2.cvtColor(source_fit, cv2.COLOR_BGR2GRAY)
        first_gray = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
        initial_ssim = float(structural_similarity(source_gray, first_gray, data_range=255))
        metrics["initial_source_ssim"] = round(initial_ssim, 6)
        if initial_ssim < float(policy["minimum_initial_source_ssim"]):
            blockers.append("ai_motion_initial_frame_source_similarity_below_floor")
    if probe.get("duration_seconds", 0) > float(policy["maximum_clip_seconds"]):
        blockers.append("ai_motion_clip_exceeds_maximum_seconds")
    if metrics["sample_count"] < int(policy["minimum_sampled_frames"]):
        blockers.append("ai_motion_sample_count_below_floor")
    if metrics["luma_drift"] > float(policy["maximum_luma_drift"]):
        blockers.append("ai_motion_luma_drift_above_ceiling")
    if metrics["edge_density_drift"] > float(policy["maximum_edge_density_drift"]):
        blockers.append("ai_motion_edge_density_drift_above_ceiling")
    median = metrics["median_frame_difference"]
    if median and metrics["maximum_frame_difference"] > median * float(policy["maximum_temporal_jump_multiplier"]):
        blockers.append("ai_motion_temporal_jump_detected")
    asset_id = str(receipt.get("asset_id") or output.stem)
    sheet = sheet_dir / f"{asset_id}.png"
    if source_pixels is not None:
        source_sheet = cv2.resize(source_pixels, (frames[0].shape[1], frames[0].shape[0]), interpolation=cv2.INTER_AREA) if frames else source_pixels
        contact_sheet(source_sheet, frames, sheet)
    protected_text = receipt.get("protected_text", []) if isinstance(receipt.get("protected_text"), list) else []
    unknown_tokens: set[str] = set()
    ocr_errors: list[str] = []
    ocr_policy = {
        "minimum_ocr_confidence": 45,
        "large_text_height_ratio": 0.07,
        "minimum_text_safe_margin_ratio": 0.02,
    }
    for frame in frames:
        try:
            measurement = ocr_measurement(
                Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)),
                protected_text,
                ocr_policy,
            )
            unknown_tokens.update(str(token) for token in measurement.get("unknown_large_tokens", []))
        except Exception as exc:
            ocr_errors.append(type(exc).__name__)
    metrics["unknown_large_text_tokens"] = sorted(unknown_tokens)
    metrics["ocr_errors"] = sorted(set(ocr_errors))
    if len(unknown_tokens) > int(policy["maximum_unknown_large_text_occurrences"]):
        blockers.append("ai_motion_added_or_changed_large_text")
    if ocr_errors:
        blockers.append("ai_motion_ocr_stability_check_failed")
    prompt = (
        "Judge this ordered contact sheet from a short local AI motion clip for Pattern Lab. The first cell is the source still; later cells progress left-to-right, top-to-bottom. "
        "Reject any identity drift, changing face or hands, duplicated or disappearing people, changing object count, bending architecture, "
        "new text/signs, flicker, geometry warping, misleading archival appearance, or mismatch with the narration. "
        f"Narration: {receipt.get('narration', '')}. Source role: non-proof support. "
        "Every numeric field is a 0-100 quality score, not a boolean. Score 93 or higher in every numeric field only if all sampled frames preserve identity and geometry and are genuinely owner-review quality. Return JSON only."
    )
    try:
        judgment, elapsed, output_hash, cache_status = run_model(sheet, prompt, JUDGE_SCHEMA, timeout=900)
        floor = int(policy["minimum_local_visual_judge_score"])
        if (
            judgment.get("score", 0) < floor
            or any(judgment.get(name, 0) < floor for name in ["identity_preservation", "geometry_stability", "narration_match"])
            or judgment.get("hard_failures")
        ):
            blockers.append("ai_motion_local_visual_judge_rejected")
        local_judgment = {**judgment, "elapsed_seconds": round(elapsed, 3), "output_sha256": output_hash, "cache_status": cache_status}
    except RuntimeError as exc:
        local_judgment = {"error": str(exc)}
        blockers.append("ai_motion_local_visual_judge_failed")
    realistic = bool(receipt.get("realistic_reconstruction"))
    if realistic and receipt.get("on_screen_disclosure") != "Dramatic reconstruction — not archival footage":
        blockers.append("ai_motion_realistic_reconstruction_disclosure_missing")
    return {
        "asset_id": asset_id, "status": "pass" if not blockers else "blocked",
        "output": display_path(output), "contact_sheet": display_path(sheet), "probe": probe,
        "metrics": metrics, "local_visual_judgment": local_judgment, "blockers": sorted(set(blockers)),
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    receipt_dir = approval / "ai-motion-receipts"
    sheet_dir = ensure_dir(approval / "ai-motion-contact-sheets")
    policy = read_json(POLICY_PATH).get("ai_motion", {})
    receipts = [read_json(path) for path in sorted(receipt_dir.glob("*.json"))] if receipt_dir.is_dir() else []
    rows = [validate_receipt(receipt, root, policy, sheet_dir) for receipt in receipts]
    blockers = [f"{row['asset_id']}:{item}" for row in rows for item in row["blockers"]]
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked", "asset_count": len(rows),
        "assets": rows, "blockers": blockers,
        "rule": "No AI motion is required. When present, every clip must score at least 93 with no hard failure.",
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "ai-motion-quality-report.json"
    md_path = approval / "ai-motion-quality-report.md"
    atomic_write_json(json_path, payload)
    lines = [f"# AI Motion Quality: Video {video_id}", "", f"Status: {payload['status']}", f"AI motion assets: {len(rows)}", "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "Paid provider calls: not performed", "YouTube mutation: not performed", ""]
    atomic_write_text(md_path, "\n".join(lines))
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate all Pattern Lab local AI motion receipts.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "asset_count": payload["asset_count"], "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
