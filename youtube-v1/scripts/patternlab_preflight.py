#!/usr/bin/env python3
import argparse
import json
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, media_duration_seconds, output_root, utc_now
from patternlab_images import REQUIRED_IMAGE_FILENAMES, openai_backup_policy, validate_image_pack, write_image_source_report
from patternlab_long_form_quality import build_long_form_quality_report


REPO = BASE.parent
EXPECTED_DISCORD_TARGET = "channel:1503779032817209465"
INSTALLED_DAILY_PLIST = Path.home() / "Library" / "LaunchAgents" / "com.openclaw.pattern-lab.daily-review.plist"
REPO_DAILY_PLIST = BASE / "automation" / "pattern-lab-daily-review.plist"
REQUIRED_REVIEW_ACTIONS = [
    "approve",
    "reject",
    "regenerate",
    "repair",
    "revise_hook",
    "kill_topic",
    "approve_private_upload",
    "approve_public_publish",
]


def env_value(name):
    value = os.environ.get(name, "").strip()
    if not value or value == "replace_me":
        return ""
    return value


def read_json(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def read_plist(path):
    if not path.exists():
        return None
    try:
        with path.open("rb") as handle:
            return plistlib.load(handle)
    except Exception:
        return None


def add(checks, name, status, detail, severity="blocker"):
    checks.append(
        {
            "name": name,
            "status": status,
            "severity": severity,
            "detail": detail,
        }
    )


def command_text(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, cwd=REPO)
    except Exception as exc:
        return "", str(exc), 127
    return result.stdout, result.stderr, result.returncode


def validate_env(checks):
    env_path = BASE / ".env"
    if not env_path.exists():
        add(checks, "env_file", "fail", "youtube-v1/.env is missing.")
        return
    mode = env_path.stat().st_mode & 0o777
    add(
        checks,
        "env_file_permissions",
        "pass" if mode == 0o600 else "warn",
        f"youtube-v1/.env mode is {oct(mode)}.",
        "warning",
    )
    add(
        checks,
        "elevenlabs_api_key",
        "pass" if env_value("ELEVENLABS_API_KEY") else "fail",
        "ElevenLabs API key is configured." if env_value("ELEVENLABS_API_KEY") else "ElevenLabs API key is missing.",
    )
    add(
        checks,
        "elevenlabs_voice_id",
        "pass" if env_value("ELEVENLABS_VOICE_ID") else "fail",
        "ElevenLabs voice id is configured." if env_value("ELEVENLABS_VOICE_ID") else "ElevenLabs voice id is missing.",
    )
    add(
        checks,
        "openai_backup_key",
        "pass" if env_value("OPENAI_API_KEY") else "warn",
        (
            "OpenAI image key is configured for backup image generation."
            if env_value("OPENAI_API_KEY")
            else "OpenAI image key is missing; this is only a blocker when Codex images are unavailable."
        ),
        "warning",
    )
    policy = openai_backup_policy()
    add(
        checks,
        "openai_backup_mode",
        "pass" if policy["enabled"] else "warn",
        (
            "OpenAI backup mode is enabled for missing or invalid Codex images."
            if policy["enabled"]
            else "OpenAI backup mode is disabled; Codex images must be valid before media build."
        ),
        "warning",
    )


def validate_tools(checks):
    for name in ["ffmpeg", "ffprobe", "pnpm", "python3"]:
        path = shutil.which(name)
        add(
            checks,
            f"tool_{name}",
            "pass" if path else "fail",
            f"{name} found at {path}." if path else f"{name} was not found in PATH.",
        )


def resolve_env_path(name):
    value = env_value(name)
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = BASE / path
    return path


def validate_youtube_oauth(checks):
    client = resolve_env_path("YOUTUBE_CLIENT_SECRETS_FILE")
    token = resolve_env_path("YOUTUBE_TOKEN_FILE")
    add(
        checks,
        "youtube_oauth_client",
        "pass" if client and client.exists() else "fail",
        f"YouTube OAuth client exists at {display_path(client)}." if client and client.exists() else "YouTube OAuth client file is missing or not configured.",
    )
    add(
        checks,
        "youtube_oauth_token",
        "pass" if token and token.exists() else "fail",
        f"YouTube OAuth token exists at {display_path(token)}." if token and token.exists() else "YouTube OAuth token is missing or not configured.",
    )
    token_payload = read_json(token) if token and token.exists() else None
    scopes = []
    if token_payload:
        scopes = token_payload.get("scopes") or token_payload.get("scope") or []
        if isinstance(scopes, str):
            scopes = scopes.split()
    required_scopes = {
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
    }
    missing_scopes = sorted(required_scopes.difference(scopes))
    add(
        checks,
        "youtube_oauth_refresh_token",
        "pass" if token_payload and token_payload.get("refresh_token") else "fail",
        (
            "YouTube OAuth refresh token is present; future runs can refresh without re-consent."
            if token_payload and token_payload.get("refresh_token")
            else "YouTube OAuth refresh token is missing; rerun generate_youtube_oauth_token.py with owner consent."
        ),
    )
    add(
        checks,
        "youtube_oauth_required_scopes",
        "pass" if token_payload and not missing_scopes else "fail",
        (
            "YouTube OAuth token includes upload, read, public-update, and analytics-read scopes."
            if token_payload and not missing_scopes
            else f"YouTube OAuth token is missing required scopes: {', '.join(missing_scopes) or 'unknown'}."
        ),
    )


def plist_arguments(plist):
    if not plist:
        return []
    return plist.get("ProgramArguments") or []


def validate_daily_plist(checks, path, label):
    plist = read_plist(path)
    if not plist:
        add(checks, f"{label}_daily_plist", "fail", f"{display_path(path)} is missing or invalid.")
        return
    args = plist_arguments(plist)
    interval = plist.get("StartCalendarInterval") or {}
    add(
        checks,
        f"{label}_daily_loop_target",
        "pass" if any("patternlab_daily_loop.py" in arg for arg in args) else "fail",
        f"{label} daily job uses {' '.join(args)}.",
    )
    add(
        checks,
        f"{label}_discord_channel_target",
        "pass" if EXPECTED_DISCORD_TARGET in args else "fail",
        f"{label} Discord target is {EXPECTED_DISCORD_TARGET if EXPECTED_DISCORD_TARGET in args else 'not the Pattern Lab review channel'}.",
    )
    add(
        checks,
        f"{label}_schedule_time",
        "pass" if interval.get("Hour") == 4 and interval.get("Minute") == 25 else "warn",
        f"{label} schedule is {interval.get('Hour')}:{str(interval.get('Minute')).zfill(2)}.",
        "warning",
    )


def validate_launchd(checks):
    validate_daily_plist(checks, REPO_DAILY_PLIST, "repo")
    validate_daily_plist(checks, INSTALLED_DAILY_PLIST, "installed")
    stdout, stderr, code = command_text(["launchctl", "print", "gui/502/com.openclaw.pattern-lab.daily-review"])
    detail = stdout if stdout else stderr
    add(
        checks,
        "launchagent_loaded",
        "pass" if code == 0 and "patternlab_daily_loop.py" in stdout else "fail",
        "Daily LaunchAgent is loaded and points to patternlab_daily_loop.py." if code == 0 and "patternlab_daily_loop.py" in stdout else detail.strip()[:400],
    )


def validate_wake_schedule(checks):
    stdout, stderr, code = command_text(["pmset", "-g", "sched"])
    text = stdout or stderr
    ok = code == 0 and ("04:10" in text or "4:10AM" in text) and ("01:55" in text or "1:55" in text)
    add(
        checks,
        "wake_schedule",
        "pass" if ok else "warn",
        text.strip()[:500] if text.strip() else "Could not read pmset schedule.",
        "warning",
    )


def validate_package(checks, video_id):
    root = output_root(video_id)
    launch = BASE / "launch" / f"video-{video_id}"
    add(checks, "launch_package", "pass" if launch.exists() else "fail", f"{display_path(launch)} {'exists' if launch.exists() else 'is missing'}.")
    metadata = root / "approval" / "upload-metadata.json"
    gates = root / "approval" / "monetization-gates-report.json"
    readiness = root / "approval" / "private-upload-readiness.md"
    readiness_json = root / "approval" / "private-upload-readiness.json"
    shorts_plan = root / "approval" / "shorts-upload-plan.md"
    shorts_quality = root / "approval" / "shorts-quality-report.json"
    media_qa = root / "approval" / "media-qa-report.json"
    add(checks, "upload_metadata", "pass" if metadata.exists() else "fail", f"{display_path(metadata)} {'exists' if metadata.exists() else 'is missing'}.")
    gate_payload = read_json(gates)
    add(
        checks,
        "monetization_gates",
        "pass" if gate_payload and gate_payload.get("status") == "pass" else "fail",
        f"Monetization gate status is {gate_payload.get('status') if gate_payload else 'missing'}.",
    )
    readiness_payload = read_json(readiness_json)
    readiness_status = readiness_payload.get("status") if readiness_payload else "missing"
    readiness_pass = readiness_status == "private-upload-ready"
    add(
        checks,
        "private_readiness_report",
        "pass" if readiness_pass else "fail",
        f"{display_path(readiness_json)} status is {readiness_status}; readiness must be private-upload-ready.",
    )
    if shorts_plan.exists():
        text = shorts_plan.read_text(encoding="utf-8")
        scored_source_ok = "Timestamp source: script-moment-score" in text
        scored_moments_ok = text.count("Moment score:") >= 3 and text.count("Moment excerpt:") >= 3
        scripted_source_ok = "Timestamp source: scripted-short-package" in text
        scripted_package_ok = text.count("Standalone score:") >= 3 and text.count("Scripted transcript:") >= 3
        source_ok = (scored_source_ok and scored_moments_ok) or (scripted_source_ok and scripted_package_ok)
        detail = (
            "Shorts are selected from the standalone scripted Shorts package."
            if scripted_source_ok and scripted_package_ok
            else "Shorts are selected by script moment score with excerpts."
            if scored_source_ok and scored_moments_ok
            else "Shorts plan is not using scored script moments or the standalone scripted Shorts package."
        )
        add(checks, "shorts_moment_selection", "pass" if source_ok else "fail", detail)
    else:
        add(checks, "shorts_moment_selection", "fail", "Shorts upload plan is missing.")
    shorts_quality_payload = read_json(shorts_quality)
    add(
        checks,
        "shorts_quality",
        "pass" if shorts_quality_payload and shorts_quality_payload.get("status") == "pass" else "fail",
        f"Shorts quality status is {shorts_quality_payload.get('status') if shorts_quality_payload else 'missing'}.",
    )
    media_qa_payload = read_json(media_qa)
    media_qa_pass = bool(
        media_qa_payload
        and media_qa_payload.get("status") == "pass"
        and int(media_qa_payload.get("minimum_asset_score", 0) or 0) >= 93
    )
    add(
        checks,
        "strict_media_qa",
        "pass" if media_qa_pass else "fail",
        f"Strict media QA status is {media_qa_payload.get('status') if media_qa_payload else 'missing'}; every asset must score at least 93.",
    )


def validate_media(checks, video_id):
    root = output_root(video_id)
    image_report = validate_image_pack(root)
    policy = openai_backup_policy()
    write_image_source_report(
        root,
        video_id,
        image_report,
        backup_available=policy["available"],
        backup_enabled=policy["enabled"],
    )
    image_problem_count = (
        len(image_report["missing_images"])
        + len(image_report["invalid_images"])
        + len(image_report["ledger_missing"])
        + len(image_report["ledger_invalid"])
    )
    if image_report["usable_valid"]:
        image_status = "pass"
        image_detail = f"Image pack is valid from source: {image_report['selected_source']}."
        image_severity = "blocker"
    elif policy["can_run"]:
        image_status = "warn"
        image_detail = (
            f"Image pack has {image_problem_count} issue(s), but OpenAI backup is enabled and can run if Codex images remain unavailable."
        )
        image_severity = "warning"
    else:
        image_status = "fail"
        backup_reason = "OpenAI backup is disabled." if policy["available"] else "OpenAI backup is unavailable."
        image_detail = (
            f"No valid Codex image pack exists. {backup_reason} "
            f"Missing: {', '.join(image_report['missing_images']) or 'none'}."
        )
        image_severity = "blocker"
    add(
        checks,
        "image_source_policy",
        image_status,
        image_detail,
        image_severity,
    )
    missing_required = [name for name in REQUIRED_IMAGE_FILENAMES if name in image_report["missing_images"]]
    add(
        checks,
        "required_images",
        "pass" if image_report["usable_valid"] else ("warn" if policy["can_run"] else "fail"),
        (
            "All required images are valid and ledgered."
            if image_report["usable_valid"]
            else f"Required image pack is incomplete or invalid. Missing: {', '.join(missing_required) or 'none'}."
        ),
        "warning" if policy["can_run"] and not image_report["usable_valid"] else "blocker",
    )
    voice = root / "audio" / "voiceover_full_normalized.mp3"
    if voice.exists():
        try:
            duration = media_duration_seconds(voice)
            add(checks, "voiceover_duration", "pass" if 480 <= duration <= 840 else "fail", f"Voiceover duration is {duration:.1f}s.")
        except Exception as exc:
            add(checks, "voiceover_duration", "fail", f"Could not read voiceover duration: {exc}.")
    else:
        add(checks, "voiceover_duration", "fail", "Normalized voiceover is missing.")
    proof = root / "proof-footage" / "artifact-proof-clip.mp4"
    add(checks, "proof_footage", "pass" if proof.exists() else "fail", f"{display_path(proof)} {'exists' if proof.exists() else 'is missing'}.")
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if long_form.exists():
        try:
            duration = media_duration_seconds(long_form)
            add(checks, "long_form_duration", "pass" if 480 <= duration <= 840 else "fail", f"Long-form duration is {duration:.1f}s.")
        except Exception as exc:
            add(checks, "long_form_duration", "fail", f"Could not read long-form duration: {exc}.")
    else:
        add(checks, "long_form_duration", "fail", "Long-form draft is missing.")
    long_form_quality, long_form_quality_report = build_long_form_quality_report(video_id)
    add(
        checks,
        "long_form_quality_gate",
        "pass" if long_form_quality.get("status") == "pass" else "fail",
        f"Long-form quality report is {long_form_quality.get('status')} at {display_path(long_form_quality_report)}.",
    )
    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if (root / "shorts").exists() else []
    add(checks, "shorts_count", "pass" if len(shorts) >= 3 else "fail", f"{len(shorts)} Shorts rendered.")


def validate_safety_locks(checks):
    upload_source = (BASE / "scripts" / "upload_private_youtube.py").read_text(encoding="utf-8")
    add(
        checks,
        "private_upload_only",
        "pass" if 'ALLOWED_PRIVACY = {"private", "unlisted"}' in upload_source else "fail",
        "Upload script allows private/unlisted only." if 'ALLOWED_PRIVACY = {"private", "unlisted"}' in upload_source else "Upload privacy allowlist changed.",
    )
    review_source = (BASE / "scripts" / "patternlab_review_action.py").read_text(encoding="utf-8")
    missing_actions = [action for action in REQUIRED_REVIEW_ACTIONS if f'"{action}"' not in review_source]
    add(
        checks,
        "review_actions",
        "pass" if not missing_actions else "fail",
        "All required review actions are wired." if not missing_actions else f"Missing review actions: {', '.join(missing_actions)}.",
    )


def write_reports(video_id, checks):
    blockers = [check for check in checks if check["status"] == "fail" and check["severity"] == "blocker"]
    warnings = [
        check
        for check in checks
        if check["status"] == "warn" or (check["severity"] == "warning" and check["status"] != "pass")
    ]
    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "blockers": blockers,
        "warnings": warnings,
        "checks": checks,
    }
    root = output_root(video_id)
    video_dir = ensure_dir(root / "approval")
    global_dir = ensure_dir(BASE / "local-output" / "preflight")
    for target_dir in [video_dir, global_dir]:
        (target_dir / "patternlab-preflight.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        lines = [
            f"# Pattern Lab Preflight: Video {video_id}",
            "",
            f"Generated: {payload['generated_at']}",
            f"Status: {status}",
            "",
            "## Blockers",
            "",
            *([f"- {item['name']}: {item['detail']}" for item in blockers] or ["- none"]),
            "",
            "## Warnings",
            "",
            *([f"- {item['name']}: {item['detail']}" for item in warnings] or ["- none"]),
            "",
            "## Checks",
            "",
            *[f"- {item['name']}: {item['status']} ({item['detail']})" for item in checks],
            "",
        ]
        (target_dir / "patternlab-preflight.md").write_text("\n".join(lines), encoding="utf-8")
    return payload, video_dir / "patternlab-preflight.md"


def main():
    parser = argparse.ArgumentParser(description="Run Pattern Lab hardening preflight checks.")
    parser.add_argument("--video-id", default="02")
    parser.add_argument("--fail-on-blockers", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    checks = []
    validate_env(checks)
    validate_tools(checks)
    validate_youtube_oauth(checks)
    validate_launchd(checks)
    validate_wake_schedule(checks)
    validate_package(checks, args.video_id)
    validate_media(checks, args.video_id)
    validate_safety_locks(checks)
    payload, report = write_reports(args.video_id, checks)
    print(f"Status: {payload['status']}")
    print(f"Preflight report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker['name']}: {blocker['detail']}")
    if args.fail_on_blockers and payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
