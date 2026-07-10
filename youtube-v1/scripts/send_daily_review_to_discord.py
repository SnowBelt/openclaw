#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
YOUTUBE = REPO / "youtube-v1"
sys.path.insert(0, str(YOUTUBE / "scripts"))
from patternlab_common import media_duration_seconds, utc_now
from patternlab_discord_feedback import callback_value

DEFAULT_TARGET = "channel:1503779032817209465"
DISCORD_STAGE_ROOT = Path("/tmp/openclaw/pattern-lab-review")
MAX_DISCORD_MEDIA_BYTES = 8 * 1024 * 1024
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v"}
LONG_FORM_MIN_SECONDS = 8 * 60
LONG_FORM_MAX_SECONDS = 14 * 60
SHORT_MIN_SECONDS = 25
SHORT_MAX_SECONDS = 45
THUMBNAIL_LABELS = {
    "thumbnail_candidate_a.png": "A",
    "thumbnail_candidate_b.png": "B",
    "thumbnail_candidate_c.png": "C",
}
AVATAR_LABELS = {
    "james_avatar_concept_a.png": "A",
    "james_avatar_concept_b.png": "B",
    "james_avatar_concept_c.png": "C",
}


def run(command):
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")
    subprocess.run(command, cwd=REPO, check=True, env=env)


def existing(path):
    path = Path(path)
    if not path.exists():
        raise SystemExit(f"Missing review file: {path.relative_to(REPO)}")
    return path


def repo_display(path):
    path = Path(path)
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def thumbnail_label(path):
    path = Path(path)
    return THUMBNAIL_LABELS.get(path.name, path.stem.removeprefix("thumbnail_candidate_").upper())


def avatar_label(path):
    path = Path(path)
    return AVATAR_LABELS.get(path.name, path.stem.removeprefix("james_avatar_concept_").upper())


def validate_channel_target(target, allow_dm):
    if target.startswith("channel:"):
        return
    if allow_dm and target.startswith("user:"):
        return
    raise SystemExit(
        "Pattern Lab review delivery must target a Discord text channel. "
        "Use --target channel:<id>, or pass --allow-dm-target for an intentional manual override."
    )


def validate_media_size(path):
    size = Path(path).stat().st_size
    if size > MAX_DISCORD_MEDIA_BYTES:
        raise SystemExit(
            f"Discord media file is too large: {repo_display(path)} "
            f"({size / 1024 / 1024:.1f} MB, limit {MAX_DISCORD_MEDIA_BYTES / 1024 / 1024:.0f} MB)."
        )


def validate_duration(path, minimum, maximum, label):
    duration = media_duration_seconds(path)
    if duration < minimum:
        raise SystemExit(f"{label} blocked from review delivery: {duration:.1f}s is below {minimum:.0f}s.")
    if duration > maximum:
        raise SystemExit(f"{label} blocked from review delivery: {duration:.1f}s is above {maximum:.0f}s.")
    return duration


def validate_review_ready(root, video_id, long_form, long_form_for_discord, shorts):
    monetization = root / "approval" / "monetization-gates-report.json"
    long_form_quality = root / "approval" / "long-form-quality-report.json"
    readiness = root / "approval" / "private-upload-readiness.md"
    if long_form_quality.exists():
        payload = json.loads(long_form_quality.read_text(encoding="utf-8"))
        if payload.get("status") != "pass":
            raise SystemExit(f"Review delivery blocked: long-form quality gates are {payload.get('status')}.")
    else:
        raise SystemExit("Review delivery blocked: long-form quality report is missing.")
    if monetization.exists():
        payload = json.loads(monetization.read_text(encoding="utf-8"))
        if payload.get("status") != "pass":
            raise SystemExit(f"Review delivery blocked: monetization gates are {payload.get('status')}.")
    else:
        raise SystemExit("Review delivery blocked: monetization gates report is missing.")
    shorts_plan = root / "approval" / "shorts-upload-plan.md"
    if not shorts_plan.exists():
        raise SystemExit("Review delivery blocked: Shorts upload plan is missing.")
    shorts_plan_text = shorts_plan.read_text(encoding="utf-8")
    if "Timestamp source: scripted-short-package" not in shorts_plan_text and "Timestamp source: script-moment-score" not in shorts_plan_text:
        raise SystemExit("Review delivery blocked: Shorts were not selected from scored script moments or the standalone scripted Shorts package.")
    if "Timestamp source: scripted-short-package" in shorts_plan_text:
        if shorts_plan_text.count("Standalone score:") < 3 or shorts_plan_text.count("Scripted transcript:") < 3:
            raise SystemExit("Review delivery blocked: Shorts plan lacks standalone scores or scripted transcripts.")
    elif shorts_plan_text.count("Moment score:") < 3 or shorts_plan_text.count("Moment excerpt:") < 3:
        raise SystemExit("Review delivery blocked: Shorts plan lacks scored moment excerpts.")

    full_duration = validate_duration(long_form, LONG_FORM_MIN_SECONDS, LONG_FORM_MAX_SECONDS, "Long-form draft")
    if long_form_for_discord != long_form:
        proxy_duration = media_duration_seconds(long_form_for_discord)
        if proxy_duration + 5 < full_duration:
            raise SystemExit(
                "Review delivery blocked: Discord review proxy is shorter than the monetization-compliant long-form draft."
            )
    for index, short in enumerate(shorts, 1):
        validate_duration(short, SHORT_MIN_SECONDS, SHORT_MAX_SECONDS, f"Short {index}")

    if readiness.exists():
        text = readiness.read_text(encoding="utf-8")
        forbidden = [
            "Long-form draft is below the 8 minute monetization target",
            "Long-form draft is missing",
            "At least 3 Shorts are required",
            "Missing required images",
            "Final voiceover and normalized voiceover are required",
        ]
        for marker in forbidden:
            if marker in text:
                raise SystemExit(f"Review delivery blocked by readiness report: {marker}.")


def is_video(path):
    return Path(path).suffix.lower() in VIDEO_SUFFIXES


def stage_media(video_id, path):
    path = existing(path)
    validate_media_size(path)
    stage_dir = DISCORD_STAGE_ROOT / f"video-{video_id}"
    stage_dir.mkdir(parents=True, exist_ok=True)
    staged = stage_dir / path.name
    shutil.copy2(path, staged)
    os.chmod(staged, 0o600)
    return staged


def callback(action, asset_type, video_id, asset_id=None, filename=None, reason=None, repair_scope=None):
    return callback_value(
        action,
        asset_type,
        video_id,
        asset_id=asset_id,
        filename=filename,
        reason=reason,
        repair_scope=repair_scope,
    )


def controls(buttons, title=None, context=None, tone="info"):
    blocks = []
    if context:
        blocks.append({"type": "context", "text": context})
    blocks.append({"type": "buttons", "buttons": buttons})
    return json.dumps({"title": title, "tone": tone, "blocks": blocks})


def send_message(target, message, presentation=None):
    command = [
        "/opt/homebrew/bin/pnpm",
        "openclaw",
        "message",
        "send",
        "--channel",
        "discord",
        "--target",
        target,
        "--message",
        message,
    ]
    if presentation:
        command.extend(["--presentation", presentation])
    run(command)


def send_media(target, message, media_path, presentation=None):
    if is_video(media_path) and presentation:
        raise SystemExit("Video files must be sent as plain attachments with separate controls.")
    command = [
        "/opt/homebrew/bin/pnpm",
        "openclaw",
        "message",
        "send",
        "--channel",
        "discord",
        "--target",
        target,
        "--message",
        message,
        "--media",
        str(media_path),
    ]
    if presentation:
        command.extend(["--presentation", presentation])
    run(command)


def send_video(target, message, media_path):
    if not is_video(media_path):
        raise SystemExit(
            f"Expected a video file for plain video delivery: {repo_display(media_path)}"
        )
    send_media(target, message, media_path)


def refresh_review_reports(video_id):
    commands = [
        [sys.executable, "youtube-v1/scripts/generate_upload_metadata.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/patternlab_long_form_quality.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/patternlab_thumbnail_quality.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/patternlab_shorts_quality.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/patternlab_visual_upgrade.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/monetization_gates.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/private_upload_readiness.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/public_publish_readiness.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/analyze_performance.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/generate_discord_review_proxy.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/generate_owner_review_packet.py", "--video-id", video_id],
        [sys.executable, "youtube-v1/scripts/generate_daily_executive_brief.py", "--video-id", video_id],
    ]
    for command in commands:
        subprocess.run(command, cwd=REPO, check=False)


def delivery_steps(
    video_id,
    staged_brief,
    staged_packet,
    staged_readiness,
    staged_visual_plan,
    staged_long_form,
    staged_avatar_concepts,
    staged_thumbnails,
    staged_shorts,
):
    steps = [
        {"kind": "controls", "label": "Intro review gates", "media": None, "presentation": True, "controls": group_review_controls(video_id)},
        {"kind": "file", "label": "Daily executive brief", "media": str(staged_brief), "presentation": False},
        {"kind": "file", "label": "Owner review packet", "media": str(staged_packet), "presentation": False},
        {
            "kind": "file",
            "label": "Private upload readiness report",
            "media": str(staged_readiness),
            "presentation": False,
        },
        {
            "kind": "file",
            "label": "Visual upgrade approval plan",
            "media": str(staged_visual_plan),
            "presentation": False,
        },
    ]
    for avatar in staged_avatar_concepts:
        label = avatar_label(avatar)
        steps.append(
            {
                "kind": "image",
                "label": f"James avatar concept {label}",
                "media": str(avatar),
                "presentation": True,
                "controls": avatar_controls(video_id, label, f"visual-upgrade/james_avatar_concept_{label.lower()}.png"),
            }
        )
    steps.extend(
        [
        {
            "kind": "video",
            "label": "Long-form draft video file",
            "media": str(staged_long_form),
            "presentation": False,
        },
        {
            "kind": "controls",
            "label": "Long-form approval controls",
            "media": None,
            "presentation": True,
            "controls": long_form_controls(video_id),
        },
        ]
    )
    for thumbnail in staged_thumbnails:
        label = thumbnail_label(thumbnail)
        steps.append(
            {
                "kind": "image",
                "label": f"Thumbnail candidate {label}",
                "media": str(thumbnail),
                "presentation": True,
                "controls": thumbnail_controls(video_id, label, f"images/thumbnail_candidate_{label.lower()}.png"),
            }
        )
    for index, short in enumerate(staged_shorts, 1):
        steps.extend(
            [
                {
                    "kind": "video",
                    "label": f"Short {index} video file",
                    "media": str(short),
                    "presentation": False,
                },
                {
                    "kind": "controls",
                    "label": f"Short {index} approval controls",
                    "media": None,
                    "presentation": True,
                    "controls": short_controls(video_id, index),
                },
            ]
        )
    for step in steps:
        if step["kind"] == "video" and step["presentation"]:
            raise SystemExit("Invalid delivery plan: video steps cannot include presentation controls.")
    return steps


def write_delivery_manifest(root, target, steps):
    manifest = root / "approval" / "discord-review-delivery-plan.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": utc_now(),
        "target": target,
        "channel_only": target.startswith("channel:"),
        "video_delivery": "plain_discord_attachments",
        "controls_delivery": "separate_messages",
        "max_media_mb": MAX_DISCORD_MEDIA_BYTES // 1024 // 1024,
        "steps": [
            {
                **step,
                "media": repo_display(step["media"]) if step.get("media") else None,
            }
            for step in steps
        ],
    }
    manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return manifest


def group_review_controls(video_id):
    return controls(
        [
            {
                "label": "Approve images",
                "style": "success",
                "value": callback("approve", "image", video_id),
            },
            {
                "label": "Regenerate images",
                "style": "secondary",
                "value": callback(
                    "regenerate",
                    "image",
                    video_id,
                    reason="owner_requested_image_variants",
                ),
            },
            {
                "label": "Approve voice",
                "style": "success",
                "value": callback("approve", "voiceover", video_id),
            },
            {
                "label": "Repair voice",
                "style": "danger",
                "value": callback("repair", "voiceover", video_id, reason="voice_needs_revision"),
            },
            {
                "label": "Approve proof",
                "style": "success",
                "value": callback("approve", "proof_footage", video_id),
            },
            {
                "label": "Revise hook",
                "style": "secondary",
                "value": callback("revise_hook", "video", video_id, reason="owner_requested_hook_revision"),
            },
            {
                "label": "Reject topic",
                "style": "danger",
                "value": callback("kill_topic", "topic", video_id, reason="owner_rejected_topic"),
            },
            {
                "label": "Approve review package",
                "style": "success",
                "value": callback("approve_review_package", "", video_id, reason="owner_approved_full_review_package"),
            },
            {
                "label": "Approve private upload",
                "style": "success",
                "value": callback("approve_private_upload", "", video_id, reason="owner_approved_private_or_unlisted_upload"),
            },
            {
                "label": "Approve public publish",
                "style": "danger",
                "value": callback("approve_public_publish", "", video_id, reason="owner_approved_public_publish_after_youtube_checks"),
            },
        ],
        title="Pattern Lab review gates",
        context="Approve the review package first, then approve private/unlisted upload separately. Public publish approval is logged only; no public posting is automated.",
    )


def thumbnail_controls(video_id, label, filename):
    return controls(
        [
            {
                "label": "Approve Thumbnail",
                "style": "success",
                "value": callback("approve", "thumbnail", video_id, filename=filename, reason="good_thumbnail_style", repair_scope="thumbnail_same_idea"),
            },
            {
                "label": "Not Clickable",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="thumbnail_not_clickable", repair_scope="thumbnail_new_idea"),
            },
            {
                "label": "Wrong Promise",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="thumbnail_wrong_promise", repair_scope="thumbnail_new_idea"),
            },
            {
                "label": "Too Cluttered",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="too_cluttered", repair_scope="thumbnail_same_idea"),
            },
            {
                "label": "Bad Font/Color",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="bad_font_color", repair_scope="thumbnail_same_idea"),
            },
            {
                "label": "Too Generic",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="too_generic", repair_scope="thumbnail_new_idea"),
            },
            {
                "label": "Text Hard to Read",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="text_hard_to_read", repair_scope="thumbnail_same_idea"),
            },
            {
                "label": "Wrong City Feel",
                "style": "danger",
                "value": callback("reject", "thumbnail", video_id, filename=filename, reason="wrong_city_feel", repair_scope="thumbnail_new_idea"),
            },
            {
                "label": "Regenerate Same Idea",
                "style": "secondary",
                "value": callback("regenerate", "thumbnail", video_id, filename=filename, reason="regenerate_same_idea", repair_scope="thumbnail_same_idea"),
            },
            {
                "label": "Regenerate New Idea",
                "style": "secondary",
                "value": callback("regenerate", "thumbnail", video_id, filename=filename, reason="regenerate_new_idea", repair_scope="thumbnail_new_idea"),
            },
        ],
        title=f"Thumbnail {label}",
        context="Approve one strong candidate or use a targeted rejection so the next thumbnail learns your taste.",
    )


def avatar_controls(video_id, label, filename):
    return controls(
        [
            {
                "label": f"Approve James {label}",
                "style": "success",
                "value": callback("approve", "avatar", video_id, filename=filename),
            },
            {
                "label": f"Regenerate James {label}",
                "style": "secondary",
                "value": callback(
                    "regenerate",
                    "avatar",
                    video_id,
                    filename=filename,
                    reason="owner_requested_avatar_variant",
                ),
            },
            {
                "label": f"Reject James {label}",
                "style": "danger",
                "value": callback(
                    "reject",
                    "avatar",
                    video_id,
                    filename=filename,
                    reason="avatar_style_not_approved",
                ),
            },
        ],
        title=f"James avatar concept {label}",
        context="Avatar approval only controls future intro/outro/decision moments. Public use is blocked until you approve one.",
    )


def long_form_controls(video_id):
    return controls(
        [
            {
                "label": "Approve Video",
                "style": "success",
                "value": callback("approve", "video", video_id, reason="good_visual_match", repair_scope="asset_only"),
            },
            {
                "label": "Redo Hook",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="redo_hook", repair_scope="long_form_hook_only"),
            },
            {
                "label": "Redo Visuals",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="visuals_mismatch", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Redo Pacing",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="pacing_needs_revision", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Redo Voice",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="voice_needs_revision", repair_scope="long_form_voice_only"),
            },
            {
                "label": "Random Text/Box",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="random_text_box", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Wrong Visuals",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="visuals_mismatch", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Fact/Source Issue",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="fact_source_issue", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Private Info Risk",
                "style": "danger",
                "value": callback("repair", "video", video_id, reason="possible_private_info", repair_scope="long_form_visuals_only"),
            },
            {
                "label": "Reject Topic",
                "style": "danger",
                "value": callback("kill_topic", "topic", video_id, reason="reject_topic", repair_scope="topic_replacement"),
            },
        ],
        title="Long-form draft",
        context="Choose the smallest exact repair. This queues targeted repair instead of blind full rebuild.",
    )


def short_controls(video_id, index):
    asset_id = f"video-{video_id}-short-{index:02d}"
    return controls(
        [
            {
                "label": "Approve Short",
                "style": "success",
                "value": callback("approve", "short", video_id, asset_id=asset_id, reason="strong_short_loop", repair_scope="this_short_only"),
            },
            {
                "label": "Redo Short",
                "style": "secondary",
                "value": callback("regenerate", "short", video_id, asset_id=asset_id, reason="reject_concept", repair_scope="this_short_only"),
            },
            {
                "label": "Weak Hook",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="weak_hook", repair_scope="this_short_only"),
            },
            {
                "label": "Starts Mid-Sentence",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="starts_mid_sentence", repair_scope="this_short_only"),
            },
            {
                "label": "No Clear Point",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="no_clear_point", repair_scope="this_short_only"),
            },
            {
                "label": "Random Text/Box",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="random_text_box", repair_scope="this_short_only"),
            },
            {
                "label": "Bad Crop",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="bad_crop", repair_scope="this_short_only"),
            },
            {
                "label": "Captions Bad",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="captions_unreadable", repair_scope="this_short_only"),
            },
            {
                "label": "Visuals Mismatch",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="visuals_mismatch", repair_scope="this_short_only"),
            },
            {
                "label": "Too Slow",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="too_slow", repair_scope="this_short_only"),
            },
            {
                "label": "Audio Bad",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="audio_bad", repair_scope="this_short_only"),
            },
            {
                "label": "Bad Ending/Loop",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="bad_loop", repair_scope="this_short_only"),
            },
            {
                "label": "Doesn't Drive to Full Video",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="does_not_bridge_to_long_form", repair_scope="this_short_only"),
            },
            {
                "label": "Use This Style More",
                "style": "success",
                "value": callback("approve", "short", video_id, asset_id=asset_id, reason="use_this_style_more", repair_scope="this_short_only"),
            },
            {
                "label": "Reject Concept",
                "style": "danger",
                "value": callback("reject", "short", video_id, asset_id=asset_id, reason="reject_concept", repair_scope="this_short_only"),
            },
        ],
        title=f"Short {index}",
        context="Each Short should start clean, make one point, loop well, and bridge to the long-form video.",
    )


def main():
    parser = argparse.ArgumentParser(description="Send the daily Pattern Lab review packet to Discord.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-intro", action="store_true")
    parser.add_argument("--skip-packet-reports", action="store_true")
    parser.add_argument("--allow-dm-target", action="store_true")
    args = parser.parse_args()
    validate_channel_target(args.target, args.allow_dm_target)
    refresh_review_reports(args.video_id)

    root = YOUTUBE / "local-output" / f"video-{args.video_id}"
    long_form = existing(root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4")
    discord_long_form = root / "review" / f"pattern-lab-video-{args.video_id}-draft-discord-review.mp4"
    long_form_for_discord = discord_long_form if discord_long_form.exists() else long_form
    shorts = [
        existing(root / "shorts" / f"pattern-lab-video-{args.video_id}-short-01.mp4"),
        existing(root / "shorts" / f"pattern-lab-video-{args.video_id}-short-02.mp4"),
        existing(root / "shorts" / f"pattern-lab-video-{args.video_id}-short-03.mp4"),
    ]
    packet = existing(root / "review" / "owner-review-packet.md")
    brief = existing(root / "approval" / "daily-executive-brief.md")
    readiness = existing(root / "approval" / "private-upload-readiness.md")
    visual_plan = existing(root / "approval" / "visual-upgrade-plan.md")
    avatar_dir = root / "visual-upgrade"
    avatar_concepts = sorted(avatar_dir.glob("james_avatar_concept_*.png")) if avatar_dir.exists() else []
    if len(avatar_concepts) < 3:
        raise SystemExit("Missing James avatar concepts: expected 3 james_avatar_concept_*.png files.")
    thumbnails_dir = root / "images"
    thumbnails = sorted(thumbnails_dir.glob("thumbnail_candidate_*.png")) if thumbnails_dir.exists() else []
    if len(thumbnails) < 3:
        raise SystemExit("Missing review thumbnails: expected at least 3 thumbnail_candidate_*.png files.")
    validate_review_ready(root, args.video_id, long_form, long_form_for_discord, shorts)

    intro = (
        "Pattern Lab revised review packet is ready.\n\n"
        "This version uses a hook-first intro, a consistent Pattern Lab outro, and a script-aware visual beat plan where image changes are tied to narration.\n\n"
        "New visual upgrade review: choose whether James should be represented by a stylized avatar, and approve only one concept before it appears in any public video.\n\n"
        "Review order:\n"
        "1. James avatar concepts: approve one or reject/regenerate.\n"
        "2. Long-form draft: voice, pacing, source proof in first 20 seconds, no private info.\n"
        "3. Short 1: curiosity hook.\n"
        "4. Short 2: utility hook.\n"
        "5. Short 3: identity/payoff hook.\n\n"
        "Public publishing remains blocked until explicit owner approval."
    )
    staged_brief = stage_media(args.video_id, brief)
    staged_packet = stage_media(args.video_id, packet)
    staged_readiness = stage_media(args.video_id, readiness)
    staged_visual_plan = stage_media(args.video_id, visual_plan)
    staged_long_form = stage_media(args.video_id, long_form_for_discord)
    staged_shorts = [stage_media(args.video_id, short) for short in shorts]
    staged_thumbnails = [stage_media(args.video_id, thumbnail) for thumbnail in thumbnails]
    staged_avatar_concepts = [stage_media(args.video_id, avatar) for avatar in avatar_concepts]
    steps = delivery_steps(
        args.video_id,
        staged_brief,
        staged_packet,
        staged_readiness,
        staged_visual_plan,
        staged_long_form,
        staged_avatar_concepts,
        staged_thumbnails,
        staged_shorts,
    )
    manifest = write_delivery_manifest(root, args.target, steps)

    if args.dry_run:
        print(f"Target: {args.target}")
        print(intro)
        print("Controls: group review buttons")
        print("Controls: long-form approve/repair buttons")
        print("Controls: per-thumbnail approve/regenerate/reject buttons")
        print("Controls: per-Short approve/regenerate/reject buttons")
        print("Controls: revise hook, reject topic, private upload approval, public publish approval")
        for path in [
            manifest,
            staged_brief,
            staged_packet,
            staged_readiness,
            staged_visual_plan,
            staged_long_form,
            *staged_avatar_concepts,
            *staged_thumbnails,
            *staged_shorts,
        ]:
            print(path)
        return

    if not args.skip_intro:
        send_message(args.target, intro, group_review_controls(args.video_id))
    if not args.skip_packet_reports:
        send_media(args.target, "Daily executive brief", staged_brief)
        send_media(args.target, "Owner review packet", staged_packet)
        send_media(args.target, "Private upload readiness report", staged_readiness)
        send_media(args.target, "Visual upgrade approval plan", staged_visual_plan)
    for avatar in staged_avatar_concepts:
        label = avatar_label(avatar)
        send_media(
            args.target,
            f"James avatar concept {label}",
            avatar,
            avatar_controls(args.video_id, label, f"visual-upgrade/james_avatar_concept_{label.lower()}.png"),
        )
    send_video(args.target, "Long-form draft video file", staged_long_form)
    send_message(
        args.target,
        "Long-form approval controls",
        long_form_controls(args.video_id),
    )
    for thumbnail in staged_thumbnails:
        label = thumbnail_label(thumbnail)
        send_media(
            args.target,
            f"Thumbnail candidate {label}",
            thumbnail,
            thumbnail_controls(args.video_id, label, f"images/thumbnail_candidate_{label.lower()}.png"),
        )
    for index, short in enumerate(staged_shorts, 1):
        send_video(args.target, f"Short {index} video file", short)
        send_message(
            args.target,
            f"Short {index} approval controls",
            short_controls(args.video_id, index),
        )


if __name__ == "__main__":
    main()
