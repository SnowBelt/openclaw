#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, media_duration_seconds, output_root, utc_now
from patternlab_legacy import all_launch_video_ids, legacy_video_ids, missing_legacy_markers
from validate_james_avatar import validate_avatar_contract
from validate_james_persona import build_james_persona_report


STRATEGY = BASE / "state" / "monetization" / "strategy.json"
SLATE = BASE / "state" / "monetization" / "content-slate.json"
DAILY_PLIST = BASE / "automation" / "pattern-lab-daily-review.plist"
REQUIRED_SCRIPTS = [
    "patternlab_legacy.py",
    "patternlab_daily_loop.py",
    "patternlab_daily_factory.py",
    "patternlab_retention_ladder.py",
    "patternlab_content_calendar.py",
    "patternlab_monetization_tracker.py",
    "patternlab_profit_analytics.py",
    "patternlab_quality_gates.py",
    "patternlab_benchmark_growth.py",
    "patternlab_guru_growth_gates.py",
    "patternlab_approval_package.py",
    "patternlab_visual_upgrade.py",
    "validate_james_avatar.py",
    "validate_james_persona.py",
    "patternlab_images.py",
    "patternlab_media_pipeline.py",
    "patternlab_preflight.py",
    "monetization_gates.py",
    "private_upload_readiness.py",
    "public_publish_readiness.py",
    "patternlab_review_action.py",
    "process_repair_queue.py",
    "send_daily_review_to_discord.py",
    "send_visual_upgrade_to_discord.py",
    "generate_shorts_ffmpeg.py",
    "analyze_performance.py",
    "upload_private_youtube.py",
    "upload_approved_package.py",
    "youtube_auth_health.py",
    "verify_youtube_uploads.py",
]
REQUIRED_REVIEW_ACTIONS = {
    "approve",
    "approve_review_package",
    "reject",
    "repair",
    "regenerate",
    "revise_hook",
    "kill_topic",
    "approve_private_upload",
    "approve_public_publish",
}
REQUIRED_METRICS = {
    "views",
    "impressions",
    "ctr_percent",
    "average_view_duration_seconds",
    "average_percentage_viewed",
    "retention_30s_percent",
    "subscribers_gained",
    "comments_signal_summary",
    "shorts_viewed_percent",
    "shorts_swiped_away_percent",
    "related_video_clicks",
    "estimated_revenue_usd",
    "rpm_usd",
    "decision_label",
    "subscriber_conversion_per_1000_views",
    "returning_viewers",
    "browse_ctr_percent",
    "suggested_ctr_percent",
    "search_ctr_percent",
    "thumbnail_family",
    "thumbnail_candidate_role",
    "title_thumbnail_promise",
    "youtube_ab_test_status",
    "watch_time_share_winner",
    "expectation_mismatch_comments",
    "city_requests",
    "local_corrections",
    "source_suggestions",
    "nostalgia_or_local_emotion",
    "geography_confusion",
    "source_disputes",
    "sponsor_fit",
    "media_quality_tags",
    "watch_hours",
}
REQUIRED_POLICY_SOURCES = {
    "https://support.google.com/youtube/answer/72851",
    "https://support.google.com/youtube/answer/94522",
    "https://support.google.com/youtube/answer/1311392",
    "https://support.google.com/youtube/answer/12504220",
    "https://support.google.com/youtube/answer/14328491",
    "https://support.google.com/youtube/answer/6162278",
}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def weighted_score(strategy, scores):
    total = 0.0
    for key, weight in strategy["topic_scoring_weights"].items():
        total += (float(scores.get(key, 0)) / 10.0) * float(weight)
    return round(total, 1)


def word_count(path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    return len([word for word in text.replace("#", " ").split() if word.strip()])


def parse_shorts_count(path):
    if not path.exists():
        return 0
    text = path.read_text(encoding="utf-8")
    return len(re.findall(r"^## Short\s+\d+:", text, flags=re.MULTILINE))


def existing_launch_ids(include_legacy=False):
    return all_launch_video_ids(include_legacy=include_legacy)


def validate_strategy(strategy, failures, warnings):
    cadence = strategy.get("cadence", {})
    if strategy.get("channel") != "Pattern Lab":
        failures.append("Strategy channel must be Pattern Lab.")
    if strategy.get("lane") != "hidden systems behind American cities":
        failures.append("Strategy lane must be hidden systems behind American cities.")
    if set(strategy.get("sub_lanes", [])) != {
        "city origins and turning points",
        "lost neighborhoods and infrastructure",
        "people culture and industry",
    }:
        failures.append("Strategy sub-lanes do not match the city-history one-lane, three-sub-lane plan.")
    if strategy.get("topic_score_threshold") != 80:
        failures.append("Topic score threshold must be 80/100.")
    if cadence.get("long_form_per_week") != 3:
        failures.append("Cadence must target 3 long-form videos per week.")
    if cadence.get("shorts_public_target_per_long_form") != 2:
        failures.append("Cadence must target 2 public Shorts per long-form video.")
    if cadence.get("shorts_generated_for_review_per_long_form") != 3:
        failures.append("Review package must generate 3 Shorts candidates per long-form video.")
    if cadence.get("long_form_target_minutes_min") != 8 or cadence.get("long_form_target_minutes_max") != 14:
        failures.append("Long-form duration target must be 8-14 minutes.")
    if cadence.get("shorts_target_seconds_min") != 25 or cadence.get("shorts_target_seconds_max") != 45:
        failures.append("Shorts duration target must be 25-45 seconds.")
    if set(strategy.get("official_policy_sources", [])) != REQUIRED_POLICY_SOURCES:
        failures.append("Official YouTube policy source list is incomplete.")
    paths = strategy.get("monetization_paths", {})
    primary = paths.get("primary", {})
    secondary = paths.get("secondary_shorts", {})
    early = paths.get("early_ypp_where_available", {})
    if primary.get("subscribers") != 1000 or primary.get("valid_public_long_form_watch_hours_12m") != 4000:
        failures.append("Primary YPP target must be 1,000 subscribers and 4,000 valid public long-form watch hours.")
    if secondary.get("subscribers") != 1000 or secondary.get("valid_public_shorts_views_90d") != 10000000:
        failures.append("Secondary Shorts YPP target must be 1,000 subscribers and 10M valid public Shorts views.")
    if early.get("subscribers") != 500 or early.get("public_uploads_90d") != 3:
        failures.append("Early YPP target must include 500 subscribers and 3 public uploads in 90 days.")
    if len(strategy.get("decision_labels", [])) < 6:
        warnings.append("Decision labels are sparse; performance learning may lose nuance.")
    cta_policy = strategy.get("subscribe_cta_policy", {})
    if not cta_policy.get("required_in_long_form") or not cta_policy.get("required_in_shorts_bridge"):
        failures.append("Subscribe CTA policy must require long-form and Shorts bridge CTAs.")
    if "city file" not in " ".join(cta_policy.get("approved_lines", [])).lower():
        failures.append("Subscribe CTA approved lines must tie the ask to the city-file promise.")
    source_policy = strategy.get("source_policy", {})
    if "random Google Images result" not in source_policy.get("blocked_image_rights", []):
        failures.append("Source policy must block random image-search sourcing.")
    if "Library of Congress" not in " ".join(source_policy.get("preferred_sources", [])):
        failures.append("Source policy must prefer Library of Congress or equivalent archive sources.")


def validate_slate(strategy, slate, failures, warnings):
    topics = slate.get("topics", [])
    if len(topics) < 12:
        failures.append("Content slate must contain at least 12 monetization-scored long-form topics.")
    seen = set()
    for topic in topics:
        video_id = topic.get("video_id", "")
        if video_id in seen:
            failures.append(f"Duplicate slate video id: {video_id}.")
        seen.add(video_id)
        if topic.get("sub_lane") not in strategy.get("sub_lanes", []):
            failures.append(f"Video {video_id} uses an invalid sub-lane.")
        if not topic.get("artifact_type") or not topic.get("artifact_source"):
            failures.append(f"Video {video_id} is missing an original artifact definition.")
        score = weighted_score(strategy, topic.get("scores", {}))
        if score < strategy["topic_score_threshold"]:
            failures.append(f"Video {video_id} scores below topic threshold: {score}/100.")
        for key, minimum in strategy.get("minimum_quality_scores", {}).items():
            if float(topic.get("scores", {}).get(key, 0)) < float(minimum):
                failures.append(f"Video {video_id} fails minimum quality score for {key}.")
        angle = topic.get("public_angle", "").lower()
        for blocked in strategy.get("blocked_public_topics", []):
            if blocked in angle:
                failures.append(f"Video {video_id} includes blocked public topic: {blocked}.")
    if len({topic.get("sub_lane") for topic in topics}) < 3:
        warnings.append("Content slate does not cover all three sub-lanes.")


def validate_launch_packages(strategy, failures, warnings):
    for video_id in existing_launch_ids():
        launch = BASE / "launch" / f"video-{video_id}"
        package_path = launch / "package.json"
        metadata = None
        if package_path.exists():
            package = read_json(package_path)
            metadata = package.get("upload_metadata", {})
        elif video_id == "01":
            warnings.append("Video 01 is a legacy pilot package without package.json.")
            continue
        else:
            failures.append(f"Video {video_id} is missing package.json.")
            continue
        if len(metadata.get("title_options", [])) < 5:
            failures.append(f"Video {video_id} needs at least 5 title options.")
        footer = (metadata.get("description_footer") or "").lower()
        pinned = (metadata.get("pinned_comment") or "").lower()
        if "subscribe" not in footer and "subscribe" not in pinned:
            failures.append(f"Video {video_id} metadata must include an earned subscribe CTA.")
        if len(metadata.get("shorts", [])) < cadence_generated_shorts(strategy):
            failures.append(f"Video {video_id} needs 3 Shorts candidates in metadata.")
        guru_growth = package.get("guru_growth_system") or metadata.get("guru_growth_system") or {}
        if not guru_growth:
            failures.append(f"Video {video_id} package is missing guru_growth_system.")
        else:
            if len(guru_growth.get("shorts_concepts") or (guru_growth.get("shorts_discovery_funnel") or {}).get("concepts") or []) < 5:
                failures.append(f"Video {video_id} guru_growth_system needs at least 5 Shorts concepts.")
            governor = guru_growth.get("sustainable_production_governor") or {}
            if governor.get("quality_over_frequency") is not True:
                failures.append(f"Video {video_id} guru_growth_system must enforce quality over frequency.")
            testing = guru_growth.get("title_thumbnail_test_discipline") or {}
            if testing.get("winner_metric") != "watch_time_share_first_then_ctr":
                failures.append(f"Video {video_id} guru_growth_system must use watch-time-share first, then CTR as the winner metric.")
        ladder = package.get("retention_ladder", {})
        rules = ladder.get("rules", {})
        if not ladder:
            failures.append(f"Video {video_id} package is missing machine-readable retention_ladder.")
        if rules.get("max_seconds_without_new_beat") != 75:
            failures.append(f"Video {video_id} retention ladder must enforce a 75 second max beat gap.")
        if len(ladder.get("beats", [])) < 8:
            failures.append(f"Video {video_id} retention ladder needs at least 8 beats.")
        for key in ["default_title", "default_thumbnail", "description", "tags", "chapters", "pinned_comment", "synthetic_disclosure_decision"]:
            if not metadata.get(key):
                failures.append(f"Video {video_id} metadata missing {key}.")
        script_words = word_count(launch / "final-script.md")
        script_path = launch / "final-script.md"
        if script_words is None:
            failures.append(f"Video {video_id} is missing final-script.md.")
        elif script_words < 1100 or script_words > 2300:
            failures.append(f"Video {video_id} script word count is outside 8-14 minute target: {script_words}.")
        if script_path.exists():
            script_text = script_path.read_text(encoding="utf-8")
            if "I am Matthew" in script_text:
                failures.append(f"Video {video_id} uses the retired presenter name Matthew.")
            if "I am James, and this is Pattern Lab." not in script_text:
                failures.append(f"Video {video_id} must introduce the presenter as James.")
        shorts_count = parse_shorts_count(launch / "shorts-package.md")
        if shorts_count < cadence_generated_shorts(strategy):
            failures.append(f"Video {video_id} shorts package needs 3 structured Shorts.")


def validate_legacy_isolation(failures, warnings):
    legacy_ids = legacy_video_ids()
    expected_legacy_ids = {"01", "02"}
    if legacy_ids != expected_legacy_ids:
        failures.append(
            "Legacy manifest must list exactly Video 01 and Video 02 as legacy packages "
            f"for Milestone 7; found {', '.join(sorted(legacy_ids)) or 'none'}."
        )
    missing_markers = missing_legacy_markers()
    for marker in missing_markers:
        failures.append(f"Legacy launch package is missing marker file: {marker}.")
    active_ids = set(existing_launch_ids())
    leaked_ids = sorted(active_ids & legacy_ids)
    if leaked_ids:
        failures.append(f"Legacy packages leaked into active launch validation: {', '.join(leaked_ids)}.")
    if legacy_ids and not leaked_ids and not missing_markers:
        warnings.append(f"Legacy launch packages excluded from active validation: {', '.join(sorted(legacy_ids))}.")


def cadence_generated_shorts(strategy):
    return int(strategy.get("cadence", {}).get("shorts_generated_for_review_per_long_form", 3))


def validate_scripts(failures, warnings):
    for script in REQUIRED_SCRIPTS:
        if not (BASE / "scripts" / script).exists():
            failures.append(f"Required automation script missing: {script}.")
    review_source = (BASE / "scripts" / "patternlab_review_action.py").read_text(encoding="utf-8")
    for action in REQUIRED_REVIEW_ACTIONS:
        if f'"{action}"' not in review_source:
            failures.append(f"Review action is not wired: {action}.")
    repair_source = (BASE / "scripts" / "process_repair_queue.py").read_text(encoding="utf-8")
    if "generate_images.py" not in repair_source or "generate_shorts_ffmpeg.py" not in repair_source:
        failures.append("Repair queue processor must regenerate images and Shorts from owner rejection buttons.")
    if "generate_discord_review_proxy.py" not in repair_source or "generate_owner_review_packet.py" not in repair_source:
        failures.append("Repair queue processor must refresh review artifacts after repairs.")
    if "patternlab_visual_upgrade.py" not in repair_source:
        failures.append("Repair queue processor must regenerate James avatar concepts after avatar rejection.")
    if "process_queues" not in review_source or "auto_repair" not in review_source:
        failures.append("Review actions must invoke automated repair processing unless explicitly disabled.")
    if '"avatar"' not in review_source or "james-avatar-approval.json" not in review_source:
        failures.append("Review actions must support approval-gated James avatar concepts.")
    if "approve_review_package" not in review_source or "review-package-approval.json" not in review_source:
        failures.append("Review actions must support a full review package approval separate from private upload.")
    if "public_publish_preapproval_blockers" not in review_source or "live YouTube API verification is not verified" not in review_source:
        failures.append("Public publish approval must require live YouTube API verification before logging owner approval.")
    approved_upload_source = (BASE / "scripts" / "upload_approved_package.py").read_text(encoding="utf-8")
    if "youtube_auth_health.py" not in approved_upload_source:
        failures.append("Approved package uploader must run YouTube OAuth health before live uploads.")
    approval_package_source = (BASE / "scripts" / "patternlab_approval_package.py").read_text(encoding="utf-8")
    if "does_not_approve_private_upload" not in approval_package_source or "does_not_approve_public_publish" not in approval_package_source:
        failures.append("Review package approval readiness must explicitly avoid private upload and public publish approval.")
    if "QUALITY_REPORTS" not in approval_package_source or "pending_targets" not in approval_package_source:
        failures.append("Review package approval readiness must list quality gates and target rows.")
    factory_source = (BASE / "scripts" / "patternlab_daily_factory.py").read_text(encoding="utf-8")
    if "I am Matthew" in factory_source:
        failures.append("Daily factory uses the retired presenter name Matthew.")
    if "I am James, and this is Pattern Lab." not in factory_source:
        failures.append("Daily factory must introduce the presenter as James.")
    if "city, source, system" not in factory_source or "No source, no story." not in factory_source:
        failures.append("Daily factory must enforce the city-history outro and source-proof signoff.")
    if "subscribe for the next Pattern Lab city file" not in factory_source and "subscribe for the next evidence-backed city file" not in factory_source:
        failures.append("Daily factory must include an earned subscribe CTA for future city files.")
    if "JAMES_MOMENT" not in factory_source or "That is a vibe. It is not evidence." not in factory_source:
        failures.append("Daily factory must inject one light-touch James persona moment into future scripts.")
    content_source = (BASE / "scripts" / "patternlab_content_quality.py").read_text(encoding="utf-8")
    if "build_retention_ladder_report" not in content_source:
        failures.append("Content quality gates must validate the retention ladder.")
    if "subscribe_cta" not in content_source:
        failures.append("Content quality gates must enforce an earned subscribe CTA.")
    if "build_james_persona_report" not in content_source:
        failures.append("Content quality gates must validate the James persona contract.")
    quality_gate_source = (BASE / "scripts" / "patternlab_quality_gates.py").read_text(encoding="utf-8")
    if "later_stage_blockers_not_milestone_6_failures" not in quality_gate_source:
        failures.append("Aggregate quality gates must classify later-stage production blockers separately.")
    if "build_thumbnail_quality_report" not in quality_gate_source or "build_source_rights_report" not in quality_gate_source:
        failures.append("Aggregate quality gates must include thumbnail and source-rights validators.")
    if "build_benchmark_growth_report" not in quality_gate_source:
        failures.append("Aggregate quality gates must include the benchmark-channel growth validator.")
    if "build_guru_growth_report" not in quality_gate_source:
        failures.append("Aggregate quality gates must include the YouTube guru growth validator.")
    persona_source = (BASE / "scripts" / "validate_james_persona.py").read_text(encoding="utf-8")
    if "overuses James persona moments" not in persona_source or "disallowed or unverifiable James biography" not in persona_source:
        failures.append("James persona validator must block overuse and unverifiable biography drift.")
    dashboard_source = (BASE / "scripts" / "patternlab_dashboard_server.py").read_text(encoding="utf-8")
    if "video_id" not in dashboard_source or "approve_public_publish" not in dashboard_source:
        failures.append("Dashboard does not expose video-aware approval gates.")
    if "approve_review_package" not in dashboard_source:
        failures.append("Dashboard must expose full review package approval separately from private upload.")
    if not DAILY_PLIST.exists() or "patternlab_daily_loop.py" not in DAILY_PLIST.read_text(encoding="utf-8"):
        failures.append("Daily LaunchAgent plist must run patternlab_daily_loop.py.")
    upload_source = (BASE / "scripts" / "upload_private_youtube.py").read_text(encoding="utf-8")
    approved_upload_source = (BASE / "scripts" / "upload_approved_package.py").read_text(encoding="utf-8")
    if "public" in upload_source and "private" in upload_source:
        warnings.append("Upload script mentions privacy states; verify public upload remains impossible in tests.")
    if "private-upload-ready" not in approved_upload_source or "upload_private_youtube.py" not in approved_upload_source:
        failures.append("Approved package uploader must require private readiness before private/unlisted upload.")
    if '"long-form"' not in approved_upload_source or '"short"' not in approved_upload_source:
        failures.append("Approved package uploader must upload both long-form and Shorts surfaces.")
    review_source = (BASE / "scripts" / "send_daily_review_to_discord.py").read_text(encoding="utf-8")
    if "LONG_FORM_MIN_SECONDS = 8 * 60" not in review_source or "validate_review_ready" not in review_source:
        failures.append("Discord review sender must block long-form drafts below 8 minutes.")
    if "James avatar concept" not in review_source or "patternlab_visual_upgrade.py" not in review_source:
        failures.append("Discord review sender must include James avatar approval concepts.")
    if "Approve review package" not in review_source or "Approve private upload" not in review_source:
        failures.append("Discord review sender must separate review package approval from private upload approval.")
    shorts_source = (BASE / "scripts" / "generate_shorts_ffmpeg.py").read_text(encoding="utf-8")
    if "script-moment-score" not in shorts_source or "score_paragraph" not in shorts_source:
        failures.append("Shorts generator must select clips using scored script moments.")
    image_source = (BASE / "scripts" / "generate_images.py").read_text(encoding="utf-8")
    image_contract = (BASE / "scripts" / "patternlab_images.py").read_text(encoding="utf-8")
    preflight_source = (BASE / "scripts" / "patternlab_preflight.py").read_text(encoding="utf-8")
    pipeline_source = (BASE / "scripts" / "patternlab_media_pipeline.py").read_text(encoding="utf-8")
    if "--source" not in image_source or "Codex image pack is valid. OpenAI backup skipped." not in image_source:
        failures.append("Image generator must support Codex-primary source selection and skip OpenAI when Codex images are valid.")
    if "create_codex_image_pack.swift" not in image_source:
        failures.append("Image generator must create a Codex image pack before using OpenAI backup.")
    if not (BASE / "scripts" / "create_codex_image_pack.swift").exists():
        failures.append("Codex image pack builder is missing.")
    if "CODEX_IMAGE_TOOL = \"Codex image generation\"" not in image_contract:
        failures.append("Image contract must record Codex image generation as the primary image source.")
    if "OPENAI_IMAGE_TOOL = \"OpenAI Images API\"" not in image_contract or "backup image source" not in image_contract:
        failures.append("Image contract must retain OpenAI Images API as backup-only source.")
    if "def openai_backup_policy" not in image_contract or "PATTERNLAB_OPENAI_BACKUP" not in image_contract:
        failures.append("Image contract must expose explicit OpenAI backup availability and enablement policy.")
    if "openai_api_key_for_unattended_images" in preflight_source:
        failures.append("Preflight must not hard-block solely on missing OpenAI image API key.")
    if "openai_backup_mode" not in preflight_source or "policy[\"can_run\"]" not in preflight_source:
        failures.append("Preflight must distinguish configured OpenAI backup keys from enabled backup mode.")
    if "validate_image_pack" not in pipeline_source or "--image-source" not in pipeline_source:
        failures.append("Media pipeline must validate image packs and expose image-source mode.")
    if "openai_backup_policy" not in pipeline_source:
        failures.append("Media pipeline must use the shared OpenAI backup policy.")
    if "patternlab_visual_upgrade.py" not in pipeline_source:
        failures.append("Media pipeline must generate the visual upgrade approval plan.")
    visual_upgrade_source = (BASE / "scripts" / "patternlab_visual_upgrade.py").read_text(encoding="utf-8")
    if "owner-review-required" not in visual_upgrade_source or "james-avatar-approval.json" not in visual_upgrade_source:
        failures.append("Visual upgrade plan must keep James avatar concepts owner-approval gated.")
    if "create_visual_upgrade_pack.swift" not in visual_upgrade_source:
        failures.append("Visual upgrade plan must create local James avatar concept assets.")
    if "copy_canonical_avatar" not in visual_upgrade_source or "james-canonical-avatar.png" not in visual_upgrade_source:
        failures.append("Visual upgrade plan must protect the approved canonical James avatar from regeneration drift.")
    if "REFERENCE_RULE" not in visual_upgrade_source:
        failures.append("Visual upgrade plan must preserve the approved James avatar asymmetry reference rule.")
    if not (BASE / "scripts" / "create_visual_upgrade_pack.swift").exists():
        failures.append("Visual upgrade Swift renderer is missing.")
    avatar_validator_source = (BASE / "scripts" / "validate_james_avatar.py").read_text(encoding="utf-8")
    if "Canonical James avatar hash does not match the approved manifest" not in avatar_validator_source:
        failures.append("James avatar validator must fail if the approved avatar hash drifts.")
    if "talking-avatar use by default" not in avatar_validator_source:
        failures.append("James avatar validator must keep lip-synced talking avatar use blocked by default.")
    build_video_source = (BASE / "scripts" / "build_video_ffmpeg.py").read_text(encoding="utf-8")
    if "Voiceover audio is older than final-script.md" not in build_video_source:
        failures.append("Video builder must reject stale voiceover audio after script changes.")
    voiceover_source = (BASE / "scripts" / "generate_voiceover.py").read_text(encoding="utf-8")
    if "launch/video-{args.video_id}/final-script.md" not in voiceover_source:
        failures.append("Voiceover generator must default to the matching video script.")
    readiness_source = (BASE / "scripts" / "private_upload_readiness.py").read_text(encoding="utf-8")
    if "Voiceover audio is older than final-script.md" not in readiness_source:
        failures.append("Private readiness must reject stale voiceover audio after script changes.")
    if "Shorts are not selected from scored script moments" not in readiness_source:
        failures.append("Private readiness must reject Shorts that were not selected from scored script moments.")
    if "validate_image_pack" not in readiness_source:
        failures.append("Private readiness must reject invalid or unledgered image packs.")
    if "Human review approval is incomplete" not in readiness_source or "Selected default thumbnail is not approved" not in readiness_source:
        failures.append("Private readiness must require complete asset approvals and an approved selected thumbnail.")
    if "Owner approval for the full review package is missing" not in readiness_source:
        failures.append("Private readiness must require review package approval before private upload.")
    public_readiness_source = (BASE / "scripts" / "public_publish_readiness.py").read_text(encoding="utf-8")
    if "youtube-upload-report-short-" not in public_readiness_source:
        failures.append("Public readiness must require private/unlisted upload reports for Shorts.")
    if "Related Video: long-form video" not in public_readiness_source:
        failures.append("Public readiness must require Related Video linking for Shorts.")
    if "youtube-live-verification-report.json" not in public_readiness_source or "Live YouTube API verification is not verified" not in public_readiness_source:
        failures.append("Public readiness must require live YouTube API verification before public approval.")
    verification_source = (BASE / "scripts" / "verify_youtube_uploads.py").read_text(encoding="utf-8")
    if "videos()" not in verification_source or "youtube.readonly" not in verification_source:
        failures.append("YouTube verification must query uploaded videos with the required readonly OAuth scope.")
    continue_source = (BASE / "scripts" / "patternlab_continue_until_blocked.py").read_text(encoding="utf-8")
    if "youtube_live_verification" not in continue_source:
        failures.append("Continue runner must surface live YouTube verification as a priority build gap.")
    daily_source = (BASE / "scripts" / "generate_daily_executive_brief.py").read_text(encoding="utf-8")
    if "build_tracker_report" not in daily_source or "build_calendar" not in daily_source:
        failures.append("Daily executive brief must include YPP progress and the two-week content calendar.")
    tracker_source = (BASE / "scripts" / "patternlab_monetization_tracker.py").read_text(encoding="utf-8")
    if "valid_public_long_form_watch_hours_12m" not in tracker_source or "valid_public_shorts_views_90d" not in tracker_source:
        failures.append("YPP tracker must track long-form watch hours and Shorts views separately.")
    calendar_source = (BASE / "scripts" / "patternlab_content_calendar.py").read_text(encoding="utf-8")
    if "PUBLISH_WEEKDAYS = [0, 2, 4]" not in calendar_source:
        failures.append("Content calendar must target the 3 long-form/week cadence.")
    shorts_source_check = (BASE / "scripts" / "generate_shorts_ffmpeg.py").read_text(encoding="utf-8")
    if "No Source, No Story" not in shorts_source_check or "Full city file" not in shorts_source_check:
        failures.append("Shorts generator must use the city-history proof and subscribe-bridge defaults.")


def validate_metrics(failures):
    template = BASE / "templates" / "performance-metrics-template.csv"
    if not template.exists():
        failures.append("Performance metrics template is missing.")
        return
    header = template.read_text(encoding="utf-8").splitlines()[0].split(",")
    missing = sorted(REQUIRED_METRICS - set(header))
    if missing:
        failures.append(f"Performance metrics template is missing fields: {', '.join(missing)}.")
    text = template.read_text(encoding="utf-8")
    for checkpoint in [",24,", ",72,", ",168,", ",720,"]:
        if checkpoint not in text:
            failures.append("Performance metrics template must include 24h, 72h, 7d, and 30d checkpoints.")


def validate_media_gate(video_id, failures, warnings):
    root = output_root(video_id)
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if long_form.exists():
        duration = media_duration_seconds(long_form)
        if video_id == "01" and duration < 480:
            report = root / "approval" / "private-upload-readiness.md"
            if report.exists() and "below the 8 minute monetization target" in report.read_text(encoding="utf-8"):
                warnings.append("Video 01 pilot is correctly blocked below the 8-minute monetization target.")
            else:
                failures.append("Video 01 pilot is short but not clearly blocked by readiness.")


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab against the 10/10 monetization strategy.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()

    failures = []
    warnings = []
    strategy = read_json(STRATEGY)
    slate = read_json(SLATE)
    validate_strategy(strategy, failures, warnings)
    validate_slate(strategy, slate, failures, warnings)
    validate_legacy_isolation(failures, warnings)
    validate_launch_packages(strategy, failures, warnings)
    validate_scripts(failures, warnings)
    validate_metrics(failures)
    validate_media_gate(args.video_id, failures, warnings)
    avatar_video_id = None if args.video_id == "01" else args.video_id
    avatar_failures, avatar_warnings, _ = validate_avatar_contract(avatar_video_id)
    failures.extend(avatar_failures)
    warnings.extend(avatar_warnings)
    persona_payload, _ = build_james_persona_report(None if args.video_id == "01" else args.video_id)
    failures.extend(persona_payload.get("failures", []))
    warnings.extend(persona_payload.get("warnings", []))
    if args.video_id == "01":
        warnings.append("Video 01 is a legacy pilot; validated the global James avatar contract without requiring Video 01-local avatar assets.")
        warnings.append("Video 01 is a legacy pilot; validated the global James persona contract without requiring Video 01-local persona moments.")

    status = "pass" if not failures else "blocked"
    payload = {
        "generated_at": utc_now(),
        "status": status,
        "failures": failures,
        "warnings": warnings,
        "validated_video_id": args.video_id,
    }
    out_dir = ensure_dir(BASE / "state" / "monetization")
    json_report = out_dir / "strategy-validation.json"
    md_report = out_dir / "strategy-validation.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab Strategy Validation",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {status}",
        "",
        "## Failures",
        "",
        *([f"- {failure}" for failure in failures] or ["- none"]),
        "",
        "## Warnings",
        "",
        *([f"- {warning}" for warning in warnings] or ["- none"]),
        "",
    ]
    md_report.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Strategy validation: {display_path(md_report)}")
    for failure in failures:
        print(f"- {failure}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
