#!/usr/bin/env python3
"""Verify/download the explicitly selected free local quality models."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


MANIFEST_PATH = BASE / "resources" / "local-model-manifest.json"


def read_manifest(path: Path = MANIFEST_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def model_root(manifest: dict) -> Path:
    return Path(os.environ.get(manifest["model_root_environment"], manifest["default_model_root"])).expanduser()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_models(manifest: dict, root: Path) -> dict:
    rows: dict[str, dict] = {}
    for name, spec in manifest["models"].items():
        directory = root / spec["local_directory"]
        required = [directory / value for value in spec["required_files"]]
        present = directory.is_dir() and all(path.is_file() and path.stat().st_size > 0 for path in required)
        rows[name] = {
            "repository": spec["repository"],
            "revision": spec["revision"],
            "purpose": spec["purpose"],
            "local_directory": str(directory),
            "available": present,
            "missing_files": [str(path) for path in required if not path.is_file() or path.stat().st_size == 0],
            "required_file_sha256": {str(path.relative_to(directory)): sha256_file(path) for path in required if path.is_file() and path.stat().st_size > 0},
        }
    return rows


def build_report(video_id: str, *, manifest_path: Path = MANIFEST_PATH) -> tuple[dict, Path, Path]:
    manifest = read_manifest(manifest_path)
    root = model_root(manifest)
    models = inspect_models(manifest, root)
    blockers = [f"local_model_missing:{name}" for name, row in models.items() if not row["available"]]
    approval = ensure_dir(output_root(video_id) / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "model_manifest": display_path(manifest_path),
        "model_root": str(root),
        "models": models,
        "blockers": blockers,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-model-health-report.json"
    md_path = approval / "local-model-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Local Model Health: Video {video_id}", "", f"Status: {payload['status']}",
        f"Model root: `{root}`", "", "## Models", "",
        *[f"- {name}: {'available' if row['available'] else 'missing'} — {row['repository']}@{row['revision']}" for name, row in models.items()],
        "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]),
        "", "Paid provider calls: not performed", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def download_models(manifest: dict, root: Path, selected: set[str], *, dry_run: bool) -> list[dict]:
    unknown = selected - set(manifest["models"])
    if unknown:
        raise SystemExit(f"Unknown model name(s): {', '.join(sorted(unknown))}")
    if dry_run:
        return [
            {"name": name, "repository": spec["repository"], "revision": spec["revision"], "local_directory": str(root / spec["local_directory"]), "downloaded": False}
            for name, spec in manifest["models"].items() if not selected or name in selected
        ]
    from huggingface_hub import snapshot_download

    results = []
    for name, spec in manifest["models"].items():
        if selected and name not in selected:
            continue
        directory = root / spec["local_directory"]
        directory.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=spec["repository"],
            revision=spec["revision"],
            local_dir=str(directory),
        )
        results.append({"name": name, "repository": spec["repository"], "revision": spec["revision"], "local_directory": str(directory), "downloaded": True})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify or download Pattern Lab's explicit local quality models.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--download", action="store_true", help="Download the manifest-selected free model files locally.")
    parser.add_argument("--model", action="append", default=[], help="Specific manifest model name; may be passed more than once.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    manifest = read_manifest()
    root = model_root(manifest)
    if args.download:
        results = download_models(manifest, root, set(args.model), dry_run=args.dry_run)
        print(json.dumps({"download": results, "dry_run": args.dry_run}, indent=2))
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
