#!/usr/bin/env python3
"""Write Pattern Lab package dependency hashes and stale-output report."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
import patternlab_script_bootstrap  # noqa: F401

from patternlab.thumbnail import thumbnail_review_manifest_path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def file_info(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"path": display_path(path), "exists": False, "sha256": "", "mtime": 0}
    stat = path.stat()
    return {"path": display_path(path), "exists": True, "sha256": sha256(path), "mtime": stat.st_mtime, "size": stat.st_size}


def canonical_package_hash(video_id: str, dependencies: dict[str, dict[str, Any]], outputs: dict[str, list[dict[str, Any]]]) -> tuple[str, dict[str, Any]]:
    """Hash the immutable package, excluding report timestamps and approvals."""
    entries = []
    for role, info in sorted(dependencies.items()):
        if info.get("exists"):
            entries.append({"role": role, "path": info["path"], "sha256": info["sha256"], "size": info["size"]})
    for role, rows in sorted(outputs.items()):
        for index, info in enumerate(rows, start=1):
            if info.get("exists"):
                entries.append({"role": f"{role}:{index}", "path": info["path"], "sha256": info["sha256"], "size": info["size"]})
    manifest = {"schema_version": 1, "video_id": video_id, "entries": entries}
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), manifest


def newest(paths: list[Path]) -> float:
    return max((p.stat().st_mtime for p in paths if p.exists()), default=0.0)


def valid_retained_narration_binding(path: Path, script: Path, transcript: Path, voice: Path) -> bool:
    if not all(item.is_file() for item in (path, script, transcript, voice)):
        return False
    try:
        binding = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(
        binding.get("status") == "pass"
        and binding.get("authorization") == "owner_retained_existing_narration"
        and binding.get("approved_script", {}).get("sha256") == sha256(script)
        and binding.get("retained_narration_transcript", {}).get("sha256") == sha256(transcript)
        and binding.get("retained_normalized_audio", {}).get("sha256") == sha256(voice)
        and binding.get("new_voice_generation_performed") is False
    )


def valid_shorts_render_receipt(path: Path, shorts: list[Path]) -> bool:
    if not path.is_file() or not shorts:
        return False
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if receipt.get("status") != "pass":
        return False
    rows = receipt.get("shorts")
    if not isinstance(rows, list) or len(rows) != len(shorts):
        return False
    expected = {Path(row.get("path", "")).name: row.get("sha256") for row in rows if isinstance(row, dict)}
    return all(expected.get(short.name) == sha256(short) for short in shorts)


def valid_thumbnail_manifest(path: Path, thumbnails: list[Path]) -> bool:
    if not path.is_file() or len(thumbnails) != 3:
        return False
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    rows = manifest.get("candidates")
    if not isinstance(rows, list) or len(rows) != len(thumbnails):
        return False
    expected = {
        Path(str(row.get("path") or "")).name: str(row.get("sha256") or "")
        for row in rows
        if isinstance(row, dict)
    }
    return all(expected.get(path.name) == sha256(path) for path in thumbnails)


def valid_evidence_binding(path: Path, manifest: Path, script: Path, route: Path) -> bool:
    if not all(item.is_file() for item in (path, manifest, script, route)):
        return False
    try:
        binding = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    intake = Path(str(binding.get("intake_path") or "")).expanduser()
    if not intake.is_absolute():
        intake = BASE / intake
    return bool(
        binding.get("status") == "pass"
        and intake.is_file()
        and binding.get("manifest_sha256") == sha256(manifest)
        and binding.get("script_sha256") == sha256(script)
        and binding.get("visual_route_sha256") == sha256(route)
        and binding.get("intake_sha256") == sha256(intake)
    )


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / 'approval')
    launch = BASE / 'launch' / f'video-{video_id}'
    dependency_paths = {
        'final_script': launch / 'final-script.md',
        'episode_package': launch / 'package.json',
        'evidence_queries': launch / 'evidence-queries.json',
        'visual_route': launch / 'long-form-visual-routing.json',
        'visual_contract': launch / 'visual-contract.json',
        'voiceover_normalized': root / 'audio' / 'voiceover_full_normalized.mp3',
        'rights_ledger': root / 'rights-ledger.csv',
        'shorts_script_package': approval / 'shorts-script-package.json',
        'brand_kit': BASE / 'resources' / 'pattern-lab-brand-tokens.json',
        'evidence_manifest': approval / 'evidence-manifest.json',
        'canonical_render_plan': approval / 'canonical-render-plan.json',
        'thumbnail_candidate_manifest': thumbnail_review_manifest_path(root),
    }
    receipt_paths = {
        'evidence_manifest_binding_receipt': approval / 'evidence-manifest-binding.json',
        'retained_narration_binding_receipt': approval / 'retained-narration-binding.json',
        'shorts_render_receipt': approval / 'shorts-render-report.json',
    }
    output_groups = {
        'long_form_video': [root / 'video' / f'pattern-lab-video-{video_id}-draft.mp4'],
        'voiceover': [root / 'audio' / 'voiceover_full_normalized.mp3'],
        'closed_captions': [root / 'captions' / 'closed-captions-final.srt'],
        'shorts': sorted((root / 'shorts').glob(f'pattern-lab-video-{video_id}-short-*.mp4')),
        'thumbnails': sorted((root / 'images').glob('thumbnail_candidate_*.png')),
    }
    dependencies = {name: file_info(path) for name, path in dependency_paths.items()}
    receipts = {name: file_info(path) for name, path in receipt_paths.items()}
    outputs = {name: [file_info(path) for path in paths] for name, paths in output_groups.items()}
    final_package_hash, final_package_manifest = canonical_package_hash(video_id, dependencies, outputs)
    script_mtime = dependency_paths['final_script'].stat().st_mtime if dependency_paths['final_script'].exists() else 0
    brand_mtime = dependency_paths['brand_kit'].stat().st_mtime if dependency_paths['brand_kit'].exists() else 0
    shorts_pkg_mtime = dependency_paths['shorts_script_package'].stat().st_mtime if dependency_paths['shorts_script_package'].exists() else 0
    stale_outputs: list[dict[str, str]] = []

    def mark_if(group: str, condition: bool, reason: str) -> None:
        if condition:
            stale_outputs.append({"asset_group": group, "reason": reason})

    retained_narration_is_bound = valid_retained_narration_binding(
        receipt_paths['retained_narration_binding_receipt'],
        dependency_paths['final_script'],
        root / 'audio' / 'voiceover_full.txt',
        dependency_paths['voiceover_normalized'],
    )
    shorts_render_is_bound = valid_shorts_render_receipt(
        receipt_paths['shorts_render_receipt'],
        output_groups['shorts'],
    )
    thumbnails_are_bound = valid_thumbnail_manifest(
        dependency_paths['thumbnail_candidate_manifest'],
        output_groups['thumbnails'],
    )
    evidence_is_bound = valid_evidence_binding(
        receipt_paths['evidence_manifest_binding_receipt'],
        dependency_paths['evidence_manifest'],
        dependency_paths['final_script'],
        dependency_paths['visual_route'],
    )
    mark_if(
        'voiceover',
        script_mtime > newest(output_groups['voiceover']) and not retained_narration_is_bound,
        'final script is newer than voiceover outputs and no exact retained-narration binding exists',
    )
    long_form_input_mtime = newest(
        [
            dependency_paths['final_script'],
            dependency_paths['visual_route'],
            dependency_paths['visual_contract'],
            dependency_paths['evidence_manifest'],
            dependency_paths['canonical_render_plan'],
            dependency_paths['voiceover_normalized'],
        ]
    )
    mark_if('long_form_video', long_form_input_mtime > newest(output_groups['long_form_video']), 'script, route, visual contract, evidence manifest, render plan, or voiceover is newer than long-form render')
    mark_if(
        'shorts',
        max(script_mtime, shorts_pkg_mtime, brand_mtime) > newest(output_groups['shorts']) and not shorts_render_is_bound,
        'script, Shorts package, or brand kit is newer than Shorts renders and no exact render receipt exists',
    )
    mark_if(
        'thumbnails',
        brand_mtime > newest(output_groups['thumbnails']) or not thumbnails_are_bound,
        'brand kit is newer than thumbnail renders or the candidate manifest is missing/stale',
    )
    missing_dependency = [name for name, info in dependencies.items() if not info['exists']]
    missing_receipt = [name for name, info in receipts.items() if not info['exists']]
    blockers = [f'missing_dependency:{name}' for name in missing_dependency]
    blockers.extend(f'missing_receipt:{name}' for name in missing_receipt)
    blockers.extend(
        f"stale_output:{item['asset_group']}:{item['reason']}"
        for item in stale_outputs
    )
    if not evidence_is_bound:
        blockers.append('evidence_manifest_binding_missing_or_stale')
    payload = {
        'generated_at': utc_now(),
        'video_id': video_id,
        'status': 'blocked' if blockers else 'pass',
        'dependencies': dependencies,
        'receipts': receipts,
        'outputs': outputs,
        'final_package_hash': final_package_hash,
        'final_package_manifest': final_package_manifest,
        'stale_outputs': stale_outputs,
        'retained_narration_binding_valid': retained_narration_is_bound,
        'shorts_render_receipt_valid': shorts_render_is_bound,
        'thumbnail_candidate_manifest_valid': thumbnails_are_bound,
        'evidence_manifest_binding_valid': evidence_is_bound,
        'blockers': blockers,
        'youtube_mutation': 'not_performed',
    }
    json_path = approval / 'package-hash-report.json'
    md_path = approval / 'package-hash-report.md'
    json_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    lines = [f'# Pattern Lab Package Hashes: Video {video_id}', '', f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", f"Final package hash: `{final_package_hash}`", '', '## Stale Outputs', '']
    lines.extend([f"- {item['asset_group']}: {item['reason']}" for item in stale_outputs] or ['- none'])
    lines.extend(['', '## Blockers', ''])
    lines.extend([f'- {b}' for b in blockers] or ['- none'])
    md_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate Pattern Lab package hash report.')
    parser.add_argument('--video-id', default='04')
    args = parser.parse_args()
    payload, _, md = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Package hash report: {display_path(md)}")
    if payload['status'] != 'pass':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
