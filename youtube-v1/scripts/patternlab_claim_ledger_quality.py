#!/usr/bin/env python3
"""Validate the source-backed claim ledger without inventing claims or sources."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now

REQUIRED = {
    "claim_id", "claim", "source_url", "source_title", "source_type",
    "source_location_or_excerpt", "confidence", "script_paragraph",
    "visual_asset_ids", "fact_checker_status",
}


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    ledger = approval / "claim-ledger.json"
    blockers: list[str] = []
    rows: list[dict] = []
    if not ledger.exists():
        blockers.append("claim_ledger_missing: provide claim-ledger.json; no claims or sources were invented")
    else:
        try:
            value = json.loads(ledger.read_text(encoding="utf-8"))
            rows = value if isinstance(value, list) else value.get("claims", [])
        except (OSError, json.JSONDecodeError):
            blockers.append("claim_ledger_invalid_json")
        if not isinstance(rows, list) or not rows:
            blockers.append("claim_ledger_empty")
        for index, row in enumerate(rows if isinstance(rows, list) else [], 1):
            if not isinstance(row, dict):
                blockers.append(f"claim_{index}:not_an_object")
                continue
            missing = sorted(REQUIRED - set(row))
            if missing:
                blockers.append(f"claim_{index}:missing:{','.join(missing)}")
            if row.get("confidence") not in {"high", "medium", "low"}:
                blockers.append(f"claim_{index}:invalid_confidence")
            if row.get("fact_checker_status") not in {"pending", "verified", "rejected"}:
                blockers.append(f"claim_{index}:invalid_fact_checker_status")
            if not isinstance(row.get("visual_asset_ids"), list):
                blockers.append(f"claim_{index}:visual_asset_ids_must_be_list")
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "ledger": display_path(ledger), "claim_count": len(rows),
        "blockers": blockers, "youtube_mutation": "not_performed",
    }
    json_path = approval / "claim-ledger-quality-report.json"
    md_path = approval / "claim-ledger-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Claim Ledger Quality: Video {video_id}", "", f"Status: {payload['status']}",
        "", f"Claims: {len(rows)}", "", "## Blockers", "",
        *([f"- {item}" for item in blockers] or ["- none"]),
        "", "No claims or sources were invented by this validator.",
        "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")


if __name__ == "__main__":
    main()
