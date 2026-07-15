#!/usr/bin/env python3
"""Select and render city-generic, source-preserving 2.5D historical motion.

The orchestrator never treats a flat zoom as parallax. It selects unique,
direct historical photographs already bound to narration, generates separate
foreground/background layers, and records the exact source and receipt hashes
that the evidence manifest must consume.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import cv2

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))
if str(YOUTUBE_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

from patternlab.state import sha256_file
from patternlab_historical_parallax import build as build_parallax
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "approved", "accept"}


def route_uses(route: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for segment_index, segment in enumerate(route.get("segments", []), start=1):
        if not isinstance(segment, dict):
            continue
        entries = segment.get("entries") if isinstance(segment.get("entries"), list) else []
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        duration = (end - start) / max(1, len(entries))
        for entry_index, entry in enumerate(entries, start=1):
            if not isinstance(entry, dict):
                continue
            rows.append(
                {
                    "asset_id": str(entry.get("asset_id") or ""),
                    "role": str(entry.get("role") or "context_only"),
                    "claim_id": str(entry.get("claim_id") or segment.get("claim_id") or ""),
                    "start_seconds": round(start + (entry_index - 1) * duration, 3),
                    "duration_seconds": round(duration, 3),
                    "route_order": len(rows),
                    "segment_index": segment_index,
                }
            )
    return rows


def image_metrics(path: Path) -> dict[str, Any]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return {"decodable": False, "width": 0, "height": 0, "area": 0}
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return {
        "decodable": True,
        "width": width,
        "height": height,
        "area": width * height,
        "mean_luma": round(float(gray.mean() / 255.0), 5),
        "contrast": round(float(gray.std() / 255.0), 5),
    }


def plan(video_id: str) -> tuple[dict[str, Any], Path, dict[str, dict[str, Any]]]:
    root = output_root(video_id)
    launch = launch_root(video_id)
    approval = ensure_dir(root / "approval")
    route = read_json(launch / "long-form-visual-routing.json")
    expanded = root / "source-packet" / "long-form-rebuild" / "evidence-intake-expanded.json"
    intake_path = expanded if expanded.is_file() else root / "source-packet" / "evidence-intake.json"
    intake = read_json(intake_path)
    requirements = route.get("requirements") if isinstance(route.get("requirements"), dict) else {}
    minimum = int(requirements.get("minimum_historical_motion_assets", 4))
    target = max(minimum, int(requirements.get("target_historical_motion_assets", minimum)))
    uses = route_uses(route)
    counts = Counter(row["asset_id"] for row in uses if row["asset_id"])
    first_use = {row["asset_id"]: row for row in uses if row["asset_id"]}
    assets = {
        str(row.get("asset_id") or ""): row
        for row in intake.get("assets", [])
        if isinstance(row, dict) and str(row.get("asset_id") or "")
    }
    candidates: list[dict[str, Any]] = []
    for asset_id, use in first_use.items():
        asset = assets.get(asset_id, {})
        path = root / str(asset.get("relative_path") or "")
        eligible = bool(
            counts[asset_id] == 1
            and asset.get("asset_kind") == "photo"
            and asset.get("source_class") == "historical_evidence"
            and asset.get("evidence_fit") == "direct"
            and truthy(asset.get("human_accepted"))
            and truthy(asset.get("commercial_use_ok"))
            and truthy(asset.get("modification_ok"))
            and path.is_file()
        )
        metrics = image_metrics(path) if eligible else {"decodable": False, "width": 0, "height": 0, "area": 0}
        if not metrics.get("decodable") or min(int(metrics.get("width", 0)), int(metrics.get("height", 0))) < 720:
            eligible = False
        candidates.append(
            {
                "source_asset_id": asset_id,
                "eligible": eligible,
                "source_path": display_path(path) if path.is_file() else str(path),
                "source_sha256": sha256_file(path) if path.is_file() else "",
                "role": use.get("role"),
                "claim_id": use.get("claim_id"),
                "start_seconds": use.get("start_seconds"),
                "duration_seconds": max(4.0, float(use.get("duration_seconds", 4.0))),
                "route_order": use.get("route_order"),
                "image_metrics": metrics,
            }
        )
    role_priority = {"source_proof": 0, "archive_evidence": 1, "then_now": 2, "context_only": 3}
    candidates.sort(
        key=lambda row: (
            not row["eligible"],
            role_priority.get(str(row.get("role")), 4),
            -int(row.get("image_metrics", {}).get("area", 0)),
            int(row.get("route_order", 9999)),
        )
    )
    eligible_count = sum(bool(row["eligible"]) for row in candidates)
    blockers = [] if eligible_count >= target else [f"historical_motion_eligible_sources_below_target:{eligible_count}/{target}"]
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "mode": "plan",
        "intake": display_path(intake_path),
        "minimum_asset_count": minimum,
        "target_asset_count": target,
        "eligible_asset_count": eligible_count,
        "candidates": candidates,
        "selected_assets": [],
        "blockers": blockers,
        "rule": "Only one-use, direct, rights-cleared historical photographs may become source-preserving two-plane motion.",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report_path = approval / "historical-motion-selection-report.json"
    return payload, report_path, assets


def render_selected(video_id: str, payload: dict[str, Any], assets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if os.environ.get("PATTERNLAB_CANONICAL_RUN") != "1":
        raise SystemExit("historical_motion_render_requires_canonical_production_entrypoint")
    root = output_root(video_id)
    target = int(payload["target_asset_count"])
    destination = ensure_dir(root / "source-packet" / "derived-motion")
    selected: list[dict[str, Any]] = []
    failures: list[str] = []
    for candidate in payload["candidates"]:
        if len(selected) >= target:
            break
        if not candidate.get("eligible"):
            continue
        asset_id = str(candidate["source_asset_id"])
        source = root / str(assets[asset_id]["relative_path"])
        output = destination / f"{asset_id}-documentary-depth.mp4"
        try:
            motion, receipt = build_parallax(
                video_id,
                source,
                output,
                mask=None,
                preset="documentary_depth",
                duration=float(candidate["duration_seconds"]),
                fps=24,
                width=1920,
                height=1080,
                usage_status="production_selected",
            )
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            failures.append(f"{asset_id}:{type(exc).__name__}:{str(exc)[:240]}")
            continue
        selected.append(
            {
                **candidate,
                "status": "pass",
                "output": display_path(output),
                "output_relative_path": str(output.relative_to(root)),
                "output_sha256": str(motion["output_sha256"]),
                "receipt": display_path(receipt),
                "receipt_sha256": sha256_file(receipt),
                "foreground_mask": motion.get("foreground_mask"),
                "foreground_mask_sha256": motion.get("foreground_mask_sha256"),
                "engine": motion.get("engine"),
            }
        )
    blockers = [] if len(selected) >= int(payload["minimum_asset_count"]) else [
        f"historical_motion_rendered_assets_below_floor:{len(selected)}/{payload['minimum_asset_count']}"
    ]
    return {
        **payload,
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "mode": "rendered",
        "selected_assets": selected,
        "render_failures": failures,
        "blockers": blockers,
    }


def write_report(payload: dict[str, Any], report_path: Path) -> None:
    atomic_write_json(report_path, payload)
    atomic_write_text(
        report_path.with_suffix(".md"),
        "\n".join(
            [
                f"# Historical Motion Selection: Video {payload['video_id']}",
                "",
                f"Status: {payload['status']}",
                f"Mode: {payload['mode']}",
                f"Selected: {len(payload.get('selected_assets', []))}/{payload['target_asset_count']}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload.get("blockers", [])] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or render city-generic source-preserving historical parallax.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    payload, report_path, assets = plan(video_id)
    if args.render and payload["status"] == "pass":
        payload = render_selected(video_id, payload, assets)
    write_report(payload, report_path)
    print(json.dumps({"status": payload["status"], "mode": payload["mode"], "report": display_path(report_path), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
