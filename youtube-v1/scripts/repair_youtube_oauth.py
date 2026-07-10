#!/usr/bin/env python3
"""Beginner-safe Pattern Lab YouTube OAuth repair wrapper.

This wrapper never uploads to YouTube. It delegates to generate_youtube_oauth_token.py
with deterministic defaults that avoid the MacBook/Mac Studio localhost trap.
"""
import argparse
import subprocess
import sys
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
DEFAULT_PORT = 53682
DEFAULT_ACCOUNT_EMAIL = "patternlabus@gmail.com"


def main():
    parser = argparse.ArgumentParser(
        description="Repair Pattern Lab YouTube OAuth locally. Never uploads, publishes, comments, pins, or changes YouTube."
    )
    parser.add_argument("--video-id", default="04")
    parser.add_argument(
        "--scope-profile",
        choices=["analytics-readonly", "full-automation"],
        default="full-automation",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--account-email", default=DEFAULT_ACCOUNT_EMAIL)
    parser.add_argument(
        "--no-open-browser",
        action="store_true",
        default=True,
        help="Print the auth URL. This is the safest default for remote/screen-sharing sessions.",
    )
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Ask Python to open the browser on this same machine instead of printing only.",
    )
    parser.add_argument(
        "--macbook-tunnel-host",
        default="",
        help="Optional SSH host to include a MacBook tunnel command in the printed instructions.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the delegated command without opening a browser or writing a token.")
    args = parser.parse_args()

    command = [
        sys.executable,
        str(BASE / "scripts" / "generate_youtube_oauth_token.py"),
        "--scope-profile",
        args.scope_profile,
        "--video-id",
        args.video_id,
        "--port",
        str(args.port),
        "--account-email",
        args.account_email,
    ]
    if not args.open_browser:
        command.append("--no-open-browser")
    if args.macbook_tunnel_host:
        command.extend(["--macbook-tunnel-host", args.macbook_tunnel_host])
    if args.dry_run:
        command.append("--dry-run")

    print("Pattern Lab YouTube OAuth repair", flush=True)
    print("YouTube mutation: not_performed", flush=True)
    print("Beginner rule: open the approval URL on the same machine running this command unless a tunnel is active.", flush=True)
    return subprocess.call(command, cwd=BASE.parent)


if __name__ == "__main__":
    raise SystemExit(main())
