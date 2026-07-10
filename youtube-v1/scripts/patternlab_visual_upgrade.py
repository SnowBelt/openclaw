#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, append_ledger, display_path, ensure_dir, output_root, utc_now


AVATAR_CONCEPTS = [
    ("james_avatar_concept_a.png", "James Avatar A", "Owner-approved real visual reference", "selected"),
    ("james_avatar_concept_b.png", "James Avatar B", "Criteria host", "alternate"),
    ("james_avatar_concept_c.png", "James Avatar C", "Abstract voice mark", "safest"),
]
AVATAR_DIR = BASE / "resources" / "channel-branding" / "final" / "presenter-avatar"
CANONICAL_AVATAR = AVATAR_DIR / "james-canonical-avatar.png"
CANONICAL_MANIFEST = AVATAR_DIR / "james-avatar-manifest.json"
CANONICAL_VIDEO_AVATAR = "james_avatar_concept_a.png"
REFERENCE_RULE = (
    "Break the symmetry intentionally: uneven brows, eyes, smile, nose alignment, "
    "and natural face proportions while keeping him friendly and usable."
)

STYLEBOARDS = [
    ("visual_mode_lab.png", "Lab Mode", "tables, proof, scorecards, row-by-row evidence"),
    ("visual_mode_judgment.png", "Judgment Mode", "pass, revise, reject decision punctuation"),
    ("visual_mode_field.png", "Field Mode", "generated context scenes used only when they support narration"),
]


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def approval_status(root):
    payload = read_json(root / "approval" / "james-avatar-approval.json")
    if not payload:
        manifest = read_json(CANONICAL_MANIFEST)
        if CANONICAL_AVATAR.exists() and manifest and manifest.get("status") == "owner-approved":
            return {
                "status": "approved",
                "selected_avatar": CANONICAL_VIDEO_AVATAR,
                "approved_at": "global-canonical-avatar",
            }
        return {
            "status": "owner-review-required",
            "selected_avatar": "",
            "approved_at": "",
        }
    return {
        "status": payload.get("status", "approved"),
        "selected_avatar": payload.get("selected_avatar", ""),
        "approved_at": payload.get("approved_at", ""),
    }


def copy_canonical_avatar(root, dry_run=False):
    target = ensure_dir(root / "visual-upgrade") / CANONICAL_VIDEO_AVATAR
    manifest = read_json(CANONICAL_MANIFEST) or {}
    if not CANONICAL_AVATAR.exists():
        return {
            "status": "missing",
            "source": display_path(CANONICAL_AVATAR),
            "target": display_path(target),
        }
    if dry_run:
        return {
            "status": "dry-run",
            "source": display_path(CANONICAL_AVATAR),
            "target": display_path(target),
            "manifest_status": manifest.get("status", ""),
        }
    shutil.copy2(CANONICAL_AVATAR, target)
    return {
        "status": "applied",
        "source": display_path(CANONICAL_AVATAR),
        "target": display_path(target),
        "manifest_status": manifest.get("status", ""),
    }


def run_swift(video_id, root, dry_run=False):
    command = [
        "swift",
        "-module-cache-path",
        "/private/tmp/patternlab-swift-module-cache",
        "youtube-v1/scripts/create_visual_upgrade_pack.swift",
        "--video-id",
        video_id,
        "--output-root",
        str(root.relative_to(BASE.parent)),
    ]
    if dry_run:
        return {"command": " ".join(command), "status": "dry-run"}
    result = subprocess.run(command, cwd=BASE.parent, capture_output=True, text=True, check=False)
    return {
        "command": " ".join(command),
        "status": "pass" if result.returncode == 0 else "fail",
        "exit_code": result.returncode,
        "stdout": result.stdout.strip()[-4000:],
        "stderr": result.stderr.strip()[-4000:],
    }


def write_reports(video_id, root, render_step, canonical_step):
    visual_dir = ensure_dir(root / "visual-upgrade")
    approval = ensure_dir(root / "approval")
    avatar_approval = approval_status(root)
    assets = []
    for filename, title, description, recommendation in AVATAR_CONCEPTS:
        path = visual_dir / filename
        assets.append(
            {
                "filename": str(path.relative_to(root)),
                "title": title,
                "kind": "avatar_concept",
                "description": description,
                "recommendation": recommendation,
                "exists": path.exists(),
                "human_review_required": True,
                "human_review_status": "approved" if avatar_approval["selected_avatar"] == filename else "pending",
            }
        )
        if path.exists():
            append_ledger(
                root,
                {
                    "asset_id": f"video-{video_id}-james-avatar-{filename.removesuffix('.png').split('_')[-1]}",
                    "asset_type": "avatar",
                    "filename": str(path.relative_to(root)),
                    "tool": "Codex image generation" if filename == CANONICAL_VIDEO_AVATAR and canonical_step.get("status") == "applied" else "Local AppKit vector render",
                    "model_or_service": "imagegen skill / built-in image generation" if filename == CANONICAL_VIDEO_AVATAR and canonical_step.get("status") == "applied" else "create_visual_upgrade_pack.swift",
                    "source_prompt_or_source_file": "youtube-v1/resources/channel-branding/final/presenter-avatar/james-avatar-manifest.json" if filename == CANONICAL_VIDEO_AVATAR and canonical_step.get("status") == "applied" else "youtube-v1/scripts/patternlab_visual_upgrade.py",
                    "license_status": "owner-approved original Pattern Lab presenter avatar" if filename == CANONICAL_VIDEO_AVATAR and canonical_step.get("status") == "applied" else "original Pattern Lab approval concept",
                    "created_at": utc_now(),
                    "notes": "Canonical James avatar reference; no lip-sync approved" if filename == CANONICAL_VIDEO_AVATAR and canonical_step.get("status") == "applied" else "James presenter concept; not used in video until owner approval",
                    "human_review_required": "yes",
                    "human_review_status": "approved" if avatar_approval["selected_avatar"] == filename else "pending",
                },
            )
    for filename, title, description in STYLEBOARDS:
        path = visual_dir / filename
        assets.append(
            {
                "filename": str(path.relative_to(root)),
                "title": title,
                "kind": "visual_styleboard",
                "description": description,
                "exists": path.exists(),
                "human_review_required": False,
                "human_review_status": "reference",
            }
        )
        if path.exists():
            append_ledger(
                root,
                {
                    "asset_id": f"video-{video_id}-{filename.removesuffix('.png')}",
                    "asset_type": "visual_styleboard",
                    "filename": str(path.relative_to(root)),
                    "tool": "Local AppKit vector render",
                    "model_or_service": "create_visual_upgrade_pack.swift",
                    "source_prompt_or_source_file": "youtube-v1/scripts/patternlab_visual_upgrade.py",
                    "license_status": "original Pattern Lab visual style reference",
                    "created_at": utc_now(),
                    "notes": "Visual upgrade reference; not a public asset until owner approval",
                    "human_review_required": "no",
                    "human_review_status": "reference",
                },
            )

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "avatar-approved" if avatar_approval["status"] == "approved" else "owner-review-required",
        "avatar_approval": avatar_approval,
        "render_step": render_step,
        "canonical_avatar_step": canonical_step,
        "policy": {
            "avatar_use": "James Avatar A is owner-approved as the real visual reference for intro, outro, and decision moments.",
            "talking_avatar": "Lip-synced talking avatar is not approved by default; use static or subtle-motion identity only.",
            "video_upgrade": "Use motion graphics, animated source-proof moments, and script-synced visual changes before adding avatar lip-sync.",
            "shorts_upgrade": "Use fast visual proof, text, and one payoff; no generic standalone tips.",
            "reference_rule": REFERENCE_RULE,
        },
        "visual_cadence": {
            "long_form_meaningful_beat_seconds": "8-14",
            "long_form_micro_motion_seconds": "2-4",
            "shorts_visual_change_seconds": "1-3",
            "rule": "Every visual change must map to narration: claim, evidence, rejection, criteria, pattern, payoff, or bridge.",
        },
        "assets": assets,
    }
    json_report = approval / "visual-upgrade-plan.json"
    md_report = approval / "visual-upgrade-plan.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Visual Upgrade Plan: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Owner Approval",
        "",
        "- James Avatar A is approved as the real visual reference for the Pattern Lab presenter.",
        "- Use it for intro, outro, and decision moments.",
        "- Do not use lip-synced talking avatar footage without separate owner approval.",
        f"- Preserve the owner-selected reference rule: {REFERENCE_RULE}",
        "",
        "## Visual Upgrade Rules",
        "",
        "- Use animated source-proof moments before decorative images.",
        "- Show a meaningful visual beat every 8-14 seconds in long-form.",
        "- Add small motion every 2-4 seconds with zooms, highlights, stamps, or score movement.",
        "- For Shorts, use a visual proof change every 1-3 seconds.",
        "- Do not change images unless the narration changes claim, evidence, rejection, criteria, pattern, payoff, or bridge.",
        "",
        "## Avatar Reference",
        "",
    ]
    for filename, title, description, recommendation in AVATAR_CONCEPTS:
        lines.append(f"- {title}: `{display_path(visual_dir / filename)}` | {description} | {recommendation}")
    lines.extend(["", "## Visual Modes", ""])
    for filename, title, description in STYLEBOARDS:
        lines.append(f"- {title}: `{display_path(visual_dir / filename)}` | {description}")
    lines.extend(
        [
            "",
            "## Next Build Behavior",
            "",
        "- Use the selected James reference for intro, outro, and decision moments.",
        "- Future James variants should use the approved image and reference note before generating new assets.",
        "- Rejecting or replacing this avatar requires a new explicit owner approval.",
        "",
    ]
    )
    md_report.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Generate Pattern Lab visual upgrade concepts and approval plan.")
    parser.add_argument("--video-id", default="02")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = output_root(args.video_id)
    ensure_dir(root / "visual-upgrade")
    render_step = run_swift(args.video_id, root, dry_run=args.dry_run)
    if render_step.get("status") == "fail":
        print(render_step.get("stderr", ""))
        raise SystemExit(render_step.get("exit_code", 1))
    canonical_step = copy_canonical_avatar(root, dry_run=args.dry_run)
    payload, _, md_report = write_reports(args.video_id, root, render_step, canonical_step)
    print(f"Status: {payload['status']}")
    print(f"Visual upgrade plan: {display_path(md_report)}")


if __name__ == "__main__":
    main()
