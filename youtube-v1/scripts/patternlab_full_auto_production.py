#!/usr/bin/env python3
"""Orchestrate complete local Pattern Lab production up to owner review."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, output_root, utc_now
from patternlab_topic_qualification_queue import build_topic_qualification_queue

REPO = BASE.parent


def env_with_paths() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")
    return env


def run_step(name: str, command: list[str], *, dry_run: bool, check: bool = False, required: bool = True) -> dict[str, Any]:
    if dry_run:
        return {
            "name": name,
            "command": " ".join(command),
            "exit_code": None,
            "ok": True,
            "status": "planned",
            "dry_run": True,
            "required": required,
        }
    result = subprocess.run(command, cwd=REPO, env=env_with_paths(), check=False)
    ok = result.returncode == 0
    if check and not ok:
        raise SystemExit(result.returncode)
    return {
        "name": name,
        "command": " ".join(command),
        "exit_code": result.returncode,
        "ok": ok,
        "status": "pass" if ok else "blocked",
        "dry_run": False,
        "required": required,
    }


def run_steps_fail_fast(
    definitions: list[tuple[str, list[str], bool]], *, dry_run: bool, runner=run_step
) -> list[dict[str, Any]]:
    """Run local production gates in order and skip downstream work after a required failure."""
    steps: list[dict[str, Any]] = []
    blocker: dict[str, Any] | None = None
    for name, command, required in definitions:
        if blocker is not None and not dry_run:
            steps.append(
                {
                    "name": name,
                    "command": " ".join(command),
                    "exit_code": None,
                    "ok": False,
                    "status": "skipped",
                    "dry_run": False,
                    "required": required,
                    "blocked_by": blocker["name"],
                }
            )
            continue
        step = runner(name, command, dry_run=dry_run, required=required)
        steps.append(step)
        if required and not step.get("ok"):
            blocker = step
    return steps


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def script_sha256(video_id: str) -> str:
    path = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def paid_voice_approval(video_id: str) -> tuple[bool, str]:
    root = output_root(video_id)
    receipt = read_json(root / "approval" / "paid-service-approval.json")
    expected = script_sha256(video_id)
    if not receipt:
        return False, "paid_voice_approval_missing"
    if receipt.get("provider") != "elevenlabs":
        return False, "paid_voice_approval_provider_mismatch"
    if receipt.get("video_id") != video_id:
        return False, "paid_voice_approval_video_mismatch"
    if not expected or receipt.get("script_sha256") != expected:
        return False, "paid_voice_approval_script_hash_mismatch"
    operation = str(receipt.get("operation") or "").strip()
    accepted_operations = {
        "upload_ready_narration",
        f"video_{video_id}_upload_ready_narration",
    }
    if operation not in accepted_operations:
        return False, "paid_voice_approval_operation_mismatch"
    return True, "approved"


def next_incomplete_video() -> str:
    queue, _json_path, _md_path = build_topic_qualification_queue()
    candidate = queue.get("next_candidate") or {}
    video_id = str(candidate.get("video_id") or "").strip()
    status = str(candidate.get("topic_status") or "").strip()
    if status not in {"active_rebuild", "production_ready"} or not video_id:
        raise SystemExit(
            "No production-eligible Pattern Lab topic exists. "
            "Complete the active rebuild or qualify a source-backed topic before automatic production."
        )
    return video_id.zfill(2)


def media_state(video_id: str) -> dict[str, Any]:
    root = output_root(video_id)
    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if (root / "shorts").exists() else []
    return {
        "source_packet_exists": (root / "source-packet").exists(),
        "rights_ledger_exists": (root / "rights-ledger.csv").exists(),
        "long_form_exists": (root / "video" / f"pattern-lab-video-{video_id}-draft.mp4").exists(),
        "voiceover_exists": (root / "audio" / "voiceover_full_normalized.mp3").exists(),
        "thumbnail_count": len(list((root / "images").glob("thumbnail_candidate_*.png"))) if (root / "images").exists() else 0,
        "shorts_count": len(shorts),
        "owner_packet_exists": (root / "review" / "owner-review-packet.md").exists(),
    }


def build_full_auto_report(video_id: str, steps: list[dict[str, Any]], dry_run: bool, shorts_target: int) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    state = media_state(video_id)
    blockers: list[str] = []
    informational: list[str] = []
    failed_steps = [step for step in steps if not step.get("ok") and step.get("status") != "skipped"]
    failed_required_steps = [step for step in failed_steps if step.get("required", True)]
    package_current = state["long_form_exists"] and state["shorts_count"] >= 3 and state["owner_packet_exists"]
    if dry_run:
        informational.append("dry_run_no_media_mutation_performed")
    blockers.extend(f"required_step_failed:{step['name']}:{step['exit_code']}" for step in failed_required_steps)
    informational.extend(
        f"optional_step_failed:{step['name']}:{step['exit_code']}"
        for step in failed_steps
        if not step.get("required", True)
    )
    if not dry_run and not state["owner_packet_exists"]:
        blockers.append("owner_packet_missing_after_run")
    if not dry_run and not state["long_form_exists"]:
        blockers.append("long_form_missing_after_run")
    if not dry_run and state["shorts_count"] < 3:
        blockers.append(f"shorts_below_minimum_after_run:{state['shorts_count']}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "dry_run_planned" if dry_run else ("pass" if not blockers else "blocked"),
        "full_auto_production_status": "dry_run_planned" if dry_run else ("pass" if not blockers else "blocked"),
        "current_package_complete": package_current,
        "informational": informational,
        "failed_step_count": len(failed_steps),
        "failed_required_step_count": len(failed_required_steps),
        "shorts_target": shorts_target,
        "shorts_policy": "rank 8-12 candidate moments and render 3-5 passing Shorts; public publish blocked",
        "renderer_priority": ["canva_no_ai_export_if_callable", "penpot_self_host_slot_fill", "chrome_fontsource_backup"],
        "public_youtube_mutation": "not_performed",
        "upload_or_publish": "not_performed",
        "thumbnail_replacement": "not_performed",
        "steps": steps,
        "media_state": state,
        "blockers": blockers,
    }
    json_path = approval / "full-auto-production-report.json"
    md_path = approval / "full-auto-production-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Full Auto Production: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Shorts target: {shorts_target}",
        "Public YouTube mutation: not_performed",
        "",
        "## Steps",
        "",
    ]
    for step in steps:
        lines.append(f"- {step['name']}: {step.get('status', 'pass' if step['ok'] else 'blocked')} ({step['exit_code']}) `{step['command']}`")
    lines.extend(["", "## Informational", ""])
    lines.extend([f"- {item}" for item in informational] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run complete local Pattern Lab production up to owner review.")
    parser.add_argument("--next-scheduled", action="store_true")
    parser.add_argument("--video-id")
    parser.add_argument("--live-voice", choices=["when-approved", "never"], default="never")
    parser.add_argument("--shorts-target", type=int, choices=[3, 4, 5], default=5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    if os.environ.get("PATTERNLAB_CANONICAL_RUN") != "1" and not args.dry_run:
        raise SystemExit(
            "Direct full-auto production is unsupported. Use "
            "youtube-v1/scripts/patternlab_production.py --profile full_package."
        )
    load_dotenv()
    video_id = (args.video_id or next_incomplete_video()).zfill(2) if not str(args.video_id or "").startswith("video-") else str(args.video_id)
    py = sys.executable
    voice_approved, voice_reason = paid_voice_approval(video_id)
    live_voice = args.live_voice == "when-approved" and voice_approved
    definitions: list[tuple[str, list[str], bool]] = []
    # Keep the backlog moving without treating a broad headline as a media-ready
    # episode. This local worker only writes research briefs and cannot call a
    # provider, render media, or mutate YouTube.
    definitions.append(("research_queue_briefs", [py, "youtube-v1/scripts/patternlab_topic_research_worker.py"], False))
    if args.live_voice == "when-approved" and not voice_approved:
        definitions.append(("paid_voice_approval", ["blocked", voice_reason], True))
    if live_voice:
        definitions.append(("elevenlabs_credit_preflight", [py, "youtube-v1/scripts/patternlab_elevenlabs_credit_health.py", "--video-id", video_id, "--live"], True))
    definitions.append(("package", [py, "youtube-v1/scripts/patternlab_daily_factory.py", "--video-id", video_id], True))
    # Every narration beat must declare whether its visual is proof, generic
    # context, reconstruction, or a source-grounded system graphic before the
    # renderer can make a polished but misleading edit.
    definitions.append(("visual_contract", [py, "youtube-v1/scripts/patternlab_visual_contract.py", "--video-id", video_id], True))
    definitions.append(("renderer_decision", [py, "youtube-v1/scripts/patternlab_renderer_decision_gate.py", "--video-id", video_id], True))
    media_cmd = [py, "youtube-v1/scripts/patternlab_media_pipeline.py", "--video-id", video_id]
    if live_voice:
        media_cmd.append("--live-voice")
    definitions.append(("media_pipeline", media_cmd, True))
    definitions.append(("shorts_tournament_plan", [py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id, "--shorts-target", str(args.shorts_target), "--dry-run"], True))
    # The legacy media worker may create files, but no package can reach owner
    # review until an explicit, hash-verified evidence manifest proves which
    # assets support the narration.  This intentionally blocks rather than
    # inferring a source trail from filenames or generic B-roll.
    definitions.append(("canonical_evidence_preflight", [py, "youtube-v1/scripts/patternlab_canonical_preflight.py", "--video-id", video_id], True))
    definitions.append(("episode_standard", [py, "youtube-v1/scripts/patternlab_episode_standard.py", "--video-id", video_id], True))
    definitions.append(("local_visual_model_benchmark", [py, "youtube-v1/scripts/patternlab_local_visual_judge_runner.py", "--video-id", video_id, "--benchmark"], True))
    definitions.append(("local_visual_model_benchmark_verify", [py, "youtube-v1/scripts/patternlab_local_visual_model_benchmark.py", "--video-id", video_id], True))
    definitions.append(("local_visual_final_judge", [py, "youtube-v1/scripts/patternlab_local_visual_judge_runner.py", "--video-id", video_id, "--judge-final"], True))
    definitions.append(("voice_visual_match", [py, "youtube-v1/scripts/patternlab_voice_visual_match.py", "--video-id", video_id], True))
    definitions.append(("strict_media_qa", [py, "youtube-v1/scripts/patternlab_media_qa.py", "--video-id", video_id], True))
    definitions.append(("finished_watchdown", [py, "youtube-v1/scripts/patternlab_finished_video_watchdown.py", "--video-id", video_id], True))
    definitions.append(("shorts_followup", [py, "youtube-v1/scripts/patternlab_shorts_followup_packet.py", "--video-id", video_id], True))
    definitions.append(("package_hashes", [py, "youtube-v1/scripts/patternlab_package_hashes.py", "--video-id", video_id], True))
    definitions.append(("canonical_release_registration", [py, "youtube-v1/scripts/patternlab_register_release.py", "--video-id", video_id], True))
    definitions.append(("owner_packet", [py, "youtube-v1/scripts/generate_owner_review_packet.py", "--video-id", video_id], True))
    definitions.append(("dashboard_check", [py, "youtube-v1/scripts/patternlab_dashboard_server.py", "--check", "--video-id", video_id], True))
    steps = run_steps_fail_fast(definitions, dry_run=args.dry_run)
    payload, _json_path, md_path = build_full_auto_report(video_id, steps, args.dry_run, args.shorts_target)
    print(f"Status: {payload['status']}")
    print(f"Full auto report: {display_path(md_path)}")
    if args.require_complete and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
