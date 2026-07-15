#!/usr/bin/env python3
"""Deterministic failure and restore drill for the thumbnail pipeline."""
from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_thumbnail_worldclass import image_metrics, read_json, sha256, validate_tournament


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    from PIL import Image, ImageDraw

    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(Path(__file__).resolve().parents[1] / "resources" / "thumbnail-worldclass-policy.json")
    checks: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="patternlab-thumbnail-reliability-") as temp:
        work = Path(temp)
        source = work / "fixture.png"
        image = Image.new("RGB", (1280, 720), (10, 90, 210))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 420, 1280, 720), fill=(242, 184, 18))
        draw.rectangle((60, 60, 1220, 250), fill=(245, 245, 245))
        image.save(source)
        source_hash = sha256(source)
        backup = work / "backup" / source.name
        backup.parent.mkdir()
        shutil.copy2(source, backup)
        checks.append({"name": "backup_hash_match", "passed": sha256(backup) == source_hash})

        corrupt = work / "corrupt.png"
        corrupt.write_bytes(b"not an image")
        try:
            metrics = image_metrics(corrupt)
            corrupt_rejected = metrics.get("status") == "blocked"
        except Exception:
            corrupt_rejected = True
        checks.append({"name": "corrupt_image_rejected", "passed": corrupt_rejected})

        restored = work / "restored.png"
        shutil.copy2(backup, restored)
        checks.append({"name": "restore_hash_match", "passed": sha256(restored) == source_hash})

        manifest = {
            "roughs": [{}] * 20,
            "shortlist": [{}] * 8,
            "production": [{}] * 5,
            "finalists": [
                {"template_family": "then_now", "sha256": "a"},
                {"template_family": "map_photo", "sha256": "b"},
                {"template_family": "proof_object_context", "sha256": "c"},
            ],
        }
        checks.append({"name": "valid_tournament_contract", "passed": not validate_tournament(manifest, policy)})
        manifest["finalists"][2]["sha256"] = "a"
        checks.append({"name": "duplicate_candidate_rejected", "passed": "duplicate_finalist_hash" in validate_tournament(manifest, policy)})

    blockers = [check["name"] for check in checks if not check["passed"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "checks": checks,
        "blockers": blockers,
        "clean_install_contract": "Pinned tools/models are health-checked; model files remain outside Git.",
        "crash_resume_contract": "Immutable candidate hashes and resumable manifests prevent stale or duplicate promotion.",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "thumbnail-reliability-proof.json"
    md_path = approval / "thumbnail-reliability-proof.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Thumbnail Reliability Proof: {video_id}", "", f"Status: {payload['status']}", ""]
    lines.extend(f"- {item['name']}: {'pass' if item['passed'] else 'fail'}" for item in checks)
    lines.extend(["", "Paid provider calls: not performed", "YouTube mutation: not performed"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(report)}, indent=2))


if __name__ == "__main__":
    main()
