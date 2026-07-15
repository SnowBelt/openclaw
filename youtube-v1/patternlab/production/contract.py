"""Typed, fail-closed Pattern Lab production contract loader."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ALLOWED_PHASES = frozenset({"prepare", "render", "verify", "release", "review"})
ALLOWED_SIDE_EFFECTS = frozenset(
    {"local_read", "local_write", "local_render", "local_model_inference", "discord_owner_review"}
)
FORBIDDEN_COMMAND_FRAGMENTS = (
    "patternlab_full_auto_production.py",
    "upload_approved_package.py",
    "publish_approved_package.py",
    "youtube_upload",
    "youtube_publish",
    "videos.update",
    "comments.insert",
    "thumbnails.set",
)

CANONICAL_BOOTSTRAP_STAGES = (
    "workflow_integrity",
    "skill_deployment_integrity",
    "runtime_source_integrity",
    "city_portability",
)

LONG_FORM_REQUIRED_STAGES = (
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
    "canonical_render",
    "long_form_aggregate_qa",
    "package_completeness",
    "owner_rejection_supersession",
    "discord_owner_review",
)

FULL_PACKAGE_REQUIRED_STAGES = (
    *LONG_FORM_REQUIRED_STAGES[:-3],
    "shorts_script_package",
    "shorts_audio_economy",
    "shorts_boundary_quality",
    "shorts_first_frame_plan",
    "shorts_pacing_plan",
    "shorts_engagement_loop",
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
    "thumbnail_package_quality",
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


class ContractError(ValueError):
    """Raised when a production contract is ambiguous or unsafe."""


@dataclass(frozen=True)
class OutputSpec:
    path: str
    json_status: tuple[str, ...] = ()


@dataclass(frozen=True)
class StageSpec:
    stage_id: str
    phase: str
    side_effect: str
    command: tuple[str, ...]
    outputs: tuple[OutputSpec, ...]
    required: bool = True


@dataclass(frozen=True)
class ProductionContract:
    contract_id: str
    schema_version: int
    profile: str
    description: str
    requires_production_lock: bool
    minimum_automated_score: int
    stages: tuple[StageSpec, ...]
    source_path: Path
    raw: dict[str, Any]


def _string_list(value: Any, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        raise ContractError(f"{field}_must_be_nonempty_string_list")
    return tuple(value)


def load_contract(path: Path, profile: str) -> ProductionContract:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"production_contract_unreadable:{path}") from exc
    if not isinstance(raw, dict) or int(raw.get("schema_version", 0)) != 1:
        raise ContractError("unsupported_production_contract_schema")
    contract_id = str(raw.get("contract_id") or "").strip()
    if not contract_id:
        raise ContractError("production_contract_id_missing")
    profiles = raw.get("profiles")
    if not isinstance(profiles, dict) or profile not in profiles:
        raise ContractError(f"unknown_production_profile:{profile}")
    profile_raw = profiles[profile]
    if not isinstance(profile_raw, dict):
        raise ContractError(f"invalid_production_profile:{profile}")
    stage_rows = profile_raw.get("stages")
    if not isinstance(stage_rows, list) or not stage_rows:
        raise ContractError(f"production_profile_has_no_stages:{profile}")
    stage_ids: set[str] = set()
    stages: list[StageSpec] = []
    for index, row in enumerate(stage_rows):
        if not isinstance(row, dict):
            raise ContractError(f"stage_not_object:{index}")
        stage_id = str(row.get("id") or "").strip()
        if not stage_id or stage_id in stage_ids:
            raise ContractError(f"stage_id_missing_or_duplicate:{stage_id or index}")
        stage_ids.add(stage_id)
        phase = str(row.get("phase") or "").strip()
        side_effect = str(row.get("side_effect") or "").strip()
        if phase not in ALLOWED_PHASES:
            raise ContractError(f"stage_phase_not_allowed:{stage_id}:{phase}")
        if side_effect not in ALLOWED_SIDE_EFFECTS:
            raise ContractError(f"stage_side_effect_not_allowed:{stage_id}:{side_effect}")
        command = _string_list(row.get("command"), field=f"stage_command:{stage_id}")
        command_text = " ".join(command).lower()
        if any(fragment in command_text for fragment in FORBIDDEN_COMMAND_FRAGMENTS):
            raise ContractError(f"youtube_mutation_command_forbidden:{stage_id}")
        output_rows = row.get("outputs")
        if not isinstance(output_rows, list) or not output_rows:
            raise ContractError(f"stage_outputs_missing:{stage_id}")
        outputs: list[OutputSpec] = []
        for output in output_rows:
            if not isinstance(output, dict) or not str(output.get("path") or "").strip():
                raise ContractError(f"stage_output_invalid:{stage_id}")
            statuses = output.get("json_status", [])
            if not isinstance(statuses, list) or not all(isinstance(item, str) and item for item in statuses):
                raise ContractError(f"stage_output_status_invalid:{stage_id}")
            outputs.append(OutputSpec(str(output["path"]), tuple(statuses)))
        stages.append(
            StageSpec(
                stage_id=stage_id,
                phase=phase,
                side_effect=side_effect,
                command=command,
                outputs=tuple(outputs),
                required=bool(row.get("required", True)),
            )
        )
    minimum = int(raw.get("minimum_automated_score", 0))
    if minimum < 93:
        raise ContractError("production_contract_minimum_score_below_93")
    if contract_id.startswith("patternlab-production"):
        governance = raw.get("change_governance")
        if not isinstance(governance, dict):
            raise ContractError("production_change_governance_missing")
        for field in (
            "required_surfaces",
            "required_skills",
            "legacy_entrypoints_requiring_canonical_context",
        ):
            _string_list(governance.get(field), field=f"change_governance:{field}")
        if not bool(profile_raw.get("requires_production_lock")):
            raise ContractError(f"production_profile_lock_required:{profile}")
        ordered = [stage.stage_id for stage in stages]
        if tuple(ordered[: len(CANONICAL_BOOTSTRAP_STAGES)]) != CANONICAL_BOOTSTRAP_STAGES:
            raise ContractError(f"production_profile_bootstrap_gates_missing:{profile}")
        route = next((stage for stage in stages if stage.stage_id == "visual_route_compile"), None)
        if route is None or "--video-id" not in route.command:
            raise ContractError(f"production_profile_route_not_city_generic:{profile}")
        command_text = "\n".join(" ".join(stage.command).lower() for stage in stages)
        required = LONG_FORM_REQUIRED_STAGES if profile == "long_form_rebuild" else FULL_PACKAGE_REQUIRED_STAGES
        missing = [stage_id for stage_id in required if stage_id not in ordered]
        if missing:
            raise ContractError(f"production_profile_required_stages_missing:{profile}:{','.join(missing)}")
        positions = [ordered.index(stage_id) for stage_id in required]
        if positions != sorted(positions):
            raise ContractError(f"production_profile_required_stage_order_invalid:{profile}")
        if profile == "long_form_rebuild" and ("short" in command_text or "thumbnail" in command_text):
            raise ContractError("long_form_rebuild_profile_contains_short_or_thumbnail_work")
    return ProductionContract(
        contract_id=contract_id,
        schema_version=1,
        profile=profile,
        description=str(profile_raw.get("description") or "").strip(),
        requires_production_lock=bool(profile_raw.get("requires_production_lock")),
        minimum_automated_score=minimum,
        stages=tuple(stages),
        source_path=path,
        raw=raw,
    )
