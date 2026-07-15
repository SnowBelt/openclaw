#!/usr/bin/env python3
"""Fail-closed disk budgeting and safe media lifecycle reporting for Pattern Lab."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, patternlab_media_store, patternlab_model_root, utc_now
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text


POLICY_PATH = BASE / "resources" / "storage-lifecycle-policy.json"
GIB = 1024 ** 3


def read_policy() -> dict[str, Any]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def disk_snapshot(path: Path) -> dict[str, Any]:
    usage = shutil.disk_usage(path)
    return {
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "total_gib": round(usage.total / GIB, 2),
        "used_gib": round(usage.used / GIB, 2),
        "free_gib": round(usage.free / GIB, 2),
        "free_fraction": round(usage.free / usage.total, 5) if usage.total else 0,
    }


def operation_budget(policy: dict[str, Any], operation: str, disk: dict[str, Any]) -> dict[str, Any]:
    requirement = policy.get("disk_reserves", {}).get(operation, {})
    minimum_gib = float(requirement.get("minimum_free_gib", 0))
    minimum_fraction = float(requirement.get("minimum_free_fraction", 0))
    blockers: list[str] = []
    if disk["free_gib"] < minimum_gib:
        blockers.append(f"free_disk_below_{operation}_gib_floor:{disk['free_gib']}<{minimum_gib}")
    if disk["free_fraction"] < minimum_fraction:
        blockers.append(f"free_disk_below_{operation}_fraction_floor:{disk['free_fraction']}<{minimum_fraction}")
    return {
        "operation": operation,
        "status": "pass" if not blockers else "blocked",
        "minimum_free_gib": minimum_gib,
        "minimum_free_fraction": minimum_fraction,
        "blockers": blockers,
    }


def classify(relative: Path, policy: dict[str, Any]) -> str:
    normalized = f"/{relative.as_posix().lower()}"
    # Explicit transient subtrees remain disposable even when nested under a
    # generally protected source packet. Deletion still requires age + --apply.
    if any(token.lower() in normalized for token in policy.get("disposable_path_tokens", [])):
        return "disposable"
    if any(token.lower() in normalized for token in policy.get("protected_path_tokens", [])):
        return "protected"
    if relative.suffix.lower() in {".json", ".md", ".csv", ".txt", ".yaml", ".yml"}:
        return "metadata"
    return "working_media"


def directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for candidate in path.rglob("*"):
        try:
            if candidate.is_file() and not candidate.is_symlink():
                total += candidate.stat().st_size
        except OSError:
            continue
    return total


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root: Path, policy: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    by_size: dict[int, list[Path]] = defaultdict(list)
    if not root.exists():
        return rows, []
    for path in sorted(root.rglob("*")):
        try:
            if not path.is_file() or path.is_symlink():
                continue
            stat = path.stat()
        except OSError:
            continue
        relative = path.relative_to(root)
        role = classify(relative, policy)
        rows.append({
            "path": display_path(path),
            "relative_path": relative.as_posix(),
            "bytes": stat.st_size,
            "gib": round(stat.st_size / GIB, 5),
            "age_days": round((time.time() - stat.st_mtime) / 86400, 2),
            "storage_class": role,
        })
        if stat.st_size >= 1024 * 1024:
            by_size[stat.st_size].append(path)
    duplicate_groups: list[dict[str, Any]] = []
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        by_hash: dict[str, list[Path]] = defaultdict(list)
        for path in paths:
            by_hash[sha256(path)].append(path)
        for digest, duplicates in by_hash.items():
            if len(duplicates) > 1:
                duplicate_groups.append({
                    "sha256": digest,
                    "bytes_each": size,
                    "recoverable_bytes": size * (len(duplicates) - 1),
                    "paths": [display_path(path) for path in duplicates],
                })
    return rows, duplicate_groups


def cleanup_candidates(rows: list[dict[str, Any]], policy: dict[str, Any]) -> list[dict[str, Any]]:
    retention = policy.get("retention_days", {})
    default_days = int(retention.get("render_intermediate", 3))
    candidates: list[dict[str, Any]] = []
    for row in rows:
        if row["storage_class"] != "disposable":
            continue
        relative = row["relative_path"].lower()
        days = default_days
        if "failed-candidates" in relative:
            days = int(retention.get("failed_generation_candidate", 2))
        elif "superseded-candidates" in relative:
            days = int(retention.get("superseded_generation_candidate", 7))
        elif "/frames/" in f"/{relative}":
            days = int(retention.get("extracted_frame", 3))
        if row["age_days"] >= days:
            candidates.append({**row, "retention_days": days})
    return candidates


def build_report(video_id: str, *, apply: bool = False) -> tuple[dict[str, Any], Path, Path]:
    policy = read_policy()
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    disk = disk_snapshot(BASE)
    budgets = {
        name: operation_budget(policy, name, disk)
        for name in policy.get("disk_reserves", {})
    }
    rows, duplicates = inventory(root, policy)
    cleanup = cleanup_candidates(rows, policy)
    deleted: list[str] = []
    if apply:
        for row in cleanup:
            path = root / row["relative_path"]
            resolved = path.resolve()
            if root.resolve() not in resolved.parents or classify(path.relative_to(root), policy) != "disposable":
                continue
            try:
                path.unlink()
                deleted.append(display_path(path))
            except OSError:
                continue
    episode_bytes = sum(row["bytes"] for row in rows)
    total_budget_gib = float(policy.get("episode_budgets_gib", {}).get("total_active_episode", 60))
    blockers: list[str] = []
    runtime_health = budgets.get("runtime_health", {})
    blockers.extend(runtime_health.get("blockers", []))
    if episode_bytes / GIB > total_budget_gib:
        blockers.append(f"episode_storage_above_budget:{round(episode_bytes / GIB, 2)}>{total_budget_gib}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH),
        "disk": disk,
        "operation_budgets": budgets,
        "episode": {
            "root": display_path(root),
            "bytes": episode_bytes,
            "gib": round(episode_bytes / GIB, 3),
            "active_budget_gib": total_budget_gib,
            "file_count": len(rows),
        },
        "duplicate_groups": duplicates,
        "recoverable_duplicate_gib": round(sum(row["recoverable_bytes"] for row in duplicates) / GIB, 3),
        "cleanup_candidates": cleanup,
        "cleanup_candidate_gib": round(sum(row["bytes"] for row in cleanup) / GIB, 3),
        "apply": apply,
        "deleted": deleted,
        "blockers": blockers,
        "protected_classes_never_deleted": policy.get("never_delete_classes", []),
        "storage_strategy": [
            "stream transient frames directly into FFmpeg",
            "keep one shared hash-locked model cache outside Git",
            "keep source originals, rights/approval receipts, and final approved releases",
            "expire only classified transient frames, intermediates, failed candidates, and superseded proxies",
            "use a configurable external APFS media root when available",
        ],
        "configured_roots": {
            "media_store": str(patternlab_media_store()),
            "model_root": str(patternlab_model_root()),
            "external_media_store_configured": str(patternlab_media_store()).startswith("/Volumes/"),
        },
        "recommended_layout": {
            "internal_ssd": ["active release metadata", "approval receipts", "small current proxies"],
            "external_apfs_ssd": ["source originals", "active renders", "generated candidates", "model cache", "archive masters"],
            "archive": ["approved final master", "source originals", "rights and approval receipts"],
        },
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "storage-lifecycle-report.json"
    md_path = approval / "storage-lifecycle-report.md"
    atomic_write_json(json_path, payload)
    lines = [
        f"# Pattern Lab Storage Lifecycle: Video {video_id}", "",
        f"Status: {payload['status']}",
        f"Disk free: {disk['free_gib']} GiB ({disk['free_fraction']:.1%})",
        f"Episode footprint: {payload['episode']['gib']} GiB / {total_budget_gib} GiB",
        f"Recoverable duplicates: {payload['recoverable_duplicate_gib']} GiB",
        f"Safe cleanup candidates: {payload['cleanup_candidate_gib']} GiB",
        "", "## Operation budgets", "",
    ]
    lines.extend(f"- {name}: {row['status']}" for name, row in budgets.items())
    lines.extend(["", "## Safety", "", "- Source media, rights, approvals, releases, upload receipts, and credentials are never deleted.", f"- Cleanup apply mode: {'used' if apply else 'not used'}", "- YouTube mutation: not performed", ""])
    atomic_write_text(md_path, "\n".join(lines))
    return payload, json_path, md_path


def requested_status(payload: dict[str, Any], require_operation: str | None) -> str:
    """Return the status for the exact operation a caller requested.

    The overall runtime reserve remains visible in every report, but it must
    not falsely block a smaller operation whose own conservative reserve is
    satisfied.  This keeps still generation available while long-form render,
    model download, and image-to-video remain fail-closed.
    """
    if require_operation:
        return str(payload.get("operation_budgets", {}).get(require_operation, {}).get("status") or "blocked")
    return str(payload.get("status") or "blocked")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit and safely clean Pattern Lab transient media storage.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--apply", action="store_true", help="Delete only old files classified as disposable.")
    parser.add_argument("--require-operation", choices=["runtime_health", "routine_still_generation", "long_form_render", "local_image_to_video", "model_download"])
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), apply=args.apply)
    status = requested_status(payload, args.require_operation)
    result = {
        "status": status,
        "overall_status": payload["status"],
        "report": display_path(report),
        "disk": payload["disk"],
        "episode": payload["episode"],
    }
    if args.require_operation:
        result["operation"] = payload["operation_budgets"][args.require_operation]
    print(json.dumps(result, indent=2))
    if status != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
