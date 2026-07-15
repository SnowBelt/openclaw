#!/usr/bin/env python3
"""Report the actual local visual-AI device state before it is trusted in production."""
from __future__ import annotations

import argparse
import json
import platform
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


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy_path = BASE / "resources" / "local-visual-model-benchmark-policy.json"
    policy = read_json(policy_path)
    blockers: list[str] = []
    try:
        import torch
        mps_built = bool(torch.backends.mps.is_built())
        mps_available = bool(torch.backends.mps.is_available())
        torch_version = torch.__version__
    except Exception as exc:
        mps_built = False
        mps_available = False
        torch_version = "missing"
        blockers.append(f"torch_visual_ai_unavailable:{type(exc).__name__}")
    if not policy:
        blockers.append("local_visual_model_benchmark_policy_missing")
    if platform.machine() == "arm64" and not mps_available:
        blockers.append("apple_silicon_mps_unavailable_in_current_runtime")
    benchmark = read_json(approval / "local-visual-model-benchmark-report.json")
    if benchmark.get("status") != "pass":
        blockers.append("local_visual_model_benchmark_not_pass")
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "platform": {"machine": platform.machine(), "system": platform.system()},
        "torch_version": torch_version, "mps_built": mps_built, "mps_available": mps_available,
        "benchmark_policy": display_path(policy_path), "benchmark_status": benchmark.get("status", "missing"),
        "blockers": blockers, "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-visual-ai-health-report.json"
    md_path = approval / "local-visual-ai-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Visual AI Health: Video {video_id}", "", f"Status: {payload['status']}",
        f"Machine: {platform.machine()}", f"Torch: {torch_version}", f"MPS built: {mps_built}", f"MPS available: {mps_available}",
        "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Check Pattern Lab local visual AI device and benchmark health.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
