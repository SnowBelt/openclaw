#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
ENV_PATH = BASE / ".env"
DEFAULT_CALLBACK_HOST = "127.0.0.1"
DEFAULT_CALLBACK_PORT = 53682
DEFAULT_ACCOUNT_EMAIL = "patternlabus@gmail.com"
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

SCOPE_LABELS = {
    "analytics-readonly": "youtube.readonly, yt-analytics.readonly",
    "full-automation": "youtube.upload, youtube.readonly, youtube.force-ssl, yt-analytics.readonly",
}
SENSITIVE_KEYS = {"access_token", "refresh_token", "client_secret"}


def read_env():
    values = {}
    if not ENV_PATH.exists():
        raise SystemExit("Missing youtube-v1/.env")
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def resolve_local_path(value, label):
    if not value or value == "replace_me":
        raise SystemExit(f"{label} is not configured in youtube-v1/.env")
    path = Path(value)
    if not path.is_absolute():
        path = BASE / path
    return path


def read_json(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"JSON file is invalid: {path}: {exc}") from exc


def validate_client_secrets(path):
    data = read_json(path)
    if data is None:
        raise SystemExit(f"YouTube OAuth client secrets file is missing: {path}")
    client = data.get("installed")
    if not isinstance(client, dict):
        raise SystemExit("YouTube OAuth client must be a Desktop app client with an installed block.")
    required = ["client_id", "client_secret", "auth_uri", "token_uri"]
    missing = [key for key in required if not client.get(key)]
    if missing:
        raise SystemExit(f"YouTube OAuth client secrets file is missing: {', '.join(missing)}")
    return client


def token_client_id(path):
    token = read_json(path)
    if not isinstance(token, dict):
        return ""
    return token.get("client_id", "")


def timestamp_slug():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def backup_existing_token(token_path, backup_dir):
    if not token_path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"{token_path.stem}.{timestamp_slug()}{token_path.suffix}"
    shutil.copy2(token_path, backup_path)
    os.chmod(backup_path, stat.S_IRUSR | stat.S_IWUSR)
    return backup_path


def write_token(path, credentials, backup_dir):
    path.parent.mkdir(parents=True, exist_ok=True)
    backup_path = backup_existing_token(path, backup_dir)
    path.write_text(credentials.to_json(), encoding="utf-8")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    return backup_path


def validate_port(value):
    port = int(value)
    if port < 0 or port > 65535:
        raise argparse.ArgumentTypeError("port must be between 0 and 65535")
    return port


def check_port_available(host, port):
    if port == 0:
        return True, "random available port selected by the OS"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError as exc:
            if getattr(exc, "errno", None) in (1, 13):
                return True, f"not prechecked in this sandbox: {exc}"
            return False, str(exc)
    return True, "available"


def print_beginner_instructions(args, token_file, client_id, existing_token_client_id):
    callback = f"http://{args.host}:{args.port or '<random-port>'}/"
    print("\nOAuth safety instructions:")
    print(f"- Run machine: this terminal on the Mac Studio.")
    print(f"- Browser to use: Chrome on the Mac Studio, unless you intentionally created a tunnel.")
    print(f"- Google account to choose: {args.account_email}.")
    print(f"- Callback URL pattern: {callback}")
    print("- Do not open the Google URL on the MacBook unless a tunnel is active.")
    print("- Do not reuse an old Google URL after this command exits.")
    if args.macbook_tunnel_host:
        print("\nMacBook tunnel option:")
        print("1. Keep this command running on the Mac Studio.")
        print("2. In a separate MacBook terminal, run:")
        print(f"   ssh -L {args.port}:{args.host}:{args.port} {args.macbook_tunnel_host}")
        print("3. Only then open the Google URL on the MacBook.")
    print("\nOAuth file state:")
    print(f"- Configured client ID: {client_id}")
    print(f"- Token file target: {token_file.relative_to(BASE)}")
    print(f"- Existing token client ID: {existing_token_client_id or 'none'}")
    if existing_token_client_id and existing_token_client_id != client_id:
        print("- Existing token mismatch: yes; the new token will replace it after successful approval.")
    elif existing_token_client_id:
        print("- Existing token mismatch: no; the existing token will still be backed up before replacement.")
    else:
        print("- Existing token: none")


def run_health_check(video_id, scope_profile):
    script = BASE / "scripts" / "youtube_auth_health.py"
    command = [
        sys.executable,
        str(script),
        "--video-id",
        video_id,
        "--scope-profile",
        scope_profile,
    ]
    result = subprocess.run(command, cwd=BASE.parent, text=True, capture_output=True)
    print("\nPost-generation OAuth health check:")
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode != 0:
        raise SystemExit(f"OAuth token was written, but health verification failed with exit code {result.returncode}.")


def main():
    parser = argparse.ArgumentParser(
        description="Generate the local Pattern Lab YouTube OAuth upload token. Never uploads to YouTube."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--no-open-browser",
        action="store_true",
        help="Print the auth URL instead of asking Python to open the browser.",
    )
    parser.add_argument(
        "--scope-profile",
        choices=sorted(SCOPE_PROFILES),
        default="full-automation",
        help="OAuth scope set to request. Use analytics-readonly for read-only Analytics setup.",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_CALLBACK_HOST,
        help=f"OAuth callback host. Default: {DEFAULT_CALLBACK_HOST}.",
    )
    parser.add_argument(
        "--port",
        type=validate_port,
        default=DEFAULT_CALLBACK_PORT,
        help=f"OAuth callback port. Default: {DEFAULT_CALLBACK_PORT}. Use 0 for a random port.",
    )
    parser.add_argument(
        "--account-email",
        default=DEFAULT_ACCOUNT_EMAIL,
        help=f"Google account hint shown to OAuth. Default: {DEFAULT_ACCOUNT_EMAIL}.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=900,
        help="Seconds to wait for browser approval before failing. Default: 900.",
    )
    parser.add_argument(
        "--backup-dir",
        default="local-output/oauth-backups",
        help="Directory for token backups before replacement.",
    )
    parser.add_argument(
        "--video-id",
        default="04",
        help="Video id used for the post-generation OAuth health report. Default: 04.",
    )
    parser.add_argument(
        "--skip-health-check",
        action="store_true",
        help="Skip the local post-generation youtube_auth_health.py verification.",
    )
    parser.add_argument(
        "--macbook-tunnel-host",
        default="",
        help="Optional SSH host for printing a MacBook tunnel command.",
    )
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds must be greater than 0")

    values = read_env()
    client_secrets = resolve_local_path(values.get("YOUTUBE_CLIENT_SECRETS_FILE"), "YOUTUBE_CLIENT_SECRETS_FILE")
    token_file = resolve_local_path(values.get("YOUTUBE_TOKEN_FILE"), "YOUTUBE_TOKEN_FILE")
    backup_dir = resolve_local_path(args.backup_dir, "--backup-dir")
    client = validate_client_secrets(client_secrets)
    client_id = client["client_id"]
    existing_token_client_id = token_client_id(token_file)

    available, reason = check_port_available(args.host, args.port)
    if not available:
        raise SystemExit(
            f"OAuth callback port {args.host}:{args.port} is not available: {reason}. "
            "Close the process using that port or rerun with --port 0 for a random port."
        )

    print("YouTube OAuth client: configured")
    print(f"Token file target: {token_file.relative_to(BASE)}")
    print(f"Scope profile: {args.scope_profile}")
    print(f"Scopes: {SCOPE_LABELS[args.scope_profile]}")
    print(f"Callback host: {args.host}")
    print(f"Callback port: {args.port}")
    print(f"Approval timeout: {args.timeout_seconds} seconds")
    print_beginner_instructions(args, token_file, client_id, existing_token_client_id)
    if args.dry_run:
        print("\nDry run only. No browser opened and no token written.")
        return

    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), SCOPE_PROFILES[args.scope_profile])
    prompt = "consent select_account"
    credentials = flow.run_local_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_open_browser,
        prompt=prompt,
        login_hint=args.account_email,
        access_type="offline",
        timeout_seconds=args.timeout_seconds,
    )
    backup_path = write_token(token_file, credentials, backup_dir)
    print("YouTube OAuth token written with owner-only permissions.")
    print(f"Token file: {token_file.relative_to(BASE)}")
    if backup_path:
        print(f"Previous token backup: {backup_path.relative_to(BASE)}")
    else:
        print("Previous token backup: none; no prior token existed.")
    if not args.skip_health_check:
        run_health_check(args.video_id, args.scope_profile)
    print("OAuth repair completed locally. YouTube mutation: not_performed")


if __name__ == "__main__":
    main()
