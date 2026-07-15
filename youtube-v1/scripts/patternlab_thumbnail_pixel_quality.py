#!/usr/bin/env python3
"""Measure final Pattern Lab thumbnail pixels and phone-shelf text, fail closed."""
from __future__ import annotations

import argparse
import difflib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import load_policy, normalize_tokens, resolve_youtube_path, strict_score, write_report
from patternlab.state import sha256_file
from patternlab.thumbnail import candidate_issues, load_thumbnail_candidate_manifest, quality_status


def image_metrics(path: Path) -> dict[str, Any]:
    with Image.open(path) as source:
        image = source.convert("RGB")
        rgb = np.asarray(image, dtype=np.float32) / 255.0
        gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
        maximum = rgb.max(axis=2)
        minimum = rgb.min(axis=2)
        saturation = np.divide(maximum - minimum, maximum, out=np.zeros_like(maximum), where=maximum > 0)
        gray_uint8 = np.asarray(image.convert("L"), dtype=np.uint8)
        try:
            import cv2

            sharpness_variance = float(cv2.Laplacian(gray_uint8, cv2.CV_64F).var())
        except Exception:
            # The finite-difference fallback remains deterministic, but OpenCV
            # is locked in the production environment and is the authority.
            dx = np.diff(gray_uint8.astype(np.float32), axis=1)
            dy = np.diff(gray_uint8.astype(np.float32), axis=0)
            sharpness_variance = float((dx.var() + dy.var()) / 2)
        clipped = np.logical_or(np.all(rgb <= 0.015, axis=2), np.all(rgb >= 0.985, axis=2))
        width, height = image.size
        zones = {}
        for name, region in {
            "left": gray[:, : max(1, width // 2)],
            "right": gray[:, width // 2 :],
            "center": gray[:, width // 4 : max(width // 4 + 1, 3 * width // 4)],
        }.items():
            zones[name] = {
                "mean_luma": round(float(region.mean()), 4),
                "luma_standard_deviation": round(float(region.std()), 4),
            }
        return {
            "width": width,
            "height": height,
            "mean_luma": round(float(gray.mean()), 4),
            "dark_pixel_ratio": round(float((gray < 0.18).mean()), 4),
            "mean_saturation": round(float(saturation.mean()), 4),
            "luma_standard_deviation": round(float(gray.std()), 4),
            "sharpness_variance": round(sharpness_variance, 2),
            "clipped_pixel_ratio": round(float(clipped.mean()), 4),
            "zones": zones,
        }


def ocr_measurement(
    image: Image.Image,
    expected_text: list[Any],
    policy: dict[str, Any],
    declared_regions: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Read visible public type without confusing it with the photo texture.

    A thumbnail can use a deliberate outlined display face that is legible to a
    human at shelf size but difficult for whole-image OCR because smoke, water,
    or a historic photo has more edges than the headline.  When the renderer
    declares normalized public-text regions, OCR is run on those exact,
    hash-bound crops after high-quality upscaling.  A separate whole-image pass
    still supplies unknown-text detection.  This is stricter than an OCR audit
    image: it evaluates pixels from the actual final thumbnail.
    """
    import pytesseract
    from pytesseract import Output

    def data_for(target: Image.Image, psm: int) -> dict[str, Any]:
        return pytesseract.image_to_data(target, config=f"--psm {psm}", output_type=Output.DICT)

    full_data = data_for(image, 11)
    expected = normalize_tokens(expected_text)
    expected_set = set(expected)

    def expected_match(token: str) -> str | None:
        if token in expected_set:
            return token
        if len(token) < 4:
            return None
        for candidate in expected_set:
            if len(candidate) < 4 or abs(len(candidate) - len(token)) > 1:
                continue
            if difflib.SequenceMatcher(None, token, candidate).ratio() >= 0.80:
                return candidate
        return None

    observed: list[str] = []
    large_unknown: list[str] = []
    unsafe_boxes: list[dict[str, Any]] = []
    minimum_confidence = float(policy.get("minimum_ocr_confidence", 45))
    large_ratio = float(policy.get("large_text_height_ratio", 0.075))
    safe_ratio = float(policy.get("minimum_text_safe_margin_ratio", 0.018))
    width, height = image.size
    for index, raw in enumerate(full_data.get("text", [])):
        token_values = normalize_tokens(str(raw))
        try:
            confidence = float(full_data["conf"][index])
        except (KeyError, TypeError, ValueError):
            confidence = -1
        if confidence < minimum_confidence or not token_values:
            continue
        left = int(full_data["left"][index])
        top = int(full_data["top"][index])
        box_width = int(full_data["width"][index])
        box_height = int(full_data["height"][index])
        observed.extend(token_values)
        observed.extend(match for token in token_values if (match := expected_match(token)))
        is_large = box_height / max(1, height) >= large_ratio
        if is_large:
            large_unknown.extend(
                token
                for token in token_values
                if len(token) >= 5 and token.isalpha() and expected_match(token) is None
            )
            # Only Pattern Lab public text is subject to overlay safe margins.
            # Native text inside a rights-cleared map/photo is not an overlay.
            if any(expected_match(token) for token in token_values) and (
                left < width * safe_ratio
                or top < height * safe_ratio
                or left + box_width > width * (1 - safe_ratio)
                or top + box_height > height * (1 - safe_ratio)
            ):
                unsafe_boxes.append({"text": str(raw), "left": left, "top": top, "width": box_width, "height": box_height})
    # Recover expected tokens from deterministic, normalized text regions.
    # Regions are [left, top, right, bottom] fractions of the final frame.
    crop_observed: list[str] = []
    region_errors: list[str] = []
    if declared_regions:
        for region in declared_regions:
            if len(region) != 4:
                region_errors.append("declared_text_region_not_four_values")
                continue
            left_n, top_n, right_n, bottom_n = (float(value) for value in region)
            if not (0 <= left_n < right_n <= 1 and 0 <= top_n < bottom_n <= 1):
                region_errors.append("declared_text_region_out_of_bounds")
                continue
            left = max(0, round(left_n * width))
            top = max(0, round(top_n * height))
            right = min(width, round(right_n * width))
            bottom = min(height, round(bottom_n * height))
            crop = image.crop((left, top, right, bottom)).resize(
                (max(1, (right - left) * 4), max(1, (bottom - top) * 4)),
                Image.Resampling.LANCZOS,
            )
            # Outlined display text frequently has a bright fill, dark edge,
            # and colored drop depth.  Add contrast/threshold variants solely
            # for OCR; all variants still come from the final rendered crop.
            gray = crop.convert("L")
            from PIL import ImageOps
            enhanced = ImageOps.autocontrast(gray)
            binary_light = enhanced.point(lambda value: 255 if value > 145 else 0)
            binary_dark = enhanced.point(lambda value: 255 if value < 115 else 0)
            # Try line and sparse modes.  The token union is used only for
            # expected words; unknown-text detection remains the full image.
            for ocr_image in (crop, enhanced, binary_light, binary_dark):
                for psm in (6, 7, 11):
                    for raw in data_for(ocr_image, psm).get("text", []):
                        values = normalize_tokens(str(raw))
                        crop_observed.extend(values)
                        crop_observed.extend(match for token in values if (match := expected_match(token)))
            if (
                left < width * safe_ratio
                or top < height * safe_ratio
                or right > width * (1 - safe_ratio)
                or bottom > height * (1 - safe_ratio)
            ):
                unsafe_boxes.append({"text": "declared_region", "left": left, "top": top, "width": right - left, "height": bottom - top})
    observed_set = set(observed) | set(crop_observed)
    recall = len(expected_set & observed_set) / len(expected_set) if expected_set else 1.0
    return {
        "ocr_text": " ".join(observed + crop_observed),
        "expected_tokens": sorted(expected_set),
        "observed_tokens": sorted(observed_set),
        "word_recall": round(recall, 4),
        "missing_tokens": sorted(expected_set - observed_set),
        "unknown_large_tokens": sorted(set(large_unknown)),
        "unsafe_large_text_boxes": unsafe_boxes,
        "declared_text_region_errors": region_errors,
    }


def evaluate_metrics(metrics: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    width = int(metrics.get("width") or 0)
    height = int(metrics.get("height") or 0)
    aspect = width / height if height else 0
    if (
        width < int(policy["minimum_width"])
        or height < int(policy["minimum_height"])
        or abs(aspect - float(policy["required_aspect_ratio"])) > float(policy["aspect_ratio_tolerance"])
    ):
        blockers.append(f"thumbnail_dimensions_invalid:{metrics.get('width')}x{metrics.get('height')}")
    comparisons = [
        ("mean_luma", "minimum_mean_luma", "thumbnail_mean_luma_below_floor", lambda a, b: a < b),
        ("dark_pixel_ratio", "maximum_dark_pixel_ratio", "thumbnail_dark_pixel_ratio_above_ceiling", lambda a, b: a > b),
        ("mean_saturation", "minimum_mean_saturation", "thumbnail_saturation_below_floor", lambda a, b: a < b),
        ("luma_standard_deviation", "minimum_luma_standard_deviation", "thumbnail_contrast_below_floor", lambda a, b: a < b),
        ("sharpness_variance", "minimum_sharpness_variance", "thumbnail_sharpness_below_floor", lambda a, b: a < b),
        ("clipped_pixel_ratio", "maximum_clipped_pixel_ratio", "thumbnail_clipping_above_ceiling", lambda a, b: a > b),
    ]
    for metric_key, policy_key, code, failed in comparisons:
        if failed(float(metrics.get(metric_key, 0)), float(policy[policy_key])):
            blockers.append(code)
    bright_zones = sum(
        1
        for row in metrics.get("zones", {}).values()
        if float(row.get("mean_luma", 0)) >= float(policy["minimum_mean_luma"]) * 0.8
        and float(row.get("luma_standard_deviation", 0)) >= float(policy["minimum_luma_standard_deviation"]) * 0.7
    )
    if bright_zones < 2:
        blockers.append("thumbnail_focal_regions_dim_or_flat")
    return blockers


def candidate_manifest(root: Path) -> tuple[Path, list[dict[str, Any]]]:
    """Compatibility adapter for callers that imported the legacy helper."""
    manifest = load_thumbnail_candidate_manifest(root)
    return manifest.path, list(manifest.candidates)


def validate_candidate(candidate: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    warnings: list[str] = []
    path = resolve_youtube_path(str(candidate.get("path", "")))
    digest = ""
    metrics: dict[str, Any] = {}
    shelf: list[dict[str, Any]] = []
    if not path.is_file():
        blockers.append("thumbnail_file_missing")
    else:
        digest = sha256_file(path)
        expected_hash = str(candidate.get("sha256") or "")
        if not expected_hash:
            blockers.append("thumbnail_manifest_sha256_missing")
        elif digest != expected_hash:
            blockers.append("thumbnail_manifest_sha256_mismatch")
        try:
            metrics = image_metrics(path)
            blockers.extend(evaluate_metrics(metrics, policy))
            with Image.open(path) as source:
                rgb = source.convert("RGB")
                for width, height in policy.get("shelf_sizes", []):
                    resized = rgb.resize((int(width), int(height)), Image.Resampling.LANCZOS)
                    try:
                        row = ocr_measurement(
                            resized,
                            candidate.get("public_text", []),
                            policy,
                            candidate.get("ocr_regions") if isinstance(candidate.get("ocr_regions"), list) else None,
                        )
                    except Exception as exc:
                        row = {"word_recall": 0, "missing_tokens": normalize_tokens(candidate.get("public_text", [])), "unknown_large_tokens": [], "unsafe_large_text_boxes": [], "error": type(exc).__name__}
                    row.update({"width": int(width), "height": int(height)})
                    shelf.append(row)
                    if float(row.get("word_recall", 0)) < float(policy["minimum_ocr_word_recall"]):
                        blockers.append(f"mobile_ocr_failure:{width}x{height}")
                    if len(row.get("unknown_large_tokens", [])) > int(policy["maximum_unknown_large_text_occurrences"]):
                        blockers.append(f"unexpected_large_text_or_box:{width}x{height}")
                    if row.get("unsafe_large_text_boxes"):
                        blockers.append(f"text_safe_margin_violation:{width}x{height}")
        except Exception as exc:
            blockers.append(f"thumbnail_pixel_analysis_failed:{type(exc).__name__}")
    blockers = sorted(set(blockers))
    score = strict_score(blockers, warnings)
    return {
        "id": candidate.get("id", ""),
        "path": display_path(path),
        "sha256": digest,
        "status": "pass" if not blockers and score >= int(load_policy().get("minimum_asset_score", 93)) else "blocked",
        "score": score,
        "metrics": metrics,
        "shelf_ocr": shelf,
        "blockers": blockers,
        "warnings": warnings,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = load_policy()
    thumbnail_policy = policy.get("thumbnail", {})
    manifest = load_thumbnail_candidate_manifest(root)
    manifest_path, candidates = manifest.path, list(manifest.candidates)
    rows = [validate_candidate(item, thumbnail_policy) for item in candidates]
    blockers = candidate_issues(rows, "blockers", deduplicate=True)
    warnings = candidate_issues(rows, "warnings")
    if not candidates:
        blockers.append("thumbnail_candidate_manifest_missing_or_empty")
    minimum = int(policy.get("minimum_asset_score", 93))
    if any(int(row.get("score", 0)) < minimum for row in rows):
        blockers.append("one_or_more_thumbnail_scores_below_93")
    if policy.get("warnings_block_release") and warnings:
        blockers.append("thumbnail_warnings_must_be_resolved")
    blockers = sorted(set(blockers))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": quality_status(has_candidates=bool(rows), blockers=blockers),
        "minimum_asset_score": minimum,
        "candidate_manifest": display_path(manifest_path),
        "candidate_count": len(rows),
        "minimum_score_observed": min((row["score"] for row in rows), default=0),
        "candidates": rows,
        "blockers": blockers,
        "warnings": warnings,
        "youtube_mutation": "not_performed",
    }
    json_path, md_path = write_report(
        approval,
        "thumbnail-pixel-quality-report",
        f"Pattern Lab Thumbnail Final-Pixel QA: Video {video_id}",
        payload,
        extra_lines=[
            "## Candidates",
            "",
            *[f"- {row['id']}: {row['status']} — {row['score']}/100 — {row['path']}" for row in rows],
        ],
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run strict final-pixel QA on Pattern Lab thumbnails.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
