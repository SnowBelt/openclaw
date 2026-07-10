#!/usr/bin/env python3
"""One-command Pattern Lab status surface."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_readiness_truth_summary import build_truth_summary
from patternlab_discord_feedback import read_jsonl, unresolved_repairs


MANDATORY_REPORTS = {
    "package_hash": "package-hash-report.json",
    "private_readiness": "private-upload-readiness.json",
    "shorts_quality": "shorts-quality-report.json",
    "quality_gates": "quality-gates-report.json",
    "voice_visual_match": "voice-visual-match-report.json",
    "finished_watchdown": "finished-video-watchdown-report.json",
}


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def readiness_status(approval: Path, name: str) -> tuple[str, str]:
    """Return a fail-closed status for a mandatory report."""
    filename = MANDATORY_REPORTS[name]
    path = approval / filename
    payload = read_json(path)
    if payload:
        status = str(payload.get("status", "missing"))
        if name == "private_readiness":
            status = "pass" if status == "private-upload-ready" else status
        return status, display_path(path)
    if name == "private_readiness":
        legacy = approval / "private-upload-readiness.md"
        if legacy.exists():
            for line in legacy.read_text(encoding="utf-8").splitlines():
                if line.startswith("Status:"):
                    value = line.split(":", 1)[1].strip()
                    return ("pass" if value == "private-upload-ready" else value), display_path(legacy)
    return "missing", display_path(path)


def mandatory_blockers(approval: Path, package_hash: dict) -> list[str]:
    blockers = []
    for name in MANDATORY_REPORTS:
        status, path = readiness_status(approval, name)
        if status != "pass":
            blockers.append(f"{name}:{status}:{path}")
    if package_hash.get("stale_outputs") or package_hash.get("blockers"):
        if not any(item.startswith("package_hash:") for item in blockers):
            blockers.append("package_hash:blocked:package freshness or dependency blockers are present")
    return blockers


def build_status(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / 'approval')
    truth, _, _ = build_truth_summary(video_id)
    upload = read_json(approval / 'youtube-upload-report.json')
    discord = read_json(approval / 'discord-review-packet-quality-report.json')
    feedback_events = read_jsonl(approval / 'owner-feedback.jsonl')
    open_repairs = unresolved_repairs(root)
    package_hash = read_json(approval / 'package-hash-report.json')
    public_report = read_json(approval / 'public-publish-report.json')
    upload_currency = read_json(approval / 'upload-currency-report.json')
    related_video_report = read_json(approval / 'related-video-setup-report.json')
    bridge_comments_report = read_json(approval / 'bridge-comments-report.json')
    metrics_baseline = read_json(root / 'metrics' / f'video-{video_id}-post-public-metrics-baseline.json')
    public_state = 'published' if public_report.get('status') == 'published' else truth.get('public_publish')
    related_video_state = related_video_report.get('status', 'missing')
    bridge_comments_state = bridge_comments_report.get('status', 'missing')
    metrics_state = metrics_baseline.get('status', 'pending_public_publish' if public_state != 'published' else 'missing')
    upload_currency_state = upload_currency.get('status', 'missing')
    private_state = truth.get('private_upload_action', {}).get('status', 'missing')
    mandatory = mandatory_blockers(approval, package_hash)
    if mandatory:
        package_lock = 'blocked'
    elif open_repairs:
        package_lock = 'repair_required'
    elif private_state == 'already_uploaded_current_package_private_or_unlisted':
        package_lock = 'locked_uploaded'
    elif private_state == 'approved_but_current_package_not_uploaded_after_rebuild':
        package_lock = 'approved_reupload_required'
    elif upload.get('status') == 'uploaded':
        package_lock = 'uploaded_but_currency_unknown'
    else:
        package_lock = 'unlocked'
    if mandatory:
        next_action = 'Resolve the mandatory package blockers before any owner approval or public-publish decision.'
    elif open_repairs:
        next_action = 'Resolve the open targeted repair queue items, rerun affected validators, then resend only repaired assets for owner review.'
    elif private_state == 'approved_but_current_package_not_uploaded_after_rebuild':
        next_action = 'Current local media is newer than the private upload report; perform an approval-gated replacement private/unlisted upload before any public launch.'
    elif discord.get('status') != 'pass':
        next_action = 'Regenerate and validate the Discord review packet before relying on owner button feedback.'
    elif upload_currency_state != 'pass':
        next_action = 'Regenerate the upload currency report and resolve any local-media mismatch before public launch.'
    elif public_state == 'blocked_until_explicit_owner_approval':
        next_action = 'Wait for explicit owner public-publish approval after YouTube Studio checks.'
    elif len(feedback_events) == 0:
        next_action = 'Collect real owner feedback in Discord; dry-run feedback validation is complete but learning has no real events yet.'
    elif public_state == 'published' and related_video_state != 'pass':
        next_action = 'Set or manually confirm Related Video on each Short after exact owner approval.'
    elif public_state == 'published' and bridge_comments_state != 'pass':
        next_action = 'Post/pin or manually confirm bridge comments after exact owner approval.'
    elif public_state == 'published' and metrics_state in {'missing', 'pending_public_publish'}:
        next_action = 'Create post-public metrics baseline and wait for the first analytics checkpoint.'
    else:
        next_action = 'Run the next approval-gated launch or analytics step shown in public readiness.'
    payload = {
        'generated_at': utc_now(),
        'video_id': video_id,
        'status': 'blocked' if mandatory else ('awaiting_owner_approval' if public_state == 'blocked_until_explicit_owner_approval' else 'pass'),
        'package_lock_state': package_lock,
        'private_upload_state': private_state,
        'discord_review_state': discord.get('status', 'missing'),
        'upload_currency_state': upload_currency_state,
        'real_owner_feedback_events': len(feedback_events),
        'open_repair_count': len(open_repairs),
        'public_publish_state': public_state,
        'related_video_state': related_video_state,
        'bridge_comments_state': bridge_comments_state,
        'metrics_checkpoint_state': metrics_state,
        'analytics_state': truth.get('analytics_oauth', {}).get('status', 'missing'),
        'stale_output_count': len(package_hash.get('stale_outputs', [])) if package_hash else 'missing',
        'mandatory_blockers': mandatory,
        'exact_next_action': next_action,
        'youtube_mutation': 'not_performed',
    }
    json_path = approval / 'patternlab-status.json'
    md_path = approval / 'patternlab-status.md'
    json_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    lines = [f'# Pattern Lab Status: Video {video_id}', '', f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", '', '## Current State', '']
    for key in ['package_lock_state','private_upload_state','discord_review_state','upload_currency_state','real_owner_feedback_events','open_repair_count','public_publish_state','related_video_state','bridge_comments_state','metrics_checkpoint_state','analytics_state','stale_output_count']:
        lines.append(f'- {key}: {payload[key]}')
    lines.extend(['', '## Exact Next Action', '', f"- {payload['exact_next_action']}", '', 'YouTube mutation: not performed', ''])
    lines.extend(['## Mandatory Blockers', '', *([f'- {item}' for item in mandatory] or ['- none']), ''])
    md_path.write_text('\n'.join(lines), encoding='utf-8')
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description='Print one Pattern Lab status surface.')
    parser.add_argument('--video-id', default='04')
    args = parser.parse_args()
    payload, _, md = build_status(args.video_id)
    print(json.dumps(payload, indent=2))
    print(f"Pattern Lab status: {display_path(md)}")


if __name__ == '__main__':
    main()
