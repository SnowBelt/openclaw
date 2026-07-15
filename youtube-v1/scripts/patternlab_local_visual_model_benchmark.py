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
from patternlab_media_qa_common import qa_contract_hash
from patternlab.state import sha256_file


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def resolve_receipt_path(value: object) -> Path:
    path = Path(str(value or ""))
    return path if path.is_absolute() else BASE / path


def build_report(video_id: str, receipt_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy_path = BASE / "resources" / "local-visual-model-benchmark-policy.json"
    policy = read_json(policy_path)
    receipt_path = receipt_path or approval / "local-visual-model-benchmark-receipt.json"
    receipt = read_json(receipt_path)
    acceptance = policy.get("acceptance", {})
    suite_path = BASE / str(acceptance.get("suite", "resources/visual-judge-benchmark-suite.json")).removeprefix("youtube-v1/")
    suite = read_json(suite_path)
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
        semantic_vlm_accuracy = float(receipt.get("semantic_vlm_fixture_accuracy", 0))
    except (TypeError, ValueError):
        semantic_vlm_accuracy = 0.0
    try:
        median_seconds = float(receipt.get("median_seconds_per_frame"))
    except (TypeError, ValueError):
        median_seconds = float("inf")
    if fixture_accuracy < float(acceptance.get("minimum_fixture_accuracy", 1)):
        blockers.append("local_visual_model_benchmark_accuracy_below_policy")
    if semantic_vlm_accuracy < float(acceptance.get("minimum_semantic_vlm_accuracy", 1)):
        blockers.append("local_visual_model_benchmark_semantic_accuracy_below_policy")
    if median_seconds > float(acceptance.get("maximum_median_seconds_per_frame", 0)):
        blockers.append("local_visual_model_benchmark_runtime_above_policy")
    if receipt.get("fallback_model_used"):
        blockers.append("local_visual_model_benchmark_silent_fallback")
    if receipt.get("model_role") != "final_local_judge":
        blockers.append("local_visual_model_benchmark_model_role_invalid")
    if not str(receipt.get("model_id") or "").strip() or not str(receipt.get("model_sha256") or "").strip():
        blockers.append("local_visual_model_benchmark_model_identity_missing")
    if not str(receipt.get("mmproj_sha256") or "").strip():
        blockers.append("local_visual_model_benchmark_mmproj_identity_missing")
    if not suite or receipt.get("benchmark_suite_sha256") != (sha256_file(suite_path) if suite_path.exists() else ""):
        blockers.append("local_visual_model_benchmark_suite_missing_or_stale")
    if receipt.get("qa_contract_sha256") != qa_contract_hash():
        blockers.append("local_visual_model_benchmark_qa_contract_stale")
    expected_fixtures = {str(row.get("id")): row for row in suite.get("fixtures", []) if isinstance(row, dict)}
    result_rows = [row for row in receipt.get("fixture_results", []) if isinstance(row, dict)]
    result_by_id = {str(row.get("fixture_id")): row for row in result_rows}
    if len(result_rows) < int(acceptance.get("minimum_fixture_count", 20)) or set(result_by_id) != set(expected_fixtures):
        blockers.append("local_visual_model_benchmark_fixture_coverage_incomplete")
    observed_categories = {str(expected_fixtures.get(fixture_id, {}).get("category", "")) for fixture_id in result_by_id}
    required_categories = set(acceptance.get("required_categories", []))
    if not required_categories.issubset(observed_categories):
        blockers.append("local_visual_model_benchmark_required_categories_missing")
    correct_count = 0
    deterministic_categories = set(acceptance.get("deterministic_measurement_categories", []))
    semantic_count = 0
    semantic_correct = 0
    for fixture_id, expected in expected_fixtures.items():
        row = result_by_id.get(fixture_id, {})
        fixture_path = resolve_receipt_path(row.get("fixture_path"))
        if not fixture_path.is_file() or row.get("fixture_sha256") != sha256_file(fixture_path):
            blockers.append(f"local_visual_model_benchmark_fixture_missing_or_stale:{fixture_id}")
        if row.get("category") != expected.get("category") or row.get("expected") != expected.get("expected"):
            blockers.append(f"local_visual_model_benchmark_fixture_contract_mismatch:{fixture_id}")
        if row.get("verdict") == expected.get("expected") and str(row.get("output_sha256") or "").strip():
            correct_count += 1
        if expected.get("category") not in deterministic_categories:
            semantic_count += 1
            if row.get("vlm_verdict") == expected.get("expected"):
                semantic_correct += 1
    computed_accuracy = correct_count / len(expected_fixtures) if expected_fixtures else 0.0
    computed_semantic_accuracy = semantic_correct / semantic_count if semantic_count else 0.0
    if abs(computed_accuracy - fixture_accuracy) > 0.0001:
        blockers.append("local_visual_model_benchmark_reported_accuracy_mismatch")
    if abs(computed_semantic_accuracy - semantic_vlm_accuracy) > 0.0001:
        blockers.append("local_visual_model_benchmark_reported_semantic_accuracy_mismatch")
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "policy": display_path(policy_path), "receipt": display_path(receipt_path),
        "model_id": receipt.get("model_id", ""), "model_sha256": receipt.get("model_sha256", ""),
        "mmproj_sha256": receipt.get("mmproj_sha256", ""), "fixture_accuracy": receipt.get("fixture_accuracy", 0),
        "semantic_vlm_fixture_accuracy": receipt.get("semantic_vlm_fixture_accuracy", 0),
        "median_seconds_per_frame": receipt.get("median_seconds_per_frame", None),
        "benchmark_suite": display_path(suite_path), "computed_fixture_accuracy": round(computed_accuracy, 4),
        "fixture_result_count": len(result_rows),
        "blockers": blockers, "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-visual-model-benchmark-report.json"
    md_path = approval / "local-visual-model-benchmark-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Visual Model Benchmark: Video {video_id}", "", f"Status: {payload['status']}",
        f"Model: {payload['model_id'] or 'missing'}", f"Hybrid fixture accuracy: {payload['fixture_accuracy']}",
        f"Semantic VLM fixture accuracy: {payload['semantic_vlm_fixture_accuracy']}",
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
