#!/usr/bin/env python3
"""Create a fail-closed Pattern Lab runtime-health receipt.

Default mode is inspection only.  Recovery and Discord alerts are deliberately
disabled by policy and require explicit future activation; neither path can
invoke a YouTube mutation.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from patternlab_common import BASE, display_path, ensure_dir, utc_now


POLICY_PATH = BASE / "resources" / "runtime-watchdog-policy.json"
OPERATIONS_ROOT = BASE / "local-output" / "operations"
OPENCLAW_BIN = "/Users/openclaw/.npm-global/bin/openclaw"
STATE_PATH = OPERATIONS_ROOT / "runtime-watchdog-state.json"


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


def write_report(payload: dict[str, Any]) -> tuple[Path, Path]:
    ensure_dir(OPERATIONS_ROOT)
    json_path = OPERATIONS_ROOT / "runtime-health-report.json"
    md_path = OPERATIONS_ROOT / "runtime-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = ["# Pattern Lab Runtime Health", "", f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", f"Mode: {payload['mode']}", "", "## Checks", ""]
    for check in payload["checks"]:
        lines.append(f"- {check['name']}: {check['status']}")
    lines.extend(["", f"Recovery: {payload['recovery'].get('reason', 'not performed')}", f"Discord alert: {payload['discord_alert'].get('reason', 'not performed')}", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def launch_agent_checks(policy: dict[str, Any], runner: Callable[..., Any]) -> list[dict[str, Any]]:
    uid = str(os.getuid())
    checks: list[dict[str, Any]] = []
    for label in policy.get("launch_agents", []):
        probe = run_command(["launchctl", "print", f"gui/{uid}/{label}"], runner)
        output = f"{probe.get('stdout', '')}\n{probe.get('stderr', '')}"
        exit_match = re.search(r"last exit code = (\d+)", output)
        exit_code = int(exit_match.group(1)) if exit_match else None
        status = "pass" if probe.get("ok") and (exit_code in {None, 0}) else "blocked"
        checks.append({"name": f"launch_agent:{label}", "status": status, "label": label, "last_exit_code": exit_code, "probe": probe})
    return checks


def read_state() -> dict[str, Any]:
    return read_json(STATE_PATH)


def write_state(state: dict[str, Any]) -> None:
    ensure_dir(STATE_PATH.parent)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def apply_safe_recovery(payload: dict[str, Any], policy: dict[str, Any], runner: Callable[..., Any]) -> None:
    if not policy.get("watchdog", {}).get("allow_launchd_recovery"):
        payload["recovery"] = {"performed": False, "reason": "recovery disabled by policy"}
        return
    failures = [check for check in payload["checks"] if check.get("name", "").startswith("launch_agent:") and check.get("status") == "blocked"]
    if not failures:
        payload["recovery"] = {"performed": False, "reason": "no failed Pattern Lab LaunchAgent"}
        return
    uid = str(os.getuid())
    results = []
    for failure in failures:
        # Missing agents cannot be bootstrapped safely from a watchdog. They
        # require the canonical installer; only an already-loaded failing job
        # may receive one kickstart attempt.
        if not failure.get("probe", {}).get("ok"):
            results.append({"label": failure["label"], "performed": False, "reason": "agent_missing_manual_install_required"})
            continue
        result = run_command(["launchctl", "kickstart", "-k", f"gui/{uid}/{failure['label']}"], runner)
        results.append({"label": failure["label"], "performed": bool(result.get("ok")), "probe": result})
    payload["recovery"] = {"performed": any(item.get("performed") for item in results), "reason": "bounded_launchagent_recovery", "results": results}


def maybe_send_alert(payload: dict[str, Any], policy: dict[str, Any], runner: Callable[..., Any]) -> None:
    settings = policy.get("watchdog", {}) if isinstance(policy.get("watchdog"), dict) else {}
    problems = [*payload.get("blockers", []), *payload.get("warnings", [])]
    if not settings.get("allow_discord_alerts"):
        payload["discord_alert"] = {"performed": False, "reason": "alerts disabled by policy"}
        return
    if not problems:
        payload["discord_alert"] = {"performed": False, "reason": "no actionable runtime problem"}
        return
    fingerprint = "|".join(sorted(problems))
    state = read_state()
    if state.get("last_alert_fingerprint") == fingerprint:
        try:
            then = datetime.fromisoformat(str(state.get("last_alert_at", "")).replace("Z", "+00:00"))
            elapsed = (datetime.now(timezone.utc) - then).total_seconds() / 60
        except ValueError:
            elapsed = 0
        cooldown = float(settings.get("alert_cooldown_minutes", 360))
        if elapsed < cooldown:
            payload["discord_alert"] = {"performed": False, "reason": "deduplicated_same_problem", "fingerprint": fingerprint, "cooldown_remaining_minutes": round(cooldown - elapsed, 1)}
            return
    target = str(settings.get("alert_target") or "").strip()
    if not target.startswith("channel:"):
        payload["discord_alert"] = {"performed": False, "reason": "invalid_alert_target"}
        return
    message = "Pattern Lab runtime alert: " + ", ".join(problems) + ". No YouTube action was performed."
    result = run_command([OPENCLAW_BIN, "message", "send", "--channel", "discord", "--target", target, "--message", message], runner)
    payload["discord_alert"] = {"performed": bool(result.get("ok")), "reason": "actionable_problem_alert" if result.get("ok") else "alert_send_failed", "fingerprint": fingerprint, "probe": result}
    if result.get("ok"):
        state["last_alert_fingerprint"] = fingerprint
        state["last_alert_at"] = utc_now()
        write_state(state)


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
    gateway = run_command([OPENCLAW_BIN, "gateway", "status", "--json"], runner)
    checks.append({"name": "gateway_status", "status": "pass" if gateway.get("ok") else "warning", "probe": gateway})
    checks.extend(launch_agent_checks(policy, runner))
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
    json_path, md_path = write_report(payload)
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a local Pattern Lab runtime-health receipt.")
    parser.add_argument("--check", action="store_true", help="Required: inspection-only health check.")
    parser.add_argument("--recover", action="store_true", help="Use only bounded LaunchAgent recovery allowed by policy.")
    parser.add_argument("--alert", action="store_true", help="Send one deduplicated Discord alert for an actionable failure.")
    args = parser.parse_args()
    if not args.check:
        raise SystemExit("Pass --check. Recovery and alerts require a separately approved activation command.")
    payload, _json_path, md_path = build_report()
    policy = read_json(POLICY_PATH)
    if args.recover:
        apply_safe_recovery(payload, policy, subprocess.run)
    if args.alert:
        maybe_send_alert(payload, policy, subprocess.run)
    payload["mode"] = "bounded_recovery_and_alerts" if (args.recover or args.alert) else "inspection_only"
    blockers = [check["name"] for check in payload["checks"] if check.get("status") == "blocked"]
    warnings = [check["name"] for check in payload["checks"] if check.get("status") == "warning"]
    payload["blockers"] = blockers
    payload["warnings"] = warnings
    payload["status"] = "pass" if not blockers else "blocked"
    _json_path, md_path = write_report(payload)
    print(f"Status: {payload['status']}")
    print(f"Runtime health report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
