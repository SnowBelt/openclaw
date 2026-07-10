#!/usr/bin/env python3
"""Keychain-backed YouTube OAuth JSON with a safe file migration fallback."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


SERVICE = "ai.openclaw.patternlab"
TOKEN_ACCOUNT = "youtube.oauth-token-json"
CLIENT_ACCOUNT = "youtube.oauth-client-json"


def _read_keychain(account: str) -> dict[str, Any] | None:
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", SERVICE, "-a", account],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _write_keychain(account: str, value: dict[str, Any]) -> None:
    encoded = json.dumps(value, separators=(",", ":"))
    result = subprocess.run(
        ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", encoded],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Unable to save Pattern Lab OAuth data to macOS Keychain.")


def read_json_secret(path: Path, account: str) -> tuple[dict[str, Any] | None, str]:
    """Prefer Keychain; retain the existing file only during migration."""
    keychain_value = _read_keychain(account)
    if keychain_value is not None:
        return keychain_value, "keychain"
    if not path.exists():
        return None, "missing"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, "invalid_file"
    return (value, "file") if isinstance(value, dict) else (None, "invalid_file")


def write_token(path: Path, token: dict[str, Any]) -> str:
    """Persist refreshed OAuth tokens to Keychain once migration is active."""
    use_keychain = _read_keychain(TOKEN_ACCOUNT) is not None or os.environ.get("PATTERNLAB_YOUTUBE_KEYCHAIN") == "1"
    if use_keychain:
        _write_keychain(TOKEN_ACCOUNT, token)
        return "keychain"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(token, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)
    return "file"


def migrate_existing_files(token_path: Path, client_path: Path) -> dict[str, str]:
    token, token_source = read_json_secret(token_path, TOKEN_ACCOUNT)
    client, client_source = read_json_secret(client_path, CLIENT_ACCOUNT)
    if not token:
        raise RuntimeError("YouTube OAuth token is missing or invalid.")
    if not client:
        raise RuntimeError("YouTube OAuth client JSON is missing or invalid.")
    _write_keychain(TOKEN_ACCOUNT, token)
    _write_keychain(CLIENT_ACCOUNT, client)
    return {"token_source_before": token_source, "client_source_before": client_source}
