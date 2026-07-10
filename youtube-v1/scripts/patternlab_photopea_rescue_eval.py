#!/usr/bin/env python3
"""Evaluate Pattern Lab Photopea manual rescue path without browser/API mutation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass_manual_rescue_contract_only",
        "photopea_rescue_status": "pass_manual_rescue_contract_only",
        "default_automation_path": False,
        "manual_rescue_only": True,
        "browser_or_api_call_performed": False,
        "allowed_inputs": ["rights-ledgered source-backed PNG/JPG", "OpenClaw thumbnail text contract", "approved owner review packet"],
        "blocked_uses": ["choosing historical claims", "using paid/pro assets", "generating proof evidence", "YouTube upload/replacement/publish"],
        "production_ready_status": "blocked_until_manual_export_and_patternlab_qa_pass",
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "blockers": [],
    }
    json_report = approval / "photopea-rescue-evaluation-report.json"
    md_report = approval / "photopea-rescue-evaluation-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Photopea Rescue Evaluation: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "Manual rescue only: true",
        "Browser/API call performed: false",
        f"Production ready: {payload['production_ready_status']}",
        "Paid/pro assets: not used",
        "Public YouTube mutation: not performed",
    ]
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Photopea rescue contract without external mutation.")
    parser.add_argument("--video-id", default="cleveland-test")
    args = parser.parse_args()
    payload, json_report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
