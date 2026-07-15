#!/usr/bin/env python3
"""Register one passing long-form candidate for hash-bound Discord review."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.models import Artifact
from patternlab.release import create_release_candidate
from patternlab.state import PatternLabState, sha256_file
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def state_path() -> Path:
    return Path(os.environ.get("PATTERNLAB_STATE_DB", BASE / "local-output" / "patternlab.sqlite3"))


def artifact(root: Path, path: Path, artifact_id: str, artifact_type: str, role: str) -> Artifact:
    return Artifact(
        artifact_id=artifact_id,
        artifact_type=artifact_type,
        relative_path=str(path.relative_to(root)),
        sha256=sha256_file(path),
        role=role,
    )


def build_report(video_id: str) -> tuple[dict, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    qa_path = approval / "long-form-media-qa-report.json"
    supersession_path = approval / "owner-rejection-supersession-report.json"
    qa = read_json(qa_path)
    supersession = read_json(supersession_path)
    required = [
        (root / "video" / f"pattern-lab-video-{video_id}-draft.mp4", f"video-{video_id}-long-form", "long_form", "owner_review"),
        (root / "captions" / "closed-captions-final.srt", f"video-{video_id}-captions", "captions", "accessibility"),
        (approval / "evidence-manifest.json", f"video-{video_id}-evidence-manifest", "evidence_manifest", "proof"),
        (approval / "canonical-render-plan.json", f"video-{video_id}-render-plan", "render_plan", "render"),
        (qa_path, f"video-{video_id}-long-form-qa", "qa_report", "quality"),
        (supersession_path, f"video-{video_id}-rejection-supersession", "qa_report", "quality"),
    ]
    blockers: list[str] = []
    if qa.get("status") != "pass" or int(qa.get("score", 0)) < 93:
        blockers.append("long_form_media_qa_not_pass_at_93")
    if supersession.get("status") != "pass":
        blockers.append("owner_rejection_supersession_not_pass")
    for path, *_ in required:
        if not path.is_file() or path.stat().st_size == 0:
            blockers.append(f"long_form_review_artifact_missing:{path.name}")
    candidate = None
    if not blockers:
        artifacts = tuple(artifact(root, *row) for row in required)
        candidate = create_release_candidate(
            video_id,
            artifacts,
            tool_versions={"patternlab_production_contract": "1"},
            model_versions={"semantic_judge": "qwen3-vl-8b-local"},
        )
        store = PatternLabState(state_path())
        store.migrate()
        store.register_release(candidate)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if candidate is not None else "blocked",
        "release_candidate_id": candidate.release_candidate_id if candidate else "",
        "package_sha256": candidate.package_sha256 if candidate else "",
        "long_form_sha256": qa.get("video_sha256", ""),
        "artifact_count": len(candidate.artifacts) if candidate else 0,
        "scope": "long_form_owner_review_only",
        "owner_approval": "pending",
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report = approval / "long-form-review-release-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Register a strict long-form-only Pattern Lab owner-review release.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
