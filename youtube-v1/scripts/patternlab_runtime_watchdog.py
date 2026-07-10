#!/usr/bin/env python3
"""Create a fail-closed Pattern Lab runtime-health receipt.

Default mode is inspection only.  Recovery and Discord alerts are deliberately
disabled by policy and require explicit future activation; neither path can
invoke a YouTube mutation.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from patternlab_common import BASE, display_path, ensure_dir, utc_now


POLICY_PATH = BASE / "resources" / "runtime-watchdog-policy.json"
OPERATIONS_ROOT = BASE / "local-output" / "operations"


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def age_minutes(path: Path) -> float | None:
    if not path.exists():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return round((datetime.now(timezone.utc) - modified).total_seconds() / 60, 1)


def run_command(command: list[str], runner: Callable[..., Any] = subprocess.run) -> dict[str, Any]:
    try:
        result = runner(command, capture_output=True, text=True, check=False, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "command": command, "error": str(exc)}
    return {
        "ok": result.returncode == 0,
        "command": command,
        "returncode": result.returncode,
        "stdout": (result.stdout or "").strip()[:1000],
        "stderr": (result.stderr or "").strip()[:1000],
    }


def build_report(runner: Callable[..., Any] = subprocess.run) -> tuple[dict[str, Any], Path, Path]:
    policy = read_json(POLICY_PATH)
    settings = policy.get("watchdog", {}) if isinstance(policy.get("watchdog"), dict) else {}
    free_gb = round(shutil.disk_usage(BASE).free / 1024**3, 2)
    min_gb = float(settings.get("minimum_free_disk_gb", 20))
    auth_report = BASE / "local-output" / "video-04" / "approval" / "youtube-auth-health-report.json"
    queue_report = OPERATIONS_ROOT / "topic-qualification-queue.json"
    auth = read_json(auth_report)
    queue = read_json(queue_report)
    token = auth.get("token", {}) if isinstance(auth.get("token"), dict) else {}
    oauth_configured = bool(
        auth.get("status") in {"configured", "verified"}
        and token.get("present")
        and token.get("has_refresh_token")
        and not token.get("missing_scopes")
    )
    checks: list[dict[str, Any]] = [
        {"name": "policy", "status": "pass" if policy else "blocked", "detail": str(POLICY_PATH)},
        {"name": "disk_free", "status": "pass" if free_gb >= min_gb else "blocked", "free_gb": free_gb, "minimum_gb": min_gb},
        {
            "name": "youtube_oauth_receipt",
            "status": "pass" if oauth_configured else "blocked",
            "report_age_minutes": age_minutes(auth_report),
            "live": auth.get("live"),
            "receipt_status": auth.get("status"),
        },
        {
            "name": "topic_queue_receipt",
            "status": "pass" if queue.get("status") == "pass" else "blocked",
            "report_age_minutes": age_minutes(queue_report),
            "selection_mode": queue.get("selection_mode"),
        },
    ]
    # This command is a read-only status check.  It is intentionally not a
    # prerequisite for local media work, because a missing CLI must surface as
    # a durable blocker rather than causing a hidden configuration rewrite.
    gateway = run_command(["openclaw", "gateway", "status", "--json"], runner)
    checks.append({"name": "gateway_status", "status": "pass" if gateway.get("ok") else "warning", "probe": gateway})
    blockers = [check["name"] for check in checks if check.get("status") == "blocked"]
    warnings = [check["name"] for check in checks if check.get("status") == "warning"]
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "mode": "inspection_only",
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "recovery": {"performed": False, "reason": "recovery disabled by policy"},
        "discord_alert": {"performed": False, "reason": "alerts disabled by policy"},
        "youtube_mutation": "not_performed",
        "automation_boundary": "This watchdog only writes a local health receipt in default mode.",
    }
    ensure_dir(OPERATIONS_ROOT)
    json_path = OPERATIONS_ROOT / "runtime-health-report.json"
    md_path = OPERATIONS_ROOT / "runtime-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = ["# Pattern Lab Runtime Health", "", f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", "Mode: inspection only", "", "## Checks", ""]
    for check in checks:
        lines.append(f"- {check['name']}: {check['status']}")
    lines.extend(["", "Recovery: not performed", "Discord alert: not performed", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a local Pattern Lab runtime-health receipt.")
    parser.add_argument("--check", action="store_true", help="Required: inspection-only health check.")
    args = parser.parse_args()
    if not args.check:
        raise SystemExit("Pass --check. Recovery and alerts require a separately approved activation command.")
    payload, _json_path, md_path = build_report()
    print(f"Status: {payload['status']}")
    print(f"Runtime health report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
