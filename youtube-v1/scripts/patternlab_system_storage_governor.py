#!/usr/bin/env python3
"""Dry-run-first storage retention for Codex backups and operations-memory backups.

This tool deliberately does not touch Kalshi data, active runtimes, models, or
Pattern Lab media. Destructive modes are explicit and emit a pre-action receipt.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import glob
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BASE = Path(__file__).resolve().parents[1]
POLICY_PATH = BASE / "resources" / "system-storage-governor-policy.json"
GIB = 1024**3


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    try:
        result = subprocess.run(
            ["/usr/bin/du", "-sk", str(path)],
            text=True,
            capture_output=True,
            timeout=10 * 60,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.split()[0]) * 1024
    except (ValueError, subprocess.TimeoutExpired):
        pass
    total = 0
    for candidate in path.rglob("*"):
        try:
            if candidate.is_file() and not candidate.is_symlink():
                total += candidate.stat().st_size
        except OSError:
            continue
    return total


def top_level_directories(root: Path) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        return []
    rows = [path for path in root.iterdir() if path.is_dir() and not path.is_symlink()]
    return sorted(rows, key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)


def operations_directories(root: Path) -> list[Path]:
    """Order canonical backups by the timestamp encoded in their stable name.

    Archiving adds files to the directory and therefore changes directory mtime;
    mtime ordering would make retention drift between repeated runs.
    """
    if not root.is_dir() or root.is_symlink():
        return []
    rows = [
        path
        for path in root.iterdir()
        if path.is_dir() and not path.is_symlink() and path.name.startswith("operations-memory-")
    ]
    return sorted(rows, key=lambda path: path.name, reverse=True)


def purpose_hint(path: Path) -> str:
    name = path.name.lower()
    hints = {
        "project-chat": "Codex project-chat state rollback",
        "program-manager": "Program Manager task recovery",
        "codex-host-services": "Codex host-services repair rollback",
        "custom-surfaces": "OpenClaw custom runtime surfaces rollback",
        "runtime": "OpenClaw runtime rollback",
        "pcc": "PCC state/runtime rollback",
        "sync": "Codex application synchronization rollback",
    }
    return next((description for token, description in hints.items() if token in name), "repair rollback snapshot")


def lsof_open(path: Path) -> bool:
    try:
        result = subprocess.run(
            ["/usr/sbin/lsof", "+D", str(path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return True


def codex_plan(roots: Iterable[Path], keep: int) -> dict[str, Any]:
    root_plans: list[dict[str, Any]] = []
    for root in roots:
        entries = top_level_directories(root)
        rows = []
        for index, path in enumerate(entries):
            stat = path.stat()
            rows.append(
                {
                    "path": str(path),
                    "name": path.name,
                    "purpose": purpose_hint(path),
                    "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "bytes": tree_bytes(path),
                    "decision": "retain" if index < keep else "delete",
                }
            )
        root_plans.append(
            {
                "root": str(root),
                "keep_newest": keep,
                "entries": rows,
                "delete_bytes": sum(row["bytes"] for row in rows if row["decision"] == "delete"),
            }
        )
    return {
        "roots": root_plans,
        "delete_bytes": sum(row["delete_bytes"] for row in root_plans),
    }


def safe_remove_backup(path: Path, allowed_root: Path) -> None:
    resolved = path.resolve()
    root = allowed_root.resolve()
    if path.is_symlink() or root not in resolved.parents or resolved.parent != root:
        raise RuntimeError(f"unsafe_backup_path:{path}")
    if lsof_open(path):
        raise RuntimeError(f"backup_has_open_files_or_could_not_prove_closed:{path}")
    shutil.rmtree(path)


def zstd_binary() -> str:
    for candidate in ("/opt/homebrew/bin/zstd", "/usr/local/bin/zstd", "/usr/bin/zstd"):
        if Path(candidate).is_file():
            return candidate
    found = shutil.which("zstd")
    if not found:
        raise RuntimeError("zstd_not_installed")
    return found


def verify_zstd_roundtrip(archive: Path, expected_sha256: str) -> str:
    process = subprocess.Popen([zstd_binary(), "-q", "-d", "-c", str(archive)], stdout=subprocess.PIPE)
    assert process.stdout is not None
    digest = hashlib.sha256()
    for chunk in iter(lambda: process.stdout.read(4 * 1024 * 1024), b""):
        digest.update(chunk)
    return_code = process.wait()
    actual = digest.hexdigest()
    if return_code != 0 or actual != expected_sha256:
        raise RuntimeError(f"zstd_roundtrip_verification_failed:{archive}:{return_code}:{actual}")
    return actual


def archive_operations_database(directory: Path, *, level: int) -> dict[str, Any]:
    source = directory / "operations_memory.db"
    archive = directory / "operations_memory.db.zst"
    manifest_path = directory / "archive-manifest.json"
    if not source.exists():
        if archive.exists() and manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            return {"path": str(directory), "status": "already_archived", **manifest}
        return {"path": str(directory), "status": "no_database"}
    if lsof_open(directory):
        raise RuntimeError(f"operations_backup_has_open_files_or_could_not_prove_closed:{directory}")
    source_sha = sha256_file(source)
    source_bytes = source.stat().st_size
    with tempfile.NamedTemporaryFile(prefix=f".{archive.name}.", dir=directory, delete=False) as handle:
        temp_archive = Path(handle.name)
    try:
        result = subprocess.run(
            [zstd_binary(), "-q", f"-{level}", "-T0", "-f", str(source), "-o", str(temp_archive)],
            text=True,
            capture_output=True,
            timeout=12 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"zstd_compression_failed:{directory}:{result.stderr[-1000:]}")
        verify_zstd_roundtrip(temp_archive, source_sha)
        archive_sha = sha256_file(temp_archive)
        os.replace(temp_archive, archive)
        manifest = {
            "version": 1,
            "archived_at": utc_now(),
            "codec": "zstd",
            "level": level,
            "original_name": source.name,
            "original_bytes": source_bytes,
            "original_sha256": source_sha,
            "archive_name": archive.name,
            "archive_bytes": archive.stat().st_size,
            "archive_sha256": archive_sha,
            "roundtrip_verified": True,
        }
        temp_manifest = manifest_path.with_suffix(".json.tmp")
        temp_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        os.replace(temp_manifest, manifest_path)
        source.unlink()
        return {"path": str(directory), "status": "archived", **manifest}
    finally:
        temp_archive.unlink(missing_ok=True)


def operations_plan(root: Path, keep_raw: int) -> dict[str, Any]:
    entries = operations_directories(root)
    rows = []
    for index, path in enumerate(entries):
        raw = path / "operations_memory.db"
        archive = path / "operations_memory.db.zst"
        rows.append(
            {
                "path": str(path),
                "decision": "retain_raw" if index < keep_raw else "archive_database",
                "raw_database_bytes": raw.stat().st_size if raw.exists() else 0,
                "archive_bytes": archive.stat().st_size if archive.exists() else 0,
                "already_archived": archive.exists() and not raw.exists(),
            }
        )
    return {"root": str(root), "keep_newest_raw": keep_raw, "entries": rows}


def runtime_plan(policy: dict[str, Any]) -> dict[str, Any]:
    dashboard = sorted(
        [Path(path) for path in glob.glob(policy["dashboard_previous_glob"]) if Path(path).is_dir() and not Path(path).is_symlink()],
        key=lambda path: path.name,
        reverse=True,
    )
    custom_root = Path(policy["custom_release_root"])
    legacy_root = Path(policy["legacy_service_release_root"])
    custom_entries = sorted(
        [path for path in custom_root.iterdir() if path.is_dir() and not path.is_symlink()] if custom_root.is_dir() else [],
        key=lambda path: path.name,
        reverse=True,
    )
    legacy_entries = sorted(
        [path for path in legacy_root.iterdir() if path.is_dir() and not path.is_symlink()] if legacy_root.is_dir() else [],
        key=lambda path: path.name,
        reverse=True,
    )
    all_paths = dashboard + custom_entries + legacy_entries
    with ThreadPoolExecutor(max_workers=4) as pool:
        sizes = dict(zip(all_paths, pool.map(tree_bytes, all_paths)))
    keep_dashboard = int(policy["keep_dashboard_previous"])
    dashboard_rows = [
        {
            "path": str(path),
            "bytes": sizes[path],
            "decision": "retain" if index < keep_dashboard else "delete",
            "purpose": "dashboard production runtime rollback",
        }
        for index, path in enumerate(dashboard)
    ]

    pointer_path = Path(policy["custom_active_pointer"])
    pointer = json.loads(pointer_path.read_text(encoding="utf-8")) if pointer_path.is_file() else {}
    active_release = str(pointer.get("releaseId") or "")
    previous_release = str(pointer.get("previousRelease") or "")
    protected_custom = {name for name in (active_release, previous_release) if name}
    if not protected_custom:
        protected_custom = {path.name for path in custom_entries[:2]}
    custom_rows = [
        {
            "path": str(path),
            "bytes": sizes[path],
            "decision": "retain" if path.name in protected_custom else "delete",
            "purpose": "active custom runtime" if path.name == active_release else ("previous custom runtime rollback" if path.name == previous_release else "superseded custom runtime release"),
        }
        for path in custom_entries
    ]

    legacy_keep = int(policy["keep_legacy_service_releases"])
    legacy_rows = [
        {
            "path": str(path),
            "bytes": sizes[path],
            "decision": "retain" if index < legacy_keep else "delete",
            "purpose": "legacy service runtime rollback",
        }
        for index, path in enumerate(legacy_entries)
    ]
    all_rows = dashboard_rows + custom_rows + legacy_rows
    return {
        "active_custom_release": active_release,
        "previous_custom_release": previous_release,
        "groups": [
            {"name": "dashboard_previous", "parent": "/Users/openclaw", "entries": dashboard_rows},
            {"name": "custom_releases", "parent": str(custom_root), "entries": custom_rows},
            {"name": "legacy_service_releases", "parent": str(legacy_root), "entries": legacy_rows},
        ],
        "delete_bytes": sum(row["bytes"] for row in all_rows if row["decision"] == "delete"),
    }


def write_receipt(receipt_root: Path, payload: dict[str, Any], name: str) -> Path:
    receipt_root.mkdir(parents=True, exist_ok=True)
    path = receipt_root / name
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Fail-closed local storage governor for approved retention classes.")
    parser.add_argument("--receipt-root", type=Path, default=BASE / "local-output" / "storage-governor")
    parser.add_argument("--apply-codex-retention", action="store_true")
    parser.add_argument("--apply-operations-archive", action="store_true")
    parser.add_argument("--apply-runtime-retention", action="store_true")
    parser.add_argument("--codex-root", action="append", type=Path)
    parser.add_argument("--keep-codex", type=int)
    parser.add_argument("--operations-root", type=Path)
    parser.add_argument("--keep-operations-raw", type=int)
    parser.add_argument("--max-operations-archives", type=int, default=0, help="For bounded execution/testing; 0 means all eligible backups.")
    args = parser.parse_args()

    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    codex_policy = policy["codex_repair_backups"]
    operations_policy = policy["operations_memory_backups"]
    runtime_policy = policy["runtime_retention"]
    codex_roots = args.codex_root or [Path(path) for path in codex_policy["roots"]]
    keep_codex = args.keep_codex if args.keep_codex is not None else int(codex_policy["keep_newest_per_root"])
    operations_root = args.operations_root or Path(operations_policy["root"])
    keep_operations_raw = args.keep_operations_raw if args.keep_operations_raw is not None else int(operations_policy["keep_newest_raw"])
    if keep_codex < 2:
        raise SystemExit("keep-codex must be at least 2")
    if keep_operations_raw < 1:
        raise SystemExit("keep-operations-raw must be at least 1")

    codex = codex_plan(codex_roots, keep_codex)
    operations = operations_plan(operations_root, keep_operations_raw)
    runtimes = runtime_plan(runtime_policy)
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "policy": str(POLICY_PATH),
        "mode": "apply" if args.apply_codex_retention or args.apply_operations_archive or args.apply_runtime_retention else "audit",
        "codex": codex,
        "operations_memory": operations,
        "runtime_retention": runtimes,
        "kalshi": "preserved_without_modification",
        "pattern_lab_media": "preserved_without_modification",
        "youtube_mutation": "not_performed",
        "actions": [],
        "errors": [],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    pre_path = write_receipt(args.receipt_root, payload, f"storage-governor-pre-{stamp}.json")

    if args.apply_codex_retention:
        for root_plan in codex["roots"]:
            root = Path(root_plan["root"])
            for row in root_plan["entries"]:
                if row["decision"] != "delete":
                    continue
                try:
                    safe_remove_backup(Path(row["path"]), root)
                    payload["actions"].append({"action": "deleted_superseded_codex_backup", **row})
                except Exception as error:  # fail closed and preserve remaining backups
                    payload["errors"].append(str(error))
                    break
            if payload["errors"]:
                break

    if args.apply_operations_archive and not payload["errors"]:
        eligible = [row for row in operations["entries"] if row["decision"] == "archive_database" and not row["already_archived"]]
        if args.max_operations_archives > 0:
            eligible = eligible[: args.max_operations_archives]
        for row in eligible:
            try:
                result = archive_operations_database(Path(row["path"]), level=int(operations_policy["archive_level"]))
                payload["actions"].append({"action": "archived_operations_memory_database", **result})
            except Exception as error:  # one failure stops the batch
                payload["errors"].append(str(error))
                break

    if args.apply_runtime_retention and not payload["errors"]:
        for group in runtimes["groups"]:
            parent = Path(group["parent"])
            for row in group["entries"]:
                if row["decision"] != "delete":
                    continue
                try:
                    safe_remove_backup(Path(row["path"]), parent)
                    payload["actions"].append({"action": "deleted_superseded_runtime", "runtime_group": group["name"], **row})
                except Exception as error:
                    payload["errors"].append(str(error))
                    break
            if payload["errors"]:
                break

    payload["completed_at"] = utc_now()
    payload["status"] = "pass" if not payload["errors"] else "blocked"
    payload["pre_action_receipt"] = str(pre_path)
    final_path = write_receipt(args.receipt_root, payload, f"storage-governor-result-{stamp}.json")
    print(json.dumps({"status": payload["status"], "receipt": str(final_path), "actions": len(payload["actions"]), "errors": payload["errors"]}, indent=2))
    if payload["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
