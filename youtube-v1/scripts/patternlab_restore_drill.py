#!/usr/bin/env python3
"""Run a no-secret, no-mutation Pattern Lab restore-confidence drill.

This is not a machine restore.  It proves that the committed orchestration
surface and current local receipts can be read without copying secrets,
rendering media, calling paid providers, or touching YouTube.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, utc_now


OPERATIONS_ROOT = BASE / "local-output" / "operations"
REQUIRED_SOURCE_FILES = (
    "scripts/patternlab_full_auto_production.py",
    "scripts/patternlab_topic_qualification_queue.py",
    "scripts/patternlab_runtime_watchdog.py",
    "resources/runtime-watchdog-policy.json",
    "automation/pattern-lab-daily-review.plist",
    "automation/pattern-lab-full-auto-production.plist",
    "automation/pattern-lab-dashboard.plist",
    "automation/pattern-lab-wake-scheduler.plist",
    "automation/pattern-lab-runtime-watchdog.plist",
)


def run(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, cwd=BASE.parent, capture_output=True, text=True, check=False, timeout=90)
    return {"command": command, "returncode": result.returncode, "stdout": result.stdout[-2000:], "stderr": result.stderr[-2000:]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Pattern Lab restore-confidence drill.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    source_checks = [{"path": path, "present": (BASE / path).exists()} for path in REQUIRED_SOURCE_FILES]
    commands = [
        run([str(BASE / ".venv-youtube-3.12/bin/python"), str(BASE / "scripts/youtube_auth_health.py"), "--video-id", args.video_id]),
        run([str(BASE / ".venv-youtube-3.12/bin/python"), str(BASE / "scripts/patternlab_topic_qualification_queue.py")]),
        run([str(BASE / ".venv-youtube-3.12/bin/python"), str(BASE / "scripts/patternlab_runtime_watchdog.py"), "--check"]),
        run([str(BASE / ".venv-youtube-3.12/bin/python"), str(BASE / "scripts/patternlab_full_auto_production.py"), "--next-scheduled", "--live-voice", "never", "--shorts-target", "3", "--dry-run"]),
    ]
    failures = [item["path"] for item in source_checks if not item["present"]]
    failures.extend("command:" + " ".join(item["command"][-2:]) for item in commands if item["returncode"] != 0)
    payload = {
        "generated_at": utc_now(), "status": "pass" if not failures else "blocked", "video_id": args.video_id,
        "source_checks": source_checks, "commands": commands, "blockers": failures,
        "secrets_copied": False, "paid_call_performed": False, "media_generated": False, "youtube_mutation": "not_performed",
        "scope": "local restore-confidence drill only; actual machine restore and launch-agent activation are separately approval-gated",
    }
    ensure_dir(OPERATIONS_ROOT)
    json_path = OPERATIONS_ROOT / "restore-drill-report.json"
    md_path = OPERATIONS_ROOT / "restore-drill-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = ["# Pattern Lab Restore Drill", "", f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", "", "## Source Surface", ""]
    lines.extend([f"- {item['path']}: {'pass' if item['present'] else 'missing'}" for item in source_checks])
    lines.extend(["", "## Command Results", ""])
    lines.extend([f"- {' '.join(item['command'][-2:])}: {'pass' if item['returncode'] == 0 else 'blocked'}" for item in commands])
    lines.extend(["", "Secrets copied: no", "Paid call: no", "Media generated: no", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {payload['status']}")
    print(f"Restore drill report: {display_path(md_path)}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
