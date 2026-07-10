#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


REPO = BASE.parent


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_status_line(path):
    path = Path(path)
    if not path.exists():
        return "missing"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def run_step(name, command):
    result = subprocess.run(command, cwd=REPO, capture_output=True, text=True, check=False)
    return {
        "name": name,
        "command": " ".join(command),
        "exit_code": result.returncode,
        "status": "pass" if result.returncode == 0 else "blocked",
        "stdout": result.stdout.strip()[-4000:],
        "stderr": result.stderr.strip()[-4000:],
    }


def skipped_step(name, reason):
    return {
        "name": name,
        "command": reason,
        "exit_code": 0,
        "status": "skipped",
        "stdout": reason,
        "stderr": "",
    }


def report_blockers(root, filename):
    path = root / "approval" / filename
    payload = read_json(path)
    if not payload:
        return []
    return payload.get("blockers") or []


def unresolved_repairs(root):
    path = root / "approval" / "repair-queue.jsonl"
    if not path.exists():
        return 0
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            count += 1
            continue
        if event.get("status", "queued") not in {"resolved", "closed", "cancelled"}:
            count += 1
    return count


def live_verification_status(root):
    payload = read_json(root / "approval" / "youtube-live-verification-report.json") or {}
    live = payload.get("live_api_verification") or {}
    return live.get("status", "missing"), live.get("reason", "")


def next_gap(root):
    review_status = read_status_line(root / "approval" / "review-package-approval-readiness.md")
    private_status = read_status_line(root / "approval" / "private-upload-readiness.md")
    public_status = read_status_line(root / "approval" / "public-publish-readiness.md")
    upload_report = read_json(root / "approval" / "youtube-upload-report.json")
    approved_upload_report = read_json(root / "approval" / "approved-package-upload-report.json")
    repairs = unresolved_repairs(root)

    if repairs:
        return {
            "gate": "repair_queue",
            "criticality": 10,
            "summary": f"Resolve {repairs} queued repair item(s), then rerun the continue runner.",
        }
    if review_status != "ready-for-review-package-approval":
        return {
            "gate": "review_package",
            "criticality": 9,
            "summary": "Fix review-package blockers before owner review-package approval.",
            "blockers": report_blockers(root, "review-package-approval-readiness.json"),
        }
    if not (root / "approval" / "review-package-approval.json").exists():
        return {
            "gate": "owner_review_package_approval",
            "criticality": 9,
            "summary": "Owner must approve the review package. This marks media assets approved but does not approve upload or public publish.",
        }
    if private_status != "private-upload-ready":
        return {
            "gate": "private_upload_readiness",
            "criticality": 10,
            "summary": "Fix private-upload readiness blockers before any YouTube upload.",
        }
    if not (root / "approval" / "private-upload-approval.json").exists():
        return {
            "gate": "owner_private_upload_approval",
            "criticality": 10,
            "summary": "Owner must approve private/unlisted upload. Public publishing remains separate.",
        }
    if not upload_report or upload_report.get("status") != "uploaded":
        return {
            "gate": "private_upload_execution",
            "criticality": 10,
            "summary": "Run the approved package upload with --live-upload after private upload approval.",
            "last_upload_package_status": (approved_upload_report or {}).get("status", "missing"),
        }
    live_status, live_reason = live_verification_status(root)
    if live_status != "verified":
        return {
            "gate": "youtube_live_verification",
            "criticality": 10,
            "summary": "Regenerate/repair YouTube OAuth, then verify the private uploads with the live YouTube API before public publish approval.",
            "blockers": [live_reason] if live_reason else ["Live YouTube API verification is not verified."],
        }
    if public_status != "public-publish-ready":
        return {
            "gate": "owner_public_publish_approval",
            "criticality": 10,
            "summary": "Owner must verify YouTube Studio checks, choose final launch timing, and explicitly approve public publish.",
        }
    return {
        "gate": "next_video_scaleout",
        "criticality": 8,
        "summary": "Public-publish gate is ready; after owner launch action, start the next Pattern Lab package and performance-learning loop.",
    }


def write_continue_report(root, video_id, live_upload, steps, gap):
    approval = ensure_dir(root / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "live_upload_enabled": live_upload,
        "steps": steps,
        "review_package_status": read_status_line(approval / "review-package-approval-readiness.md"),
        "private_upload_status": read_status_line(approval / "private-upload-readiness.md"),
        "public_publish_status": read_status_line(approval / "public-publish-readiness.md"),
        "youtube_upload_report": read_json(approval / "youtube-upload-report.json") or {},
        "next_highest_priority_build_gap": gap,
    }
    json_path = approval / "continuous-progress-report.json"
    md_path = approval / "continuous-progress-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Continuous Progress Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Live upload enabled: {live_upload}",
        "",
        "## Current Gate State",
        "",
        f"- Review package: {payload['review_package_status']}",
        f"- Private upload: {payload['private_upload_status']}",
        f"- Public publish: {payload['public_publish_status']}",
        f"- YouTube URL: {payload['youtube_upload_report'].get('youtube_url', '')}",
        "",
        "## Next Highest Priority Build Gap",
        "",
        f"- Gate: {gap['gate']}",
        f"- Criticality: {gap['criticality']}/10",
        f"- Summary: {gap['summary']}",
    ]
    if gap.get("blockers"):
        lines.extend(["", "### Blockers", ""])
        lines.extend(f"- {blocker}" for blocker in gap["blockers"])
    lines.extend(["", "## Executed Steps", ""])
    for step in steps:
        lines.append(f"- {step['status']}: {step['name']}")
        if step.get("stderr"):
            lines.append(f"  stderr: {step['stderr']}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(
        description="Run every safe Pattern Lab continuation step until an explicit owner/public gate blocks progress."
    )
    parser.add_argument("--video-id", default="03")
    parser.add_argument(
        "--live-upload",
        action="store_true",
        help="If private-upload approvals are already present, execute private/unlisted upload. Never publishes publicly.",
    )
    args = parser.parse_args()

    root = output_root(args.video_id)
    steps = [
        run_step(
            "refresh review-package approval readiness",
            [sys.executable, "youtube-v1/scripts/patternlab_approval_package.py", "--video-id", args.video_id, "--refresh-quality"],
        ),
        run_step(
            "check private-upload readiness",
            [sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", args.video_id],
        ),
    ]
    upload_command = [sys.executable, "youtube-v1/scripts/upload_approved_package.py", "--video-id", args.video_id]
    if args.live_upload:
        upload_command.append("--live")
    steps.append(run_step("advance approved private/unlisted upload package", upload_command))
    if args.live_upload:
        steps.append(
            run_step(
                "verify uploaded package with YouTube API",
                [sys.executable, "youtube-v1/scripts/verify_youtube_uploads.py", "--video-id", args.video_id, "--live"],
            )
        )
    else:
        steps.append(
            skipped_step(
                "verify uploaded package with YouTube API",
                "skipped because --live-upload was not requested; existing live verification report was preserved",
            )
        )
    steps.extend(
        [
            run_step(
                "check public-publish readiness",
                [sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", args.video_id],
            ),
            run_step(
                "validate James avatar",
                [sys.executable, "youtube-v1/scripts/validate_james_avatar.py", "--video-id", args.video_id],
            ),
            run_step(
                "validate James persona",
                [sys.executable, "youtube-v1/scripts/validate_james_persona.py", "--video-id", args.video_id],
            ),
            run_step(
                "validate monetization strategy",
                [sys.executable, "youtube-v1/scripts/validate_monetization_strategy.py", "--video-id", args.video_id],
            ),
            run_step(
                "validate dashboard state",
                [sys.executable, "youtube-v1/scripts/patternlab_dashboard_server.py", "--check", "--video-id", args.video_id],
            ),
            run_step("validate Pattern Lab automation", ["node", "youtube-v1/scripts/youtube-v1-automation.mjs", "validate"]),
        ]
    )
    gap = next_gap(root)
    payload, _, md_path = write_continue_report(root, args.video_id, args.live_upload, steps, gap)
    print(json.dumps(payload, indent=2))
    print(f"Continuous progress report: {display_path(md_path)}")


if __name__ == "__main__":
    main()
