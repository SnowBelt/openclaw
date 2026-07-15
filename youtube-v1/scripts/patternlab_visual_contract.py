#!/usr/bin/env python3
"""Create and validate the explicit narration-to-visual contract for Pattern Lab."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.visual_system import resolve_episode_identity
from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, utc_now


TAXONOMY_PATH = BASE / "resources" / "generic-context-taxonomy.json"
DISCLOSURE = "Dramatic reconstruction — not archival footage"
MODES = {"proof", "context", "reconstruction", "system"}
MOTION_INTENTS = {
    "source_highlight",
    "document_closeup",
    "map_trace",
    "then_now",
    "documentary_parallax",
    "native_video",
    "archive_montage",
    "network_map",
    "reconstruction_motion",
    "brand_card",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else ""


def nonnegative_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def contract_path(video_id: str) -> Path:
    return output_root(video_id) / "source-packet" / "visual-contract.json"


def canonical_contract_path(video_id: str) -> Path:
    return launch_root(video_id) / "visual-contract.json"


def script_paragraphs(video_id: str) -> list[str]:
    path = launch_root(video_id) / "final-script.md"
    if not path.is_file():
        return []
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    paragraphs: list[str] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                paragraph = " ".join(current)
                if not paragraph.startswith("#"):
                    paragraphs.append(paragraph)
                current = []
            continue
        if line.startswith("#"):
            continue
        current.append(re.sub(r"^[-*]\s+", "", line))
    if current:
        paragraphs.append(" ".join(current))
    return [item for item in paragraphs if len(item) >= 30]


def build_template(video_id: str) -> dict[str, Any]:
    script = launch_root(video_id) / "final-script.md"
    beats = []
    for index, paragraph in enumerate(script_paragraphs(video_id), start=1):
        beats.append(
            {
                "beat_id": f"beat-{index:02d}",
                "narration_excerpt": paragraph[:500],
                "visual_mode": "UNCLASSIFIED",
                "claim_scope": "UNCLASSIFIED",
                "semantic_actions": [],
                "emotional_function": "",
                "candidate_queries": [],
                "source_role": "",
                "editorial_role": "",
                "requires_exact_evidence": None,
                "on_screen_disclosure": "",
                "claim_ids": [],
                "planned_ai_asset_id": "",
            }
        )
    return {
        "version": 1,
        "video_id": video_id,
        "status": "draft",
        "script_sha256": sha256(script),
        "beat_count": len(beats),
        "beats": beats,
        "workflow_note": "Fill every row deliberately. Generated templates are never production-ready contracts.",
    }


def validate_contract(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    path = contract_path(video_id)
    canonical = canonical_contract_path(video_id)
    source_path = canonical if canonical.is_file() else path
    contract = read_json(source_path)
    if contract and source_path == canonical:
        ensure_dir(path.parent)
        path.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")
    taxonomy = read_json(TAXONOMY_PATH)
    package = read_json(launch_root(video_id) / "package.json")
    evidence = read_json(launch_root(video_id) / "evidence-queries.json")
    route = read_json(launch_root(video_id) / "long-form-visual-routing.json")
    identity, identity_blockers = resolve_episode_identity(package, evidence)
    route_claim_ids = {
        str(row.get("claim_id") or "")
        for row in route.get("claims", [])
        if isinstance(row, dict) and str(row.get("claim_id") or "").strip()
    }
    known_actions = set((taxonomy.get("actions") or {}).keys())
    script = launch_root(video_id) / "final-script.md"
    blockers: list[str] = list(identity_blockers)
    rows: list[dict[str, Any]] = []
    if not contract:
        blockers.append("visual_contract_missing")
    if contract.get("status") != "ready":
        blockers.append(f"visual_contract_status:{contract.get('status', 'missing')}")
    if not script.is_file() or contract.get("script_sha256") != sha256(script):
        blockers.append("visual_contract_script_hash_stale_or_missing")
    beats = contract.get("beats") if isinstance(contract.get("beats"), list) else []
    visual_event_policy = contract.get("visual_event_policy")
    if not isinstance(visual_event_policy, dict) or not all(
        str(visual_event_policy.get(key) or "").strip()
        for key in ["first_30_seconds", "remainder", "major_change", "movement_rule"]
    ):
        blockers.append("visual_contract_event_policy_missing_or_incomplete")
    if not beats:
        blockers.append("visual_contract_beats_missing")
    for index, beat in enumerate(beats, start=1):
        row_blockers: list[str] = []
        if not isinstance(beat, dict):
            blockers.append(f"beat_{index}:not_object")
            continue
        beat_id = str(beat.get("beat_id") or f"beat-{index:02d}")
        mode = str(beat.get("visual_mode") or "")
        claim_scope = str(beat.get("claim_scope") or "")
        actions = [str(item) for item in beat.get("semantic_actions", []) if str(item)]
        queries = [str(item) for item in beat.get("candidate_queries", []) if str(item).strip()]
        if not str(beat.get("narration_excerpt") or "").strip():
            row_blockers.append("narration_excerpt_missing")
        if mode not in MODES:
            row_blockers.append("visual_mode_invalid")
        if len(queries) < 3:
            row_blockers.append("candidate_queries_below_three")
        if not str(beat.get("emotional_function") or "").strip():
            row_blockers.append("emotional_function_missing")
        if not str(beat.get("retention_function") or "").strip():
            row_blockers.append("retention_function_missing")
        if str(beat.get("motion_intent") or "") not in MOTION_INTENTS:
            row_blockers.append("motion_intent_missing_or_invalid")
        if beat.get("ai_support_allowed") not in {True, False}:
            row_blockers.append("ai_support_decision_missing")
        if mode == "proof":
            if claim_scope != "city_specific":
                row_blockers.append("proof_requires_city_specific_claim_scope")
            if beat.get("source_role") != "historical_evidence":
                row_blockers.append("proof_requires_historical_evidence_source_role")
            if beat.get("requires_exact_evidence") is not True:
                row_blockers.append("proof_requires_exact_evidence")
            if beat.get("ai_support_allowed") is not False:
                row_blockers.append("proof_ai_support_must_be_false")
        elif mode == "system":
            if claim_scope != "city_specific":
                row_blockers.append("system_requires_city_specific_claim_scope")
            if beat.get("source_role") != "original_graphic":
                row_blockers.append("system_requires_original_graphic_source_role")
            if beat.get("requires_exact_evidence") is not True:
                row_blockers.append("system_requires_source_grounded_inputs")
            if beat.get("ai_support_allowed") is not False:
                row_blockers.append("system_ai_support_must_be_false")
        elif mode == "context":
            if claim_scope != "generic":
                row_blockers.append("context_requires_generic_claim_scope")
            if beat.get("source_role") != "modern_context" or beat.get("editorial_role") != "context_only":
                row_blockers.append("context_requires_context_only_role")
            if beat.get("may_imply_named_city") is not False:
                row_blockers.append("context_may_not_imply_named_city")
            if beat.get("ai_support_allowed") is not False:
                row_blockers.append("context_prefers_real_stock_ai_support_must_be_false")
            unknown = sorted(set(actions) - known_actions)
            if not actions or unknown:
                row_blockers.append("context_semantic_actions_missing_or_unknown")
        elif mode == "reconstruction":
            if claim_scope != "generic":
                row_blockers.append("reconstruction_requires_generic_claim_scope")
            if beat.get("source_role") != "ai_reconstruction":
                row_blockers.append("reconstruction_requires_ai_reconstruction_source_role")
            if beat.get("on_screen_disclosure") != DISCLOSURE:
                row_blockers.append("reconstruction_disclosure_missing_or_wrong")
            if beat.get("may_imply_named_city") is not False:
                row_blockers.append("reconstruction_may_not_imply_named_city")
            if beat.get("ai_support_allowed") is not True:
                row_blockers.append("reconstruction_ai_support_must_be_true")
            planned_asset_id = str(beat.get("planned_ai_asset_id") or "").strip()
            expected_asset_id = f"video-{video_id}-local-ai-{beat_id}"
            if planned_asset_id != expected_asset_id:
                row_blockers.append("reconstruction_planned_asset_id_missing_or_noncanonical")
            claim_ids = [str(value) for value in beat.get("claim_ids", []) if str(value).strip()]
            if not claim_ids:
                row_blockers.append("reconstruction_claim_ids_missing")
            elif route_claim_ids and any(value not in route_claim_ids for value in claim_ids):
                row_blockers.append("reconstruction_claim_ids_not_in_visual_route")
            for field in (
                "visible_action",
                "setting",
                "subject",
                "camera",
                "composition",
                "light_and_color",
                "historical_constraints",
                "preserve",
                "avoid",
            ):
                if not str(beat.get(field) or "").strip():
                    row_blockers.append(f"reconstruction_prompt_field_missing:{field}")
            maximum_seconds = nonnegative_float(beat.get("maximum_seconds"))
            if maximum_seconds is None:
                row_blockers.append("reconstruction_maximum_seconds_missing_or_invalid")
            elif maximum_seconds > 12:
                row_blockers.append("reconstruction_exceeds_twelve_seconds")
        rows.append({"beat_id": beat_id, "mode": mode, "status": "pass" if not row_blockers else "blocked", "blockers": row_blockers})
        blockers.extend(f"{beat_id}:{item}" for item in row_blockers)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "contract": display_path(path),
        "canonical_contract": display_path(source_path),
        "taxonomy": display_path(TAXONOMY_PATH),
        "city": identity.city,
        "hidden_history_question": identity.question,
        "proof_object": identity.proof_object,
        "visual_payoff": identity.payoff,
        "beat_rows": rows,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "visual-contract-report.json"
    md_path = approval / "visual-contract-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [f"# Pattern Lab Visual Contract: Video {video_id}", "", f"Status: {payload['status']}", "", "## Beats", ""]
            + [f"- {row['beat_id']}: {row['status']} ({', '.join(row['blockers']) or 'ready'})" for row in rows]
            + ["", "## Blockers", ""]
            + ([f"- {item}" for item in payload["blockers"]] or ["- none"])
            + ["", "Paid provider calls: not performed", "YouTube mutation: not performed", ""]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or validate a Pattern Lab narration-to-visual contract.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--init", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    path = contract_path(video_id)
    if args.init:
        if path.exists() and not args.overwrite:
            raise SystemExit(f"Refusing to overwrite existing visual contract: {display_path(path)}")
        ensure_dir(path.parent)
        path.write_text(json.dumps(build_template(video_id), indent=2) + "\n", encoding="utf-8")
        print(f"Visual contract template: {display_path(path)}")
        return
    payload, _json_path, md_path = validate_contract(video_id)
    print(f"Status: {payload['status']}")
    print(f"Visual contract report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
