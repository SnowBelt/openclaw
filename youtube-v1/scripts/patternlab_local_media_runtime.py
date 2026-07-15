#!/usr/bin/env python3
"""Shared durability primitives for local Pattern Lab media generation."""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


CANARY_TTL_SECONDS = 24 * 60 * 60


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def execution_context() -> dict[str, Any]:
    sandbox = os.environ.get("CODEX_SANDBOX", "").strip()
    return {
        "name": "codex_seatbelt" if sandbox else "native_user_runtime",
        "codex_sandbox": sandbox or "none",
        "metal_generation_trusted": not bool(sandbox),
        "user_id": os.getuid(),
        "runs_as_root": os.geteuid() == 0,
    }


def binary_identity(path: str) -> dict[str, str]:
    resolved = Path(path).resolve()
    version = "unknown"
    try:
        result = subprocess.run([str(resolved), "--version"], capture_output=True, text=True, timeout=10, check=False)
        version = (result.stdout or result.stderr).strip().splitlines()[0] if (result.stdout or result.stderr).strip() else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {
        "path": str(resolved),
        "version": version,
        "sha256": sha256_file(resolved) if resolved.is_file() else "",
    }


@contextlib.contextmanager
def exclusive_process_lock(path: Path, timeout_seconds: float = 30.0) -> Iterator[None]:
    """Serialize Metal generation so concurrent jobs cannot exhaust MPS buffers."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as handle:
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for local media lock: {path}")
                time.sleep(0.2)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_utc(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc)


def receipt_is_fresh(receipt: dict[str, Any], ttl_seconds: int = CANARY_TTL_SECONDS) -> bool:
    generated = parse_utc(str(receipt.get("generated_at") or ""))
    if not generated:
        return False
    return 0 <= (datetime.now(timezone.utc) - generated).total_seconds() <= ttl_seconds


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def immutable_receipts(directory: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        payload = read_json(path)
        if payload:
            payload["_receipt_path"] = str(path)
            rows.append(payload)
    return rows

