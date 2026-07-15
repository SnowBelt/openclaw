#!/usr/bin/env python3
"""Fail-closed city-generic visual-system gate for every Pattern Lab episode."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.visual_system import diversity_findings, flatten_route, narration_asset_match, resolve_episode_identity
from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, utc_now


POLICY_PATH = BASE / "resources" / "patternlab-visual-system-policy.json"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def ledger_assets(root: Path) -> dict[str, dict[str, Any]]:
    for path in (
        root / "approval" / "evidence-asset-ledger.json",
        root / "approval" / "evidence-manifest.json",
    ):
        value = read_json(path)
        rows = value.get("assets") if isinstance(value.get("assets"), list) else []
        if rows:
            return {str(row.get("asset_id") or ""): row for row in rows if isinstance(row, dict) and row.get("asset_id")}
    return {}


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    launch = launch_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    package = read_json(launch / "package.json")
    evidence = read_json(launch / "evidence-queries.json")
    contract = read_json(launch / "visual-contract.json")
    route = read_json(launch / "long-form-visual-routing.json")
    identity, blockers = resolve_episode_identity(package, evidence)
    rows = flatten_route(route)
    ledger = ledger_assets(root)
    metrics: dict[str, Any] = {}
    if not rows:
        blockers.append("long_form_visual_route_missing_or_empty")
    if not ledger:
        blockers.append("evidence_asset_ledger_missing_or_empty")
    if rows and ledger:
        metrics, diversity_blockers = diversity_findings(rows, ledger, policy.get("diversity", {}))
        blockers.extend(diversity_blockers)

    contract_beats = contract.get("beats") if isinstance(contract.get("beats"), list) else []
    if not contract_beats:
        blockers.append("visual_contract_beats_missing")
    truth_rows: list[dict[str, Any]] = []
    truth_policy = policy.get("truth_classes", {})
    for beat in contract_beats:
        if not isinstance(beat, dict):
            blockers.append("visual_contract_beat_not_object")
            continue
        beat_id = str(beat.get("beat_id") or "missing")
        mode = str(beat.get("visual_mode") or "")
        mode_policy = truth_policy.get(mode) if isinstance(truth_policy.get(mode), dict) else {}
        row_blockers: list[str] = []
        if not mode_policy:
            row_blockers.append("truth_class_unknown")
        if str(beat.get("source_role") or "") not in mode_policy.get("allowed_source_roles", []):
            row_blockers.append("truth_class_source_role_mismatch")
        if mode in {"proof", "system"} and beat.get("ai_support_allowed") is True:
            row_blockers.append("ai_support_cannot_replace_proof")
        if mode in {"context", "reconstruction"} and beat.get("may_imply_named_city") is not False:
            row_blockers.append("nonproof_visual_may_not_imply_named_city")
        if mode == "reconstruction" and beat.get("on_screen_disclosure") != mode_policy.get("required_disclosure"):
            row_blockers.append("reconstruction_disclosure_missing_or_wrong")
        truth_rows.append({"beat_id": beat_id, "status": "pass" if not row_blockers else "blocked", "blockers": row_blockers})
        blockers.extend(f"{beat_id}:{item}" for item in row_blockers)

    match_rows: list[dict[str, Any]] = []
    for row in rows:
        asset = ledger.get(str(row.get("asset_id") or ""), {})
        match = narration_asset_match(str(row.get("narration_intent") or ""), asset)
        match_rows.append({"beat_id": row.get("beat_id"), "asset_id": row.get("asset_id"), **match})
        if not match["overlap_terms"] and not str(row.get("narration_fit") or "").strip():
            blockers.append(f"narration_visual_match_unproven:{row.get('beat_id')}:{row.get('asset_id')}")

    for report_name in ("visual-contract-report.json", "ai-support-plan-report.json", "visual-acquisition-quality-report.json"):
        report = read_json(approval / report_name)
        if report.get("status") != "pass" or report.get("blockers"):
            blockers.append(f"authoritative_visual_report_not_pass:{report_name}")

    blockers = sorted(set(blockers))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH),
        "episode": {
            "city": identity.city,
            "hidden_history_question": identity.question,
            "proof_object": identity.proof_object,
            "visual_payoff": identity.payoff,
        },
        "diversity": metrics,
        "truth_rows": truth_rows,
        "narration_match_rows": match_rows,
        "blockers": blockers,
        "minimum_score": 93,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-system-gate-report.json"
    md_path = approval / "visual-system-gate-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Visual System Gate: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                f"City: {identity.city or 'missing'}",
                f"Unique presentation ratio: {metrics.get('unique_presentation_ratio', 'missing')}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in blockers] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the city-generic Pattern Lab visual system.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
