#!/usr/bin/env python3
import argparse
import csv
import json
from collections import Counter
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, media_duration_seconds, output_root, utc_now
from patternlab_approval_package import build_approval_package_report
from patternlab_benchmark_growth import build_benchmark_growth_report
from patternlab_content_quality import build_content_quality_report
from patternlab_episode_standard import build_episode_standard_report
from patternlab_first5_hook import build_first5_hook_report
from patternlab_guru_growth_gates import build_guru_growth_report
from patternlab_images import REQUIRED_IMAGE_SPECS, openai_backup_policy, validate_image_pack, write_image_source_report
from patternlab_long_form_quality import build_long_form_quality_report
from patternlab_motion_polish import build_motion_polish_report
from patternlab_quality_gates import build_quality_gates_report
from patternlab_package_hashes import build_report as build_package_hash_report
from patternlab_claim_ledger_quality import build_report as build_claim_ledger_quality_report
from patternlab_asset_identity import build_report as build_asset_identity_report
from patternlab_retention_ladder import build_retention_ladder_report
from patternlab_shorts_audio_economy import build_audio_economy_report
from patternlab_shorts_boundary_quality import build_boundary_quality_report
from patternlab_shorts_engagement_loop import build_engagement_loop_report
from patternlab_shorts_first_frame_quality import build_first_frame_quality_report
from patternlab_shorts_pacing_quality import build_pacing_quality_report
from patternlab_shorts_quality import build_shorts_quality_report
from patternlab_shorts_render_readiness import build_render_readiness_report
from patternlab_shorts_script_package import build_shorts_script_package
from patternlab_shorts_toolchain_handoff import build_toolchain_handoff
from patternlab_source_rights import build_source_rights_report
from patternlab_synthetic_disclosure import build_synthetic_disclosure_report
from patternlab_thumbnail_quality import build_thumbnail_quality_report
from patternlab_transcript_viral_quality import build_transcript_viral_report
from patternlab_comment_quality import build_comment_quality_report
from patternlab_transcript_watchtime_score import build_score as build_transcript_watchtime_score
from patternlab_transcript_editorial_quality import build_report as build_transcript_editorial_quality_report
from patternlab_visual_quality import build_visual_quality_report
from patternlab_visual_variety import build_visual_variety_report

REQUIRED_FULL_APPROVAL_TYPES = ["image", "voiceover", "proof_footage", "video", "short"]


def ledger_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_json(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def unresolved_repairs(path):
    if not path.exists():
        return []
    repairs = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                repairs.append({"reason": "unparseable repair queue row", "status": "queued"})
                continue
            if event.get("status", "queued") not in {"resolved", "closed", "cancelled"}:
                repairs.append(event)
    return repairs


def approved(row):
    return row.get("human_review_status", "").lower() == "approved"


def rows_for_type(rows, asset_type):
    return [row for row in rows if row.get("asset_type") == asset_type]


def approved_rows_for_type(rows, asset_type):
    return [row for row in rows_for_type(rows, asset_type) if approved(row)]


def predates(path, reference):
    return path.exists() and reference.exists() and path.stat().st_mtime < reference.stat().st_mtime


def approval_blockers(rows, metadata):
    blockers = []
    for asset_type in REQUIRED_FULL_APPROVAL_TYPES:
        typed = rows_for_type(rows, asset_type)
        approved_count = len([row for row in typed if approved(row)])
        if typed and approved_count != len(typed):
            blockers.append(
                f"Human review approval is incomplete for asset type: {asset_type} ({approved_count}/{len(typed)} approved)."
            )
    thumbnail_rows = rows_for_type(rows, "thumbnail")
    if thumbnail_rows:
        default_thumbnail = (metadata or {}).get("default_thumbnail", "images/thumbnail_candidate_a.png")
        approved_thumbnails = approved_rows_for_type(rows, "thumbnail")
        default_approved = any(row.get("filename") == default_thumbnail for row in approved_thumbnails)
        if not approved_thumbnails:
            blockers.append("Human review approval is missing for final thumbnail.")
        elif not default_approved:
            blockers.append(f"Selected default thumbnail is not approved: {default_thumbnail}.")
    return blockers


def main():
    parser = argparse.ArgumentParser(description="Check Pattern Lab private upload readiness.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    report = approval / "private-upload-readiness.md"
    long_form = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    shorts = sorted((root / "shorts").glob("pattern-lab-video-*-short-*.mp4")) if (root / "shorts").exists() else []
    shorts_plan = approval / "shorts-upload-plan.md"
    voiceover = root / "audio" / "voiceover_full.mp3"
    normalized = root / "audio" / "voiceover_full_normalized.mp3"
    proof = sorted((root / "proof-footage").glob("*.mp4")) if (root / "proof-footage").exists() else []
    ledger = root / "rights-ledger.csv"
    metadata = approval / "upload-metadata.json"
    monetization_report = approval / "monetization-gates-report.json"
    content_quality, content_quality_report = build_content_quality_report(args.video_id)
    episode_standard, episode_standard_json_report, episode_standard_md_report = build_episode_standard_report(args.video_id)
    first5_hook, first5_hook_json_report, first5_hook_md_report = build_first5_hook_report(args.video_id)
    retention_ladder, retention_ladder_report = build_retention_ladder_report(args.video_id)
    long_form_quality, long_form_quality_report = build_long_form_quality_report(args.video_id)
    shorts_script_package, shorts_script_package_json_report, shorts_script_package_md_report = build_shorts_script_package(args.video_id)
    shorts_audio_economy, shorts_audio_economy_json_report, shorts_audio_economy_md_report = build_audio_economy_report(args.video_id)
    shorts_boundary_quality, shorts_boundary_quality_json_report, shorts_boundary_quality_md_report = build_boundary_quality_report(args.video_id)
    shorts_first_frame_quality, shorts_first_frame_quality_json_report, shorts_first_frame_quality_md_report = build_first_frame_quality_report(args.video_id)
    shorts_pacing_quality, shorts_pacing_quality_json_report, shorts_pacing_quality_md_report = build_pacing_quality_report(args.video_id)
    shorts_engagement_loop, shorts_engagement_loop_json_report, shorts_engagement_loop_md_report = build_engagement_loop_report(args.video_id)
    shorts_toolchain_handoff, shorts_toolchain_handoff_json_report, shorts_toolchain_handoff_md_report = build_toolchain_handoff(args.video_id)
    shorts_render_readiness, shorts_render_readiness_json_report, shorts_render_readiness_md_report = build_render_readiness_report(args.video_id)
    shorts_quality, shorts_quality_report = build_shorts_quality_report(args.video_id)
    thumbnail_quality, thumbnail_quality_report = build_thumbnail_quality_report(args.video_id)
    thumbnail_factory_report = approval / "thumbnail-factory-report.json"
    thumbnail_factory = read_json(thumbnail_factory_report) or {}
    source_rights, source_rights_json_report, source_rights_md_report = build_source_rights_report(args.video_id)
    visual_quality, visual_quality_json_report, visual_quality_md_report = build_visual_quality_report(args.video_id)
    visual_variety, visual_variety_json_report, visual_variety_md_report = build_visual_variety_report(args.video_id)
    motion_polish, motion_polish_json_report, motion_polish_md_report = build_motion_polish_report(args.video_id)
    benchmark_growth, benchmark_growth_json_report, benchmark_growth_md_report = build_benchmark_growth_report(args.video_id)
    guru_growth, guru_growth_json_report, guru_growth_md_report = build_guru_growth_report(args.video_id)
    quality_gates, quality_gates_json_report, quality_gates_md_report = build_quality_gates_report(args.video_id)
    transcript_viral, transcript_viral_json_report, transcript_viral_md_report = build_transcript_viral_report(args.video_id)
    comment_quality, comment_quality_json_report, comment_quality_md_report = build_comment_quality_report(args.video_id)
    transcript_watchtime, transcript_watchtime_json_report, transcript_watchtime_md_report = build_transcript_watchtime_score(args.video_id)
    transcript_editorial, transcript_editorial_json_report, transcript_editorial_md_report = build_transcript_editorial_quality_report(args.video_id)
    package_hash, _, package_hash_md_report = build_package_hash_report(args.video_id)
    claim_ledger, _, claim_ledger_md_report = build_claim_ledger_quality_report(args.video_id)
    asset_identity, _, asset_identity_md_report = build_asset_identity_report(args.video_id)
    package_hash_report = package_hash_md_report
    private_upload_approval = approval / "private-upload-approval.json"
    review_package_approval = approval / "review-package-approval.json"
    visual_rebuild_manifest = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    discord_manifest = approval / "discord-review-delivery-plan.json"
    discord_packet_quality_report = approval / "discord-review-packet-quality-report.json"
    discord_packet_quality = read_json(discord_packet_quality_report) or {}
    repairs = unresolved_repairs(approval / "repair-queue.jsonl")
    rows = ledger_rows(ledger)
    by_type = Counter(row.get("asset_type", "") for row in rows)
    approved_by_type = Counter(row.get("asset_type", "") for row in rows if approved(row))
    review_package, _, review_package_report = build_approval_package_report(args.video_id, refresh_quality=False)
    image_report = validate_image_pack(root)
    policy = openai_backup_policy()
    write_image_source_report(
        root,
        args.video_id,
        image_report,
        backup_available=policy["available"],
        backup_enabled=policy["enabled"],
    )
    required_image_lines = []
    for filename, asset_type in REQUIRED_IMAGE_SPECS:
        status = next((item for item in image_report["file_status"] if item["filename"] == filename), None)
        label = "valid" if status and status.get("valid") else f"invalid ({status.get('reason') if status else 'missing'})"
        required_image_lines.append(f"- {filename}: {label} ({asset_type})")

    blockers = []
    if package_hash.get("status") != "pass" or package_hash.get("stale_outputs") or package_hash.get("blockers"):
        blockers.append(f"Package freshness/hash gate is blocked: {display_path(package_hash_report)}.")
    if claim_ledger.get("status") != "pass":
        blockers.append(f"Claim/source ledger gate is blocked: {display_path(claim_ledger_md_report)}.")
    if asset_identity.get("status") != "pass":
        blockers.append(f"Upload asset identity gate is blocked: {display_path(asset_identity_md_report)}.")
    if not long_form.exists():
        blockers.append("Long-form draft is missing.")
    else:
        try:
            duration = media_duration_seconds(long_form)
            if duration < 8 * 60:
                blockers.append(f"Long-form draft is below the 8 minute monetization target: {duration:.1f}s.")
            if duration > 14 * 60:
                blockers.append(f"Long-form draft is above the 14 minute monetization target: {duration:.1f}s.")
        except Exception as exc:
            blockers.append(f"Could not verify long-form duration: {exc}.")
    if len(shorts) < 3:
        blockers.append("At least 3 Shorts are required.")
    if not shorts_plan.exists():
        blockers.append("Shorts upload plan is missing.")
    else:
        shorts_plan_text = shorts_plan.read_text(encoding="utf-8")
        if "Timestamp source: scripted-short-package" not in shorts_plan_text:
            blockers.append("Shorts are not selected from the standalone scripted Shorts package.")
        if shorts_plan_text.count("Standalone score:") < 3 or shorts_plan_text.count("Scripted transcript:") < 3:
            blockers.append("Shorts upload plan is missing standalone scores or scripted transcripts.")
    if not voiceover.exists() or not normalized.exists():
        blockers.append("Final voiceover and normalized voiceover are required.")
    else:
        script_path = BASE / "launch" / f"video-{args.video_id}" / "final-script.md"
        if script_path.exists():
            newest_audio = max(voiceover.stat().st_mtime, normalized.stat().st_mtime)
            if script_path.stat().st_mtime > newest_audio:
                blockers.append("Voiceover audio is older than final-script.md and must be regenerated before upload.")
    if not image_report["usable_valid"]:
        problems = []
        if image_report["missing_images"]:
            problems.append(f"missing {', '.join(image_report['missing_images'])}")
        if image_report["invalid_images"]:
            problems.append(
                "invalid "
                + ", ".join(f"{item['filename']} ({item['reason']})" for item in image_report["invalid_images"])
            )
        if image_report["ledger_missing"]:
            problems.append(f"missing ledger rows {', '.join(image_report['ledger_missing'])}")
        if image_report["ledger_invalid"]:
            problems.append(
                "invalid ledger rows "
                + ", ".join(f"{item['filename']} ({item['reason']})" for item in image_report["ledger_invalid"])
            )
        blockers.append(f"Required image pack is not valid: {'; '.join(problems)}.")
    if not proof:
        blockers.append("Source proof footage is required.")
    if not rows:
        blockers.append("Rights ledger is missing or empty.")
    metadata_payload = read_json(metadata)
    if not metadata.exists():
        blockers.append("Upload metadata package is missing.")
    monetization = read_json(monetization_report)
    if not monetization:
        blockers.append("Monetization gates report is missing.")
    elif monetization.get("status") != "pass":
        blockers.append("Monetization gates are blocked.")
    if content_quality.get("status") != "pass":
        blockers.append(f"Content quality gates are blocked: {display_path(content_quality_report)}.")
    if episode_standard.get("status") != "pass":
        blockers.append(f"Episode standard gates are blocked: {display_path(episode_standard_md_report)}.")
    if first5_hook.get("status") != "pass":
        blockers.append(f"First-5 hook gates are blocked: {display_path(first5_hook_md_report)}.")
    if retention_ladder.get("status") != "pass":
        blockers.append(f"Retention ladder gates are blocked: {display_path(retention_ladder_report)}.")
    if long_form_quality.get("status") != "pass":
        blockers.append(f"Long-form quality gates are blocked: {display_path(long_form_quality_report)}.")
    if transcript_viral.get("status") != "pass":
        blockers.append(f"Transcript viral quality gates are blocked: {display_path(transcript_viral_md_report)}.")
    if comment_quality.get("status") != "pass":
        blockers.append(f"Comment/source-lead quality gates are blocked: {display_path(comment_quality_md_report)}.")
    if transcript_watchtime.get("status") != "pass":
        blockers.append(f"Transcript watch-time score is blocked: {display_path(transcript_watchtime_md_report)}.")
    if transcript_editorial.get("status") != "pass":
        blockers.append(f"Transcript editorial quality is blocked: {display_path(transcript_editorial_md_report)}.")
    if shorts_script_package.get("status") != "pass":
        blockers.append(f"Shorts script package is blocked: {display_path(shorts_script_package_md_report)}.")
    if shorts_audio_economy.get("status") != "pass":
        blockers.append(f"Shorts audio economy gate is blocked: {display_path(shorts_audio_economy_md_report)}.")
    if shorts_boundary_quality.get("status") != "pass":
        blockers.append(f"Shorts boundary quality gate is blocked: {display_path(shorts_boundary_quality_md_report)}.")
    if shorts_first_frame_quality.get("status") != "pass":
        blockers.append(f"Shorts first-frame quality gate is blocked: {display_path(shorts_first_frame_quality_md_report)}.")
    if shorts_pacing_quality.get("status") != "pass":
        blockers.append(f"Shorts pacing quality gate is blocked: {display_path(shorts_pacing_quality_md_report)}.")
    if shorts_engagement_loop.get("status") != "pass":
        blockers.append(f"Shorts engagement loop gate is blocked: {display_path(shorts_engagement_loop_md_report)}.")
    if shorts_toolchain_handoff.get("status") != "pass":
        blockers.append(f"Shorts free-first toolchain handoff is blocked: {display_path(shorts_toolchain_handoff_md_report)}.")
    if shorts_render_readiness.get("status") != "render-ready":
        blockers.append(f"Shorts render readiness is blocked: {display_path(shorts_render_readiness_md_report)}.")
    if shorts_quality.get("status") != "pass":
        blockers.append(f"Shorts quality gates are blocked: {display_path(shorts_quality_report)}.")
    if thumbnail_quality.get("status") != "pass":
        blockers.append(f"Thumbnail quality gates are blocked: {display_path(thumbnail_quality_report)}.")
    if thumbnail_factory.get("status") != "pass":
        blockers.append(f"Thumbnail factory is blocked or missing: {display_path(thumbnail_factory_report)}.")
    if source_rights.get("status") != "pass":
        blockers.append(f"Source rights gates are blocked: {display_path(source_rights_md_report)}.")
    synthetic_disclosure, synthetic_disclosure_json_report, synthetic_disclosure_md_report = build_synthetic_disclosure_report(args.video_id)
    if synthetic_disclosure.get("status") != "pass":
        blockers.append(f"Synthetic disclosure gates are blocked: {display_path(synthetic_disclosure_md_report)}.")
    if visual_quality.get("status") != "pass":
        blockers.append(f"Visual quality gates are blocked: {display_path(visual_quality_md_report)}.")
    if visual_variety.get("status") != "pass":
        blockers.append(f"Visual variety gates are blocked: {display_path(visual_variety_md_report)}.")
    if motion_polish.get("status") != "pass":
        blockers.append(f"Motion polish gates are blocked: {display_path(motion_polish_md_report)}.")
    if benchmark_growth.get("status") != "pass":
        blockers.append(f"Benchmark growth gates are blocked: {display_path(benchmark_growth_md_report)}.")
    if guru_growth.get("status") != "pass":
        blockers.append(f"Guru growth gates are blocked: {display_path(guru_growth_md_report)}.")
    if quality_gates.get("status") != "pass":
        blockers.append(f"Aggregate quality gates are blocked: {display_path(quality_gates_md_report)}.")
    if not discord_manifest.exists():
        blockers.append("Discord review delivery plan is missing.")
    elif not discord_packet_quality_report.exists():
        blockers.append("Discord review packet quality report is missing.")
    elif predates(discord_packet_quality_report, discord_manifest):
        blockers.append("Discord review packet quality report is stale compared with the Discord delivery plan.")
    elif discord_packet_quality.get("status") != "pass":
        blockers.append(f"Discord review packet quality is blocked: {display_path(discord_packet_quality_report)}.")
    if repairs:
        blockers.append(f"Unresolved repair queue items exist: {len(repairs)}.")
    if not review_package_approval.exists():
        blockers.append("Owner approval for the full review package is missing.")
    elif predates(review_package_approval, visual_rebuild_manifest):
        blockers.append("Owner approval for the rebuilt review package is required because the visual rebuild occurred after the prior review-package approval.")
    elif predates(review_package_approval, thumbnail_factory_report):
        blockers.append("Owner approval for the rebuilt thumbnail package is required because the thumbnail factory changed after the prior review-package approval.")
    elif review_package.get("status") != "ready-for-review-package-approval" and review_package.get("pending_target_count", 0):
        blockers.append("Review package approval exists, but the latest review package readiness report is blocked.")
    if not private_upload_approval.exists():
        blockers.append("Owner approval for private/unlisted upload is missing.")
    elif predates(private_upload_approval, visual_rebuild_manifest):
        blockers.append("Owner approval for replacement private/unlisted upload is required because the visual rebuild occurred after the prior private-upload approval.")
    elif predates(private_upload_approval, thumbnail_factory_report):
        blockers.append("Owner approval for replacement private/unlisted upload is required because the thumbnail factory changed after the prior private-upload approval.")
    blockers.extend(approval_blockers(rows, metadata_payload))
    if voiceover.exists():
        voiceover_rows = [row for row in rows if row.get("asset_type") == "voiceover"]
        text = ",".join(row.get("notes", "") for row in voiceover_rows).lower()
        has_live_voiceover = any(row.get("tool") == "ElevenLabs API" for row in voiceover_rows)
        if "silent assembly draft" in text and not has_live_voiceover:
            blockers.append("Voiceover ledger still marks audio as a silent assembly draft.")

    status = "private-upload-ready" if not blockers else "blocked-before-private-upload"
    json_report = approval / "private-upload-readiness.json"
    json_report.write_text(
        json.dumps(
            {
                "generated_at": utc_now(),
                "video_id": args.video_id,
                "status": status,
                "blockers": blockers,
                "public_publishing": "blocked_until_explicit_owner_approval",
                "youtube_mutation": "not_performed",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    lines = [
        f"# Pattern Lab Private Upload Readiness: Video {args.video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        f"Status: {status}",
        "Public publishing: blocked until explicit owner approval",
        "",
        "## Assets",
        "",
        f"- Long-form draft: {'present' if long_form.exists() else 'missing'} ({display_path(long_form)})",
        f"- Shorts count: {len(shorts)}",
        f"- Shorts upload plan: {'present' if shorts_plan.exists() else 'missing'} ({display_path(shorts_plan)})",
        f"- Voiceover: {'present' if voiceover.exists() else 'missing'} ({display_path(voiceover)})",
        f"- Normalized voiceover: {'present' if normalized.exists() else 'missing'} ({display_path(normalized)})",
        f"- Source proof footage count: {len(proof)}",
        f"- Generated image source: {image_report['selected_source']}",
        f"- Visual rebuild historical/real-photo assets: {visual_quality.get('historical_asset_count', 0)}",
        f"- Visual rebuild modern stock/context assets: {visual_quality.get('modern_context_asset_count', 0)}",
        f"- Real-media runtime share: {visual_quality.get('real_runtime_share', 0) * 100:.1f}%",
        f"- Generated/support runtime share: {visual_quality.get('generated_runtime_share', 0) * 100:.1f}%",
        f"- Visual variety categories: {visual_variety.get('distinct_category_count', 0)}",
        f"- Visual variety max category share: {visual_variety.get('max_category_runtime_share', 1) * 100:.1f}%",
        f"- Rights ledger: {'present' if ledger.exists() else 'missing'} ({display_path(ledger)})",
        f"- Upload metadata: {'present' if metadata.exists() else 'missing'} ({display_path(metadata)})",
        f"- Monetization gates: {'pass' if monetization and monetization.get('status') == 'pass' else 'not passed'} ({display_path(monetization_report)})",
        f"- Content quality gates: {content_quality.get('status')} ({display_path(content_quality_report)})",
        f"- Episode standard gates: {episode_standard.get('status')} ({display_path(episode_standard_md_report)}; json={display_path(episode_standard_json_report)})",
        f"- First-5 hook gates: {first5_hook.get('status')} ({display_path(first5_hook_md_report)})",
        f"- First-5 hook JSON: {display_path(first5_hook_json_report)}",
        f"- Retention ladder gates: {retention_ladder.get('status')} ({display_path(retention_ladder_report)})",
        f"- Long-form quality gates: {long_form_quality.get('status')} ({display_path(long_form_quality_report)})",
        f"- Transcript viral quality gates: {transcript_viral.get('status')} ({display_path(transcript_viral_md_report)})",
        f"- Comment/source-lead quality gates: {comment_quality.get('status')} ({display_path(comment_quality_md_report)})",
        f"- Transcript watch-time score: {transcript_watchtime.get('status')} ({transcript_watchtime.get('total_score', 0)}/{transcript_watchtime.get('max_score', 55)}; {display_path(transcript_watchtime_md_report)})",
        f"- Transcript editorial quality: {transcript_editorial.get('status')} ({display_path(transcript_editorial_md_report)})",
        f"- Shorts script package: {shorts_script_package.get('status')} ({display_path(shorts_script_package_md_report)})",
        f"- Shorts audio economy: {shorts_audio_economy.get('status')} ({display_path(shorts_audio_economy_md_report)})",
        f"- Shorts boundary quality: {shorts_boundary_quality.get('status')} ({display_path(shorts_boundary_quality_md_report)}; rendered alignment={shorts_boundary_quality.get('rendered_cut_alignment_status', 'missing')})",
        f"- Shorts first-frame quality: {shorts_first_frame_quality.get('status')} ({display_path(shorts_first_frame_quality_md_report)}; overlays={shorts_first_frame_quality.get('overlay_checks_status', 'missing')})",
        f"- Shorts pacing quality: {shorts_pacing_quality.get('status')} ({display_path(shorts_pacing_quality_md_report)}; rendered MP4 checks={shorts_pacing_quality.get('rendered_mp4_checks_status', 'missing')})",
        f"- Shorts engagement loop: {shorts_engagement_loop.get('status')} ({display_path(shorts_engagement_loop_md_report)})",
        f"- Shorts free-first toolchain handoff: {shorts_toolchain_handoff.get('status')} ({display_path(shorts_toolchain_handoff_md_report)})",
        f"- Shorts render readiness: {shorts_render_readiness.get('status')} ({display_path(shorts_render_readiness_md_report)})",
        f"- Shorts quality gates: {shorts_quality.get('status')} ({display_path(shorts_quality_report)})",
        f"- Thumbnail factory: {thumbnail_factory.get('status', 'missing')} ({display_path(thumbnail_factory_report)})",
        f"- Active city: {thumbnail_factory.get('active_city', 'missing')}",
        f"- City-agnostic templates: {thumbnail_factory.get('city_agnostic_status', 'missing')}",
        f"- Current thumbnail renderer: {thumbnail_factory.get('current_thumbnail_renderer', 'missing')}",
        f"- Current image generator: {thumbnail_factory.get('current_image_generator', 'missing')}",
        f"- Recommended free AI support generator: {thumbnail_factory.get('recommended_free_ai_support_generator', 'missing')}",
        f"- Recommended premium AI support generator: {thumbnail_factory.get('recommended_premium_ai_support_generator', 'missing')}",
        f"- AI support asset policy: {thumbnail_factory.get('ai_support_asset_policy_status', 'missing')}",
        f"- Internet reference non-derivative gate: {thumbnail_factory.get('internet_reference_non_derivative_status', 'missing')}",
        f"- Owner feedback learning: {thumbnail_factory.get('owner_feedback_learning_status', 'missing')}",
        f"- Owner rating preference V2: {thumbnail_factory.get('owner_rating_learning_v2_status', 'missing')} ({thumbnail_factory.get('preferred_baseline_style', 'missing')})",
        f"- Map/redrawn semantic match: {thumbnail_factory.get('redrawn_map_semantic_match_status', 'missing')}",
        f"- Underground semantic asset: {thumbnail_factory.get('underground_semantic_asset_status', 'missing')}",
        f"- Whole-word redaction: {thumbnail_factory.get('whole_word_redaction_status', 'missing')} ({thumbnail_factory.get('partial_word_redaction_count', 'missing')} partial-word redactions)",
        f"- Lost-streets visual relevance: {thumbnail_factory.get('lost_streets_semantic_asset_status', 'missing')} (rail image used: {thumbnail_factory.get('rail_image_used_for_lost_streets', 'missing')})",
        f"- Then/now split integrity: {thumbnail_factory.get('then_now_split_integrity_status', 'missing')} ({thumbnail_factory.get('then_now_median_crossing_count', 'missing')} median crossings)",
        f"- AI support asset boundary: {thumbnail_factory.get('ai_support_asset_manifest_status', 'missing')} ({thumbnail_factory.get('ai_fake_proof_count', 'missing')} fake proof assets)",
        f"- Current-style renderer V4: {thumbnail_factory.get('current_style_renderer_v4_status', 'missing')}",
        f"- Real city source-first examples: {thumbnail_factory.get('real_city_source_first_examples_status', 'missing')} (mode={thumbnail_factory.get('official_city_example_mode', 'missing')}, ad_hoc_mockup_blocked={thumbnail_factory.get('ad_hoc_mockup_blocked', 'missing')})",
        f"- Free-first thumbnail workflow: {thumbnail_factory.get('free_toolchain_status', 'missing')}",
        f"- Thumbnail rough/shortlisted/review/selected concepts: {thumbnail_factory.get('rough_concept_count', 0)} / {thumbnail_factory.get('shortlisted_concept_count', 0)} / {thumbnail_factory.get('review_concept_count', 0)} / {thumbnail_factory.get('selected_candidate_count', 0)}",
        f"- Paid tool used: {thumbnail_factory.get('paid_tool_used', True)}",
        f"- Paid asset used: {thumbnail_factory.get('paid_asset_used', True)}",
        f"- OCR mobile readability: {thumbnail_factory.get('mobile_ocr_readability_status', 'missing')}",
        f"- Benchmark similarity scoring: {thumbnail_factory.get('benchmark_similarity_status', 'missing')}",
        f"- Photopea/GIMP handoff: {display_path(approval / 'thumbnail-manual-handoff.json')} ({thumbnail_factory.get('manual_handoff_status', 'missing')})",
        "- Paid tool escalation: blocked unless the owner approves after a documented free-workflow failure",
        f"- Thumbnail contact sheet: {display_path(approval / 'thumbnail-contact-sheet.png')}",
        f"- Thumbnail city name dominance: {thumbnail_factory.get('city_name_dominant_count', 0)}/5 concepts",
        f"- Thumbnail clear promise: {thumbnail_factory.get('clear_promise_count', 0)}/5 concepts",
        f"- City skyline/landmark recognition: {thumbnail_factory.get('skyline_or_landmark_count', 0)}/5 concepts",
        f"- City recognizable visuals: {thumbnail_factory.get('city_recognizable_visual_count', thumbnail_factory.get('detroit_recognizable_visual_count', 0))}/5 concepts",
        f"- Internal public labels: {thumbnail_factory.get('internal_public_label_count', 0)}",
        f"- Random arrows: {thumbnail_factory.get('random_arrow_count', 0)}",
        f"- Every-word intent gate: {thumbnail_factory.get('every_word_intent_gate_status', 'missing')} ({thumbnail_factory.get('irrelevant_public_word_count', 'missing')} irrelevant words)",
        f"- Spelling/OCR verification: {thumbnail_factory.get('spelling_ocr_verification_status', 'missing')} ({thumbnail_factory.get('spelling_error_count', 'missing')} spelling errors)",
        f"- Cutoff text detection: {thumbnail_factory.get('cutoff_text_detection_status', 'missing')} ({thumbnail_factory.get('cutoff_text_count', 'missing')} cut-off text items)",
        f"- No image distortion: {thumbnail_factory.get('no_image_distortion_status', 'missing')} ({thumbnail_factory.get('distorted_image_count', 'missing')} distorted images)",
        f"- Layout safe zones: {thumbnail_factory.get('layout_safe_zone_status', 'missing')} ({thumbnail_factory.get('layout_safe_zone_violation_count', 'missing')} violations)",
        f"- Creative variation memory: {thumbnail_factory.get('creative_variation_memory_status', 'missing')} ({thumbnail_factory.get('creative_variation_style_count', 'missing')} styles)",
        f"- Per-thumbnail critique reports: {thumbnail_factory.get('per_thumbnail_critique_status', 'missing')} ({thumbnail_factory.get('per_thumbnail_critique_count', 'missing')} critiques)",
        f"- Fictional publication-name preflight: {thumbnail_factory.get('publication_name_preflight_status', 'missing')}",
        f"- Competitive benchmark aesthetic: {thumbnail_factory.get('benchmark_aesthetic_match_count', 0)}/5 concepts",
        f"- Thumbnail search shelf: {thumbnail_factory.get('search_shelf_test_status', 'missing')} ({display_path(approval / 'thumbnail-search-shelf-test.png')})",
        f"- Five-concept thumbnail contact sheet: {display_path(approval / 'thumbnail-five-concept-contact-sheet.png')}",
        f"- Canva render handoff: {display_path(approval / 'canva-render-handoff.json')}",
        f"- Thumbnail quality gates: {thumbnail_quality.get('status')} ({display_path(thumbnail_quality_report)})",
        f"- Source rights gates: {source_rights.get('status')} ({display_path(source_rights_md_report)})",
        f"- Source rights JSON: {display_path(source_rights_json_report)}",
        f"- Synthetic disclosure gates: {synthetic_disclosure.get('status')} ({display_path(synthetic_disclosure_md_report)})",
        f"- Synthetic disclosure JSON: {display_path(synthetic_disclosure_json_report)}",
        f"- Synthetic disclosure decision present: {synthetic_disclosure.get('synthetic_disclosure_decision_present', False)}",
        f"- Visual quality gates: {visual_quality.get('status')} ({display_path(visual_quality_md_report)})",
        f"- Visual quality JSON: {display_path(visual_quality_json_report)}",
        f"- Visual variety gates: {visual_variety.get('status')} ({display_path(visual_variety_md_report)})",
        f"- Visual variety JSON: {display_path(visual_variety_json_report)}",
        f"- Motion polish gates: {motion_polish.get('status')} ({display_path(motion_polish_md_report)})",
        f"- Motion polish JSON: {display_path(motion_polish_json_report)}",
        f"- Benchmark growth gates: {benchmark_growth.get('status')} ({display_path(benchmark_growth_md_report)})",
        f"- Benchmark growth JSON: {display_path(benchmark_growth_json_report)}",
        f"- Guru growth gates: {guru_growth.get('status')} ({display_path(guru_growth_md_report)})",
        f"- Guru growth JSON: {display_path(guru_growth_json_report)}",
        f"- Aggregate quality gates: {quality_gates.get('status')} ({display_path(quality_gates_md_report)})",
        f"- Aggregate quality JSON: {display_path(quality_gates_json_report)}",
        f"- Discord review delivery plan: {'present' if discord_manifest.exists() else 'missing'} ({display_path(discord_manifest)})",
        f"- Discord review packet quality: {discord_packet_quality.get('status', 'missing')} ({display_path(discord_packet_quality_report)})",
        f"- Review package approval: {'present' if review_package_approval.exists() else 'missing'} ({display_path(review_package_approval)})",
        f"- Review package approval readiness: {review_package.get('status')} ({display_path(review_package_report)})",
        f"- Private/unlisted upload approval: {'present' if private_upload_approval.exists() else 'missing'} ({display_path(private_upload_approval)})",
        f"- Unresolved repair queue items: {len(repairs)}",
        "",
        "## Required Images",
        "",
        *required_image_lines,
        "",
        "## Rights Ledger Review",
        "",
    ]
    for asset_type, count in sorted(by_type.items()):
        lines.append(f"- {asset_type}: {count} rows, {approved_by_type.get(asset_type, 0)} approved")
    lines.extend(
        [
            "",
            "## Review Package Approval",
            "",
            "- Approves reviewed media assets only; it does not approve private upload.",
            "- Public publishing remains blocked even after review package approval.",
            f"- Selected thumbnail: `{review_package.get('selected_thumbnail', '')}`",
            f"- Pending target rows: {review_package.get('pending_target_count', 0)}",
            f"- Readiness report: `{display_path(review_package_report)}`",
            "",
            "## Quality Gates",
            "",
            "- Source proof in first 20 seconds: expected by build order when source proof footage exists before stills or context-only visuals",
            "- Aggregate quality gate: city-history identity, source proof, title-thumbnail payoff, source rights, Canva workflow, subscribe CTA, and owner boundary must pass",
            "- Synthetic disclosure: AI can illustrate but cannot prove; fake lip-sync, fake quotes, and unlabeled fake archival footage are blocked",
            "- Script structure: hook first, brief Pattern Lab intro, consistent outro required",
            "- First-5 hook gate: opening contradiction/proof before branding, source-backed first visual, and title-thumbnail payoff required",
            "- Benchmark growth gate: one city, one strange visual clue, one source trail, one hidden system; competitor mechanics adapted without copied creative work",
            "- Guru growth gates: outlier mining, title/thumbnail testing, Morgan avatar fit, packaging lock, first-30 payoff, boredom cut, thumbnail pre-score, Shorts funnel, audience satisfaction, and quality-over-frequency governor required",
            "- Retention ladder: first 5s hook, first 20s proof, 45-75s narrative beat rhythm required",
            "- Long-form render: 8-14 minutes, 1920x1080, audio stream, proof first, upload metadata required",
            "- Visual changes: script-aware beat plan with matched narration excerpts required",
            "- Voiceover phone-speaker review: required before private upload",
            "- Thumbnail mobile preview review: required before private upload",
            "- V4 thumbnail review: owner rating preference, map/redrawn semantic match, underground support, whole-word redactions, lost-streets visual relevance, then/now split integrity, AI-support/reference-safety gates, every-word intent, spelling/OCR, cutoff detection, no-distortion, creative variation, per-thumbnail critique, and thumbnail search shelf test are required before owner approval",
            "- Public publishing automation: blocked",
            "- Topic economics score: must be at least 80/100",
            "- Upload metadata: title options, thumbnail pairing, description, tags, chapters, pinned comment required",
            "- Private/unlisted upload: requires explicit owner approval",
            "",
            "## Blockers",
            "",
        ]
    )
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(
        [
            "",
            "## Owner Approval Packet",
            "",
            "- Private or unlisted YouTube URL:",
            "- Final title:",
            "- Final thumbnail file:",
            "- Final description:",
            "- Synthetic or altered content answer:",
            "- YouTube checks result:",
            "- Rights ledger complete:",
            "- Voice quality approved:",
            "- No private information visible:",
            "- Not AI slop because:",
            "- Specific owner approval requested:",
            "",
        ]
    )
    report.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Readiness report: {display_path(report)}")
    if blockers:
        print("Blockers:")
        for blocker in blockers:
            print(f"- {blocker}")


if __name__ == "__main__":
    main()
