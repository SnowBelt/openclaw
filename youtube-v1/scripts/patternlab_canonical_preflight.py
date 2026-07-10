#!/usr/bin/env python3
"""Validate an explicit evidence manifest and emit a deterministic OTIO timeline."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

import opentimelineio as otio

from patternlab.evidence import EvidenceError, load_manifest, verify_manifest_assets
from patternlab.timeline import timeline_from_manifest
from patternlab_common import display_path, ensure_dir, output_root, utc_now


def build_report(video_id: str, manifest_path: Path | None = None) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest_path = manifest_path or approval / "evidence-manifest.json"
    otio_path = root / "video" / f"pattern-lab-video-{video_id}.otio"
    blockers: list[str] = []
    manifest = None
    try:
        manifest = load_manifest(manifest_path)
        if manifest.episode_id != video_id:
            raise EvidenceError(f"evidence_manifest_video_mismatch:{manifest.episode_id}")
        verify_manifest_assets(manifest, root)
    except EvidenceError as exc:
        blockers.append(str(exc))
    if not blockers and manifest is not None:
        otio_path.parent.mkdir(parents=True, exist_ok=True)
        otio.adapters.write_to_file(timeline_from_manifest(manifest), str(otio_path))
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "manifest": display_path(manifest_path),
        "otio_timeline": display_path(otio_path),
        "claim_count": len(manifest.claims) if manifest else 0,
        "asset_count": len(manifest.assets) if manifest else 0,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "canonical-preflight-report.json"
    md_path = approval / "canonical-preflight-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Canonical Preflight: Video {video_id}", "", f"Status: {payload['status']}",
        f"Manifest: `{payload['manifest']}`", f"OTIO timeline: `{payload['otio_timeline']}`", "", "## Blockers", "",
        *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab evidence and emit an OTIO timeline.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), Path(args.manifest) if args.manifest else None)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
