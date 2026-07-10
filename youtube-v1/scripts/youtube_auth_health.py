#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, output_root, utc_now
from upload_private_youtube import resolve_base_path
from patternlab_youtube_credentials import CLIENT_ACCOUNT, TOKEN_ACCOUNT, read_json_secret, write_token


SCOPE_PROFILES = {
    "analytics-readonly": [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    "full-automation": [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
}
SENSITIVE_MARKERS = ["access_token", "refresh_token", "client_secret", "Authorization", "Bearer "]


def repo_root_path(path):
    try:
        return f"youtube-v1/{path.relative_to(BASE)}"
    except ValueError:
        return str(path)


def preferred_youtube_python():
    candidates = [
        BASE / ".venv-youtube-3.12" / "bin" / "python",
        BASE / ".venv-youtube" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.exists():
            return repo_root_path(candidate)
    return "python3"


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def redact_error(exc):
    text = str(exc).replace("\n", " ")
    if any(marker in text for marker in SENSITIVE_MARKERS):
        return f"{type(exc).__name__}: redacted"
    return f"{type(exc).__name__}: {text[:600]}"


def configured_path(value, label):
    try:
        return resolve_base_path(value, label)
    except SystemExit as exc:
        raise RuntimeError(str(exc)) from exc


def inspect_token(token_file, required_scopes):
    token, _source = read_json_secret(token_file, TOKEN_ACCOUNT)
    if not token:
        return {
            "present": False,
            "has_refresh_token": False,
            "client_id": "",
            "scopes": [],
            "missing_scopes": required_scopes,
        }
    scopes = token.get("scopes") or token.get("scope") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    return {
        "present": True,
        "has_refresh_token": bool(token.get("refresh_token")),
        "client_id": token.get("client_id", ""),
        "scopes": sorted(scopes),
        "missing_scopes": [scope for scope in required_scopes if scope not in scopes],
    }


def inspect_client(client_secrets):
    data, _source = read_json_secret(client_secrets, CLIENT_ACCOUNT)
    if not data:
        return {"present": False, "client_id": ""}
    client = data.get("installed") or data.get("web") or {}
    return {
        "present": True,
        "client_id": client.get("client_id", ""),
    }


def live_probe(token_file, client_secrets):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    token, _source = read_json_secret(token_file, TOKEN_ACCOUNT)
    if not token:
        return "blocked", "Token file is missing or unreadable."
    credentials = Credentials.from_authorized_user_info(token)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        write_token(token_file, json.loads(credentials.to_json()))
    if not credentials.valid:
        return "blocked", "Token is invalid after refresh attempt."
    client, _client_source = read_json_secret(client_secrets, CLIENT_ACCOUNT)
    if not client:
        return "blocked", f"Missing YouTube OAuth client secrets: {display_path(client_secrets)}."
    return "verified", "OAuth token is valid or refreshed successfully."


def build_payload(video_id, live, scope_profile):
    load_dotenv()
    root = output_root(video_id)
    blockers = []
    required_scopes = SCOPE_PROFILES[scope_profile]
    try:
        token_file = configured_path(os.environ.get("YOUTUBE_TOKEN_FILE", ""), "YOUTUBE_TOKEN_FILE")
        client_secrets = configured_path(
            os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", ""),
            "YOUTUBE_CLIENT_SECRETS_FILE",
        )
    except RuntimeError as exc:
        token_file = None
        client_secrets = None
        blockers.append(str(exc))

    token = inspect_token(token_file, required_scopes) if token_file else {
        "present": False,
        "has_refresh_token": False,
        "client_id": "",
        "scopes": [],
        "missing_scopes": required_scopes,
    }
    client = inspect_client(client_secrets) if client_secrets else {
        "present": False,
        "client_id": "",
    }
    if not token["present"]:
        blockers.append("YouTube OAuth token file is missing.")
    if not token["has_refresh_token"]:
        blockers.append("YouTube OAuth token is missing a refresh token.")
    if token["missing_scopes"]:
        blockers.append(f"YouTube OAuth token is missing required scopes for profile: {scope_profile}.")
    if client_secrets and not client["present"]:
        blockers.append("YouTube OAuth client secrets file is missing.")
    if token["present"] and client["present"] and token["client_id"] != client["client_id"]:
        blockers.append("YouTube OAuth token client_id does not match configured client secrets client_id.")

    live_status = "not_run"
    live_reason = "Run with --live to refresh/probe the OAuth token."
    if live and not blockers:
        try:
            live_status, live_reason = live_probe(token_file, client_secrets)
        except Exception as exc:
            live_status = "blocked"
            live_reason = redact_error(exc)
            blockers.append("YouTube OAuth live probe failed; regenerate the OAuth token.")
            if "invalid_grant" in str(exc):
                blockers.append("YouTube OAuth refresh token is expired or revoked.")
    elif blockers:
        live_status = "blocked"
        live_reason = "Local OAuth configuration is incomplete."

    status = "verified" if live_status == "verified" and not blockers else "blocked"
    if not live and not blockers:
        status = "configured"
    python_command = preferred_youtube_python()
    repair_command = (
        f"{python_command} youtube-v1/scripts/repair_youtube_oauth.py --video-id {video_id} --scope-profile {scope_profile}"
    )
    token_matches_configured_client = bool(
        client.get("client_id") and token.get("client_id") == client.get("client_id")
    )
    mismatch_explanation = (
        "The installed OAuth client JSON is newer than the local token. Regenerate the token so Analytics/API verification uses the configured client."
        if token["present"] and client["present"] and not token_matches_configured_client
        else ""
    )
    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "live": live,
        "scope_profile": scope_profile,
        "token_file": display_path(token_file) if token_file else "",
        "client_secrets_file": display_path(client_secrets) if client_secrets else "",
        "client": client,
        "required_scopes": required_scopes,
        "token": token,
        "live_probe": {
            "status": live_status,
            "reason": live_reason,
        },
        "token_matches_configured_client": token_matches_configured_client,
        "mismatch_explanation": mismatch_explanation,
        "repair_command": repair_command,
        "recommended_python": python_command,
        "beginner_steps": [
            "Run the repair command from the repo root only when the owner is present.",
            f"Use `{python_command}` for YouTube OAuth scripts when available.",
            "Use Chrome on the Mac Studio unless you intentionally created the printed SSH tunnel from the MacBook.",
            "Open the Google authorization URL printed by the command immediately; do not reuse old URLs.",
            "Choose patternlabus@gmail.com.",
            "Approve every requested YouTube scope shown by Google.",
            "Leave the local command running while the browser redirects to 127.0.0.1 on the same machine.",
            f"Rerun youtube_auth_health.py with --scope-profile {scope_profile} after the token is written.",
        ],
        "youtube_mutation": "not_performed",
        "blockers": blockers,
    }, root


def write_report(root, payload):
    approval = ensure_dir(root / "approval")
    json_path = approval / "youtube-auth-health-report.json"
    md_path = approval / "youtube-auth-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab YouTube Auth Health: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Live probe: {payload['live_probe']['status']}",
        f"Scope profile: {payload['scope_profile']}",
        "",
        "## OAuth Files",
        "",
        f"- Token file: {payload['token_file']}",
        f"- Client secrets file: {payload['client_secrets_file']}",
        f"- Recommended Python: {payload['recommended_python']}",
        f"- Configured OAuth client ID: {payload['client'].get('client_id') or 'missing'}",
        f"- Token OAuth client ID: {payload['token'].get('client_id') or 'missing'}",
        f"- Token matches configured client: {payload['token_matches_configured_client']}",
        f"- Refresh token present: {payload['token']['has_refresh_token']}",
        f"- Missing scopes: {', '.join(payload['token']['missing_scopes']) or 'none'}",
        f"- YouTube mutation: {payload['youtube_mutation']}",
        f"- Mismatch explanation: {payload['mismatch_explanation'] or 'none'}",
        "",
        "## Repair",
        "",
        f"- Regenerate token: `{payload['repair_command']}`",
        "- This repair only regenerates local OAuth credentials; it does not upload, publish, comment, pin, set Related Video, change title, or change thumbnail.",
        "",
        "## Beginner Steps",
        "",
    ]
    lines.extend([f"{index}. {step}" for index, step in enumerate(payload["beginner_steps"], start=1)])
    lines.extend([
        "",
        "## Blockers",
        "",
    ])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Check Pattern Lab YouTube OAuth health.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--live", action="store_true", help="Refresh/probe the local OAuth token. Never uploads.")
    parser.add_argument(
        "--scope-profile",
        choices=sorted(SCOPE_PROFILES),
        default="full-automation",
        help="Required OAuth scope profile for this check.",
    )
    args = parser.parse_args()
    payload, root = build_payload(args.video_id, args.live, args.scope_profile)
    _, md_path = write_report(root, payload)
    print(json.dumps(payload, indent=2))
    print(f"YouTube auth health report: {display_path(md_path)}")
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
