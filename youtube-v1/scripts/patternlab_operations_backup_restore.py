#!/usr/bin/env python3
"""Restore a raw or zstd-archived operations-memory backup without changing it."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore an operations-memory backup to a new directory.")
    parser.add_argument("backup", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    source = args.backup.resolve()
    destination = args.destination.resolve()
    if not source.is_dir() or source.is_symlink():
        raise SystemExit("backup must be a real directory")
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit("destination must not exist or must be empty")
    destination.mkdir(parents=True, exist_ok=True)
    for path in source.iterdir():
        if path.name in {"operations_memory.db.zst", "archive-manifest.json"}:
            continue
        if path.is_file() and not path.is_symlink():
            shutil.copy2(path, destination / path.name)
    raw = source / "operations_memory.db"
    archive = source / "operations_memory.db.zst"
    restored = destination / "operations_memory.db"
    expected = None
    if raw.exists():
        shutil.copy2(raw, restored)
        expected = sha256(raw)
    elif archive.exists():
        manifest = json.loads((source / "archive-manifest.json").read_text(encoding="utf-8"))
        expected = manifest["original_sha256"]
        zstd = shutil.which("zstd") or "/opt/homebrew/bin/zstd"
        with restored.open("wb") as handle:
            result = subprocess.run([zstd, "-q", "-d", "-c", str(archive)], stdout=handle, check=False)
        if result.returncode != 0:
            raise SystemExit(f"zstd restore failed: {result.returncode}")
    else:
        raise SystemExit("backup contains no raw or archived operations_memory.db")
    actual = sha256(restored)
    if actual != expected:
        restored.unlink(missing_ok=True)
        raise SystemExit(f"restored checksum mismatch: {actual} != {expected}")
    print(json.dumps({"status": "pass", "source": str(source), "destination": str(destination), "restored_sha256": actual}, indent=2))


if __name__ == "__main__":
    main()
