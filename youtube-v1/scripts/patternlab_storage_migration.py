#!/usr/bin/env python3
"""Plan and safely copy Pattern Lab media/model state to an external APFS store."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from patternlab_common import BASE, RUNTIME_CONFIG_PATH, display_path, ensure_dir, utc_now
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, sha256_file


GIB = 1024**3


def tree_summary(root: Path, *, with_hashes: bool) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    total = 0
    if root.is_dir():
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            size = path.stat().st_size
            total += size
            files.append(
                {
                    "relative_path": path.relative_to(root).as_posix(),
                    "bytes": size,
                    "sha256": sha256_file(path) if with_hashes else "deferred_until_copy_verification",
                }
            )
    return {"root": str(root), "bytes": total, "gib": round(total / GIB, 3), "file_count": len(files), "files": files}


def destination_is_safe(destination: Path) -> tuple[bool, list[str], dict[str, Any]]:
    blockers: list[str] = []
    if not destination.is_absolute():
        blockers.append("destination_must_be_absolute")
    if not str(destination).startswith("/Volumes/"):
        blockers.append("destination_must_be_a_mounted_external_volume")
    if not destination.exists():
        blockers.append("destination_volume_or_directory_missing")
    if destination.exists() and not os.access(destination, os.W_OK):
        blockers.append("destination_not_writable")
    usage = shutil.disk_usage(destination) if destination.exists() else None
    disk = {
        "free_gib": round(usage.free / GIB, 2) if usage else 0,
        "total_gib": round(usage.total / GIB, 2) if usage else 0,
    }
    return not blockers, blockers, disk


def copy_tree(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["/usr/bin/rsync", "-a", "--checksum", "--partial", f"{source}/", f"{destination}/"],
        capture_output=True,
        text=True,
        timeout=24 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"rsync_failed:{result.returncode}:{result.stderr[-1000:]}")


def verify_equal(source: Path, destination: Path) -> tuple[bool, dict[str, Any], dict[str, Any]]:
    source_summary = tree_summary(source, with_hashes=True)
    destination_summary = tree_summary(destination, with_hashes=True)
    source_rows = {(row["relative_path"], row["bytes"], row["sha256"]) for row in source_summary["files"]}
    destination_rows = {(row["relative_path"], row["bytes"], row["sha256"]) for row in destination_summary["files"]}
    return source_rows == destination_rows, source_summary, destination_summary


def build_report(destination: Path, *, apply_copy: bool, activate: bool) -> tuple[dict[str, Any], Path, Path]:
    report_root = ensure_dir(BASE / "local-output" / "qa")
    safe, blockers, disk = destination_is_safe(destination)
    external_media = destination / "media"
    external_models = destination / "models" / "draw-things"
    roots = [
        {
            "kind": "active_media",
            "source": BASE / "local-output",
            "destination": external_media,
            "excludes": ["models", "qa", "tools", "locks"],
        },
        {
            "kind": "model_cache",
            "source": BASE / "local-output" / "models" / "draw-things",
            "destination": external_models,
            "excludes": [],
        },
    ]
    # Active media is copied episode-by-episode so shared tools and caches stay internal.
    episode_sources = sorted((BASE / "local-output").glob("video-*"))
    required_bytes = sum(tree_summary(path, with_hashes=False)["bytes"] for path in episode_sources)
    required_bytes += tree_summary(roots[1]["source"], with_hashes=False)["bytes"]
    reserve = 100 * GIB
    if safe and disk["free_gib"] * GIB < required_bytes + reserve:
        blockers.append("destination_free_space_below_copy_plus_100_gib_reserve")
    copied: list[dict[str, Any]] = []
    if apply_copy and not blockers:
        for source in episode_sources:
            target = external_media / "active" / source.name
            copy_tree(source, target)
            verified, source_summary, destination_summary = verify_equal(source, target)
            copied.append(
                {
                    "kind": "active_episode",
                    "source": str(source),
                    "destination": str(target),
                    "verified": verified,
                    "source_summary": source_summary,
                    "destination_summary": destination_summary,
                }
            )
            if not verified:
                blockers.append(f"copy_verification_failed:{source.name}")
        model_source = roots[1]["source"]
        if model_source.is_dir():
            copy_tree(model_source, external_models)
            verified, source_summary, destination_summary = verify_equal(model_source, external_models)
            copied.append(
                {
                    "kind": "model_cache",
                    "source": str(model_source),
                    "destination": str(external_models),
                    "verified": verified,
                    "source_summary": source_summary,
                    "destination_summary": destination_summary,
                }
            )
            if not verified:
                blockers.append("copy_verification_failed:model_cache")
    if activate:
        if not apply_copy:
            blockers.append("activation_requires_apply_copy")
        if blockers or not copied or not all(row["verified"] for row in copied):
            blockers.append("activation_blocked_until_all_copies_are_hash_verified")
        else:
            atomic_write_json(
                RUNTIME_CONFIG_PATH,
                {
                    "version": 1,
                    "activated_at": utc_now(),
                    "media_store": str(external_media),
                    "model_root": str(external_models),
                    "migration_receipt_pending": str(report_root / "storage-migration-report.json"),
                    "source_retirement": "not_performed",
                },
            )
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "mode": "copy_and_activate" if activate else ("copy_only" if apply_copy else "plan_only"),
        "destination": str(destination),
        "destination_disk": disk,
        "required_copy_gib": round(required_bytes / GIB, 3),
        "required_post_copy_reserve_gib": 100,
        "episode_sources": [str(path) for path in episode_sources],
        "model_source": str(roots[1]["source"]),
        "copied": copied,
        "runtime_config": display_path(RUNTIME_CONFIG_PATH),
        "runtime_config_activated": activate and not blockers,
        "source_retirement": "not_performed; originals remain until separate verified retirement approval",
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    json_path = report_root / "storage-migration-report.json"
    md_path = report_root / "storage-migration-report.md"
    atomic_write_json(json_path, payload)
    atomic_write_text(
        md_path,
        "\n".join(
            [
                "# Pattern Lab External Storage Migration",
                "",
                f"Status: {payload['status']}",
                f"Mode: {payload['mode']}",
                f"Destination: {destination}",
                f"Required copy: {payload['required_copy_gib']} GiB plus 100 GiB reserve",
                "",
                "## Safety",
                "",
                "- Copy first; compare every relative path, size, and SHA-256.",
                "- Activate only after all copies verify.",
                "- Never delete source files in this command.",
                "- Keep approved masters, sources, rights, approvals, and upload receipts.",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or perform a non-destructive Pattern Lab external-storage migration.")
    parser.add_argument("--destination", type=Path, default=Path("/Volumes/PatternLabMedia"))
    parser.add_argument("--apply-copy", action="store_true")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    payload, report, _ = build_report(args.destination.expanduser(), apply_copy=args.apply_copy, activate=args.activate)
    print(json.dumps({"status": payload["status"], "mode": payload["mode"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if (args.apply_copy or args.activate) and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
