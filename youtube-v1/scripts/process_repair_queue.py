#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, output_root, utc_now


RESOLVED_STATUSES = {"resolved", "closed", "cancelled"}


def read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                rows.append(
                    {
                        "created_at": utc_now(),
                        "status": "failed",
                        "asset_type": "unknown",
                        "reason": f"unparseable queue row {line_number}: {exc}",
                    }
                )
    return rows


def write_jsonl(path, rows):
    ensure_dir(Path(path).parent)
    with Path(path).open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def run(command, steps, dry_run=False, optional=False):
    label = " ".join(command)
    if dry_run:
        steps.append({"command": label, "status": "dry-run"})
        return True
    result = subprocess.run(
        command,
        cwd=BASE.parent,
        text=True,
        capture_output=True,
        check=False,
    )
    step = {
        "command": label,
        "status": "pass" if result.returncode == 0 else "fail",
        "stdout": result.stdout.strip()[-4000:],
        "stderr": result.stderr.strip()[-4000:],
    }
    steps.append(step)
    if result.returncode != 0 and not optional:
        return False
    return True


def refresh_review_outputs(video_id, steps, dry_run=False):
    commands = [
        [sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/generate_owner_review_packet.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/generate_daily_executive_brief.py", "--video-id", video_id],
    ]
    ok = True
    for command in commands:
        ok = run(command, steps, dry_run=dry_run, optional=True) and ok
    return ok


def repair_commands(event, video_id):
    action = event.get("action", "")
    asset_type = event.get("asset_type", "")
    reason = event.get("reason", "")
    repair_scope = event.get("repair_scope", "")
    py = sys.executable
    if action == "kill_topic" or asset_type == "topic":
        return [], "blocked", "Topic rejection is recorded; next package selection requires the daily factory to pick a replacement topic."
    if asset_type == "voiceover":
        if os.environ.get("PATTERNLAB_LIVE_VOICE", "").strip().lower() not in {"1", "true", "yes", "on"}:
            return [], "blocked", "Voiceover regeneration is blocked until PATTERNLAB_LIVE_VOICE=1 is set for a live narration run."
        return [
            [py, "youtube-v1/scripts/generate_voiceover.py", "--video-id", video_id, "--live"],
            [py, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", video_id, "--force"],
        ], "queued", ""
    if asset_type == "thumbnail":
        return [
            [py, "youtube-v1/scripts/generate_images.py", "--video-id", video_id, "--source", "codex", "--force-codex"],
        ], "queued", ""
    if asset_type == "avatar":
        return [
            [py, "youtube-v1/scripts/patternlab_visual_upgrade.py", "--video-id", video_id],
        ], "queued", ""
    if asset_type == "image":
        return [
            [py, "youtube-v1/scripts/generate_images.py", "--video-id", video_id, "--source", "codex", "--force-codex"],
            [py, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", video_id, "--force"],
        ], "queued", ""
    if asset_type == "short":
        commands = [[py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id]]
        if reason == "starts_mid_sentence":
            commands.append([py, "youtube-v1/scripts/patternlab_shorts_boundary_quality.py", "--video-id", video_id])
        elif reason == "random_text_box":
            commands.append([py, "youtube-v1/scripts/patternlab_shorts_first_frame_quality.py", "--video-id", video_id])
        elif reason == "no_clear_point":
            commands.insert(0, [py, "youtube-v1/scripts/patternlab_shorts_script_package.py", "--video-id", video_id])
        return commands, "queued", f"targeted repair scope: {repair_scope or 'this_short_only'}"
    if asset_type == "proof_footage":
        return [
            [py, "youtube-v1/scripts/generate_proof_footage.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id],
            [py, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", video_id, "--force"],
        ], "queued", ""
    if asset_type == "video" or action == "revise_hook":
        commands = []
        if reason == "possible_private_info":
            commands.append([py, "youtube-v1/scripts/generate_proof_footage.py", "--video-id", video_id])
        if repair_scope == "long_form_hook_only" or reason == "redo_hook":
            commands.append([py, "youtube-v1/scripts/patternlab_first5_hook.py", "--video-id", video_id])
        commands.extend(
            [
                [py, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", video_id],
                [py, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", video_id],
                [py, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", video_id, "--force"],
            ]
        )
        return commands, "queued", f"targeted repair scope: {repair_scope or 'long_form_visuals_only'}"
    return [], "blocked", f"No automated repair recipe is defined for asset_type={asset_type or 'missing'}."


def process_row(row, video_id, dry_run=False):
    if row.get("status", "queued") in RESOLVED_STATUSES:
        return row, {"status": "skipped", "reason": "already resolved", "steps": []}
    commands, initial_status, detail = repair_commands(row, video_id)
    started = utc_now()
    steps = []
    if initial_status == "blocked":
        updated = {**row, "status": "blocked", "processed_at": started, "repair_detail": detail}
        return updated, {"status": "blocked", "reason": detail, "steps": steps}
    ok = True
    for command in commands:
        ok = run(command, steps, dry_run=dry_run) and ok
        if not ok:
            break
    if ok:
        refresh_review_outputs(video_id, steps, dry_run=dry_run)
    status = "dry-run" if dry_run else ("resolved" if ok else "failed")
    updated = {
        **row,
        "status": status,
        "processed_at": started,
        "resolved_at": utc_now() if status == "resolved" else row.get("resolved_at", ""),
    }
    return updated, {"status": status, "steps": steps}


def queue_paths(root):
    approval = ensure_dir(root / "approval")
    return [approval / "repair-queue.jsonl", approval / "regeneration-queue.jsonl"]


def write_report(root, video_id, results, dry_run=False):
    approval = ensure_dir(root / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "dry_run": dry_run,
        "processed": len(results),
        "resolved": sum(1 for item in results if item["result"]["status"] == "resolved"),
        "blocked": sum(1 for item in results if item["result"]["status"] == "blocked"),
        "failed": sum(1 for item in results if item["result"]["status"] == "failed"),
        "results": results,
    }
    (approval / "repair-run-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Repair Run: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Dry run: {dry_run}",
        f"Processed: {payload['processed']}",
        f"Resolved: {payload['resolved']}",
        f"Blocked: {payload['blocked']}",
        f"Failed: {payload['failed']}",
        "",
        "## Results",
        "",
    ]
    for item in results:
        event = item["event"]
        result = item["result"]
        lines.extend(
            [
                f"- {event.get('action', '')} {event.get('asset_type', '')} {event.get('asset_id', '') or event.get('filename', '')}: {result['status']} (scope={event.get('repair_scope', 'missing')})",
            ]
        )
        if result.get("reason"):
            lines.append(f"  Reason: {result['reason']}")
    if not results:
        lines.append("- no queued repairs")
    (approval / "repair-run-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload


def process_queues(video_id, dry_run=False, limit=0, event_id=""):
    load_dotenv()
    root = output_root(video_id)
    processed = []
    remaining_limit = limit
    for path in queue_paths(root):
        rows = read_jsonl(path)
        changed = False
        for index, row in enumerate(rows):
            if row.get("status", "queued") in RESOLVED_STATUSES:
                continue
            if event_id and row.get("event_id") != event_id:
                continue
            if limit and remaining_limit <= 0:
                continue
            updated, result = process_row(row, video_id, dry_run=dry_run)
            rows[index] = updated
            changed = True
            processed.append({"queue": display_path(path), "event": row, "result": result})
            if limit:
                remaining_limit -= 1
        if changed and not dry_run:
            write_jsonl(path, rows)
    if processed and not dry_run:
        final_steps = []
        refresh_review_outputs(video_id, final_steps, dry_run=False)
    report = write_report(root, video_id, processed, dry_run=dry_run)
    return report


def main():
    parser = argparse.ArgumentParser(description="Process Pattern Lab repair/regeneration queue items.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--event-id", default="")
    args = parser.parse_args()
    if args.limit < 0:
        raise SystemExit("--limit must be zero or positive.")
    report = process_queues(args.video_id, dry_run=args.dry_run, limit=args.limit, event_id=args.event_id)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
