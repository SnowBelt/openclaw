#!/usr/bin/env python3
"""Detect long-form repetition, compositing seams, wrap artifacts, and route drift."""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import imagehash
import numpy as np
from PIL import Image, ImageDraw, ImageFont

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.state import sha256_file
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab_media_qa_common import load_policy, strict_score


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def source_family(row: dict) -> str:
    parsed = urlparse(str(row.get("source_url") or ""))
    return f"{parsed.netloc.lower().removeprefix('www.')}{parsed.path.rstrip('/')}" if parsed.netloc else str(row.get("source_id") or "unknown")


def horizontal_artifact_metrics(image: Image.Image) -> dict:
    gray = np.asarray(image.convert("L").resize((640, 360), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    row_delta = np.mean(np.abs(gray[1:] - gray[:-1]), axis=1)
    interior = row_delta[18:-18]
    median = float(np.median(interior)) if interior.size else 0.0
    p95 = float(np.percentile(interior, 95)) if interior.size else 0.0
    maximum = float(np.max(interior)) if interior.size else 0.0
    seam_row = int(np.argmax(interior) + 18) if interior.size else 0
    boundary_delta = np.abs(gray[seam_row + 1] - gray[seam_row]) if 0 <= seam_row < gray.shape[0] - 1 else np.zeros(gray.shape[1])
    boundary_coverage = float(np.mean(boundary_delta > 0.25))
    band = 20
    upper_band = gray[max(0, seam_row - band) : seam_row]
    lower_band = gray[seam_row + 1 : min(gray.shape[0], seam_row + 1 + band)]
    band_luma_delta = float(abs(float(upper_band.mean()) - float(lower_band.mean()))) if upper_band.size and lower_band.size else 0.0
    seam_position = seam_row / max(1, gray.shape[0] - 1)
    # Natural maps, document cards, horizons, and our short-lived lower-third
    # labels all contain strong horizontal edges.  A compositing split is a
    # center-frame discontinuity that spans most of the image and changes the
    # luminance distribution on both sides; do not flag ordinary content lines.
    seam = bool(
        0.30 <= seam_position <= 0.70
        and maximum > 0.22
        and maximum > max(median * 6.0, p95 * 1.8)
        and boundary_coverage > 0.70
        and band_luma_delta > 0.28
    )
    strip = 64
    top = gray[:strip]
    bottom = gray[-strip:]
    wrap_mae = float(np.mean(np.abs(top - bottom)))
    top_centered = top - float(top.mean())
    bottom_centered = bottom - float(bottom.mean())
    denominator = float(np.sqrt(np.sum(top_centered**2) * np.sum(bottom_centered**2)))
    correlation = float(np.sum(top_centered * bottom_centered) / denominator) if denominator > 1e-9 else 0.0
    wrap = bool(wrap_mae < 0.035 and correlation > 0.92)
    return {
        "maximum_horizontal_row_jump": round(maximum, 5),
        "maximum_horizontal_row_jump_position": round(seam_position, 5),
        "maximum_horizontal_boundary_coverage": round(boundary_coverage, 5),
        "maximum_horizontal_band_luma_delta": round(band_luma_delta, 5),
        "median_horizontal_row_jump": round(median, 5),
        "p95_horizontal_row_jump": round(p95, 5),
        "top_bottom_mae": round(wrap_mae, 5),
        "top_bottom_correlation": round(correlation, 5),
        "horizontal_seam_detected": seam,
        "top_bottom_wrap_detected": wrap,
    }


def extract_frame(video: Path, timestamp: float, target: Path) -> None:
    subprocess.run(
        [ffmpeg_cmd(), "-y", "-ss", f"{timestamp:.3f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(target)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidate = BASE / "resources" / "fonts" / "external" / "anton-google-regular.ttf"
    return ImageFont.truetype(str(candidate), size=size) if candidate.is_file() else ImageFont.load_default()


def make_contact_sheets(frames: list[dict], directory: Path, *, columns: int, rows: int) -> list[dict]:
    ensure_dir(directory)
    per_sheet = columns * rows
    results: list[dict] = []
    for sheet_index in range(math.ceil(len(frames) / per_sheet)):
        batch = frames[sheet_index * per_sheet : (sheet_index + 1) * per_sheet]
        cell_w, cell_h, label_h = 480, 270, 34
        sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), "#111111")
        draw = ImageDraw.Draw(sheet)
        cells = []
        for index, frame in enumerate(batch):
            row, column = divmod(index, columns)
            x, y = column * cell_w, row * (cell_h + label_h)
            with Image.open(frame["path"]) as source:
                fitted = source.convert("RGB").resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            sheet.paste(fitted, (x, y + label_h))
            label = f"{index + 1:02d}  {float(frame['timestamp_seconds']):06.1f}s  {frame['asset_id'][:30]}"
            draw.text((x + 8, y + 5), label, font=font(19), fill="white")
            cells.append({"cell": index + 1, "timestamp_seconds": frame["timestamp_seconds"], "beat_id": frame["beat_id"], "asset_id": frame["asset_id"]})
        path = directory / f"long-form-sequence-{sheet_index + 1:02d}.jpg"
        sheet.save(path, quality=91, optimize=True)
        results.append({"path": str(path), "sha256": sha256_file(path), "cells": cells})
    return results


def duplicate_findings(frames: list[dict], threshold: int) -> tuple[list[dict], list[list[str]]]:
    hashes: dict[str, imagehash.ImageHash] = {}
    for row in frames:
        with Image.open(row["path"]) as source:
            hashes[row["beat_id"]] = imagehash.phash(source.convert("RGB"))
    same_asset: list[dict] = []
    adjacency: dict[str, set[str]] = {row["beat_id"]: set() for row in frames}
    for index, first in enumerate(frames):
        for second in frames[index + 1 :]:
            distance = int(hashes[first["beat_id"]] - hashes[second["beat_id"]])
            if distance > threshold:
                continue
            if first["asset_id"] == second["asset_id"]:
                same_asset.append({"first_beat": first["beat_id"], "second_beat": second["beat_id"], "asset_id": first["asset_id"], "distance": distance})
            adjacency[first["beat_id"]].add(second["beat_id"])
            adjacency[second["beat_id"]].add(first["beat_id"])
    clusters: list[list[str]] = []
    remaining = set(adjacency)
    while remaining:
        seed = remaining.pop()
        component = {seed}
        stack = [seed]
        while stack:
            current = stack.pop()
            for neighbor in adjacency[current]:
                if neighbor not in component:
                    component.add(neighbor)
                    remaining.discard(neighbor)
                    stack.append(neighbor)
        if len(component) > 1:
            clusters.append(sorted(component))
    return same_asset, sorted(clusters, key=lambda row: (-len(row), row))


def contact_sheet_asset_repeats(
    beats: list[dict],
    *,
    beats_per_sheet: int,
    maximum_uses: int,
) -> list[dict]:
    """Return route-level repeats that would appear on one sequence sheet.

    This catches obvious visual recycling before rendering or expensive local
    semantic judgment. A later pHash and VLM pass still owns visually similar
    frames from different asset IDs.
    """
    repeats: list[dict] = []
    if beats_per_sheet <= 0:
        return repeats
    for offset in range(0, len(beats), beats_per_sheet):
        batch = beats[offset : offset + beats_per_sheet]
        counts = Counter(str(row.get("asset_id") or "") for row in batch)
        for asset_id, count in sorted(counts.items()):
            if asset_id and count > maximum_uses:
                repeats.append(
                    {
                        "sheet_index": offset // beats_per_sheet + 1,
                        "asset_id": asset_id,
                        "uses": count,
                        "beat_ids": [
                            str(row.get("beat_id") or "")
                            for row in batch
                            if str(row.get("asset_id") or "") == asset_id
                        ],
                    }
                )
    return repeats


def build_report(video_id: str, *, run_checks: bool = False) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    plan_path = approval / "canonical-render-plan.json"
    plan = read_json(plan_path)
    policy = load_policy().get("long_form_sequence", {})
    blockers: list[str] = []
    if run_checks and not video.is_file():
        blockers.append("long_form_video_missing")
    beats = plan.get("beats") if isinstance(plan.get("beats"), list) else []
    if plan.get("status") != "pass" or not beats:
        blockers.append("canonical_render_plan_not_pass")
    if plan.get("caption_mode") != policy.get("required_caption_mode"):
        blockers.append("long_form_caption_mode_not_closed_caption_plus_selective_text")
    if plan.get("split_screen_compositing") != "forbidden":
        blockers.append("split_screen_compositing_not_forbidden")
    counts = Counter(str(row.get("asset_id") or "") for row in beats)
    duration = max((float(row.get("end_seconds", 0)) for row in beats), default=0.0)
    if len(counts) < int(policy.get("minimum_unique_assets", 32)):
        blockers.append(f"sequence_unique_assets_below_floor:{len(counts)}")
    unique_asset_ratio = len(counts) / len(beats) if beats else 0.0
    if unique_asset_ratio + 1e-6 < float(policy.get("minimum_unique_asset_ratio", 0.0)):
        blockers.append(f"sequence_unique_asset_ratio_below_floor:{unique_asset_ratio:.4f}")
    for asset_id, count in counts.items():
        if count > int(policy.get("maximum_uses_per_asset", 4)):
            blockers.append(f"sequence_asset_use_count_above_ceiling:{asset_id}:{count}")
        runtime = sum(float(row["end_seconds"]) - float(row["start_seconds"]) for row in beats if row.get("asset_id") == asset_id)
        if duration and runtime / duration > float(policy.get("maximum_runtime_share_per_asset", 0.06)):
            blockers.append(f"sequence_asset_runtime_share_above_ceiling:{asset_id}:{runtime / duration:.4f}")
    for first, second in zip(beats, beats[1:]):
        if first.get("asset_id") == second.get("asset_id"):
            blockers.append(f"sequence_adjacent_asset_repeat:{first.get('asset_id')}")
    beats_per_sheet = int(policy.get("contact_sheet_columns", 4)) * int(
        policy.get("contact_sheet_rows", 4)
    )
    per_sheet_repeats = contact_sheet_asset_repeats(
        beats,
        beats_per_sheet=beats_per_sheet,
        maximum_uses=int(policy.get("maximum_asset_uses_per_contact_sheet", 1)),
    )
    for row in per_sheet_repeats:
        blockers.append(
            "sequence_asset_repeated_within_contact_sheet:"
            f"{row['sheet_index']}:{row['asset_id']}:{row['uses']}"
        )
    motion = read_json(approval / "canonical-motion-plan.json")
    if any(row.get("motion_style") == "then_now_split" for row in motion.get("beats", []) if isinstance(row, dict)):
        blockers.append("horizontal_split_motion_style_present")
    acquisition = read_json(approval / "visual-acquisition-quality-report.json")
    if policy.get("acquisition_report_required") and acquisition.get("status") != "pass":
        blockers.append("authoritative_visual_acquisition_not_pass")
    ledger = read_json(approval / "evidence-asset-ledger.json")
    ledger_by_id = {str(row.get("asset_id")): row for row in ledger.get("assets", []) if isinstance(row, dict)}
    video_kinds = {"film", "modern_video", "source_motion"}
    maximum_static_uses = int(policy.get("maximum_uses_per_static_asset", policy.get("maximum_uses_per_asset", 4)))
    maximum_proof_static_uses = int(policy.get("maximum_uses_per_proof_static_asset", maximum_static_uses))
    minimum_static_gap = float(policy.get("minimum_static_asset_reuse_gap_seconds", 0.0))
    minimum_observed_static_gap: float | None = None
    for asset_id, count in counts.items():
        kind = str(ledger_by_id.get(asset_id, {}).get("asset_kind") or "")
        if kind in video_kinds:
            continue
        roles = {str(row.get("role") or "") for row in beats if str(row.get("asset_id") or "") == asset_id}
        proof_roles = {"source_proof", "map_system", "archive_evidence", "document_detail", "then_now"}
        permitted_uses = maximum_proof_static_uses if roles and roles <= proof_roles else maximum_static_uses
        if count > permitted_uses:
            blockers.append(f"sequence_static_asset_use_count_above_ceiling:{asset_id}:{count}")
        asset_beats = [row for row in beats if str(row.get("asset_id") or "") == asset_id]
        for prior, current in zip(asset_beats, asset_beats[1:]):
            gap = float(current["start_seconds"]) - float(prior["end_seconds"])
            minimum_observed_static_gap = gap if minimum_observed_static_gap is None else min(minimum_observed_static_gap, gap)
            if gap + 1e-6 < minimum_static_gap:
                blockers.append(f"sequence_static_asset_reuse_gap_below_floor:{asset_id}:{gap:.3f}")
    map_document_count = sum(
        1
        for row in beats
        if str(ledger_by_id.get(str(row.get("asset_id") or ""), {}).get("asset_kind") or "") in {"map", "document"}
    )
    moving_image_count = sum(
        1
        for row in beats
        if str(ledger_by_id.get(str(row.get("asset_id") or ""), {}).get("asset_kind") or "") in video_kinds
    )
    map_document_share = map_document_count / len(beats) if beats else 0.0
    moving_image_share = moving_image_count / len(beats) if beats else 0.0
    if map_document_share > float(policy.get("maximum_map_document_share", 1.0)) + 1e-6:
        blockers.append(f"sequence_map_document_share_above_ceiling:{map_document_share:.4f}")
    if moving_image_share + 1e-6 < float(policy.get("minimum_moving_image_share", 0.0)):
        blockers.append(f"sequence_moving_image_share_below_floor:{moving_image_share:.4f}")
    families = [source_family(ledger_by_id.get(str(row.get("asset_id")), {})) for row in beats]
    family_run = 0
    prior_family = ""
    for index, family in enumerate(families, start=1):
        family_run = family_run + 1 if family == prior_family else 1
        prior_family = family
        if family_run > int(policy.get("maximum_same_source_family_run", 2)):
            blockers.append(f"sequence_same_source_family_run:{family}:{index}:{family_run}")

    frames: list[dict] = []
    artifact_samples: list[dict] = []
    same_asset_duplicates: list[dict] = []
    duplicate_clusters: list[list[str]] = []
    contact_sheets: list[dict] = []
    if run_checks and not blockers:
        frames_dir = root / "approval" / "long-form-sequence-frames"
        if frames_dir.exists():
            shutil.rmtree(frames_dir)
        ensure_dir(frames_dir)
        for beat in beats:
            timestamp = (float(beat["start_seconds"]) + float(beat["end_seconds"])) / 2
            path = frames_dir / f"{beat['beat_id']}.jpg"
            extract_frame(video, timestamp, path)
            frames.append({"beat_id": beat["beat_id"], "asset_id": beat["asset_id"], "timestamp_seconds": round(timestamp, 3), "path": str(path), "sha256": sha256_file(path)})
        same_asset_duplicates, duplicate_clusters = duplicate_findings(frames, int(policy.get("midpoint_phash_distance_threshold", 4)))
        if len(same_asset_duplicates) > int(policy.get("maximum_same_asset_near_duplicate_pairs", 0)):
            blockers.append(f"sequence_same_asset_near_duplicate_pairs:{len(same_asset_duplicates)}")
        largest_cluster = max((len(row) for row in duplicate_clusters), default=1)
        if largest_cluster > int(policy.get("maximum_cross_asset_duplicate_cluster_size", 2)):
            blockers.append(f"sequence_duplicate_cluster_too_large:{largest_cluster}")
        interval = float(policy.get("sample_interval_seconds", 3.0))
        sample_dir = root / "approval" / "long-form-artifact-samples"
        if sample_dir.exists():
            shutil.rmtree(sample_dir)
        ensure_dir(sample_dir)
        timestamp = 0.0
        while timestamp < duration:
            path = sample_dir / f"artifact-{timestamp:08.3f}.jpg"
            extract_frame(video, timestamp, path)
            with Image.open(path) as source:
                metrics = horizontal_artifact_metrics(source)
            artifact_samples.append({"timestamp_seconds": round(timestamp, 3), "path": str(path), "sha256": sha256_file(path), **metrics})
            timestamp += interval
        seam_count = sum(1 for row in artifact_samples if row["horizontal_seam_detected"])
        wrap_count = sum(1 for row in artifact_samples if row["top_bottom_wrap_detected"])
        if seam_count > int(policy.get("maximum_horizontal_seam_samples", 0)):
            blockers.append(f"horizontal_compositing_seam_samples:{seam_count}")
        if wrap_count > int(policy.get("maximum_top_bottom_wrap_samples", 0)):
            blockers.append(f"top_bottom_wrap_samples:{wrap_count}")
        contact_sheets = make_contact_sheets(
            frames,
            root / "approval" / "long-form-sequence-contact-sheets",
            columns=int(policy.get("contact_sheet_columns", 4)),
            rows=int(policy.get("contact_sheet_rows", 4)),
        )
    elif run_checks:
        blockers.append("sequence_pixel_checks_skipped_due_to_preflight_blocker")
    else:
        blockers.append("sequence_pixel_checks_not_run")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "video": display_path(video),
        "video_sha256": sha256_file(video) if video.is_file() else "",
        "canonical_render_plan": display_path(plan_path),
        "canonical_render_plan_sha256": sha256_file(plan_path) if plan_path.is_file() else "",
        "unique_asset_count": len(counts),
        "unique_asset_ratio": round(unique_asset_ratio, 5),
        "visual_beat_count": len(beats),
        "maximum_asset_uses": max(counts.values(), default=0),
        "maximum_static_asset_uses": max(
            (
                count
                for asset_id, count in counts.items()
                if str(ledger_by_id.get(asset_id, {}).get("asset_kind") or "") not in video_kinds
            ),
            default=0,
        ),
        "minimum_static_asset_reuse_gap_seconds": (
            round(minimum_observed_static_gap, 3) if minimum_observed_static_gap is not None else None
        ),
        "map_document_beat_count": map_document_count,
        "map_document_share": round(map_document_share, 5),
        "moving_image_beat_count": moving_image_count,
        "moving_image_share": round(moving_image_share, 5),
        "midpoint_frame_count": len(frames),
        "same_asset_near_duplicate_pairs": same_asset_duplicates,
        "duplicate_clusters": duplicate_clusters,
        "contact_sheet_asset_repeats": per_sheet_repeats,
        "artifact_samples": artifact_samples,
        "contact_sheets": contact_sheets,
        "score": strict_score(sorted(set(blockers))),
        "minimum_score": int(policy.get("minimum_sequence_judge_score", 93)),
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report_path = approval / "long-form-sequence-quality-report.json"
    md_path = approval / "long-form-sequence-quality-report.md"
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Long-Form Sequence Quality: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Unique assets: {len(counts)}",
                f"Visual beats: {len(beats)}",
                f"Same-asset near-duplicate pairs: {len(same_asset_duplicates)}",
                f"Artifact samples: {len(artifact_samples)}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, report_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run strict long-form sequence and artifact QA.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), run_checks=args.run)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
