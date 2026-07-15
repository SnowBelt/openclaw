#!/usr/bin/env python3
"""Deploy and verify the canonical Pattern Lab skills for Codex and OpenClaw."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = YOUTUBE_ROOT.parent
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab.state import sha256_file


SKILL_NAMES = (
    "patternlab-production-director",
    "patternlab-media-qa-director",
    "patternlab-thumbnail-director",
    "patternlab-visual-source-motion-director",
)
IGNORED_PARTS = frozenset({"__pycache__", ".DS_Store"})


def source_files(skill_root: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(
            path
            for path in skill_root.rglob("*")
            if path.is_file() and not any(part in IGNORED_PARTS for part in path.parts)
        )
    )


def tree_sha256(skill_root: Path) -> str:
    digest = hashlib.sha256()
    for path in source_files(skill_root):
        relative = path.relative_to(skill_root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def compare_skill(source: Path, target: Path) -> dict[str, Any]:
    missing: list[str] = []
    mismatched: list[str] = []
    files = source_files(source)
    for path in files:
        relative = path.relative_to(source)
        deployed = target / relative
        if not deployed.is_file():
            missing.append(relative.as_posix())
        elif sha256_file(path) != sha256_file(deployed):
            mismatched.append(relative.as_posix())
    return {
        "skill": source.name,
        "source": display_path(source),
        "target": str(target),
        "source_file_count": len(files),
        "source_tree_sha256": tree_sha256(source),
        "missing_files": missing,
        "mismatched_files": mismatched,
        "status": "pass" if files and not missing and not mismatched else "blocked",
    }


def deploy_skill(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for path in source_files(source):
        destination = target / path.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def default_destinations() -> tuple[Path, ...]:
    active_repo = Path(os.environ.get("PATTERNLAB_OPENCLAW_ROOT", Path.home() / "OpenClaw"))
    return (
        Path.home() / ".codex" / "skills",
        active_repo / ".agents" / "skills",
    )


def build_report(video_id: str, destinations: tuple[Path, ...], *, apply: bool) -> tuple[dict[str, Any], Path]:
    source_root = YOUTUBE_ROOT / "skills"
    blockers: list[str] = []
    rows: list[dict[str, Any]] = []
    for destination_root in destinations:
        for name in SKILL_NAMES:
            source = source_root / name
            target = destination_root / name
            if apply and source.is_dir():
                deploy_skill(source, target)
            row = compare_skill(source, target)
            rows.append(row)
            if row["status"] != "pass":
                blockers.append(f"skill_deployment_stale:{destination_root}:{name}")
    director = source_root / "patternlab-production-director" / "SKILL.md"
    director_text = director.read_text(encoding="utf-8") if director.is_file() else ""
    if "patternlab_production.py" not in director_text or "93/100" not in director_text:
        blockers.append("canonical_production_director_contract_missing")
    for name in SKILL_NAMES[1:]:
        path = source_root / name / "SKILL.md"
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        if "patternlab-production-director" not in text:
            blockers.append(f"specialist_skill_bypasses_production_director:{name}")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "mode": "apply_and_verify" if apply else "verify_only",
        "required_skills": list(SKILL_NAMES),
        "deployments": rows,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report = ensure_dir(output_root(video_id) / "approval") / "skill-deployment-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy or verify canonical Pattern Lab agent skills.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--destination", action="append", default=[])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    destinations = tuple(Path(item).expanduser().resolve() for item in args.destination) or default_destinations()
    payload, report = build_report(args.video_id.zfill(2), destinations, apply=args.apply)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
