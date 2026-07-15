#!/usr/bin/env python3
"""Register only a complete hash-verified Pattern Lab owner-review release."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.evidence import EvidenceError, load_manifest, verify_manifest_assets
from patternlab.models import Artifact, EpisodeState
from patternlab.release import artifact_from_path, create_release_candidate
from patternlab.state import PatternLabState, sha256_file
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def state_path() -> Path:
    return Path(__import__("os").environ.get("PATTERNLAB_STATE_DB", BASE / "local-output" / "patternlab.sqlite3"))


def artifact_base(path: Path, output: Path) -> Path:
    """Choose a stable relative namespace for repo files and external media stores."""
    resolved = path.resolve()
    for candidate in (output.resolve(), BASE.resolve()):
        try:
            resolved.relative_to(candidate)
            return candidate
        except ValueError:
            continue
    return resolved.parent


def report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    package_report = approval / "package-hash-report.json"
    evidence_path = approval / "evidence-manifest.json"
    preflight_report = approval / "canonical-preflight-report.json"
    required_gate_paths = {
        "media_qa": approval / "media-qa-report.json",
        "package_completeness": approval / "package-completeness-report.json",
    }
    blockers: list[str] = []
    package: dict = {}
    if not package_report.exists():
        blockers.append("package_hash_report_missing")
    else:
        try:
            package = json.loads(package_report.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            blockers.append("package_hash_report_invalid_json")
        if package and package.get("status") != "pass":
            blockers.append("package_hash_report_not_pass")
    if not preflight_report.exists():
        blockers.append("canonical_preflight_report_missing")
    else:
        try:
            if json.loads(preflight_report.read_text(encoding="utf-8")).get("status") != "pass":
                blockers.append("canonical_preflight_not_pass")
        except json.JSONDecodeError:
            blockers.append("canonical_preflight_report_invalid_json")
    gate_hashes: dict[str, str] = {}
    for gate_name, gate_path in required_gate_paths.items():
        if not gate_path.is_file():
            blockers.append(f"release_gate_missing:{gate_name}")
            continue
        try:
            gate_payload = json.loads(gate_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            blockers.append(f"release_gate_invalid_json:{gate_name}")
            continue
        if (
            gate_payload.get("status") != "pass"
            or gate_payload.get("blockers")
            or gate_payload.get("warnings")
        ):
            blockers.append(f"release_gate_not_clean_pass:{gate_name}")
        gate_hashes[gate_name] = sha256_file(gate_path)
    manifest = None
    try:
        manifest = load_manifest(evidence_path)
        verify_manifest_assets(manifest, root)
    except EvidenceError as exc:
        blockers.append(str(exc))
    release_candidate = None
    if not blockers and manifest is not None:
        artifacts: list[Artifact] = []
        for asset in manifest.assets:
            artifacts.append(artifact_from_path(root, root / asset.relative_path, asset.asset_id, "evidence_asset", role=asset.evidence_fit, source_ids=[asset.source_id]))
        seen_package_paths: set[Path] = set()
        for entry in package.get("final_package_manifest", {}).get("entries", []):
            entry_path = Path(entry["path"])
            path = entry_path if entry_path.is_absolute() else BASE / entry_path
            if not path.exists():
                blockers.append(f"package_artifact_missing:{entry['path']}")
                continue
            resolved_path = path.resolve()
            if resolved_path in seen_package_paths:
                continue
            seen_package_paths.add(resolved_path)
            artifact_id = f"package-{entry['role'].replace(':', '-') }"
            artifacts.append(artifact_from_path(artifact_base(path, root), path, artifact_id, "package_asset", role=entry["role"]))
        if not blockers:
            release_candidate = create_release_candidate(video_id, artifacts, tool_versions={"canonical_state": "1", "otio": "0.18.1"})
            store = PatternLabState(state_path())
            store.migrate()
            store.ensure_episode(video_id)
            current = store.episode(video_id)["state"]
            sequence = [EpisodeState.EVIDENCE_LOCKED, EpisodeState.SCRIPT_LOCKED, EpisodeState.TIMELINE_LOCKED, EpisodeState.RENDER_VERIFIED, EpisodeState.AWAITING_OWNER_REVIEW]
            if current == EpisodeState.AWAITING_OWNER_REVIEW.value:
                remaining: list[EpisodeState] = []
            else:
                state_values = [target.value for target in sequence]
                if current == EpisodeState.TOPIC_QUALIFIED.value:
                    remaining = sequence
                elif current in state_values:
                    remaining = sequence[state_values.index(current) + 1 :]
                else:
                    blockers.append(f"episode_state_not_reopenable_for_owner_review:{current}")
                    remaining = []
            for target in remaining:
                if current == target.value:
                    continue
                store.transition(video_id, target)
                current = target.value
            if not blockers:
                store.register_release(release_candidate)
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pass" if release_candidate and not blockers else "blocked",
        "release_candidate_id": release_candidate.release_candidate_id if release_candidate else "",
        "package_sha256": release_candidate.package_sha256 if release_candidate else "",
        "required_gate_sha256": gate_hashes,
        "state_db": str(state_path()), "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "canonical-release-registration-report.json"
    md_path = approval / "canonical-release-registration-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Canonical Release Registration: Video {video_id}", "", f"Status: {payload['status']}",
        f"Release candidate: `{payload['release_candidate_id'] or 'not created'}`", f"Package hash: `{payload['package_sha256'] or 'not available'}`", "", "## Blockers", "",
        *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Register a complete Pattern Lab release candidate.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
