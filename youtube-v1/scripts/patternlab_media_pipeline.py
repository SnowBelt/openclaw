#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, output_root, utc_now
from patternlab_images import openai_backup_policy, validate_image_pack, write_image_source_report


def env_with_paths():
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")
    return env


def run(command, check=True, steps=None, name=None):
    print("+ " + " ".join(command))
    result = subprocess.run(command, cwd=BASE.parent, check=check, env=env_with_paths())
    if steps is not None:
        steps.append(
            {
                "name": name or command[1] if len(command) > 1 else command[0],
                "command": " ".join(command),
                "exit_code": result.returncode,
                "ok": result.returncode == 0,
            }
        )
    return result


def exists(path):
    return path.exists() and path.stat().st_size > 0


def media_state(root, video_id):
    image_report = validate_image_pack(root)
    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if (root / "shorts").exists() else []
    long_form_quality = json_status(root / "approval" / "long-form-quality-report.json")
    quality_gates = json_status(root / "approval" / "quality-gates-report.json")
    return {
        "images_ready": image_report["usable_valid"],
        "image_source": image_report["selected_source"],
        "image_issues": len(image_report["missing_images"])
        + len(image_report["invalid_images"])
        + len(image_report["ledger_missing"])
        + len(image_report["ledger_invalid"]),
        "image_count": sum(1 for item in image_report["file_status"] if item.get("valid")),
        "audio_ready": exists(root / "audio" / "voiceover_full_normalized.mp3"),
        "proof_ready": exists(root / "proof-footage" / "artifact-proof-clip.mp4"),
        "long_form_ready": exists(root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"),
        "long_form_quality": long_form_quality,
        "quality_gates": quality_gates,
        "shorts_ready": len(shorts) >= 3,
        "shorts_count": len(shorts),
    }


def json_status(path):
    if not path.exists():
        return "missing"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return "invalid"
    return payload.get("status", "unknown")


def readiness_status(root):
    report = root / "approval" / "private-upload-readiness.md"
    if not report.exists():
        return "missing"
    for line in report.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def write_pipeline_report(root, video_id, steps, state):
    report = ensure_dir(root / "approval") / "pipeline-run-report.md"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "steps": steps,
        "media_state": state,
        "private_upload_readiness": readiness_status(root),
    }
    (root / "approval" / "pipeline-run-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Pipeline Run: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Private upload readiness: {payload['private_upload_readiness']}",
        "",
        "## Media State",
        "",
    ]
    for key, value in state.items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Steps", ""])
    for step in steps:
        if step.get("skipped"):
            label = "skipped"
        else:
            label = "pass" if step["ok"] else "failed"
        lines.append(f"- {step['name']}: {label} ({step['exit_code']})")
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Pipeline report: {display_path(report)}")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Best-effort Pattern Lab media pipeline.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--image-source", choices=["auto", "codex", "openai"], default="auto")
    parser.add_argument("--live-images", action="store_true")
    parser.add_argument("--live-voice", action="store_true")
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    steps = []
    image_policy = openai_backup_policy(live_requested=args.live_images)
    live_images = image_policy["enabled"]
    live_voice = args.live_voice or os.environ.get("PATTERNLAB_LIVE_VOICE") == "1"
    script_file = f"launch/video-{args.video_id}/final-script.md"

    run([sys.executable, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", args.video_id], check=False, steps=steps, name="preflight_before")
    run([sys.executable, "youtube-v1/scripts/generate_upload_metadata.py", "--video-id", args.video_id], steps=steps, name="upload_metadata")
    run([sys.executable, "youtube-v1/scripts/patternlab_retention_ladder.py", "--video-id", args.video_id], check=False, steps=steps, name="retention_ladder")
    run([sys.executable, "youtube-v1/scripts/generate_proof_footage.py", "--video-id", args.video_id], steps=steps, name="proof_footage")
    image_cmd = [
        sys.executable,
        "youtube-v1/scripts/generate_images.py",
        "--video-id",
        args.video_id,
        "--source",
        args.image_source,
    ]
    if live_images:
        image_cmd.append("--live")
    run(image_cmd, check=False, steps=steps, name="images_live_backup" if live_images else "images_codex_primary")
    image_report = validate_image_pack(root)
    write_image_source_report(
        root,
        args.video_id,
        image_report,
        backup_available=image_policy["available"],
        backup_enabled=live_images,
    )
    print(f"Image source selected: {image_report['selected_source']}")
    if live_voice or not exists(root / "audio" / "voiceover_full_normalized.mp3"):
        voice_cmd = [
            sys.executable,
            "youtube-v1/scripts/generate_voiceover.py",
            "--video-id",
            args.video_id,
            "--script-file",
            script_file,
        ]
        if live_voice:
            voice_cmd.append("--live")
        else:
            voice_cmd.append("--assembly-draft")
        run(voice_cmd, check=False, steps=steps, name="voiceover")
    else:
        steps.append(
            {
                "name": "voiceover",
                "command": "existing normalized voiceover reused",
                "exit_code": 0,
                "ok": True,
            }
        )

    state = media_state(root, args.video_id)
    if state["images_ready"] and state["audio_ready"] and state["proof_ready"]:
        run(
            [sys.executable, "youtube-v1/scripts/source_visual_rebuild_assets.py", "--video-id", args.video_id, "--reuse-if-ready"],
            steps=steps,
            name="visual_source_pack",
        )
        run([sys.executable, "youtube-v1/scripts/build_video_ffmpeg.py", "--video-id", args.video_id], steps=steps, name="long_form_build")
        run(
            [sys.executable, "youtube-v1/scripts/patternlab_long_form_quality.py", "--video-id", args.video_id],
            check=False,
            steps=steps,
            name="long_form_quality",
        )
        run(
            [sys.executable, "youtube-v1/scripts/patternlab_visual_quality.py", "--video-id", args.video_id],
            check=False,
            steps=steps,
            name="visual_quality",
        )
    else:
        print(
            "Media incomplete: "
            f"images_ready={state['images_ready']} audio_ready={state['audio_ready']} proof_ready={state['proof_ready']}"
        )
        steps.append(
            {
                "name": "long_form_build",
                "command": "skipped until images, audio, and proof are ready",
                "exit_code": 0,
                "ok": False,
                "skipped": True,
            }
        )

    long_form_quality_status = json_status(root / "approval" / "long-form-quality-report.json")
    if exists(root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4") and long_form_quality_status == "pass":
        run([sys.executable, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", args.video_id], steps=steps, name="shorts")
        run(
            [sys.executable, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", args.video_id],
            check=False,
            steps=steps,
            name="discord_review_proxy",
        )
    else:
        if long_form_quality_status != "pass":
            print(f"Shorts generation skipped until long-form quality passes: {long_form_quality_status}")
        run(
            [sys.executable, "youtube-v1/scripts/generate_shorts_ffmpeg.py", "--video-id", args.video_id, "--dry-run"],
            steps=steps,
            name="shorts_plan",
        )
    run([sys.executable, "youtube-v1/scripts/monetization_gates.py", "--video-id", args.video_id], check=False, steps=steps, name="monetization_gates")
    run([sys.executable, "youtube-v1/scripts/patternlab_quality_gates.py", "--video-id", args.video_id], check=False, steps=steps, name="quality_gates")
    run([sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", args.video_id], check=False, steps=steps, name="private_readiness")
    run([sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", args.video_id], check=False, steps=steps, name="public_readiness")
    run([sys.executable, "youtube-v1/scripts/patternlab_monetization_tracker.py"], check=False, steps=steps, name="ypp_tracker")
    run([sys.executable, "youtube-v1/scripts/patternlab_content_calendar.py"], check=False, steps=steps, name="content_calendar")
    run([sys.executable, "youtube-v1/scripts/patternlab_visual_upgrade.py", "--video-id", args.video_id], check=False, steps=steps, name="visual_upgrade")
    run(
        [sys.executable, "youtube-v1/scripts/generate_owner_review_packet.py", "--video-id", args.video_id],
        check=False,
        steps=steps,
        name="owner_review_packet",
    )
    run(
        [sys.executable, "youtube-v1/scripts/generate_daily_executive_brief.py", "--video-id", args.video_id],
        check=False,
        steps=steps,
        name="daily_executive_brief",
    )
    run([sys.executable, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", args.video_id], check=False, steps=steps, name="preflight_after")
    final_state = media_state(root, args.video_id)
    payload = write_pipeline_report(root, args.video_id, steps, final_state)
    if args.require_complete and payload["private_upload_readiness"] != "private-upload-ready":
        raise SystemExit(f"Pipeline incomplete: {payload['private_upload_readiness']}")


if __name__ == "__main__":
    main()
