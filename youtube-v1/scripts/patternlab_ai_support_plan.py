#!/usr/bin/env python3
"""Evaluate every narration beat for optional, non-proof AI support."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, utc_now


POLICY_PATH = BASE / "resources" / "patternlab-visual-system-policy.json"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def decision_for(beat: dict[str, Any]) -> dict[str, Any]:
    beat_id = str(beat.get("beat_id") or "missing")
    mode = str(beat.get("visual_mode") or "")
    allowed = beat.get("ai_support_allowed") is True and mode == "reconstruction"
    selected = str(beat.get("selected_ai_asset_id") or "").strip()
    planned = str(beat.get("planned_ai_asset_id") or "").strip()
    if mode in {"proof", "system"}:
        decision = "rejected"
        reason = "AI cannot replace historical proof or a source-grounded system graphic."
    elif mode == "context":
        decision = "rejected"
        reason = "Use rights-cleared stock or real modern context before synthetic context."
    elif allowed and selected:
        decision = "selected"
        reason = "The contract explicitly selected a disclosed non-proof reconstruction."
    elif allowed and planned:
        decision = "planned_generation"
        reason = "The contract requests one disclosed local non-proof reconstruction with a canonical future asset ID."
    elif allowed:
        decision = "blocked"
        reason = "AI support was authorized without a canonical planned asset ID."
    else:
        decision = "rejected"
        reason = "This beat does not explicitly authorize AI support."
    return {
        "beat_id": beat_id,
        "visual_mode": mode,
        "decision": decision,
        "reason": reason,
        "selected_ai_asset_id": selected,
        "planned_ai_asset_id": planned,
        "proof_replacement": False,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    contract_path = launch_root(video_id) / "visual-contract.json"
    contract = read_json(contract_path)
    beats = contract.get("beats") if isinstance(contract.get("beats"), list) else []
    rows = [decision_for(beat) for beat in beats if isinstance(beat, dict)]
    blockers: list[str] = []
    if not beats:
        blockers.append("visual_contract_beats_missing")
    if len(rows) != len(beats):
        blockers.append("ai_support_decision_missing_for_beat")
    for row in rows:
        if row["decision"] == "selected" and not row["selected_ai_asset_id"]:
            blockers.append(f"selected_ai_asset_missing:{row['beat_id']}")
        if row["visual_mode"] in {"proof", "system"} and row["decision"] != "rejected":
            blockers.append(f"ai_proof_replacement_not_blocked:{row['beat_id']}")
        if row["decision"] == "blocked":
            blockers.append(f"ai_support_plan_incomplete:{row['beat_id']}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH),
        "visual_contract": display_path(contract_path),
        "beat_count": len(beats),
        "evaluated_beat_count": len(rows),
        "selected_count": sum(row["decision"] == "selected" for row in rows),
        "candidate_count": sum(row["decision"] == "planned_generation" for row in rows),
        "decisions": rows,
        "blockers": blockers,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "ai-support-plan-report.json"
    md_path = approval / "ai-support-plan-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab AI Support Plan: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"Evaluated beats: {len(rows)}/{len(beats)}",
                f"Selected reconstructions: {payload['selected_count']}",
                "",
                "AI is optional non-proof support. No quota is filled automatically.",
                "",
                "## Decisions",
                "",
                *[f"- {row['beat_id']}: {row['decision']} — {row['reason']}" for row in rows],
                "",
                "Paid provider calls: not performed",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan safe per-beat Pattern Lab AI visual support.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
