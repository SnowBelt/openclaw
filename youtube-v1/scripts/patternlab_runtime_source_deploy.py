#!/usr/bin/env python3
"""Back up, deploy, and hash-verify Pattern Lab source without touching media."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab.state import sha256_file


SOURCE_ENTRIES = (
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "agents",
    "automation",
    "channel-positioning.md",
    "launch",
    "long-form-strategy.md",
    "patternlab",
    "plugins",
    "production-grade-milestones.md",
    "requirements-python312.lock",
    "requirements-visual.lock",
    "resources",
    "scripts",
    "shorts-strategy.md",
    "skills",
    "state/monetization/content-slate.json",
    "templates",
    "third_party",
    "thumbnail-strategy.md",
    "workflows",
)
IGNORED_PARTS = frozenset(
    {
        ".DS_Store",
        ".env",
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".venv",
        ".venv-youtube",
        ".venv-youtube-3.12",
        "__pycache__",
        "local-output",
        "node_modules",
        "render",
    }
)
FORBIDDEN_NAME_MARKERS = ("client_secret", "oauth-token", "credential", "discord-token")
SAFE_SOURCE_SUFFIXES = frozenset({".js", ".md", ".mjs", ".py", ".sh", ".swift", ".ts"})
MANIFEST_NAME = "runtime-source-manifest.json"
MUTABLE_RUNTIME_PREFIXES = ("local-output/", "state/")


def selected_paths(root: Path) -> tuple[Path, ...]:
    rows: list[Path] = []
    for entry in SOURCE_ENTRIES:
        path = root / entry
        if path.is_file() or path.is_symlink():
            rows.append(path)
            continue
        if not path.is_dir():
            continue
        rows.extend(
            candidate
            for candidate in path.rglob("*")
            if (candidate.is_file() or candidate.is_symlink())
            and not any(part in IGNORED_PARTS for part in candidate.relative_to(root).parts)
        )
    return tuple(sorted(set(rows), key=lambda path: path.relative_to(root).as_posix()))


def validate_selection(root: Path, paths: tuple[Path, ...]) -> list[str]:
    blockers: list[str] = []
    if not paths:
        blockers.append("runtime_source_selection_empty")
    for path in paths:
        relative = path.relative_to(root)
        lowered = relative.as_posix().lower()
        # A source module can legitimately implement credential handling. Only
        # secret-like data/config filenames are blocked; executable source is
        # still copied and is independently secret-scanned before publication.
        if (
            any(marker in lowered for marker in FORBIDDEN_NAME_MARKERS)
            and path.suffix.lower() not in SAFE_SOURCE_SUFFIXES
        ):
            blockers.append(f"runtime_source_forbidden_secret_filename:{relative}")
        if path.is_file() and not path.is_symlink() and path.stat().st_size > 25 * 1024 * 1024:
            blockers.append(f"runtime_source_file_above_25mb:{relative}")
    return blockers


def path_digest(path: Path) -> str:
    if path.is_symlink():
        return hashlib.sha256(f"symlink:{os.readlink(path)}".encode("utf-8")).hexdigest()
    return sha256_file(path)


def source_manifest(root: Path, paths: tuple[Path, ...]) -> dict[str, str]:
    return {path.relative_to(root).as_posix(): path_digest(path) for path in paths}


def manifest_digest(files: dict[str, str]) -> str:
    payload = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def compare_target(target: Path, files: dict[str, str]) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    mismatched: list[str] = []
    for relative, expected in files.items():
        path = target / relative
        if not path.is_file() and not path.is_symlink():
            missing.append(relative)
        elif path_digest(path) != expected:
            mismatched.append(relative)
    return missing, mismatched


def backup_target(target: Path, files: dict[str, str]) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = ensure_dir(target.parent / "backups") / f"patternlab-source-{timestamp}.tar.gz"
    deployed_manifest_payload = read_json(target / MANIFEST_NAME)
    previously_deployed = deployed_manifest_payload.get("files")
    previous_paths = set(previously_deployed) if isinstance(previously_deployed, dict) else set()
    footprint = sorted(set(files) | previous_paths)
    with tarfile.open(backup, "w:gz") as archive:
        for relative in footprint:
            path = target / relative
            if path.is_file() or path.is_symlink():
                archive.add(path, arcname=relative, recursive=False)
        deployed_manifest = target / MANIFEST_NAME
        if deployed_manifest.is_file() or deployed_manifest.is_symlink():
            archive.add(deployed_manifest, arcname=MANIFEST_NAME, recursive=False)
    prior = {
        relative: path_digest(target / relative)
        if (target / relative).is_file() or (target / relative).is_symlink()
        else ""
        for relative in footprint
    }
    prior[MANIFEST_NAME] = (
        path_digest(target / MANIFEST_NAME)
        if (target / MANIFEST_NAME).is_file() or (target / MANIFEST_NAME).is_symlink()
        else ""
    )
    backup.with_suffix(backup.suffix + ".json").write_text(
        json.dumps({"schema_version": 1, "target": str(target), "prior": prior}, indent=2) + "\n",
        encoding="utf-8",
    )
    return backup


def restore_backup(target: Path, backup: Path) -> list[str]:
    metadata_path = backup.with_suffix(backup.suffix + ".json")
    metadata = read_json(metadata_path)
    prior = metadata.get("prior") if isinstance(metadata.get("prior"), dict) else {}
    blockers: list[str] = []
    if not prior:
        return ["runtime_source_rollback_metadata_missing"]
    for relative in prior:
        destination = target / relative
        if destination.is_file() or destination.is_symlink():
            destination.unlink()
    with tarfile.open(backup, "r:gz") as archive:
        archive.extractall(target, filter="data")
    for relative, expected in prior.items():
        destination = target / relative
        exists = destination.is_file() or destination.is_symlink()
        if not expected and exists:
            blockers.append(f"runtime_source_rollback_unexpected_file:{relative}")
        elif expected and (not exists or path_digest(destination) != expected):
            blockers.append(f"runtime_source_rollback_hash_mismatch:{relative}")
    return blockers


def stale_paths_from_manifest(target: Path, files: dict[str, str]) -> tuple[str, ...]:
    deployed = read_json(target / MANIFEST_NAME).get("files")
    if not isinstance(deployed, dict):
        return ()
    stale: list[str] = []
    for relative in deployed:
        path = Path(str(relative))
        normalized = path.as_posix()
        if path.is_absolute() or ".." in path.parts:
            continue
        if normalized in files or normalized.startswith(MUTABLE_RUNTIME_PREFIXES):
            continue
        stale.append(normalized)
    return tuple(sorted(stale))


def deploy(source: Path, target: Path, files: dict[str, str]) -> Path:
    stale_paths = stale_paths_from_manifest(target, files)
    backup = backup_target(target, files)
    target.mkdir(parents=True, exist_ok=True)
    try:
        for relative in files:
            origin = source / relative
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(f".{destination.name}.patternlab-deploy")
            if temporary.exists() or temporary.is_symlink():
                temporary.unlink()
            if origin.is_symlink():
                temporary.symlink_to(os.readlink(origin))
            else:
                shutil.copy2(origin, temporary)
            os.replace(temporary, destination)
        for relative in stale_paths:
            destination = target / relative
            if destination.is_file() or destination.is_symlink():
                destination.unlink()
        manifest = {
            "generated_at": utc_now(),
            "source_root": str(source),
            "source_file_count": len(files),
            "source_manifest_sha256": manifest_digest(files),
            "files": files,
            "backup": str(backup),
            "youtube_mutation": "not_performed",
        }
        manifest_path = target / MANIFEST_NAME
        temporary_manifest = manifest_path.with_suffix(".json.tmp")
        temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary_manifest, manifest_path)
    except Exception:
        rollback_blockers = restore_backup(target, backup)
        if rollback_blockers:
            raise RuntimeError("runtime_source_deploy_failed_and_rollback_failed:" + ",".join(rollback_blockers))
        raise
    return backup


def build_report(video_id: str, target: Path, *, apply: bool) -> tuple[dict[str, Any], Path]:
    source = YOUTUBE_ROOT.resolve()
    target = target.expanduser().resolve()
    paths = selected_paths(source)
    blockers = validate_selection(source, paths)
    files = source_manifest(source, paths)
    backup: Path | None = None
    rollback_performed = False
    rollback_blockers: list[str] = []
    if apply and not blockers:
        try:
            backup = deploy(source, target, files)
        except Exception as exc:
            blockers.append(f"runtime_source_deploy_exception:{type(exc).__name__}")
    missing, mismatched = compare_target(target, files)
    blockers.extend(f"runtime_source_missing:{item}" for item in missing)
    blockers.extend(f"runtime_source_stale:{item}" for item in mismatched)
    deployed_manifest = read_json(target / MANIFEST_NAME)
    if not deployed_manifest:
        blockers.append("runtime_source_deployment_manifest_missing")
    elif deployed_manifest.get("source_manifest_sha256") != manifest_digest(files):
        blockers.append("runtime_source_deployment_manifest_stale")
    deployment_blockers = [
        item
        for item in blockers
        if item.startswith("runtime_source_missing:")
        or item.startswith("runtime_source_stale:")
        or item.startswith("runtime_source_deployment_manifest_")
    ]
    if apply and backup and deployment_blockers:
        rollback_performed = True
        rollback_blockers = restore_backup(target, backup)
        blockers.append("runtime_source_deployment_verification_failed_rolled_back")
        blockers.extend(rollback_blockers)
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "mode": "backup_apply_verify" if apply else "verify_only",
        "source": str(source),
        "target": str(target),
        "source_file_count": len(files),
        "source_manifest_sha256": manifest_digest(files),
        "backup": str(backup) if backup else str(deployed_manifest.get("backup") or ""),
        "rollback_performed": rollback_performed,
        "rollback_blockers": rollback_blockers,
        "missing_files": missing,
        "mismatched_files": mismatched,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(output_root(video_id) / "approval") / "runtime-source-deployment-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy or verify Pattern Lab runtime source.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--target", default=str(Path.home() / "PatternLabRuntime" / "youtube-v1"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    payload, report = build_report(args.video_id.zfill(2), Path(args.target), apply=args.apply)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
