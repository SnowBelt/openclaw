#!/usr/bin/env python3
"""Create a consistent, read-only staging copy of live OpenClaw state."""

from __future__ import annotations

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import time


def sqlite_paths(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.sqlite") if path.is_file())


def excluded_from_gateway_stage(root: Path, database: Path) -> bool:
    relative = database.relative_to(root)
    return "codex-home" in relative.parts or database.name.endswith(".reindex-lock.sqlite")


def remove_sqlite_family(database: Path) -> None:
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{database}{suffix}").unlink(missing_ok=True)


def backup_sqlite(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.backup-{os.getpid()}")
    source_uri = f"{source.as_uri()}?mode=ro"
    try:
        maximum_attempts = 8
        copied = False
        last_error: sqlite3.Error | None = None
        for attempt in range(1, maximum_attempts + 1):
            remove_sqlite_family(temporary)
            try:
                with closing(sqlite3.connect(source_uri, uri=True, timeout=30)) as source_db:
                    with closing(sqlite3.connect(temporary, timeout=30)) as target_db:
                        source_db.execute("PRAGMA busy_timeout=30000")
                        target_db.execute("PRAGMA busy_timeout=30000")
                        source_db.backup(target_db)
                        target_db.commit()
                copied = True
                break
            except sqlite3.Error as error:
                last_error = error
                if attempt == maximum_attempts:
                    break
                time.sleep(min(attempt * 0.75, 3.0))
        if not copied:
            sqlite_cli = shutil.which("sqlite3")
            if not sqlite_cli:
                raise RuntimeError(
                    f"cannot back up live SQLite database {source} -> {temporary} "
                    f"after {maximum_attempts} attempts and sqlite3 CLI is unavailable"
                ) from last_error
            remove_sqlite_family(temporary)
            cli_result = subprocess.run(
                [
                    sqlite_cli,
                    str(source),
                    ".timeout 30000",
                    f".backup {json.dumps(str(temporary))}",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if cli_result.returncode != 0:
                detail = cli_result.stderr.strip() or cli_result.stdout.strip()
                raise RuntimeError(
                    f"cannot back up live SQLite database {source} -> {temporary} "
                    f"after Python and CLI attempts: {detail or 'unknown SQLite CLI error'}"
                ) from last_error
        with closing(sqlite3.connect(temporary, timeout=30)) as target_db:
            journal_mode = target_db.execute("PRAGMA journal_mode=DELETE").fetchone()
            if journal_mode != ("delete",):
                raise RuntimeError(f"cannot normalize staged SQLite journal mode for {source}")
            result = target_db.execute("PRAGMA quick_check").fetchone()
            if result != ("ok",):
                raise RuntimeError(f"SQLite quick_check failed for {source}")
            target_db.commit()
        for suffix in ("-wal", "-shm", "-journal"):
            Path(f"{temporary}{suffix}").unlink(missing_ok=True)
        try:
            with closing(
                sqlite3.connect(f"{temporary.as_uri()}?mode=ro", uri=True)
            ) as copied_db:
                result = copied_db.execute("PRAGMA quick_check").fetchone()
        except sqlite3.Error as error:
            raise RuntimeError(
                f"cannot verify staged SQLite backup {source} -> {temporary} "
                f"(exists={temporary.exists()}, parent={temporary.parent.exists()})"
            ) from error
        if result != ("ok",):
            raise RuntimeError(f"persisted SQLite quick_check failed for {source}")
        os.chmod(temporary, stat.S_IMODE(source.stat().st_mode))
        os.replace(temporary, target)
    finally:
        remove_sqlite_family(temporary)


def backup_sqlite_isolated(source: Path, target: Path) -> None:
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--backup-one",
                str(source),
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"timed out backing up live SQLite database {source}") from error
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown SQLite backup error"
        raise RuntimeError(detail)


def remap_copied_path_values(value: object, sources: tuple[Path, ...], target: Path) -> object:
    if isinstance(value, str):
        for source in sources:
            source_text = str(source)
            if value == source_text:
                return str(target)
            source_prefix = f"{source_text}{os.sep}"
            if value.startswith(source_prefix):
                return str(target / value[len(source_prefix) :])
        return value
    if isinstance(value, list):
        return [remap_copied_path_values(item, sources, target) for item in value]
    if isinstance(value, dict):
        return {
            key: remap_copied_path_values(item, sources, target)
            for key, item in value.items()
        }
    return value


def remap_copied_plugin_index_paths(sources: tuple[Path, ...], target: Path) -> None:
    legacy_path = target / "plugins" / "installs.json"
    if legacy_path.is_file():
        legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
        remapped = remap_copied_path_values(legacy, sources, target)
        temporary = legacy_path.with_name(f".{legacy_path.name}.remap-{os.getpid()}")
        temporary.write_text(f"{json.dumps(remapped, indent=2, sort_keys=True)}\n", encoding="utf-8")
        os.chmod(temporary, stat.S_IMODE(legacy_path.stat().st_mode))
        os.replace(temporary, legacy_path)

    database_path = target / "state" / "openclaw.sqlite"
    if not database_path.is_file():
        return
    with closing(sqlite3.connect(database_path, timeout=30)) as database:
        table = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'installed_plugin_index'"
        ).fetchone()
        if table is None:
            return
        rows = database.execute(
            "SELECT index_key, install_records_json, plugins_json FROM installed_plugin_index"
        ).fetchall()
        for index_key, install_records_json, plugins_json in rows:
            records = remap_copied_path_values(
                json.loads(install_records_json), sources, target
            )
            plugins = remap_copied_path_values(json.loads(plugins_json), sources, target)
            database.execute(
                """
                UPDATE installed_plugin_index
                SET install_records_json = ?, plugins_json = ?
                WHERE index_key = ?
                """,
                (
                    json.dumps(records, separators=(",", ":"), sort_keys=True),
                    json.dumps(plugins, separators=(",", ":"), sort_keys=True),
                    index_key,
                ),
            )
        result = database.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise RuntimeError("SQLite quick_check failed after remapping staged plugin paths")
        database.commit()


def copy_stage_state(source: Path, target: Path) -> dict[str, object]:
    source_argument = source.absolute()
    source = source.resolve(strict=True)
    target = target.resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError("stage source and target directories must not overlap")
    if target.exists() and any(target.iterdir()):
        raise ValueError("stage target directory must be empty")
    target.mkdir(parents=True, exist_ok=True)
    # Immutable governance source capsules are evidence-store inputs, not
    # Gateway runtime state. Copying them into every disposable stage can
    # amplify disk usage by tens of gigabytes and make a valid stage fail with
    # ENOSPC. Keep the surrounding governance metadata available while leaving
    # the immutable capsules in their canonical store.
    rsync_excludes = (
        "logs",
        "tmp",
        "codex-home",
        "pcc/release-governance/**/source-capsules",
        "*.reindex-lock.sqlite",
        "*.sqlite",
        "*.sqlite-wal",
        "*.sqlite-shm",
        "*.sqlite-journal",
    )
    rsync_command = ["rsync", "-a"]
    for pattern in rsync_excludes:
        rsync_command.extend(("--exclude", pattern))
    rsync_command.extend((f"{source}/", f"{target}/"))
    subprocess.run(rsync_command, check=True)
    all_databases = sqlite_paths(source)
    databases = [
        database for database in all_databases if not excluded_from_gateway_stage(source, database)
    ]
    excluded = [
        database.relative_to(source).as_posix()
        for database in all_databases
        if excluded_from_gateway_stage(source, database)
    ]
    copied: list[str] = []
    for database in databases:
        relative = database.relative_to(source)
        backup_sqlite_isolated(database, target / relative)
        copied.append(relative.as_posix())
    source_roots = tuple(dict.fromkeys((source_argument, source)))
    remap_copied_plugin_index_paths(source_roots, target)
    return {
        "databaseCount": len(copied),
        "databases": copied,
        "excludedDatabaseCount": len(excluded),
        "excludedDatabases": excluded,
    }


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "--backup-one":
        backup_sqlite(Path(sys.argv[2]), Path(sys.argv[3]))
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("target")
    args = parser.parse_args()
    result = copy_stage_state(Path(args.source), Path(args.target))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
