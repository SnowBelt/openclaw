#!/usr/bin/env python3
import argparse
import csv
import json
import subprocess
import uuid
from pathlib import Path

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now
from patternlab_approval_package import build_approval_package_report, default_thumbnail, target_rows
from process_repair_queue import process_queues
from patternlab_discord_feedback import (
    append_owner_feedback,
    default_repair_scope,
    owner_feedback_event,
    parse_callback,
    validate_reason,
    validate_repair_scope,
)


ASSET_TYPES = {"avatar", "image", "thumbnail", "voiceover", "proof_footage", "video", "short"}
REPAIR_ACTIONS = {"reject", "repair", "regenerate", "revise_hook", "kill_topic"}
APPROVAL_ACTIONS = {"approve", "approve_review_package", "approve_private_upload", "approve_public_publish"}


def read_csv_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv_rows(path, rows):
    if not rows:
        return
    fields = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def append_jsonl(path, payload):
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, separators=(",", ":")) + "\n")


def read_jsonl(path):
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path, rows):
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def row_matches(row, asset_type, asset_id=None, filename=None):
    if asset_type and row.get("asset_type") != asset_type:
        return False
    if asset_id and row.get("asset_id") != asset_id:
        return False
    if filename and row.get("filename") != filename:
        return False
    return True


def write_gate_approval(root, action, reason):
    approval = ensure_dir(root / "approval")
    package = read_json(approval / "package-hash-report.json") or {}
    package_hash = package.get("final_package_hash", "")
    if not package_hash or package.get("status") != "pass":
        raise ValueError("Cannot record an upload or publish approval until the final package hash report is passing.")
    if action == "approve_private_upload":
        target = approval / "private-upload-approval.json"
        payload = {
            "approved_at": utc_now(),
            "approval": "private_or_unlisted_upload_only",
            "public_publish": "blocked_until_explicit_owner_approval",
            "final_package_hash": package_hash,
            "reason": reason,
        }
    elif action == "approve_public_publish":
        blockers = public_publish_preapproval_blockers(root)
        if blockers:
            raise ValueError("Cannot approve public publish until: " + "; ".join(blockers))
        target = approval / "public-publish-approval.json"
        payload = {
            "approved_at": utc_now(),
            "approval": "public_publish",
            "requires_manual_youtube_studio_action": False,
            "youtube_live_verification_status": "verified",
            "youtube_studio_checks_owner_attested": True,
            "synthetic_disclosure_owner_attested": True,
            "public_publish_automation": "owner_approved_youtube_api_visibility_update_only",
            "final_package_hash": package_hash,
            "youtube_video_ids": upload_video_ids(root),
            "reason": reason,
        }
    else:
        raise ValueError(f"Unsupported gate approval: {action}")
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def public_publish_preapproval_blockers(root):
    approval = root / "approval"
    blockers = []
    upload_report = read_json(approval / "youtube-upload-report.json")
    if not upload_report or upload_report.get("status") != "uploaded":
        blockers.append("private/unlisted long-form upload report is missing")
    elif upload_report.get("privacy") not in {"private", "unlisted"}:
        blockers.append("long-form upload is not private/unlisted")
    for index in [1, 2, 3]:
        short_report = read_json(approval / f"youtube-upload-report-short-{index:02d}.json")
        if not short_report or short_report.get("status") != "uploaded":
            blockers.append(f"private/unlisted Short {index} upload report is missing")
        elif short_report.get("privacy") not in {"private", "unlisted"}:
            blockers.append(f"Short {index} upload is not private/unlisted")
    verification = read_json(approval / "youtube-live-verification-report.json") or {}
    live_status = (verification.get("live_api_verification") or {}).get("status")
    if live_status != "verified":
        blockers.append("live YouTube API verification is not verified")
    package = read_json(approval / "package-hash-report.json") or {}
    package_hash = package.get("final_package_hash")
    if package.get("status") != "pass" or not package_hash:
        blockers.append("final package hash report is missing or not passing")
    for report in [upload_report, *[read_json(approval / f"youtube-upload-report-short-{index:02d}.json") for index in [1, 2, 3]]]:
        if report and package_hash and report.get("final_package_hash") != package_hash:
            blockers.append("upload receipt does not match the current final package hash")
    return blockers


def upload_video_ids(root):
    approval = root / "approval"
    reports = [read_json(approval / "youtube-upload-report.json")]
    reports.extend(read_json(approval / f"youtube-upload-report-short-{index:02d}.json") for index in [1, 2, 3])
    ids = [report.get("youtube_video_id") for report in reports if report]
    if len(ids) != 4 or any(not item for item in ids):
        raise ValueError("Cannot record public approval until the long-form and three Shorts have exact YouTube IDs.")
    return ids


def write_avatar_approval(root, filename):
    if not filename:
        return None
    target = ensure_dir(root / "approval") / "james-avatar-approval.json"
    payload = {
        "approved_at": utc_now(),
        "status": "approved",
        "selected_avatar": Path(filename).name,
        "avatar_use": "approved for Pattern Lab intro, outro, and decision moments",
        "talking_avatar": "not approved; use stylized static/motion identity only",
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def write_review_package_approval(root, reason, package_payload, rows_changed):
    target = ensure_dir(root / "approval") / "review-package-approval.json"
    payload = {
        "approved_at": utc_now(),
        "approval": "review_package_assets_only",
        "private_upload": "not_approved_by_this_action",
        "public_publish": "blocked_until_explicit_owner_approval",
        "reason": reason,
        "rows_changed": rows_changed,
        "selected_thumbnail": package_payload.get("selected_thumbnail", ""),
        "target_counts": package_payload.get("target_counts", {}),
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def update_default_thumbnail(root, filename):
    if not filename:
        return None
    metadata_path = root / "approval" / "upload-metadata.json"
    if not metadata_path.exists():
        return None
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["default_thumbnail"] = filename
    metadata["default_thumbnail_approved_at"] = utc_now()
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata_path


def rerun_readiness(video_id):
    subprocess.run(
        ["python3", "youtube-v1/scripts/private_upload_readiness.py", "--video-id", video_id],
        cwd=Path(__file__).resolve().parents[2],
        check=False,
    )


def run_auto_private_upload(video_id):
    result = subprocess.run(
        [
            "python3",
            "youtube-v1/scripts/upload_approved_package.py",
            "--video-id",
            video_id,
            "--live",
        ],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout.strip()[-4000:],
        "stderr": result.stderr.strip()[-4000:],
    }


def apply_review_action(
    video_id,
    action,
    asset_type="",
    asset_id=None,
    filename=None,
    reason="owner_review",
    repair_scope="",
    freeform_note="",
    timestamp_start="",
    timestamp_end="",
    dry_run=False,
    auto_repair=True,
    auto_upload=True,
):
    load_dotenv()
    if action not in APPROVAL_ACTIONS and action not in REPAIR_ACTIONS:
        raise ValueError(f"unsupported action: {action}")
    if asset_type and asset_type not in ASSET_TYPES and asset_type != "topic":
        raise ValueError(f"unsupported asset_type: {asset_type}")
    reason = validate_reason(action, asset_type, reason, freeform_note)
    repair_scope = repair_scope or default_repair_scope(asset_type, action, reason)
    validate_repair_scope(repair_scope)

    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    ledger = root / "rights-ledger.csv"
    rows = read_csv_rows(ledger)
    changed = 0
    new_status = None
    review_package_payload = None
    review_package_report = None

    if action == "approve":
        if not asset_type:
            raise ValueError("approve requires asset_type")
        new_status = "approved"
    elif action == "approve_review_package":
        review_package_payload, _, review_package_report_path = build_approval_package_report(
            video_id,
            refresh_quality=True,
        )
        review_package_report = display_path(review_package_report_path)
        if review_package_payload.get("blockers"):
            event = {
                "event_id": uuid.uuid4().hex,
                "created_at": utc_now(),
                "video_id": video_id,
                "action": action,
                "asset_type": asset_type,
                "asset_id": asset_id or "",
                "filename": filename or "",
                "reason": reason,
                "repair_scope": repair_scope,
                "rows_changed": 0,
            }
            return {
                "ok": False,
                "dry_run": dry_run,
                "event": event,
                "rows_changed": 0,
                "review_package_report": review_package_report,
                "blockers": review_package_payload.get("blockers", []),
            }
        metadata_path = root / "approval" / "upload-metadata.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        targets, _, _ = target_rows(rows, metadata)
        target_keys = {
            (row.get("asset_type", ""), row.get("asset_id", ""), row.get("filename", ""))
            for row in targets
        }
        for row in rows:
            key = (row.get("asset_type", ""), row.get("asset_id", ""), row.get("filename", ""))
            if key in target_keys and row.get("human_review_status") != "approved":
                row["human_review_status"] = "approved"
                changed += 1
    elif action == "reject":
        new_status = "rejected"
    elif action in {"repair", "regenerate", "revise_hook"}:
        new_status = "pending"

    if new_status and asset_type in ASSET_TYPES:
        for row in rows:
            if row_matches(row, asset_type, asset_id, filename):
                row["human_review_status"] = new_status
                changed += 1

    event = {
        "event_id": uuid.uuid4().hex,
        "created_at": utc_now(),
        "video_id": video_id,
        "action": action,
        "asset_type": asset_type,
        "asset_id": asset_id or "",
        "filename": filename or "",
        "reason": reason,
        "repair_scope": repair_scope,
        "rows_changed": changed,
    }
    if dry_run and action == "approve_public_publish":
        public_blockers = public_publish_preapproval_blockers(root)
        if not public_blockers:
            public_blockers = []
    if dry_run and action == "approve_public_publish" and public_blockers:
        return {
            "ok": False,
            "dry_run": True,
            "event": event,
            "rows_changed": changed,
            "error": "Cannot approve public publish until: " + "; ".join(public_blockers),
        }
    feedback_event = owner_feedback_event(
        video_id,
        action,
        asset_type=asset_type,
        asset_id=asset_id or "",
        filename=filename or "",
        reason=reason,
        repair_scope=repair_scope,
        freeform_note=freeform_note,
        timestamp_start=timestamp_start,
        timestamp_end=timestamp_end,
    )
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "event": event,
            "owner_feedback_event": feedback_event,
            "rows_changed": changed,
            "review_package_report": review_package_report or "",
            "review_package_pending_targets": (review_package_payload or {}).get("pending_target_count", ""),
        }

    if rows and changed:
        write_csv_rows(ledger, rows)

    metadata_file = None
    if action == "approve" and asset_type == "thumbnail" and filename:
        metadata_file = update_default_thumbnail(root, filename)
    if action == "approve_review_package" and review_package_payload:
        metadata_file = update_default_thumbnail(root, review_package_payload.get("selected_thumbnail") or default_thumbnail({}))
    avatar_file = None
    if action == "approve" and asset_type == "avatar" and filename:
        avatar_file = write_avatar_approval(root, filename)
    review_package_file = None
    if action == "approve_review_package" and review_package_payload:
        review_package_file = write_review_package_approval(root, reason, review_package_payload, changed)

    append_jsonl(approval / "review-actions.jsonl", event)
    append_jsonl(approval / "approval-log.jsonl", event)
    feedback_file = append_owner_feedback(root, feedback_event)

    repair_file = None
    if action in REPAIR_ACTIONS:
        repair_event = {
            **event,
            "status": "queued",
            "repair_scope": repair_scope,
            "next_action": repair_next_action(action, asset_type, reason, repair_scope),
        }
        repair_file = approval / "repair-queue.jsonl"
        append_jsonl(repair_file, repair_event)
    elif action == "approve" and asset_type:
        repair_file = approval / "repair-queue.jsonl"
        repair_rows = read_jsonl(repair_file)
        repair_changed = False
        for repair in repair_rows:
            if (
                repair.get("asset_type") == asset_type
                and (not asset_id or repair.get("asset_id") == asset_id)
                and (not filename or repair.get("filename") == filename)
                and repair.get("status", "queued") == "queued"
            ):
                repair["status"] = "resolved"
                repair["resolved_at"] = utc_now()
                repair_changed = True
        if repair_changed:
            write_jsonl(repair_file, repair_rows)

    gate_file = None
    if action in {"approve_private_upload", "approve_public_publish"}:
        gate_file = write_gate_approval(root, action, reason)

    repair_result = None
    upload_result = None
    if action in REPAIR_ACTIONS and auto_repair:
        repair_result = process_queues(video_id, limit=1, event_id=event["event_id"])
    else:
        rerun_readiness(video_id)
    if action == "approve_private_upload" and auto_upload:
        upload_result = run_auto_private_upload(video_id)
    return {
        "ok": True,
        "event": event,
        "rows_changed": changed,
        "metadata_file": display_path(metadata_file) if metadata_file else "",
        "avatar_file": display_path(avatar_file) if avatar_file else "",
        "review_package_file": display_path(review_package_file) if review_package_file else "",
        "review_package_report": review_package_report or "",
        "repair_file": display_path(repair_file) if repair_file else "",
        "owner_feedback_file": display_path(feedback_file) if feedback_file else "",
        "gate_file": display_path(gate_file) if gate_file else "",
        "repair_result": repair_result or {},
        "upload_result": upload_result or {},
    }


def repair_next_action(action, asset_type, reason, repair_scope=""):
    if action == "kill_topic":
        return "Stop production and replace the topic with the next highest-scoring idea."
    if action == "revise_hook" or reason == "redo_hook" or repair_scope == "long_form_hook_only":
        return "Rewrite and rebuild only the first 30 seconds/hook path, then regenerate dependent review cuts."
    if asset_type == "thumbnail":
        if repair_scope == "thumbnail_new_idea":
            return "Generate a new thumbnail concept with a different promise/style and rerun thumbnail quality gates."
        return "Repair the same thumbnail idea, focusing on readability, font/color, and mobile crop."
    if asset_type == "voiceover" or repair_scope == "long_form_voice_only":
        return "Regenerate or rerecord narration and run a phone-speaker review."
    if asset_type == "avatar":
        return "Regenerate James avatar concepts and resend the visual upgrade approval packet."
    if asset_type == "short":
        if reason == "starts_mid_sentence":
            return "Regenerate only this Short with sentence-boundary validation and rerun Shorts boundary quality."
        if reason == "random_text_box":
            return "Regenerate only this Short and remove stray template/caption/text-box artifacts before rerunning Shorts visual checks."
        if reason == "no_clear_point":
            return "Rewrite only this Short around one hook, one proof visual, and one payoff before rerendering."
        return "Regenerate only this Short around one hook, one proof visual, and one payoff."
    if asset_type == "video":
        if reason == "pacing_needs_revision":
            return "Rebuild the visual beat plan with faster image changes and tighter pauses."
        if reason == "possible_private_info":
            return "Inspect proof footage and replace any clip with private information."
        if reason == "random_text_box":
            return "Inspect the long-form render for stray overlays/caption boxes and rebuild only affected visual sections."
        if reason == "fact_source_issue":
            return "Block publishing, inspect the claim/source trail, and rebuild the affected sourced segment."
        return "Rebuild the long-form draft from approved media and rerun readiness."
    return "Repair the rejected asset, update the ledger, and resend the review packet."


def main():
    parser = argparse.ArgumentParser(description="Apply a Pattern Lab owner review action.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--action")
    parser.add_argument("--asset-type", default="")
    parser.add_argument("--asset-id")
    parser.add_argument("--filename")
    parser.add_argument("--reason", default="owner_review")
    parser.add_argument("--repair-scope", default="")
    parser.add_argument("--freeform-note", default="")
    parser.add_argument("--timestamp-start", default="")
    parser.add_argument("--timestamp-end", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-auto-repair", action="store_true")
    parser.add_argument("--no-auto-upload", action="store_true")
    parser.add_argument("--callback", help="Raw patternlab:{json} callback payload from Discord.")
    args = parser.parse_args()
    if args.callback:
        raw = args.callback
        if raw.startswith("patternlab:"):
            raw = raw[len("patternlab:") :]
        payload = parse_callback(raw)
        args.video_id = payload.get("video_id", args.video_id)
        args.action = payload.get("action", args.action)
        args.asset_type = payload.get("asset_type", args.asset_type)
        args.asset_id = payload.get("asset_id", args.asset_id)
        args.filename = payload.get("filename", args.filename)
        args.reason = payload.get("reason", args.reason)
        args.repair_scope = payload.get("repair_scope", args.repair_scope)
        args.freeform_note = payload.get("freeform_note", args.freeform_note)
        args.timestamp_start = payload.get("timestamp_start", args.timestamp_start)
        args.timestamp_end = payload.get("timestamp_end", args.timestamp_end)
    if not args.action:
        raise SystemExit("--action or --callback is required")
    result = apply_review_action(
        args.video_id,
        args.action,
        asset_type=args.asset_type,
        asset_id=args.asset_id,
        filename=args.filename,
        reason=args.reason,
        repair_scope=args.repair_scope,
        freeform_note=args.freeform_note,
        timestamp_start=args.timestamp_start,
        timestamp_end=args.timestamp_end,
        dry_run=args.dry_run,
        auto_repair=not args.no_auto_repair,
        auto_upload=not args.no_auto_upload,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
