#!/usr/bin/env python3
"""Scan local Kalshi scripts for live-trading code."""

from __future__ import annotations

import hashlib
import json
import mmap
import os
import re
import time
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parent
EXECUTABLE_SUFFIXES = {".py"}
MAX_NON_EXECUTABLE_BYTES = 5 * 1024 * 1024
PRUNED_DIRECTORY_NAMES = {
    ".artifacts",
    "__pycache__",
    "_recovery",
    "backups",
    "dashboard",
    "logs",
    "preservation_snapshots",
    "research_artifacts",
    "tests",
    "tmp",
}
DANGEROUS = {
    "write HTTP method": re.compile(r"(?<![A-Z_])(?:POST|PUT|PATCH|DELETE)(?![A-Z_])"),
    "live order endpoint": re.compile(r"/portfolio/(?:events/)?orders(?:/batched)?"),
    "create_order": re.compile(r"\bcreate_order\b"),
    "submit_order": re.compile(r"\bsubmit_order\b"),
    "accept_quote": re.compile(r"\baccept_quote\b"),
    "create_rfq": re.compile(r"\bcreate_rfq\b"),
    "batch_create": re.compile(r"\bbatch_create\b"),
    "live_trading_enabled true": re.compile(r'"live_trading_enabled"\s*:\s*true'),
    "live_order_allowed true": re.compile(r'"live_order_allowed"\s*:\s*true'),
}
DANGEROUS_BYTES = {
    label: re.compile(pattern.pattern.encode("ascii"), pattern.flags & ~re.UNICODE)
    for label, pattern in DANGEROUS.items()
}
DOCUMENTATION_ALLOWED = {"README.md", "KALSHI_STRATEGY_POLICY.md", "LIVE_TRADING_PROMOTION_GATE.md"}
SCAN_CACHE_SCHEMA = "kalshi-no-live-source-scan-cache-v1"
SCAN_CACHE_PATH = ROOT / "logs" / "cache" / "no_live_source_scan_v1.json"


def _policy_signature() -> str:
    payload = {
        "patterns": {label: pattern.pattern for label, pattern in sorted(DANGEROUS.items())},
        "documentation_allowed": sorted(DOCUMENTATION_ALLOWED),
        "executable_suffixes": sorted(EXECUTABLE_SUFFIXES),
        "pruned_directories": sorted(PRUNED_DIRECTORY_NAMES),
        "max_non_executable_bytes": MAX_NON_EXECUTABLE_BYTES,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _iter_scan_paths(root: Path, stats: dict[str, int]) -> Iterator[Path]:
    """Walk only source-bearing directories; excluded evidence trees are never enumerated."""
    for directory, names, filenames in os.walk(root, topdown=True, followlinks=False):
        names.sort()
        filenames.sort()
        retained: list[str] = []
        for name in names:
            if name in PRUNED_DIRECTORY_NAMES:
                stats["directories_pruned"] += 1
            else:
                retained.append(name)
        names[:] = retained
        base = Path(directory)
        for filename in filenames:
            stats["files_discovered"] += 1
            yield base / filename


def _scan_file(path: Path) -> tuple[list[str], bool]:
    """Scan with a read-only memory map so file size does not become heap size."""
    if path.stat().st_size == 0:
        return [], False
    with path.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as payload:
        matched = [label for label, pattern in DANGEROUS_BYTES.items() if pattern.search(payload)]
        reference_context = payload.find(b"forbidden") >= 0 or payload.find(b"dangerous") >= 0
    return matched, reference_context


def _fingerprint(stat: os.stat_result) -> list[int]:
    return [
        int(stat.st_dev),
        int(stat.st_ino),
        int(stat.st_size),
        int(stat.st_mtime_ns),
        int(stat.st_ctime_ns),
    ]


def _load_cache(path: Path | None, *, root: Path, policy_signature: str) -> dict[str, Any]:
    if path is None:
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    if (
        payload.get("schema_version") != SCAN_CACHE_SCHEMA
        or payload.get("root") != str(root)
        or payload.get("policy_signature") != policy_signature
        or not isinstance(payload.get("entries"), dict)
    ):
        return {}
    return payload


def _write_cache(
    path: Path | None,
    *,
    root: Path,
    policy_signature: str,
    entries: dict[str, dict[str, Any]],
) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCAN_CACHE_SCHEMA,
        "root": str(root),
        "policy_signature": policy_signature,
        "entries": entries,
        "derived_cache_only": True,
        "live_order_allowed": False,
        "live_trading_enabled": False,
    }
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def scan_root(root: Path = ROOT, *, cache_path: Path | None = None) -> dict[str, Any]:
    started = time.monotonic()
    root = root.resolve()
    if cache_path is None and root == ROOT.resolve():
        cache_path = SCAN_CACHE_PATH
    policy_signature = _policy_signature()
    cache = _load_cache(cache_path, root=root, policy_signature=policy_signature)
    cached_entries = cache.get("entries") if isinstance(cache.get("entries"), dict) else {}
    current_entries: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    warnings: list[str] = []
    stats = {
        "directories_pruned": 0,
        "files_discovered": 0,
        "files_scanned": 0,
        "non_executable_oversize_skipped": 0,
        "cache_hits": 0,
        "cache_misses": 0,
    }
    for path in _iter_scan_paths(root, stats):
        if path.name == Path(__file__).name:
            continue
        # Filter by name before stat/mmap calls. The directory entry already
        # supplies the filename, while most root artifacts are inert JSON.
        if path.suffix not in EXECUTABLE_SUFFIXES and path.name not in DOCUMENTATION_ALLOWED:
            continue
        try:
            stat = path.stat()
            is_file = path.is_file()
        except OSError as exc:
            warnings.append(f"{path.relative_to(root)} unreadable: {exc}")
            continue
        if not is_file or path.suffix == ".pyc":
            continue
        if path.suffix not in EXECUTABLE_SUFFIXES:
            try:
                if path.stat().st_size > MAX_NON_EXECUTABLE_BYTES:
                    stats["non_executable_oversize_skipped"] += 1
                    continue
            except OSError as exc:
                warnings.append(f"{path.relative_to(root)} unreadable: {exc}")
                continue
        try:
            rel = str(path.relative_to(root))
            fingerprint = _fingerprint(stat)
            cached = cached_entries.get(rel) if isinstance(cached_entries, dict) else None
            if isinstance(cached, dict) and cached.get("fingerprint") == fingerprint:
                labels = cached.get("matched_labels")
                matched_labels = [str(item) for item in labels] if isinstance(labels, list) else []
                reference_context = cached.get("reference_context") is True
                stats["cache_hits"] += 1
            else:
                matched_labels, reference_context = _scan_file(path)
                stats["cache_misses"] += 1
        except OSError as exc:
            warnings.append(f"{path.relative_to(root)} unreadable: {exc}")
            continue
        current_entries[rel] = {
            "fingerprint": fingerprint,
            "matched_labels": matched_labels,
            "reference_context": reference_context,
        }
        stats["files_scanned"] += 1
        for label in matched_labels:
            if path.name in DOCUMENTATION_ALLOWED or reference_context:
                warnings.append(f"documentation/reference pattern {label!r} in {rel}")
            elif path.suffix in EXECUTABLE_SUFFIXES:
                failures.append(f"dangerous pattern {label!r} in executable {rel}")
    try:
        if current_entries != cached_entries:
            _write_cache(
                cache_path,
                root=root,
                policy_signature=policy_signature,
                entries=current_entries,
            )
    except OSError as exc:
        warnings.append(f"scan_cache_write_failed:{type(exc).__name__}")
    return {
        "ok": not failures,
        "critical_failures": failures,
        "warnings": warnings,
        "scan_stats": {
            **stats,
            "elapsed_seconds": round(time.monotonic() - started, 6),
            "bounded_memory_scan": True,
            "excluded_trees_enumerated": False,
            "metadata_validated_cache": cache_path is not None,
        },
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "mode": "READ_ONLY",
    }


def main() -> int:
    payload = scan_root()
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
