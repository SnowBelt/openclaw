#!/usr/bin/env python3
"""Generate one owner-facing Pattern Lab readiness truth summary.

This report deliberately separates hard private-upload blockers from public,
analytics, external-tool, optional, stale, and experimental blockers so the
owner packet does not conflate unrelated readiness surfaces.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now


OPTIONAL_REPORT_TAXONOMY: dict[str, tuple[str, str]] = {
    "full-auto-production-report.json": (
        "optional_improvement",
        "Full-auto production is not required for the already built/private-ready package.",
    ),
    "full-auto-production-dry-run-report.json": (
        "experimental_not_required",
        "Dry-run automation receipts are informational and do not block private upload.",
    ),
    "thumbnail-canva-render-plan-report.json": (
        "external_tool_blocker",
        "Live Canva template execution/export is optional while the local source-backed renderer passes.",
    ),
    "thumbnail-canva-source-bridge-report.json": (
        "external_tool_blocker",
        "Canva source bridge is external-tool coverage and not required for the current local thumbnail path.",
    ),
    "canva-no-ai-render-plan-report.json": (
        "external_tool_blocker",
        "No-AI Canva live validation is optional because local rendered thumbnail gates pass.",
    ),
    "thumbnail-mobile-shelf-strip-report.json": (
        "optional_improvement",
        "Mobile shelf strip is an optional preview artifact; thumbnail quality/readability gates pass separately.",
    ),
    "thumbnail-pop-score-report.json": (
        "experimental_not_required",
        "Heuristic pop score is experimental and not a private-upload gate.",
    ),
    "thumbnail-poster-depth-renderer-report.json": (
        "experimental_not_required",
        "Poster-depth renderer is an alternate renderer experiment, not the selected production path.",
    ),
    "daily-delivery-blocker-report.json": (
        "stale_or_superseded_report",
        "Daily delivery blocker preserved old production state and does not override current private readiness.",
    ),
    "finished-video-watchdown-report.json": (
        "hard_private_upload_blocker",
        "Finished-video watchdown is a hard gate only when it reports real duration/readability/black-frame blockers.",
    ),
    "youtube-auth-health-report.json": (
        "analytics_blocker",
        "OAuth health affects analytics/API verification, not private-upload readiness.",
    ),
}

HARD_PRIVATE_STATUSES = {"private-upload-ready"}
PASS_STATUSES = {"pass", "uploaded", "sent", "render-ready", "configured", "verified"}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def status_from_md(path: Path) -> str:
    if not path.exists():
        return "missing"
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def blockers_from_md(path: Path) -> list[str]:
    if not path.exists():
        return [f"missing:{display_path(path)}"]
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    in_blockers = False
    blockers: list[str] = []
    for line in lines:
        if line.startswith("## Blockers"):
            in_blockers = True
            continue
        if in_blockers and line.startswith("## "):
            break
        if in_blockers and line.startswith("- "):
            item = line[2:].strip()
            if item and item.lower() != "none":
                blockers.append(item)
    return blockers


def report_status(path: Path) -> str:
    data = read_json(path)
    return str(
        data.get("status")
        or data.get("finished_video_watchdown_status")
        or data.get("full_auto_production_status")
        or data.get("render_plan_status")
        or data.get("canva_source_bridge_status")
        or "missing"
    )


def report_blockers(path: Path) -> list[str]:
    data = read_json(path)
    blockers = data.get("blockers") or []
    return [str(item) for item in blockers]


def package_asset_paths(root: Path, approval: Path) -> list[Path]:
    video_id = root.name.replace("video-", "")
    # Upload currency must compare publishable media, not generated approval reports.
    # Readiness/report files can be regenerated after upload without making the
    # already uploaded private/unlisted media stale.
    paths = [
        root / "video" / f"pattern-lab-video-{video_id}-draft.mp4",
        root / "audio" / "voiceover_full_normalized.mp3",
    ]
    paths.extend(sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")))
    paths.extend(sorted((root / "images").glob("thumbnail_candidate_*.png")))
    return [path for path in paths if path.exists()]


def newest_mtime(paths: list[Path]) -> float:
    return max((path.stat().st_mtime for path in paths), default=0.0)


def private_upload_action(root: Path, approval: Path) -> dict[str, Any]:
    approval_file = approval / "private-upload-approval.json"
    upload_report = approval / "youtube-upload-report.json"
    approved = approval_file.exists()
    uploaded = read_json(upload_report)
    assets_newest = newest_mtime(package_asset_paths(root, approval))
    upload_mtime = upload_report.stat().st_mtime if upload_report.exists() else 0.0
    upload_status = uploaded.get("status", "missing") if uploaded else "missing"
    privacy = uploaded.get("privacy", "") if uploaded else ""
    if upload_status == "uploaded" and privacy in {"private", "unlisted"} and upload_mtime >= assets_newest:
        status = "already_uploaded_current_package_private_or_unlisted"
    elif upload_status == "uploaded" and privacy in {"private", "unlisted"}:
        status = "approved_but_current_package_not_uploaded_after_rebuild"
    elif approved:
        status = "approved_not_uploaded"
    else:
        status = "not_approved"
    return {
        "status": status,
        "private_upload_approval_present": approved,
        "existing_upload_report_status": upload_status,
        "existing_upload_privacy": privacy,
        "existing_upload_report": display_path(upload_report) if upload_report.exists() else "",
        "current_package_newer_than_upload_report": bool(upload_mtime and assets_newest > upload_mtime),
    }


def public_publish_status(approval: Path) -> str:
    report = read_json(approval / "public-publish-report.json")
    if report.get("status") == "published":
        return "published"
    approval_file = approval / "public-publish-approval.json"
    if approval_file.exists():
        return "approved_not_published"
    return "blocked_until_explicit_owner_approval"


def analytics_status(approval: Path) -> dict[str, Any]:
    import platform
    import sys
    auth = read_json(approval / "youtube-auth-health-report.json")
    token = auth.get("token") or {}
    client = auth.get("client") or {}
    blockers = [str(item) for item in auth.get("blockers") or []]
    status = auth.get("status", "missing")
    return {
        "status": status,
        "blockers": blockers,
        "configured_client_id": client.get("client_id", ""),
        "token_client_id": token.get("client_id", ""),
        "token_matches_configured_client": bool(
            client.get("client_id") and token.get("client_id") == client.get("client_id")
        ),
        "repair_command": auth.get("repair_command", ""),
        "beginner_next_steps": [
            "Run the repair command from the repo root only when the owner is present.",
            "Open the Google authorization URL printed by the command.",
            "Choose patternlabus@gmail.com.",
            "Approve every requested YouTube scope shown by Google.",
            "Let the browser redirect to 127.0.0.1 while the local command is still running.",
            "Rerun youtube_auth_health.py with --scope-profile full-automation after the token is written.",
        ],
        "python_runtime": platform.python_version(),
        "python_runtime_warning": "python_below_3_11" if sys.version_info < (3, 11) else "",
        "youtube_mutation": "not_performed",
    }


def classify_reports(approval: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    optional_or_external: list[dict[str, Any]] = []
    stale_or_nonblocking: list[dict[str, Any]] = []
    for filename, (category, reason) in OPTIONAL_REPORT_TAXONOMY.items():
        path = approval / filename
        if not path.exists():
            continue
        status = report_status(path)
        blockers = report_blockers(path)
        item = {
            "report": display_path(path),
            "status": status,
            "category": category,
            "reason": reason,
            "blockers": blockers,
        }
        if category == "stale_or_superseded_report":
            stale_or_nonblocking.append(item)
        elif status not in PASS_STATUSES or blockers:
            optional_or_external.append(item)
    return optional_or_external, stale_or_nonblocking


def build_truth_summary(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    private_status = status_from_md(approval / "private-upload-readiness.md")
    private_blockers = blockers_from_md(approval / "private-upload-readiness.md")
    quality = read_json(approval / "quality-gates-report.json")
    upload_action = private_upload_action(root, approval)
    analytics = analytics_status(approval)
    optional_or_external, stale_or_nonblocking = classify_reports(approval)
    hard_blockers = list(private_blockers)
    if private_status not in HARD_PRIVATE_STATUSES:
        hard_blockers.append(f"private_upload_readiness_not_ready:{private_status}")
    if quality.get("status") != "pass":
        hard_blockers.append("aggregate_quality_gates_not_pass")
    public_state = public_publish_status(approval)
    feedback = approval / "owner-feedback.jsonl"
    real_feedback_count = len([line for line in feedback.read_text(encoding="utf-8").splitlines() if line.strip()]) if feedback.exists() else 0
    package_hash = read_json(approval / "package-hash-report.json")
    package_hash_blockers = [str(item) for item in package_hash.get("blockers") or []] if package_hash else ["package_hash_report_missing"]
    if package_hash.get("status") != "pass" or package_hash.get("stale_outputs"):
        hard_blockers.append("package_hash_not_current")
        hard_blockers.extend(package_hash_blockers)
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not hard_blockers else "blocked",
        "private_upload_readiness": "ready" if private_status == "private-upload-ready" and not private_blockers else "blocked",
        "private_upload_readiness_report_status": private_status,
        "private_upload_action": upload_action,
        "public_publish": public_state,
        "real_owner_feedback_events": real_feedback_count,
        "owner_learning_state": "active" if real_feedback_count else "validated_but_no_real_owner_events",
        "package_hash_state": package_hash.get("status", "missing") if package_hash else "missing",
        "stale_output_count": len(package_hash.get("stale_outputs", [])) if package_hash else "missing",
        "package_hash_blockers": package_hash_blockers,
        "youtube_mutations_performed": False,
        "analytics_oauth": analytics,
        "current_blockers": hard_blockers,
        "optional_or_external_blockers": optional_or_external,
        "stale_or_nonblocking_reports": stale_or_nonblocking,
        "next_owner_action": (
            "Collect real owner feedback in Discord if the latest packet has not been reviewed; "
            "public publishing still requires separate explicit owner approval after YouTube Studio checks."
        ),
        "verification_commands": [
            "python3 youtube-v1/scripts/private_upload_readiness.py --video-id 04",
            "python3 youtube-v1/scripts/patternlab_quality_gates.py --video-id 04",
            "python3 youtube-v1/scripts/generate_owner_review_packet.py --video-id 04",
            "python3 youtube-v1/scripts/youtube_auth_health.py --video-id 04 --scope-profile full-automation || true",
            "python3 youtube-v1/scripts/patternlab_readiness_truth_summary.py --video-id 04",
            "python3 -m py_compile <changed python scripts>",
            "git diff --check",
        ],
        "public_youtube_mutation": "not_performed",
        "upload_publish_comment_pin_related_title_thumbnail_mutation": "not_performed",
    }
    json_path = approval / "patternlab-readiness-truth-summary.json"
    md_path = approval / "patternlab-readiness-truth-summary.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(payload), encoding="utf-8")
    return payload, json_path, md_path


def render_markdown(payload: dict[str, Any]) -> str:
    analytics = payload.get("analytics_oauth") or {}
    private_action = payload.get("private_upload_action") or {}
    lines = [
        f"# Pattern Lab Readiness Truth Summary: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Primary Truth",
        "",
        f"- Private/unlisted upload readiness: {payload['private_upload_readiness']}",
        f"- Private/unlisted upload action: {private_action.get('status', 'missing')}",
        f"- Public publish: {payload['public_publish']}",
        f"- Analytics OAuth: {analytics.get('status', 'missing')}",
        f"- Owner feedback learning: {payload.get('owner_learning_state', 'missing')} ({payload.get('real_owner_feedback_events', 0)} real events)",
        f"- Package hash state: {payload.get('package_hash_state', 'missing')} (stale outputs: {payload.get('stale_output_count', 'missing')})",
        f"- YouTube mutations performed by this readiness pass: {payload['youtube_mutations_performed']}",
        "- Upload/publish/comment/pin/Related Video/title/thumbnail mutation: not_performed",
        "",
        "## Hard Private-Upload Blockers",
        "",
    ]
    lines.extend([f"- {item}" for item in payload["current_blockers"]] or ["- none"])
    lines.extend(
        [
            "",
            "## Analytics OAuth Details",
            "",
            f"- Configured OAuth client ID: {analytics.get('configured_client_id', 'missing')}",
            f"- Token OAuth client ID: {analytics.get('token_client_id', 'missing')}",
            f"- Token matches configured client: {analytics.get('token_matches_configured_client')}",
            f"- Python runtime: {analytics.get('python_runtime', 'missing')}",
            f"- Python runtime warning: {analytics.get('python_runtime_warning') or 'none'}",
            f"- Repair command: `{analytics.get('repair_command', '')}`",
            "- Why blocked: OAuth only blocks live API/analytics work when token health is not verified; it does not block local review readiness.",
            "- No YouTube mutation is required for OAuth repair.",
            "",
            "### Beginner OAuth Steps",
            "",
        ]
    )
    lines.extend([f"{index}. {step}" for index, step in enumerate(analytics.get("beginner_next_steps", []), start=1)])
    lines.extend(["", "## Optional / External / Non-Private-Upload Blockers", ""])
    for item in payload["optional_or_external_blockers"]:
        lines.append(f"- {item['report']}: {item['status']} ({item['category']}) — {item['reason']}")
        for blocker in item.get("blockers") or []:
            lines.append(f"  - reported blocker: {blocker}")
    if not payload["optional_or_external_blockers"]:
        lines.append("- none")
    lines.extend(["", "## Stale Or Superseded Reports", ""])
    for item in payload["stale_or_nonblocking_reports"]:
        lines.append(f"- {item['report']}: {item['status']} — {item['reason']}")
    if not payload["stale_or_nonblocking_reports"]:
        lines.append("- none")
    lines.extend(["", "## Next Owner Action", "", f"- {payload['next_owner_action']}", ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Pattern Lab readiness truth summary.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_truth_summary(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Readiness truth summary: {display_path(md_path)}")
    if payload["current_blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
