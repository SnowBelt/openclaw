#!/usr/bin/env python3
"""Verify every public Pattern Lab automation surface routes through one contract."""
from __future__ import annotations

import argparse
import json
import plistlib
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = YOUTUBE_ROOT.parent
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.production import ContractError, load_contract
from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, utc_now


REQUIRED_LONG_FORM_STAGES = (
    "skill_deployment_integrity",
    "runtime_source_integrity",
    "city_portability",
    "storage_preflight",
    "retained_narration_binding",
    "visual_contract",
    "ai_support_plan",
    "visual_prompt_compile",
    "local_generation_routes",
    "free_stock_plan",
    "context_media_library",
    "open_archive_plan",
    "visual_route_compile",
    "local_still_tournament",
    "source_pool_compile",
    "authoritative_visual_acquisition",
    "historical_motion_plan",
    "historical_motion_render",
    "historical_motion_quality",
    "ai_motion_quality",
    "evidence_manifest_compile",
    "word_alignment",
    "closed_captions",
    "canonical_preflight",
    "canonical_render_plan",
    "canonical_motion_plan",
    "canonical_render",
    "long_form_audio_quality",
    "long_form_rendered_media_quality",
    "sequence_deterministic_quality",
    "local_visual_benchmark_verify",
    "local_visual_frame_judge",
    "sequence_semantic_judge",
    "render_claim_quality",
    "voice_visual_match",
    "visual_retention_quality",
    "long_form_aggregate_qa",
    "package_completeness",
    "owner_rejection_supersession",
    "long_form_review_release",
    "discord_owner_review",
)

REQUIRED_FULL_PACKAGE_STAGES = (
    *REQUIRED_LONG_FORM_STAGES[:-4],
    "shorts_script_package",
    "shorts_audio_economy",
    "shorts_boundary_quality",
    "shorts_first_frame_plan",
    "shorts_pacing_plan",
    "shorts_render_readiness",
    "shorts_render",
    "full_audio_quality",
    "full_rendered_media_quality",
    "shorts_first_frame_final",
    "shorts_pacing_final",
    "shorts_final_quality",
    "thumbnail_brief",
    "thumbnail_factory",
    "thumbnail_package",
    "thumbnail_source_adequacy",
    "thumbnail_font_quality",
    "thumbnail_pixel_quality",
    "thumbnail_semantic_quality",
    "thumbnail_scorecard",
    "thumbnail_reliability",
    "thumbnail_worldclass",
    "media_qa_defect_harness",
    "strict_media_qa",
    "package_hashes",
    "package_completeness",
    "canonical_release_registration",
    "owner_rejection_supersession",
    "owner_review_packet",
    "discord_owner_review",
)


def build_report() -> tuple[dict, Path]:
    contract_path = YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json"
    blockers: list[str] = []
    profiles = {}
    try:
        for name in ("long_form_rebuild", "full_package"):
            profiles[name] = load_contract(contract_path, name)
    except ContractError as exc:
        blockers.append(f"production_contract_invalid:{exc}")
    if "long_form_rebuild" in profiles:
        stages = [stage.stage_id for stage in profiles["long_form_rebuild"].stages]
        missing = [stage for stage in REQUIRED_LONG_FORM_STAGES if stage not in stages]
        blockers.extend(f"required_long_form_stage_missing:{stage}" for stage in missing)
        commands = "\n".join(" ".join(stage.command).lower() for stage in profiles["long_form_rebuild"].stages)
        if "short" in commands or "thumbnail" in commands:
            blockers.append("long_form_rebuild_profile_contains_short_or_thumbnail_work")
    if "full_package" in profiles:
        full = profiles["full_package"]
        stages = [stage.stage_id for stage in full.stages]
        missing = [stage for stage in REQUIRED_FULL_PACKAGE_STAGES if stage not in stages]
        blockers.extend(f"required_full_package_stage_missing:{stage}" for stage in missing)
        present = [stage for stage in REQUIRED_FULL_PACKAGE_STAGES if stage in stages]
        positions = [stages.index(stage) for stage in present]
        if positions != sorted(positions):
            blockers.append("required_full_package_stage_order_invalid")
        commands = "\n".join(" ".join(stage.command).lower() for stage in full.stages)
        if "patternlab_full_auto_production.py" in commands or "legacy_full_package_worker" in stages:
            blockers.append("full_package_delegates_to_legacy_worker")
        if any(stage.phase == "produce" for stage in full.stages):
            blockers.append("full_package_contains_unsupported_produce_phase")
    for name, contract in profiles.items():
        stage_ids = {stage.stage_id for stage in contract.stages}
        if "skill_deployment_integrity" not in stage_ids:
            blockers.append(f"profile_missing_skill_deployment_integrity:{name}")
        if "runtime_source_integrity" not in stage_ids:
            blockers.append(f"profile_missing_runtime_source_integrity:{name}")
        if "city_portability" not in stage_ids:
            blockers.append(f"profile_missing_city_portability:{name}")
        if not contract.requires_production_lock:
            blockers.append(f"profile_missing_production_lock_requirement:{name}")
        route = next((stage for stage in contract.stages if stage.stage_id == "visual_route_compile"), None)
        if route is None or "--video-id" not in route.command:
            blockers.append(f"profile_visual_route_not_city_generic:{name}")
    governance = (
        profiles.get("long_form_rebuild").raw.get("change_governance", {})
        if profiles.get("long_form_rebuild")
        else {}
    )
    for relative in governance.get("required_surfaces", []):
        path = REPO_ROOT / str(relative)
        if not path.is_file() and not path.is_symlink():
            blockers.append(f"production_governance_surface_missing:{relative}")
    for name in governance.get("required_skills", []):
        path = YOUTUBE_ROOT / "skills" / str(name) / "SKILL.md"
        if not path.is_file():
            blockers.append(f"production_governance_skill_missing:{name}")
    for relative in governance.get("legacy_entrypoints_requiring_canonical_context", []):
        path = REPO_ROOT / str(relative)
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        if "PATTERNLAB_CANONICAL_RUN" not in text:
            blockers.append(f"legacy_entrypoint_canonical_guard_missing:{relative}")
    entrypoint = YOUTUBE_ROOT / "scripts" / "patternlab_production.py"
    if not entrypoint.is_file():
        blockers.append("canonical_production_entrypoint_missing")
    runbook = YOUTUBE_ROOT / "workflows" / "patternlab-full-auto-production-runbook.md"
    runbook_text = runbook.read_text(encoding="utf-8") if runbook.is_file() else ""
    if "patternlab_production.py" not in runbook_text or "--profile full_package" not in runbook_text:
        blockers.append("full_auto_runbook_does_not_use_canonical_entrypoint")
    for marker in (
        "## City-Portable Episode Contract",
        "machine_verified_exact_license",
        "local_still_tournament",
        "## Future Addition Standard",
        "typed stage/output/side-effect contract",
        "content-addressed resume",
        "active-runtime drift",
    ):
        if marker not in runbook_text:
            blockers.append(f"future_addition_standard_missing:{marker}")
    skill = YOUTUBE_ROOT / "skills" / "patternlab-production-director" / "SKILL.md"
    if not skill.is_file() or "patternlab_production.py" not in skill.read_text(encoding="utf-8"):
        blockers.append("canonical_production_skill_missing_or_stale")
    skill_deployment = YOUTUBE_ROOT / "scripts" / "patternlab_skill_deployment.py"
    if not skill_deployment.is_file():
        blockers.append("patternlab_skill_deployment_gate_missing")
    scoped_agents = YOUTUBE_ROOT / "AGENTS.md"
    if not scoped_agents.is_file() or "patternlab_production.py" not in scoped_agents.read_text(encoding="utf-8"):
        blockers.append("scoped_patternlab_agent_rules_missing_or_stale")
    plist_path = YOUTUBE_ROOT / "automation" / "pattern-lab-full-auto-production.plist"
    try:
        plist = plistlib.loads(plist_path.read_bytes())
    except (OSError, plistlib.InvalidFileException):
        plist = {}
        blockers.append("full_auto_launchd_plist_invalid")
    arguments = [str(item) for item in plist.get("ProgramArguments", [])]
    if not any(item.endswith("patternlab_production.py") for item in arguments):
        blockers.append("full_auto_launchd_bypasses_canonical_entrypoint")
    if "--profile" not in arguments or "full_package" not in arguments:
        blockers.append("full_auto_launchd_profile_missing")
    if "--render" not in arguments:
        blockers.append("full_auto_launchd_render_missing")
    if "--send-review" not in arguments:
        blockers.append("full_auto_launchd_owner_review_delivery_missing")
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "contract": display_path(contract_path),
        "contract_sha256": sha256_file(contract_path) if contract_path.is_file() else "",
        "profiles": {
            name: {
                "stage_count": len(contract.stages),
                "stages": [stage.stage_id for stage in contract.stages],
            }
            for name, contract in profiles.items()
        },
        "canonical_entrypoint": display_path(entrypoint),
        "legacy_direct_production": "unsupported",
        "future_extension_rule": "Add or change a production stage only through the typed contract, scoped AGENTS rules, regression tests, and current workflow-integrity receipt.",
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    output = ensure_dir(YOUTUBE_ROOT / "local-output" / "operations") / "patternlab-workflow-integrity-report.json"
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, output


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the canonical Pattern Lab production workflow.")
    parser.parse_args()
    payload, report = build_report()
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
