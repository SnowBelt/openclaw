#!/usr/bin/env python3
"""Write Pattern Lab package dependency hashes and stale-output report."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


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


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / 'approval')
    launch = BASE / 'launch' / f'video-{video_id}'
    dependency_paths = {
        'final_script': launch / 'final-script.md',
        'voiceover_normalized': root / 'audio' / 'voiceover_full_normalized.mp3',
        'visual_beat_plan': root / 'video' / f'pattern-lab-video-{video_id}-visual-beat-plan.md',
        'rights_ledger': root / 'rights-ledger.csv',
        'thumbnail_factory': approval / 'thumbnail-factory-report.json',
        'shorts_script_package': approval / 'shorts-script-package.json',
        'brand_kit': BASE / 'resources' / 'pattern-lab-brand-tokens.json',
        'source_manifest': root / 'source-packet' / 'visual-rebuild' / 'visual-rebuild-manifest.json',
    }
    output_groups = {
        'long_form_video': [root / 'video' / f'pattern-lab-video-{video_id}-draft.mp4'],
        'voiceover': [root / 'audio' / 'voiceover_full.mp3', root / 'audio' / 'voiceover_full_normalized.mp3'],
        'shorts': sorted((root / 'shorts').glob(f'pattern-lab-video-{video_id}-short-*.mp4')),
        'thumbnails': sorted((root / 'images').glob('thumbnail_candidate_*.png')),
        'owner_packet': [root / 'review' / 'owner-review-packet.md'],
    }
    dependencies = {name: file_info(path) for name, path in dependency_paths.items()}
    outputs = {name: [file_info(path) for path in paths] for name, paths in output_groups.items()}
    final_package_hash, final_package_manifest = canonical_package_hash(video_id, dependencies, outputs)
    script_mtime = dependency_paths['final_script'].stat().st_mtime if dependency_paths['final_script'].exists() else 0
    brand_mtime = dependency_paths['brand_kit'].stat().st_mtime if dependency_paths['brand_kit'].exists() else 0
    visual_mtime = dependency_paths['visual_beat_plan'].stat().st_mtime if dependency_paths['visual_beat_plan'].exists() else 0
    shorts_pkg_mtime = dependency_paths['shorts_script_package'].stat().st_mtime if dependency_paths['shorts_script_package'].exists() else 0
    stale_outputs: list[dict[str, str]] = []

    def mark_if(group: str, condition: bool, reason: str) -> None:
        if condition:
            stale_outputs.append({"asset_group": group, "reason": reason})

    mark_if('voiceover', script_mtime > newest(output_groups['voiceover']), 'final script is newer than voiceover outputs')
    mark_if('long_form_video', max(script_mtime, visual_mtime, newest(output_groups['voiceover'])) > newest(output_groups['long_form_video']), 'script, visual plan, or voiceover is newer than long-form render')
    mark_if('shorts', max(script_mtime, shorts_pkg_mtime, brand_mtime) > newest(output_groups['shorts']), 'script, Shorts package, or brand kit is newer than Shorts renders')
    mark_if('thumbnails', brand_mtime > newest(output_groups['thumbnails']), 'brand kit is newer than thumbnail renders')
    missing_dependency = [name for name, info in dependencies.items() if not info['exists']]
    blockers = [f'missing_dependency:{name}' for name in missing_dependency]
    blockers.extend(
        f"stale_output:{item['asset_group']}:{item['reason']}"
        for item in stale_outputs
    )
    payload = {
        'generated_at': utc_now(),
        'video_id': video_id,
        'status': 'blocked' if blockers else 'pass',
        'dependencies': dependencies,
        'outputs': outputs,
        'final_package_hash': final_package_hash,
        'final_package_manifest': final_package_manifest,
        'stale_outputs': stale_outputs,
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
