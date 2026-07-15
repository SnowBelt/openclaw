#!/usr/bin/env python3
"""Rank Pattern Lab topics for research without silently starting production.

The queue separates a promising headline from a production-ready city file.
It is deliberately fail-closed: a topic without a narrow question and a
rights-cleared source pack may be researched next, but cannot be selected for
automatic media assembly or YouTube action.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import patternlab_script_bootstrap  # noqa: F401

from patternlab.city import CityContractError, topic_city
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


SLATE_PATH = BASE / "state" / "monetization" / "content-slate.json"
STRATEGY_PATH = BASE / "state" / "monetization" / "strategy.json"
OPERATIONS_ROOT = BASE / "local-output" / "operations"

GENERIC_TITLE_PATTERNS = (
    re.compile(r"^how\s+.+\s+became\s+the\s+", re.IGNORECASE),
    re.compile(r"^the history of\s+", re.IGNORECASE),
    re.compile(r"^everything you need to know about\s+", re.IGNORECASE),
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def score_topic(strategy: dict[str, Any], topic: dict[str, Any]) -> float:
    total = 0.0
    for name, weight in (strategy.get("topic_scoring_weights") or {}).items():
        total += float(topic.get("scores", {}).get(name, 0) or 0) / 10.0 * float(weight or 0)
    return round(total, 1)


def narrow_topic_issues(topic: dict[str, Any]) -> list[str]:
    title = str(topic.get("working_title", "")).strip()
    public_angle = str(topic.get("public_angle", "")).strip()
    artifact = str(topic.get("artifact_type", "")).strip()
    issues: list[str] = []
    try:
        topic_city(topic)
    except CityContractError as exc:
        issues.append(str(exc))
    if not title:
        issues.append("missing_working_title")
    elif any(pattern.search(title) for pattern in GENERIC_TITLE_PATTERNS):
        issues.append("generic_survey_title")
    if len(re.findall(r"[A-Za-z0-9']+", title)) < 4:
        issues.append("title_too_short_to_express_a_specific_question")
    if not artifact:
        issues.append("missing_proof_object")
    for field in ("hidden_history_question", "proof_object", "visual_payoff"):
        if not str(topic.get(field) or "").strip():
            issues.append(f"missing_{field}")
    blueprints = topic.get("shorts_blueprints")
    if not isinstance(blueprints, list) or not 3 <= len(blueprints) <= 5:
        issues.append("shorts_blueprints_outside_3_5")
    if topic.get("source_dossier_status") != "pass":
        issues.append("source_dossier_not_pass")
    if topic.get("script_status") not in {"fact_checked", "approved_locked"}:
        issues.append("script_not_fact_checked")
    if not public_angle:
        issues.append("missing_public_angle")
    # A wide list of city systems signals a survey rather than one evidence
    # trail. It must be narrowed before production.
    broad_systems = sum(
        term in public_angle.lower()
        for term in ("geography", "factories", "labor", "roads", "entrepreneurs", "population", "industry", "policy")
    )
    if broad_systems >= 4:
        issues.append("public_angle_contains_too_many_systems_for_one_episode")
    return issues


def source_pack_status(video_id: str) -> tuple[str, list[str]]:
    root = output_root(video_id)
    manifest = read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json")
    if not manifest:
        return "not_built", ["source_pack_not_built"]
    assets: list[dict[str, Any]] = []
    for key in ("historical_assets", "modern_context_assets"):
        rows = manifest.get(key, [])
        if isinstance(rows, list):
            assets.extend(row for row in rows if isinstance(row, dict))
    providers = {
        str(asset.get("archive_or_platform") or asset.get("tool") or "").strip()
        for asset in assets
    }
    providers.discard("")
    blockers: list[str] = []
    if manifest.get("status") not in {"ready", "pass"}:
        blockers.append(f"source_pack_status:{manifest.get('status', 'missing')}")
    if len(assets) < 8:
        blockers.append(f"source_pack_asset_shortfall:{len(assets)}/8")
    if len(providers) < 2:
        blockers.append(f"source_pack_single_provider:{len(providers)}")
    # A source-first rebuild creates a claim-to-visual contract. Its stale
    # generic-media manifest is not enough: the linked visuals must pass the
    # stricter claim-fidelity audit before autonomous production selection.
    dossier = root / "source-packet" / "rebuild-v2" / f"video-{video_id}-evidence-dossier.json"
    if dossier.exists():
        fidelity = read_json(root / "approval" / "claim-visual-fidelity-report.json")
        if fidelity.get("status") != "pass":
            blockers.append(f"claim_visual_fidelity:{fidelity.get('status', 'missing')}")
    return ("ready" if not blockers else "incomplete"), blockers


def prior_upload_exists(video_id: str) -> bool:
    approval = output_root(video_id) / "approval"
    return any(
        (approval / name).exists()
        for name in ("youtube-upload-report.json", "approved-package-upload-report.json")
    )


def build_topic_qualification_queue() -> tuple[dict[str, Any], Path, Path]:
    strategy = read_json(STRATEGY_PATH)
    slate = read_json(SLATE_PATH)
    threshold = float(strategy.get("topic_score_threshold", 80) or 80)
    rows: list[dict[str, Any]] = []
    for topic in slate.get("topics", []):
        if not isinstance(topic, dict):
            continue
        video_id = str(topic.get("video_id", "")).zfill(2)
        score = score_topic(strategy, topic)
        topic_issues = narrow_topic_issues(topic)
        source_status, source_issues = source_pack_status(video_id)
        rebuild_in_progress = (output_root(video_id) / "source-packet" / "rebuild-v2" / f"video-{video_id}-evidence-dossier.json").exists()
        already_uploaded = prior_upload_exists(video_id)
        if rebuild_in_progress:
            status = "active_rebuild"
        elif already_uploaded:
            status = "archived_existing_package"
        elif score >= threshold and not topic_issues and source_status == "ready":
            status = "production_ready"
        else:
            status = "research_queue"
        rows.append({
            "video_id": video_id,
            "city": topic.get("city", ""),
            "working_title": topic.get("working_title", ""),
            "artifact_type": topic.get("artifact_type", ""),
            "topic_score": score,
            "topic_status": status,
            "source_pack_status": source_status,
            "topic_blockers": topic_issues,
            "source_pack_blockers": source_issues,
            "next_action": (
                "complete_active_rebuild"
                if rebuild_in_progress
                else "do_not_reselect_existing_upload"
                if already_uploaded
                else "start_source_research"
                if not topic_issues
                else "narrow_question_and_packaging"
            ),
            "youtube_mutation": "not_performed",
        })
    rows.sort(key=lambda row: (-row["topic_score"], row["video_id"]))
    active_rebuilds = [row for row in rows if row["topic_status"] == "active_rebuild"]
    production_ready = [row for row in rows if row["topic_status"] == "production_ready"]
    research_queue = [row for row in rows if row["topic_status"] == "research_queue"]
    selected = active_rebuilds[0] if active_rebuilds else (production_ready[0] if production_ready else (research_queue[0] if research_queue else None))
    payload = {
        "generated_at": utc_now(),
        "status": "pass",
        "selection_mode": "active_rebuild" if active_rebuilds else ("production_ready" if production_ready else "research_only_no_production_eligible"),
        "topic_count": len(rows),
        "active_rebuild_count": len(active_rebuilds),
        "production_ready_count": len(production_ready),
        "research_queue_count": len(research_queue),
        "next_candidate": selected,
        "rows": rows,
        "automation_boundary": "This queue may select a research task only. It cannot generate media, spend on paid services, or mutate YouTube.",
        "youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    ensure_dir(OPERATIONS_ROOT)
    json_path = OPERATIONS_ROOT / "topic-qualification-queue.json"
    md_path = OPERATIONS_ROOT / "topic-qualification-queue.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab Topic Qualification Queue",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Selection mode: {payload['selection_mode']}",
        f"Production-ready: {payload['production_ready_count']}",
        f"Research queue: {payload['research_queue_count']}",
        "",
        "## Next Candidate",
        "",
        f"- {selected['video_id']} — {selected['working_title']}" if selected else "- none",
        "",
        "## Queue",
        "",
    ]
    for row in rows:
        reasons = [*row["topic_blockers"], *row["source_pack_blockers"]]
        lines.append(
            f"- {row['video_id']}: {row['topic_status']} score={row['topic_score']} | {row['working_title']} | blockers={', '.join(reasons) or 'none'}"
        )
    lines.extend(["", "YouTube mutation: not performed", "Paid or pro assets: not used", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the fail-closed Pattern Lab topic qualification queue.")
    parser.parse_args()
    payload, _json_path, md_path = build_topic_qualification_queue()
    print(f"Status: {payload['status']}")
    print(f"Topic qualification queue: {display_path(md_path)}")


if __name__ == "__main__":
    main()
