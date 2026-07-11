#!/usr/bin/env python3
"""Validate a reproducible local visual-model benchmark receipt before model lock."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def build_report(video_id: str, receipt_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy_path = BASE / "resources" / "local-visual-model-benchmark-policy.json"
    policy = read_json(policy_path)
    receipt_path = receipt_path or approval / "local-visual-model-benchmark-receipt.json"
    receipt = read_json(receipt_path)
    acceptance = policy.get("acceptance", {})
    blockers: list[str] = []
    if not policy:
        blockers.append("local_visual_model_benchmark_policy_missing")
    if not receipt:
        blockers.append("local_visual_model_benchmark_receipt_missing")
    if receipt.get("video_id") != video_id:
        blockers.append("local_visual_model_benchmark_video_id_mismatch")
    if receipt.get("local_only") is not True:
        blockers.append("local_visual_model_benchmark_not_local_only")
    try:
        fixture_accuracy = float(receipt.get("fixture_accuracy", 0))
    except (TypeError, ValueError):
        fixture_accuracy = 0.0
    try:
        median_seconds = float(receipt.get("median_seconds_per_frame"))
    except (TypeError, ValueError):
        median_seconds = float("inf")
    if fixture_accuracy < float(acceptance.get("minimum_fixture_accuracy", 1)):
        blockers.append("local_visual_model_benchmark_accuracy_below_policy")
    if median_seconds > float(acceptance.get("maximum_median_seconds_per_frame", 0)):
        blockers.append("local_visual_model_benchmark_runtime_above_policy")
    if receipt.get("fallback_model_used"):
        blockers.append("local_visual_model_benchmark_silent_fallback")
    if receipt.get("model_role") != "final_local_judge":
        blockers.append("local_visual_model_benchmark_model_role_invalid")
    if not str(receipt.get("model_id") or "").strip() or not str(receipt.get("model_sha256") or "").strip():
        blockers.append("local_visual_model_benchmark_model_identity_missing")
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "policy": display_path(policy_path), "receipt": display_path(receipt_path),
        "model_id": receipt.get("model_id", ""), "fixture_accuracy": receipt.get("fixture_accuracy", 0),
        "median_seconds_per_frame": receipt.get("median_seconds_per_frame", None),
        "blockers": blockers, "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-visual-model-benchmark-report.json"
    md_path = approval / "local-visual-model-benchmark-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Visual Model Benchmark: Video {video_id}", "", f"Status: {payload['status']}",
        f"Model: {payload['model_id'] or 'missing'}", f"Fixture accuracy: {payload['fixture_accuracy']}",
        f"Median seconds/frame: {payload['median_seconds_per_frame']}", "", "## Blockers", "",
        *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a local Pattern Lab visual model benchmark receipt.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), Path(args.receipt) if args.receipt else None)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
