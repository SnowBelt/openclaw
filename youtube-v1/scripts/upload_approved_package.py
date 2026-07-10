#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now


def readiness_status(root):
    report = root / "approval" / "private-upload-readiness.md"
    if not report.exists():
        return "missing"
    for line in report.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def run(command, live):
    if not live:
        return {"command": " ".join(command), "status": "dry-run", "exit_code": 0}
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    return {
        "command": " ".join(command),
        "status": "pass" if result.returncode == 0 else "fail",
        "exit_code": result.returncode,
        "stdout": result.stdout.strip()[-4000:],
        "stderr": result.stderr.strip()[-4000:],
    }


def upload_report_path(root, surface, short_index):
    if surface == "long-form":
        return root / "approval" / "youtube-upload-report.json"
    return root / "approval" / f"youtube-upload-report-short-{short_index:02d}.json"


def already_uploaded(root, surface, short_index=0):
    report = read_json(upload_report_path(root, surface, short_index))
    return bool(report and report.get("status") == "uploaded")


def package_already_uploaded(root):
    return already_uploaded(root, "long-form") and all(
        already_uploaded(root, "short", index) for index in [1, 2, 3]
    )


def archive_existing_upload_reports(root, run_id):
    approval = ensure_dir(root / "approval")
    archive_dir = ensure_dir(approval / "archive" / f"replacement-upload-{run_id}")
    archived = []
    filenames = [
        "youtube-upload-report.json",
        "youtube-upload-report-short-01.json",
        "youtube-upload-report-short-02.json",
        "youtube-upload-report-short-03.json",
        "youtube-live-verification-report.json",
        "youtube-live-verification-report.md",
        "approved-package-upload-report.json",
        "approved-package-upload-report.md",
    ]
    for filename in filenames:
        source = approval / filename
        if not source.exists():
            continue
        target = archive_dir / filename
        shutil.move(str(source), str(target))
        archived.append({"from": display_path(source), "to": display_path(target)})
    return archived


def auth_health(root):
    report = read_json(root / "approval" / "youtube-auth-health-report.json")
    if not report:
        return "missing"
    return report.get("status", "unknown")


def write_report(root, video_id, live, steps, status, blockers):
    approval = ensure_dir(root / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "live": live,
        "status": status,
        "blockers": blockers,
        "public_publish": "blocked_until_explicit_owner_approval",
        "steps": steps,
    }
    (approval / "approved-package-upload-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Approved Package Upload: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Live upload: {live}",
        f"Status: {status}",
        "Public publish: blocked until explicit owner approval",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Steps", ""])
    for step in steps:
        lines.append(f"- {step['status']}: {step['command']}")
        if step.get("stderr"):
            lines.append(f"  stderr: {step['stderr']}")
    (approval / "approved-package-upload-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Upload an approved Pattern Lab package as private/unlisted only.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--privacy", choices=["private", "unlisted"], default="private")
    parser.add_argument("--live", action="store_true")
    parser.add_argument(
        "--force-reupload",
        action="store_true",
        help="Archive existing local upload evidence and upload a fresh private/unlisted replacement package.",
    )
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    run_id = utc_now().replace(":", "").replace("-", "").replace("T", "-").replace("Z", "Z")
    subprocess.run(
        [sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", args.video_id],
        cwd=Path(__file__).resolve().parents[2],
        check=False,
    )
    status = readiness_status(root)
    blockers = []
    if status != "private-upload-ready":
        blockers.append(f"Private upload readiness is {status}.")
    if not (root / "approval" / "private-upload-approval.json").exists():
        blockers.append("Owner private/unlisted upload approval is missing.")
    if args.live:
        auth_result = subprocess.run(
            [
                sys.executable,
                "youtube-v1/scripts/youtube_auth_health.py",
                "--video-id",
                args.video_id,
                "--live",
            ],
            cwd=Path(__file__).resolve().parents[2],
            check=False,
        )
        if auth_result.returncode != 0:
            blockers.append(f"YouTube OAuth health is {auth_health(root)}.")
    if blockers:
        report = write_report(root, args.video_id, args.live, [], "blocked", blockers)
        print(json.dumps(report, indent=2))
        raise SystemExit(1)

    archived_reports = archive_existing_upload_reports(root, run_id) if args.force_reupload else []
    steps = []
    started_already_uploaded = package_already_uploaded(root)
    if not already_uploaded(root, "long-form"):
        steps.append(
            run(
                [
                    sys.executable,
                    "youtube-v1/scripts/upload_private_youtube.py",
                    "--video-id",
                    args.video_id,
                    "--surface",
                    "long-form",
                    "--privacy",
                    args.privacy,
                    "--live",
                ],
                args.live,
            )
        )
    for index in [1, 2, 3]:
        if already_uploaded(root, "short", index):
            continue
        steps.append(
            run(
                [
                    sys.executable,
                    "youtube-v1/scripts/upload_private_youtube.py",
                    "--video-id",
                    args.video_id,
                    "--surface",
                    "short",
                    "--short-index",
                    str(index),
                    "--privacy",
                    args.privacy,
                    "--live",
                ],
                args.live,
            )
        )
        if steps[-1]["status"] == "fail":
            break
    failed = [step for step in steps if step["status"] == "fail"]
    finished_uploaded = package_already_uploaded(root)
    if started_already_uploaded or finished_uploaded:
        status = "uploaded"
    else:
        status = "uploaded" if args.live and not failed else ("dry-run-ready" if not failed else "failed")
    if args.live and not failed:
        subprocess.run(
            [sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", args.video_id],
            cwd=Path(__file__).resolve().parents[2],
            check=False,
        )
        subprocess.run(
            [sys.executable, "youtube-v1/scripts/patternlab_upload_currency.py", "--video-id", args.video_id],
            cwd=Path(__file__).resolve().parents[2],
            check=False,
        )
    report = write_report(root, args.video_id, args.live, steps, status, [])
    report["replacement_run_id"] = run_id if args.force_reupload else ""
    report["force_reupload"] = args.force_reupload
    report["archived_reports"] = archived_reports
    (root / "approval" / "approved-package-upload-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if failed:
        raise SystemExit(1)
    print(f"Upload package report: {display_path(root / 'approval' / 'approved-package-upload-report.md')}")


if __name__ == "__main__":
    main()
