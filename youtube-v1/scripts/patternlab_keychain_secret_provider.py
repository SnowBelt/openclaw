#!/usr/bin/env python3
"""OpenClaw exec SecretRef provider backed by the macOS login keychain."""
from __future__ import annotations

import json
import subprocess
import sys


SERVICE = "ai.openclaw.patternlab"
ACCOUNTS = {
    "discord/bot-token": "discord.bot-token",
}


def read_secret(account: str) -> str:
    result = subprocess.run(
        ["security", "find-generic-password", "-w", "-s", SERVICE, "-a", account],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError("secret unavailable")
    return result.stdout.strip()


def main() -> None:
    request = json.load(sys.stdin)
    ids = request.get("ids", [])
    values, errors = {}, {}
    for identifier in ids:
        account = ACCOUNTS.get(identifier)
        if not account:
            errors[identifier] = {"message": "unsupported secret id"}
            continue
        try:
            values[identifier] = read_secret(account)
        except RuntimeError as exc:
            errors[identifier] = {"message": str(exc)}
    print(json.dumps({"protocolVersion": 1, "values": values, "errors": errors}))


if __name__ == "__main__":
    main()
