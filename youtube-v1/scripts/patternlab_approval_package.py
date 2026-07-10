#!/usr/bin/env python3
import argparse
import csv
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


REVIEW_PACKAGE_APPROVAL_TYPES = ["image", "voiceover", "proof_footage", "video", "short"]
QUALITY_REPORTS = [
    ("quality_gates", "quality-gates-report.json"),
    ("monetization", "monetization-gates-report.json"),
    ("content", "content-quality-report.json"),
    ("retention_ladder", "retention-ladder-report.json"),
    ("long_form", "long-form-quality-report.json"),
    ("synthetic_disclosure", "synthetic-disclosure-report.json"),
    ("visual_quality", "visual-quality-report.json"),
    ("visual_variety", "visual-variety-report.json"),
    ("motion_polish", "motion-polish-report.json"),
    ("benchmark_growth", "benchmark-growth-report.json"),
    ("guru_growth", "guru-growth-report.json"),
    ("shorts", "shorts-quality-report.json"),
    ("thumbnail_factory", "thumbnail-factory-report.json"),
    ("thumbnail_visible_source_audit", "thumbnail-visible-source-audit-report.json"),
    ("thumbnail", "thumbnail-quality-report.json"),
    ("james_persona", "james-persona-validation.json"),
    ("james_avatar", "james-avatar-validation.json"),
]
THUMBNAIL_ONLY_QUALITY_REPORTS = [
    ("quality_gates", "quality-gates-report.json"),
    ("source_rights", "source-rights-report.json"),
    ("thumbnail_factory", "thumbnail-factory-report.json"),
    ("thumbnail_visible_source_audit", "thumbnail-visible-source-audit-report.json"),
    ("thumbnail", "thumbnail-quality-report.json"),
]


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None




def real_city_thumbnail_test(root):
    report = read_json(root / "approval" / "real-city-source-asset-report.json") or {}
    manifest = read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json") or {}
    thumbnail_factory = read_json(root / "approval" / "thumbnail-factory-report.json") or {}
    visible_source_audit = read_json(root / "approval" / "thumbnail-visible-source-audit-report.json") or {}
    source_backed_factory = (
        thumbnail_factory.get("status") == "pass"
        and visible_source_audit.get("status") == "pass"
        and int(visible_source_audit.get("visible_real_photo_count", 0)) >= 5
        and int(visible_source_audit.get("photo_hero_or_major_inset_count", 0)) >= 5
        and int(visible_source_audit.get("map_only_concept_count", 0)) == 0
        and int(visible_source_audit.get("unmanifested_visible_source_count", 0)) == 0
    )
    return (
        bool(report.get("real_city_asset_count"))
        and manifest.get("real_world_city_test") is True
        and manifest.get("synthetic_mockup_allowed") is False
    ) or source_backed_factory

def read_ledger(root):
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def approved(row):
    return row.get("human_review_status", "").lower() == "approved"


def unresolved_repairs(root):
    path = root / "approval" / "repair-queue.jsonl"
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                rows.append({"status": "queued", "reason": "unparseable repair queue row"})
                continue
            if event.get("status", "queued") not in {"resolved", "closed", "cancelled"}:
                rows.append(event)
    return rows


def refresh_quality_reports(video_id):
    commands = [
        ["youtube-v1/scripts/generate_canva_thumbnail_brief.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_thumbnail_factory.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_synthetic_disclosure.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_benchmark_growth.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_guru_growth_gates.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_quality_gates.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_visual_quality.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_visual_variety.py", "--video-id", video_id],
        ["youtube-v1/scripts/patternlab_motion_polish.py", "--video-id", video_id],
        ["youtube-v1/scripts/monetization_gates.py", "--video-id", video_id],
        ["youtube-v1/scripts/validate_james_avatar.py", "--video-id", video_id],
        ["youtube-v1/scripts/validate_james_persona.py", "--video-id", video_id],
    ]
    results = []
    for command in commands:
        result = subprocess.run(
            [sys.executable, *command],
            cwd=BASE.parent,
            capture_output=True,
            text=True,
            check=False,
        )
        results.append(
            {
                "command": "python3 " + " ".join(command),
                "exit_code": result.returncode,
                "stdout": result.stdout.strip()[-2000:],
                "stderr": result.stderr.strip()[-2000:],
            }
        )
    return {
        "commands": results,
        "status": "pass" if all(item["exit_code"] == 0 for item in results) else "blocked",
    }


def quality_statuses(root, thumbnail_only=False):
    statuses = []
    reports = THUMBNAIL_ONLY_QUALITY_REPORTS if thumbnail_only else QUALITY_REPORTS
    for name, filename in reports:
        path = root / "approval" / filename
        payload = read_json(path)
        statuses.append(
            {
                "name": name,
                "path": display_path(path),
                "status": payload.get("status") if payload else "missing",
                "pass": bool(payload and payload.get("status") == "pass"),
            }
        )
    return statuses


def default_thumbnail(metadata):
    if not metadata:
        return "images/thumbnail_candidate_a.png"
    return metadata.get("default_thumbnail") or "images/thumbnail_candidate_a.png"


def target_rows(rows, metadata, review_package_approval_types=None):
    targets = []
    blockers = []
    by_type = Counter(row.get("asset_type", "") for row in rows)
    approval_types = review_package_approval_types or REVIEW_PACKAGE_APPROVAL_TYPES
    for asset_type in approval_types:
        typed = [row for row in rows if row.get("asset_type") == asset_type]
        if not typed:
            blockers.append(f"Review package cannot approve missing asset type: {asset_type}.")
        targets.extend(typed)
    thumbnail = default_thumbnail(metadata)
    matching_thumbnails = [
        row
        for row in rows
        if row.get("asset_type") == "thumbnail" and row.get("filename") == thumbnail
    ]
    if not matching_thumbnails:
        blockers.append(f"Review package cannot approve missing selected thumbnail row: {thumbnail}.")
    targets.extend(matching_thumbnails)
    return targets, blockers, by_type


def build_approval_package_report(video_id, refresh_quality=False):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    refresh = refresh_quality_reports(video_id) if refresh_quality else None
    rows = read_ledger(root)
    metadata = read_json(approval / "upload-metadata.json")
    repairs = unresolved_repairs(root)
    thumbnail_only = real_city_thumbnail_test(root)
    qualities = quality_statuses(root, thumbnail_only=thumbnail_only)
    review_types = ["image", "thumbnail"] if thumbnail_only else REVIEW_PACKAGE_APPROVAL_TYPES
    targets, target_blockers, by_type = target_rows(rows, metadata, review_types)
    blockers = list(target_blockers)
    if not rows:
        blockers.append("Rights ledger is missing or empty.")
    if not metadata:
        blockers.append("Upload metadata is missing or invalid.")
    if repairs:
        blockers.append(f"Unresolved repair queue items exist: {len(repairs)}.")
    for quality in qualities:
        if not quality["pass"]:
            blockers.append(f"Quality report is not passing: {quality['name']} ({quality['status']}).")
    target_counts = Counter(row.get("asset_type", "") for row in targets)
    pending_targets = [
        {
            "asset_id": row.get("asset_id", ""),
            "asset_type": row.get("asset_type", ""),
            "filename": row.get("filename", ""),
            "current_status": row.get("human_review_status", ""),
        }
        for row in targets
        if not approved(row)
    ]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "ready-for-review-package-approval" if not blockers else "blocked-before-review-package-approval",
        "does_not_approve_private_upload": True,
        "does_not_approve_public_publish": True,
        "real_city_thumbnail_test": thumbnail_only,
        "thumbnail_only_review_package": thumbnail_only,
        "selected_thumbnail": default_thumbnail(metadata),
        "quality_refresh": refresh or {},
        "quality_reports": qualities,
        "rights_ledger_counts": dict(sorted(by_type.items())),
        "target_counts": dict(sorted(target_counts.items())),
        "pending_target_count": len(pending_targets),
        "pending_targets": pending_targets,
        "blockers": blockers,
    }
    json_report = approval / "review-package-approval-readiness.json"
    md_report = approval / "review-package-approval-readiness.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Review Package Approval Readiness: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Safety Boundary",
        "",
        "- This approval marks reviewed media assets as owner-approved.",
        "- Real-city thumbnail tests approve/review thumbnail and image-pack assets only; they do not claim voiceover/video/short readiness.",
        "- This approval does not approve private/unlisted upload.",
        "- This approval does not approve public publishing.",
        "",
        "## Approval Targets",
        "",
        f"- Selected thumbnail: `{payload['selected_thumbnail']}`",
    ]
    for asset_type, count in sorted(target_counts.items()):
        lines.append(f"- {asset_type}: {count} rows")
    lines.extend(["", "## Quality Reports", ""])
    for quality in qualities:
        lines.append(f"- {quality['name']}: {quality['status']} ({quality['path']})")
    lines.extend(["", "## Pending Target Rows", ""])
    if pending_targets:
        for row in pending_targets:
            lines.append(f"- {row['asset_type']} `{row['filename']}` ({row['current_status'] or 'missing'})")
    else:
        lines.append("- none")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Check Pattern Lab review package approval readiness.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--refresh-quality", action="store_true")
    args = parser.parse_args()
    payload, _, md_report = build_approval_package_report(args.video_id, refresh_quality=args.refresh_quality)
    print(f"Status: {payload['status']}")
    print(f"Review package approval readiness: {display_path(md_report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
