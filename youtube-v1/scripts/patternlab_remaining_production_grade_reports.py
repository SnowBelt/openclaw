#!/usr/bin/env python3
"""Generate local reports for Pattern Lab remaining production-grade blockers.

This script is intentionally local/read-only with respect to external systems:
it does not call Canva, YouTube, paid tools, or AI generation.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


REPORT_ROOT = BASE / "approval-blockers"
CANVA_TOOLS_OBSERVED = [
    "copy_design",
    "create_design_from_candidate",
    "fetch",
    "generate_design",
    "get_design",
    "get_design_pages",
    "get_design_thumbnail",
    "image_to_design",
    "import_design_from_url",
    "perform_editing_operations",
    "resize_design",
    "start_editing_transaction",
]
CANVA_MISSING_EXPORT_TOOLS = [
    "export_design",
    "download_design",
    "download_local_file",
    "export_png",
    "export_jpg",
]


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_md(path: Path, lines: list[str]) -> None:
    ensure_dir(path.parent)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def provider_health_pass(video_id: str) -> bool:
    return read_json(output_root(video_id) / "approval" / "source-provider-health-report.json").get("status") == "pass"


def analytics_auth_verified() -> bool:
    for video_id in ("04", "03"):
        report = read_json(output_root(video_id) / "approval" / "youtube-auth-health-report.json")
        if report.get("status") == "verified" and report.get("live") is True and report.get("token_matches_configured_client") is True:
            return True
    return False


def build_blocked_milestones_report() -> tuple[dict[str, Any], Path, Path]:
    pittsburgh_source_ok = provider_health_pass("video-pittsburgh-first-run")
    cleveland_source_ok = provider_health_pass("video-cleveland-test")
    penpot_report = read_json(REPORT_ROOT / "penpot-production-export-smoke-report.json")
    penpot_export_ok = (
        penpot_report.get("milestone_222_penpot_production_1920x1080_export") == "pass"
        and penpot_report.get("export_1920x1080_verified") is True
        and penpot_report.get("chat_safe_preview_verified") is True
    )
    analytics_verified = analytics_auth_verified()
    groups = [
        {
            "group": "youtube_analytics_oauth",
            "milestones": ["29B", "29C", "29B-R1", "212"],
            "status": "pending_analytics_checkpoints" if analytics_verified else "blocked_external",
            "reason": "OAuth is live-verified; the remaining work is importing and deduplicating the required Analytics checkpoints." if analytics_verified else "YouTube Analytics read-only OAuth refresh token is invalid or not reauthorized.",
            "next_action": "Run the read-only 24h import, then continue with due 72h/7d/30d checkpoints." if analytics_verified else "Owner reauthorizes readonly YouTube Analytics OAuth, then run analytics checkpoints.",
            "evidence": {
                "analytics_auth_verified": analytics_verified,
                "health_reports": [display_path(output_root(video_id) / "approval" / "youtube-auth-health-report.json") for video_id in ("04", "03")],
            },
        },
        {
            "group": "youtube_thumbnail_replacement_approval",
            "milestones": ["58", "66", "76", "86", "96", "140-R1", "195", "211"],
            "status": "blocked_external",
            "reason": "Exact YouTube video ID and exact local candidate path are missing.",
            "next_action": "Use the exact thumbnail replacement approval template.",
        },
        {
            "group": "public_publish_approval",
            "milestones": ["130", "140"],
            "status": "blocked_external",
            "reason": "Public publish requires a separate exact owner approval.",
            "next_action": "Use the exact public publish approval template after private review is accepted.",
        },
        {
            "group": "canva_export_download_unavailable",
            "milestones": ["203", "207", "265", "274", "275"],
            "status": "blocked_capability",
            "reason": "Current callable Canva tool surface does not expose local PNG/JPG export/download.",
            "next_action": "Wait for export/download tool, manually provide exported local files, or keep local fallback renderer.",
        },
        {
            "group": "penpot_export",
            "milestones": ["222"],
            "status": "complete_locally" if penpot_export_ok else "blocked_capability",
            "reason": "Local/self-hosted Penpot native 1920x1080 PNG export and chat-safe preview smoke pass." if penpot_export_ok else "Local/self-hosted Penpot export endpoint is not verified.",
            "next_action": "Add owner-approved Penpot editable template slots before using Penpot for real thumbnail production." if penpot_export_ok else "Install/configure Penpot locally or carry exact blocker report.",
            "evidence": {
                "penpot_report": display_path(REPORT_ROOT / "penpot-production-export-smoke-report.json"),
                "export_1920x1080_verified": bool(penpot_report.get("export_1920x1080_verified")),
                "chat_safe_preview_verified": bool(penpot_report.get("chat_safe_preview_verified")),
            },
        },
        {
            "group": "ai_paid_premium_tool_exact_approval_missing",
            "milestones": ["118", "118-R1", "178", "183"],
            "status": "blocked_approval",
            "reason": "No exact approved AI/tool/model is named for non-proof support assets.",
            "next_action": "Owner names exact tool/model and scope, or keep local/Canva/Penpot workflow.",
        },
        {
            "group": "historical_source_browser_shortfall",
            "milestones": ["141-R1"],
            "status": "superseded_locally" if pittsburgh_source_ok and cleveland_source_ok else "blocked_needs_recheck",
            "reason": "Older Miami live-source shortfall is superseded only when newer source-provider health reports pass.",
            "next_action": "Use source-provider health V2; rerun a city package if a specific city still shortfalls.",
            "evidence": {
                "pittsburgh_source_provider_health_pass": pittsburgh_source_ok,
                "cleveland_source_provider_health_pass": cleveland_source_ok,
            },
        },
    ]
    payload = {
        "generated_at": utc_now(),
        "status": "pass",
        "milestone_range": "remaining_incomplete_and_blocked",
        "groups": groups,
        "local_completion_target": ["294", "295", "296", "297", "298", "299"],
        "public_youtube_mutation": "not_performed",
        "thumbnail_replacement": "not_performed",
        "public_publish": "not_performed",
        "canva_live_call": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_path = REPORT_ROOT / "patternlab-blocked-milestones-report.json"
    md_path = REPORT_ROOT / "patternlab-blocked-milestones-report.md"
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab Blocked Milestones Reconciliation",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "External mutation: not performed",
        "",
        "## Blocker Groups",
        "",
    ]
    for group in groups:
        lines.extend(
            [
                f"### {group['group']}",
                f"- Milestones: {', '.join(group['milestones'])}",
                f"- Status: {group['status']}",
                f"- Reason: {group['reason']}",
                f"- Next action: {group['next_action']}",
                "",
            ]
        )
    write_md(md_path, lines)
    return payload, json_path, md_path


def build_canva_export_capability_report() -> tuple[dict[str, Any], Path, Path]:
    payload = {
        "generated_at": utc_now(),
        "status": "blocked_export_tool_unavailable_with_proof",
        "milestone_265_status": "blocked_export_tool_unavailable_with_proof",
        "callable_canva_capability_families": CANVA_TOOLS_OBSERVED,
        "missing_required_export_tools": CANVA_MISSING_EXPORT_TOOLS,
        "copy_edit_thumbnail_import_resize_available": True,
        "local_png_jpg_export_download_callable": False,
        "canva_ai_generation": "not_used",
        "magic_layers_image_to_design": "not_used",
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "decision": "Use local fallback renderer or manually supplied Canva export until a callable export/download tool exists.",
    }
    json_path = REPORT_ROOT / "canva-export-capability-report.json"
    md_path = REPORT_ROOT / "canva-export-capability-report.md"
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab Canva Export Capability Finalization",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "Canva AI generation: not_used",
        "Paid/pro assets: not_used",
        "YouTube mutation: not_performed",
        "",
        "## Callable Tool Families Observed",
        "",
        *[f"- {tool}" for tool in CANVA_TOOLS_OBSERVED],
        "",
        "## Missing Required Export/Download Tools",
        "",
        *[f"- {tool}" for tool in CANVA_MISSING_EXPORT_TOOLS],
        "",
        f"Decision: {payload['decision']}",
    ]
    write_md(md_path, lines)
    return payload, json_path, md_path


def build_canva_no_ai_readiness(video_id: str, city: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    html = read_json(approval / "html-thumbnail-renderer-report.json")
    quality = read_json(approval / "quality-gates-report.json")
    canva = read_json(approval / "canva-no-ai-render-plan-report.json")
    source_assets = read_json(approval / "real-city-source-asset-report.json")
    local_fallback_ready = (
        quality.get("status") == "pass"
        and html.get("status") == "pass"
        and html.get("chat_delivery_surface_status") == "pass"
    )
    source_backed_ready = (
        source_assets.get("status") == "pass"
        or html.get("source_role_integrity_status") == "pass"
    )
    blockers = []
    if not source_backed_ready:
        blockers.append("source_backed_city_images_not_verified")
    if not local_fallback_ready:
        blockers.append("local_fallback_renderer_not_verified")
    blockers.append("canva_export_download_tool_unavailable")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "blocked_export_tool_unavailable_with_local_fallback_ready" if local_fallback_ready and source_backed_ready else "blocked",
        "approved_canva_no_ai_templates_required": True,
        "source_backed_city_images_required": True,
        "source_backed_city_images_status": "pass" if source_backed_ready else "blocked",
        "template_font_preservation_required": True,
        "template_font_preservation_status": canva.get("canva_template_font_preservation_audit_v2_status", "blocked_until_canva_plan_exists"),
        "canva_export_download_status": "blocked_export_tool_unavailable_with_proof",
        "local_fallback_renderer_status": "pass" if local_fallback_ready else "blocked",
        "local_fallback_renderer_report": display_path(approval / "html-thumbnail-renderer-report.json"),
        "quality_gates_report": display_path(approval / "quality-gates-report.json"),
        "canva_no_ai_render_plan_report": display_path(approval / "canva-no-ai-render-plan-report.json"),
        "canva_live_edit": "not_performed",
        "canva_ai_generation": "not_used",
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "blockers": blockers,
    }
    json_path = approval / "canva-no-ai-regeneration-readiness-report.json"
    md_path = approval / "canva-no-ai-regeneration-readiness-report.md"
    write_json(json_path, payload)
    lines = [
        f"# Canva No-AI Regeneration Readiness: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {city}",
        f"Source-backed city images: {payload['source_backed_city_images_status']}",
        f"Template font preservation: {payload['template_font_preservation_status']}",
        f"Canva export/download: {payload['canva_export_download_status']}",
        f"Local fallback renderer: {payload['local_fallback_renderer_status']}",
        "Canva live edit: not_performed",
        "Public YouTube mutation: not_performed",
        "",
        "## Blockers",
        "",
        *[f"- {item}" for item in blockers],
    ]
    write_md(md_path, lines)
    return payload, json_path, md_path


def build_penpot_export_smoke_report() -> tuple[dict[str, Any], Path, Path]:
    json_path = REPORT_ROOT / "penpot-production-export-smoke-report.json"
    md_path = REPORT_ROOT / "penpot-production-export-smoke-report.md"
    existing = read_json(json_path) if json_path.exists() else {}
    if existing.get("milestone_300_penpot_local_server_smoke") == "pass" and existing.get("milestone_301_penpot_authenticated_binfile_export_smoke") == "pass":
        payload = dict(existing)
        payload["generated_at"] = utc_now()
        payload["status"] = "pass" if payload.get("milestone_222_penpot_production_1920x1080_export") == "pass" else "pass_local_server_and_binfile_export"
        payload["milestone_222_status"] = payload.get("milestone_222_penpot_production_1920x1080_export", "blocked_pending_penpot_template_frame_slot_fill_and_image_export")
        write_json(json_path, payload)
        lines = [
            "# Pattern Lab Penpot Production Export Smoke Probe",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {payload['status']}",
            f"Local server smoke: {payload.get('milestone_300_penpot_local_server_smoke')}",
            f"Authenticated binfile export smoke: {payload.get('milestone_301_penpot_authenticated_binfile_export_smoke')}",
            f"Production 1920x1080 image export: {payload.get('milestone_222_penpot_production_1920x1080_export')}",
            f"Compose services: {payload.get('compose_services_status')} ({', '.join(payload.get('compose_services_running', []))})",
            f"Binfile path: {payload.get('authenticated_binfile_export', {}).get('local_binfile_path', 'missing')}",
            f"Binfile size: {payload.get('authenticated_binfile_export', {}).get('local_binfile_size', 0)} bytes",
            f"Production PNG path: {payload.get('production_png_path', 'missing')}",
            f"Production PNG dimensions: {payload.get('production_png_width')}x{payload.get('production_png_height')}",
            f"Chat-safe preview verified: {payload.get('chat_safe_preview_verified')}",
            f"Chat delivery report: {payload.get('chat_delivery_report_path', 'missing')}",
            "Paid/pro assets: not used",
            "Public YouTube mutation: not performed",
            "",
            "## Remaining blocker",
            "",
            *(
                [f"- {item}" for item in payload.get("remaining_blockers", [])]
                if payload.get("remaining_blockers", [])
                else ["- none for the local Penpot export smoke; real thumbnail use still needs owner-approved Penpot templates."]
            ),
        ]
        write_md(md_path, lines)
        return payload, json_path, md_path

    docker_path = shutil.which("docker")
    penpot_path = shutil.which("penpot")
    existing_reports = [
        display_path(path)
        for path in sorted((BASE / "local-output").glob("*/approval/penpot-fallback-evaluation-report.json"))
    ]
    status = "blocked_penpot_server_export_api_unverified"
    blockers = []
    if not docker_path:
        blockers.append("docker_missing_for_self_hosted_penpot")
    if not penpot_path:
        blockers.append("penpot_cli_missing")
    blockers.append("local_penpot_server_export_endpoint_not_verified")
    payload = {
        "generated_at": utc_now(),
        "status": status,
        "milestone_222_status": status,
        "docker_available": bool(docker_path),
        "docker_path": docker_path or "missing",
        "penpot_cli_available": bool(penpot_path),
        "penpot_cli_path": penpot_path or "missing",
        "existing_penpot_readiness_reports": existing_reports,
        "container_started": False,
        "network_fetch_performed": False,
        "export_1920x1080_verified": False,
        "chat_safe_preview_verified": False,
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "blockers": blockers,
        "next_install_requirement": "Install/configure local or self-hosted Penpot with an authenticated export path, then rerun export smoke.",
    }
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab Penpot Production Export Smoke Probe",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Docker available: {payload['docker_available']} ({payload['docker_path']})",
        f"Penpot CLI available: {payload['penpot_cli_available']} ({payload['penpot_cli_path']})",
        "Container started: false",
        "Network fetch performed: false",
        "Export 1920x1080 verified: false",
        "",
        "## Blockers",
        "",
        *[f"- {item}" for item in blockers],
        "",
        f"Next install requirement: {payload['next_install_requirement']}",
    ]
    write_md(md_path, lines)
    return payload, json_path, md_path


def build_analytics_oauth_runbook() -> tuple[dict[str, Any], Path, Path]:
    payload = {
        "generated_at": utc_now(),
        "status": "pass",
        "live_analytics_status": "blocked_until_owner_reauthorizes_readonly_oauth",
        "required_scope": "https://www.googleapis.com/auth/yt-analytics.readonly",
        "invalid_grant_handling": "delete/replace expired token only after owner reauthorizes; do not mutate YouTube",
        "checkpoint_hours": [24, 72, 168, 720],
        "public_youtube_mutation": "not_performed",
    }
    json_path = REPORT_ROOT / "youtube-analytics-oauth-reauthorization-runbook.json"
    md_path = BASE / "workflows" / "youtube-analytics-oauth-reauthorization-runbook.md"
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab YouTube Analytics OAuth Reauthorization Runbook",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Live analytics: {payload['live_analytics_status']}",
        "",
        "## Required Scope",
        "",
        f"- `{payload['required_scope']}`",
        "",
        "## Token Check",
        "",
        "- Confirm `YOUTUBE_TOKEN_FILE` points to the authorized user token.",
        "- Confirm the token contains the required scope.",
        "- If refresh fails with `invalid_grant`, the owner must reauthorize; do not treat this as a script failure.",
        "",
        "## Commands After Reauthorization",
        "",
        "```bash",
        "youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 24 --live",
        "youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 72 --live",
        "youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 168 --live",
        "youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 720 --live",
        "```",
        "",
        "YouTube mutation: not_performed.",
    ]
    write_md(md_path, lines)
    return payload, json_path, md_path


def placeholder_found(text: str) -> bool:
    upper = text.upper()
    return any(
        marker in upper
        for marker in [
            "[EXACT YOUTUBE/VIDEO ID]",
            "[EXACT YOUTUBE VIDEO ID]",
            "[EXACT LOCAL FILE PATH]",
            "[EXACT LOCAL CANDIDATE PATH]",
            "LATEST CANDIDATE",
        ]
    )


def build_public_mutation_audit() -> tuple[dict[str, Any], Path, Path]:
    invalid_fixtures = [
        "I approve replacing the YouTube thumbnail for Pattern Lab Video [exact YouTube/video ID] with [exact local file path]. I do not authorize public publish or any other YouTube mutation.",
        "I approve replacing the YouTube thumbnail with the latest candidate.",
        "I approve setting Pattern Lab Video [exact YouTube video ID] public on YouTube. I do not authorize any other YouTube mutation.",
    ]
    fixture_results = [
        {
            "fixture": fixture,
            "status": "pass" if placeholder_found(fixture) else "fail",
            "expected": "blocked_placeholder_detected",
        }
        for fixture in invalid_fixtures
    ]
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if all(item["status"] == "pass" for item in fixture_results) else "blocked",
        "placeholder_approval_blocker_status": "pass" if all(item["status"] == "pass" for item in fixture_results) else "blocked",
        "thumbnail_replacement_requires": [
            "exact_youtube_video_id",
            "exact_local_candidate_path",
            "explicit_no_public_publish_boundary",
        ],
        "public_publish_requires": [
            "separate_exact_public_publish_approval",
            "exact_youtube_video_id",
        ],
        "invalid_fixture_results": fixture_results,
        "public_youtube_mutation": "not_performed",
        "thumbnail_replacement": "not_performed",
        "public_publish": "not_performed",
    }
    json_path = REPORT_ROOT / "public-mutation-approval-gate-audit.json"
    md_path = REPORT_ROOT / "public-mutation-approval-gate-audit.md"
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab Public Mutation Approval Gate Audit",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "YouTube mutation: not_performed",
        "",
        "## Invalid Placeholder Fixture Results",
        "",
    ]
    for result in fixture_results:
        lines.append(f"- {result['status']}: {result['expected']} — `{result['fixture']}`")
    lines.extend(
        [
            "",
            "## Required Exact Approval Fields",
            "",
            "- Thumbnail replacement: exact YouTube video ID, exact local candidate path, explicit no-public-publish boundary.",
            "- Public publish: separate exact public-publish approval with exact YouTube video ID.",
        ]
    )
    write_md(md_path, lines)
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Pattern Lab remaining production-grade blocker reports.")
    parser.add_argument("--videos", nargs="*", default=["video-cleveland-test", "miami-photo-redo"])
    args = parser.parse_args()
    reports: dict[str, Any] = {}
    reports["blocked_milestones"] = build_blocked_milestones_report()[0]
    reports["canva_export_capability"] = build_canva_export_capability_report()[0]
    reports["canva_readiness"] = [
        build_canva_no_ai_readiness(video_id, "Cleveland" if "cleveland" in video_id else "Miami")[0]
        for video_id in args.videos
    ]
    reports["penpot_export_smoke"] = build_penpot_export_smoke_report()[0]
    reports["analytics_oauth_runbook"] = build_analytics_oauth_runbook()[0]
    reports["public_mutation_audit"] = build_public_mutation_audit()[0]
    print(json.dumps({"status": "pass", "reports": display_path(REPORT_ROOT), "generated_groups": list(reports)}, indent=2))


if __name__ == "__main__":
    main()
