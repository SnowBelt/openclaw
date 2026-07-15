#!/usr/bin/env python3
"""Install and verify only the canonical Pattern Lab user LaunchAgents."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from patternlab_common import BASE, display_path, ensure_dir, utc_now


AUTOMATION_ROOT = BASE / "automation"
OPERATIONS_ROOT = BASE / "local-output" / "operations"
CANONICAL_PLISTS = (
    "pattern-lab-daily-review.plist",
    "pattern-lab-dashboard.plist",
    "pattern-lab-full-auto-production.plist",
    "pattern-lab-runtime-watchdog.plist",
)
CANONICAL_LABELS = (
    "com.openclaw.patternlab-v2.daily-review",
    "com.openclaw.patternlab-v2.dashboard",
    "com.openclaw.patternlab-v2.full-auto-production",
    "com.openclaw.patternlab-v2.runtime-watchdog",
)
LEGACY_LABELS = (
    "com.openclaw.pattern-lab.daily-review",
    "com.openclaw.pattern-lab.dashboard",
    "com.openclaw.pattern-lab.full-auto-production",
    "com.openclaw.pattern-lab.runtime-watchdog",
    "com.openclaw.pattern-lab.wake-scheduler",
    "com.openclaw.pattern-lab-daily-review",
    "com.openclaw.pattern-lab-dashboard",
    "com.openclaw.pattern-lab-full-auto-production",
    "com.openclaw.pattern-lab-runtime-watchdog",
)
MATCHING_GLOBS = (
    "com.openclaw.pattern-lab*.plist",
    "com.openclaw.patternlab-v2*.plist",
)


def read_plist(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            payload = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException):
        return {}
    return payload if isinstance(payload, dict) else {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_command(command: list[str], runner: Callable[..., Any]) -> dict[str, Any]:
    try:
        result = runner(command, capture_output=True, text=True, check=False, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "command": command, "error": str(exc)}
    return {
        "ok": result.returncode == 0,
        "command": command,
        "returncode": result.returncode,
        "stdout": (result.stdout or "").strip()[:2000],
        "stderr": (result.stderr or "").strip()[:2000],
    }


def canonical_rows(automation_root: Path = AUTOMATION_ROOT) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for filename, expected_label in zip(CANONICAL_PLISTS, CANONICAL_LABELS, strict=True):
        source = automation_root / filename
        payload = read_plist(source)
        label = str(payload.get("Label") or "")
        arguments = payload.get("ProgramArguments") if isinstance(payload.get("ProgramArguments"), list) else []
        rows.append(
            {
                "source": source,
                "label": label,
                "expected_label": expected_label,
                "arguments": [str(item) for item in arguments],
                "source_sha256": sha256_file(source) if source.is_file() else "",
                "valid": bool(source.is_file() and label == expected_label and arguments),
            }
        )
    return tuple(rows)


def matching_installed_files(launch_agents_dir: Path) -> tuple[Path, ...]:
    rows: set[Path] = set()
    for pattern in MATCHING_GLOBS:
        rows.update(path for path in launch_agents_dir.glob(pattern) if path.is_file() or path.is_symlink())
    return tuple(sorted(rows))


def backup_installed_files(launch_agents_dir: Path, paths: tuple[Path, ...]) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = launch_agents_dir / "PatternLabBackups" / timestamp
    backup.mkdir(parents=True, exist_ok=False)
    for path in paths:
        shutil.copy2(path, backup / path.name, follow_symlinks=False)
    return backup


def latest_backup(launch_agents_dir: Path) -> Path | None:
    root = launch_agents_dir / "PatternLabBackups"
    if not root.is_dir():
        return None
    backups = sorted(path for path in root.iterdir() if path.is_dir())
    return backups[-1] if backups else None


def verify_installation(
    launch_agents_dir: Path,
    uid: int,
    *,
    automation_root: Path = AUTOMATION_ROOT,
    runner: Callable[..., Any] = subprocess.run,
) -> tuple[list[dict[str, Any]], list[str]]:
    blockers: list[str] = []
    rows: list[dict[str, Any]] = []
    canonical_destinations: set[Path] = set()
    for canonical in canonical_rows(automation_root):
        label = canonical["expected_label"]
        destination = launch_agents_dir / f"{label}.plist"
        canonical_destinations.add(destination)
        installed = read_plist(destination)
        source_hash = canonical["source_sha256"]
        installed_hash = sha256_file(destination) if destination.is_file() else ""
        probe = run_command(["launchctl", "print", f"gui/{uid}/{label}"], runner)
        expected_program = canonical["arguments"][1] if len(canonical["arguments"]) > 1 else ""
        loaded_matches = bool(probe.get("ok") and expected_program and expected_program in probe.get("stdout", ""))
        status = "pass"
        if not canonical["valid"]:
            blockers.append(f"canonical_launchagent_invalid:{label}")
            status = "blocked"
        if installed.get("Label") != label:
            blockers.append(f"installed_launchagent_missing_or_invalid:{label}")
            status = "blocked"
        if not source_hash or installed_hash != source_hash:
            blockers.append(f"installed_launchagent_hash_mismatch:{label}")
            status = "blocked"
        if not loaded_matches:
            blockers.append(f"launchagent_not_loaded_or_wrong_program:{label}")
            status = "blocked"
        rows.append(
            {
                "label": label,
                "source": str(canonical["source"]),
                "destination": str(destination),
                "source_sha256": source_hash,
                "installed_sha256": installed_hash,
                "loaded_program_match": loaded_matches,
                "probe": probe,
                "status": status,
            }
        )
    for path in matching_installed_files(launch_agents_dir):
        if path not in canonical_destinations:
            blockers.append(f"obsolete_or_malformed_launchagent_file:{path.name}")
    return rows, sorted(set(blockers))


def restore_files(launch_agents_dir: Path, backup: Path) -> list[str]:
    blockers: list[str] = []
    for path in matching_installed_files(launch_agents_dir):
        path.unlink()
    for source in backup.iterdir():
        if not source.is_file():
            continue
        destination = launch_agents_dir / source.name
        shutil.copy2(source, destination)
        if sha256_file(destination) != sha256_file(source):
            blockers.append(f"launchagent_rollback_hash_mismatch:{source.name}")
    return blockers


def apply_installation(
    launch_agents_dir: Path,
    uid: int,
    *,
    automation_root: Path = AUTOMATION_ROOT,
    runner: Callable[..., Any] = subprocess.run,
) -> tuple[Path, list[dict[str, Any]], list[str], bool, list[str]]:
    launch_agents_dir.mkdir(parents=True, exist_ok=True)
    installed_before = matching_installed_files(launch_agents_dir)
    backup = backup_installed_files(launch_agents_dir, installed_before)
    operations: list[dict[str, Any]] = []
    rollback_performed = False
    rollback_blockers: list[str] = []
    all_labels = tuple(dict.fromkeys((*CANONICAL_LABELS, *LEGACY_LABELS)))
    loaded_before = {
        label
        for label in all_labels
        if run_command(["launchctl", "print", f"gui/{uid}/{label}"], runner).get("ok")
    }
    try:
        for label in all_labels:
            operations.append(run_command(["launchctl", "bootout", f"gui/{uid}/{label}"], runner))
        for path in installed_before:
            path.unlink()
        for canonical in canonical_rows(automation_root):
            if not canonical["valid"]:
                raise RuntimeError(f"canonical_launchagent_invalid:{canonical['expected_label']}")
            destination = launch_agents_dir / f"{canonical['expected_label']}.plist"
            shutil.copy2(canonical["source"], destination)
            destination.chmod(0o644)
            operation = run_command(["launchctl", "bootstrap", f"gui/{uid}", str(destination)], runner)
            operations.append(operation)
            if not operation.get("ok"):
                raise RuntimeError(f"launchagent_bootstrap_failed:{canonical['expected_label']}")
        rows, blockers = verify_installation(
            launch_agents_dir,
            uid,
            automation_root=automation_root,
            runner=runner,
        )
        if blockers:
            raise RuntimeError("launchagent_verification_failed:" + ",".join(blockers))
        return backup, operations, [], rollback_performed, rollback_blockers
    except Exception as exc:
        rollback_performed = True
        for label in CANONICAL_LABELS:
            operations.append(run_command(["launchctl", "bootout", f"gui/{uid}/{label}"], runner))
        rollback_blockers = restore_files(launch_agents_dir, backup)
        restored_by_label = {
            str(payload.get("Label")): path
            for path in matching_installed_files(launch_agents_dir)
            if (payload := read_plist(path)).get("Label")
        }
        for label in sorted(loaded_before):
            restored = restored_by_label.get(label)
            if restored is None:
                rollback_blockers.append(f"launchagent_rollback_loaded_file_missing:{label}")
                continue
            operation = run_command(["launchctl", "bootstrap", f"gui/{uid}", str(restored)], runner)
            operations.append(operation)
            if not operation.get("ok"):
                rollback_blockers.append(f"launchagent_rollback_bootstrap_failed:{label}")
        return backup, operations, [str(exc)], rollback_performed, rollback_blockers


def build_report(
    *,
    apply: bool,
    launch_agents_dir: Path | None = None,
    uid: int | None = None,
    automation_root: Path = AUTOMATION_ROOT,
    runner: Callable[..., Any] = subprocess.run,
) -> tuple[dict[str, Any], Path]:
    launch_agents_dir = launch_agents_dir or (Path.home() / "Library" / "LaunchAgents")
    uid = os.getuid() if uid is None else uid
    backup: Path | None = None
    operations: list[dict[str, Any]] = []
    apply_blockers: list[str] = []
    rollback_performed = False
    rollback_blockers: list[str] = []
    if apply:
        backup, operations, apply_blockers, rollback_performed, rollback_blockers = apply_installation(
            launch_agents_dir,
            uid,
            automation_root=automation_root,
            runner=runner,
        )
    rows, blockers = verify_installation(
        launch_agents_dir,
        uid,
        automation_root=automation_root,
        runner=runner,
    )
    blockers.extend(apply_blockers)
    blockers.extend(rollback_blockers)
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "mode": "backup_apply_verify" if apply else "verify_only",
        "uid": uid,
        "launch_agents_dir": str(launch_agents_dir),
        "backup": str(backup or latest_backup(launch_agents_dir) or ""),
        "canonical_labels": list(CANONICAL_LABELS),
        "agents": rows,
        "operations": operations,
        "rollback_performed": rollback_performed,
        "rollback_blockers": rollback_blockers,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(OPERATIONS_ROOT) / "launchd-install-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Install or verify canonical Pattern Lab user LaunchAgents.")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    payload, report = build_report(apply=args.apply)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
