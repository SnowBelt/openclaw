#!/usr/bin/env python3
import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, ensure_dir, media_duration_seconds, output_root, utc_now
from patternlab_content_calendar import build_calendar
from patternlab_monetization_tracker import build_tracker_report
from patternlab_readiness_truth_summary import build_truth_summary
from patternlab.review import owner_review_blockers, owner_review_gate_statuses, owner_review_status


REPO = BASE.parent


def repo_display(path):
    path = Path(path)
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def duration_label(path):
    path = Path(path)
    if not path.exists():
        return "missing"
    try:
        seconds = media_duration_seconds(path)
    except Exception as exc:
        return f"unverified ({exc})"
    minutes = int(seconds // 60)
    remainder = int(round(seconds % 60))
    return f"{minutes}:{remainder:02d} ({seconds:.1f}s)"


def size_label(path):
    path = Path(path)
    if not path.exists():
        return "missing"
    return f"{path.stat().st_size / 1024 / 1024:.1f} MB"


def ledger_counts(path):
    if not path.exists():
        return Counter(), Counter()
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    by_type = Counter(row.get("asset_type", "") for row in rows)
    approved = Counter(
        row.get("asset_type", "")
        for row in rows
        if row.get("human_review_status", "").lower() == "approved"
    )
    return by_type, approved


def visual_rebuild_counts(path):
    manifest = read_json(path) or {}
    return (
        manifest.get("historical_count", 0),
        manifest.get("modern_context_count", 0),
        manifest.get("status", "missing"),
    )


def status_from_report(path, default="missing"):
    path = Path(path)
    if not path.exists():
        return default
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def report_prefix(video_id: str) -> str:
    return video_id if str(video_id).startswith("video-") else f"video-{video_id}"


def main():
    parser = argparse.ArgumentParser(description="Generate the Pattern Lab owner review packet.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()

    root = output_root(args.video_id)
    review = ensure_dir(root / "review")
    approval = root / "approval"
    packet = review / "owner-review-packet.md"
    long_form = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    discord_proxy = review / f"pattern-lab-video-{args.video_id}-draft-discord-review.mp4"
    shorts = [
        root / "shorts" / f"pattern-lab-video-{args.video_id}-short-01.mp4",
        root / "shorts" / f"pattern-lab-video-{args.video_id}-short-02.mp4",
        root / "shorts" / f"pattern-lab-video-{args.video_id}-short-03.mp4",
    ]
    thumbnails_dir = root / "images"
    thumbnails = sorted(thumbnails_dir.glob("thumbnail_candidate_*.png")) if thumbnails_dir.exists() else []
    image_report = read_json(approval / "image-source-report.json") or {}
    upload_metadata = read_json(approval / "upload-metadata.json") or {}
    monetization = read_json(approval / "monetization-gates-report.json") or {}
    long_form_quality = read_json(approval / "long-form-quality-report.json") or {}
    shorts_quality = read_json(approval / "shorts-quality-report.json") or {}
    shorts_script_package = read_json(approval / "shorts-script-package.json") or {}
    shorts_audio_economy = read_json(approval / "shorts-audio-economy-report.json") or {}
    shorts_boundary_quality = read_json(approval / "shorts-boundary-quality-report.json") or {}
    shorts_first_frame_quality = read_json(approval / "shorts-first-frame-quality-report.json") or {}
    shorts_pacing_quality = read_json(approval / "shorts-pacing-quality-report.json") or {}
    shorts_engagement_loop = read_json(approval / "shorts-engagement-loop-report.json") or {}
    shorts_toolchain_handoff = read_json(approval / "shorts-toolchain-handoff.json") or {}
    shorts_render_readiness = read_json(approval / "shorts-render-readiness-report.json") or {}
    thumbnail_factory = read_json(approval / "thumbnail-factory-report.json") or {}
    thumbnail_quality = read_json(approval / "thumbnail-quality-report.json") or {}
    thumbnail_font_quality = read_json(approval / "thumbnail-font-quality-report.json") or {}
    thumbnail_typography_research = read_json(approval / "thumbnail-market-typography-research-report.json") or {}
    thumbnail_reference_library = read_json(approval / "thumbnail-reference-library-report.json") or {}
    thumbnail_reference_anatomy = read_json(approval / "thumbnail-reference-anatomy-report.json") or {}
    thumbnail_pop_score = read_json(approval / "thumbnail-pop-score-report.json") or {}
    thumbnail_poster_depth = read_json(approval / "thumbnail-poster-depth-renderer-report.json") or {}
    thumbnail_shelf_strip = read_json(approval / "thumbnail-mobile-shelf-strip-report.json") or {}
    thumbnail_owner_rating_v3 = read_json(approval / "thumbnail-owner-rating-learning-report.json") or {}
    title_thumbnail_pair_packet = read_json(approval / "title-thumbnail-pair-packet.json") or {}
    thumbnail_font_tournament = read_json(approval / "thumbnail-font-tournament-report.json") or {}
    html_thumbnail_renderer = read_json(approval / "html-thumbnail-renderer-report.json") or {}
    source_candidate_tournament = read_json(approval / "source-candidate-tournament-report.json") or {}
    source_provider_health = read_json(approval / "source-provider-health-report.json") or {}
    shorts_followup = read_json(approval / "shorts-followup-packet.json") or {}
    performance_learning = read_json(root / "metrics" / f"{report_prefix(args.video_id)}-performance-learning-scaffold.json") or {}
    penpot_fallback = read_json(approval / "penpot-fallback-evaluation-report.json") or {}
    penpot_slot_fill = read_json(approval / "penpot-slot-fill-smoke-report.json") or {}
    renderer_decision = read_json(approval / "renderer-decision-gate-report.json") or {}
    photopea_rescue = read_json(approval / "photopea-rescue-evaluation-report.json") or {}
    canva_template_registry = read_json(approval / "thumbnail-canva-template-registry-report.json") or {}
    canva_render_plan = read_json(approval / "thumbnail-canva-render-plan-report.json") or {}
    canva_no_ai_render_plan = read_json(approval / "canva-no-ai-render-plan-report.json") or {}
    canva_no_ai_live_validation = read_json(approval / "canva-no-ai-live-validation-report.json") or {}
    external_font_registry = read_json(approval / "external-font-registry-report.json") or {}
    font_license_gate = read_json(approval / "thumbnail-font-license-gate-report.json") or {}
    full_auto_production = read_json(approval / "full-auto-production-report.json") or {}
    voice_visual_match = read_json(approval / "voice-visual-match-report.json") or {}
    finished_watchdown = read_json(approval / "finished-video-watchdown-report.json") or {}
    episode_standard = read_json(approval / "episode-standard-report.json") or {}
    transcript_viral = read_json(approval / "transcript-viral-quality-report.json") or {}
    comment_quality = read_json(approval / "comment-quality-report.json") or {}
    transcript_watchtime = read_json(approval / "transcript-watchtime-score-report.json") or {}
    photo_backed_thumbnail_summary = read_json(approval / "miami-photo-backed-thumbnail-report.json") or {}
    visible_source_audit = read_json(approval / "thumbnail-visible-source-audit-report.json") or {}
    real_city_source_assets = read_json(approval / "real-city-source-asset-report.json") or {}
    synthetic_disclosure = read_json(approval / "synthetic-disclosure-report.json") or {}
    retention_ladder = read_json(approval / "retention-ladder-report.json") or {}
    visual_upgrade = read_json(approval / "visual-upgrade-plan.json") or {}
    visual_quality = read_json(approval / "visual-quality-report.json") or {}
    visual_match = read_json(approval / "visual-match-report.json") or {}
    first5_hook = read_json(approval / "first5-hook-report.json") or {}
    motion_polish = read_json(approval / "motion-polish-report.json") or {}
    visual_variety = read_json(approval / "visual-variety-report.json") or {}
    benchmark_growth = read_json(approval / "benchmark-growth-report.json") or {}
    guru_growth = read_json(approval / "guru-growth-report.json") or {}
    visual_manifest = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    historical_count, modern_context_count, visual_rebuild_status = visual_rebuild_counts(visual_manifest)
    pipeline = read_json(approval / "pipeline-run-report.json") or {}
    package_hash = read_json(approval / "package-hash-report.json") or {}
    canonical_preflight = read_json(approval / "canonical-preflight-report.json") or {}
    canonical_release = read_json(approval / "canonical-release-registration-report.json") or {}
    canonical_render = read_json(approval / "canonical-render-plan.json") or {}
    render_quality = read_json(approval / "render-quality-report.json") or {}
    # This packet is a read-only review surface. It must not overwrite the
    # active runtime's calendar or monetization history while inspecting a
    # source worktree.
    ypp, ypp_report = build_tracker_report(write=False)
    calendar, calendar_report = build_calendar(write=False)
    by_type, approved = ledger_counts(root / "rights-ledger.csv")
    private_status = status_from_report(approval / "private-upload-readiness.md")
    public_status = status_from_report(approval / "public-publish-readiness.md")
    truth_summary, truth_summary_json, truth_summary_md = build_truth_summary(args.video_id)
    private_truth = truth_summary.get("private_upload_readiness", "missing")
    private_action = (truth_summary.get("private_upload_action") or {}).get("status", "missing")
    public_truth = truth_summary.get("public_publish", "missing")
    analytics_truth = (truth_summary.get("analytics_oauth") or {}).get("status", "missing")

    title_options = upload_metadata.get("title_options") or []
    selected_title = upload_metadata.get("selected_title") or upload_metadata.get("default_title") or ""
    if not selected_title and title_options:
        selected_title = title_options[0]
    description = upload_metadata.get("description") or ""
    tags = upload_metadata.get("tags") or []
    chapters = upload_metadata.get("chapters") or []
    pinned = upload_metadata.get("pinned_comment") or ""
    owner_review_gates = owner_review_gate_statuses(
        package_hash=package_hash.get("status"),
        canonical_preflight=canonical_preflight.get("status"),
        canonical_release=canonical_release.get("status"),
        canonical_render=canonical_render.get("status"),
        render_quality=render_quality.get("status"),
        long_form_quality=long_form_quality.get("status"),
        shorts_quality=shorts_quality.get("status"),
        thumbnail_quality=thumbnail_quality.get("status"),
        episode_standard=episode_standard.get("status"),
        voice_visual_match=voice_visual_match.get("voice_visual_match_status"),
        finished_watchdown=finished_watchdown.get("finished_video_watchdown_status"),
    )
    owner_review_status_value = owner_review_status(owner_review_gates)
    owner_review_blocker_list = owner_review_blockers(owner_review_gates)
    canonical_gate_report = {
        "generated_at": utc_now(),
        "video_id": args.video_id,
        "status": "pass" if owner_review_status_value == "ready-for-owner-review" else "blocked",
        "owner_review_status": owner_review_status_value,
        "gates": owner_review_gates,
        "blockers": owner_review_blocker_list,
        "release_candidate_id": canonical_release.get("release_candidate_id", ""),
        "release_candidate_sha256": canonical_release.get("package_sha256", ""),
        "youtube_mutation": "not_performed",
    }
    canonical_gate_path = approval / "owner-review-canonical-gate-report.json"
    canonical_gate_path.write_text(json.dumps(canonical_gate_report, indent=2) + "\n", encoding="utf-8")

    lines = [
        f"# Pattern Lab Owner Review Packet: Video {args.video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        f"Status: {owner_review_status_value}",
        "Owner review release: blocked until every canonical package and quality gate passes" if owner_review_status_value != "ready-for-owner-review" else "Owner review release: ready for owner review after confirming all listed gates",
        f"Private/unlisted upload readiness: {private_truth}",
        f"Private/unlisted upload action: {private_action}",
        f"Public publish: {public_truth}",
        f"Analytics OAuth: {analytics_truth}",
        "YouTube mutation performed by this packet: not_performed",
        "",
        "## Readiness Truth Summary",
        "",
        f"- Truth summary JSON: {repo_display(truth_summary_json)}",
        f"- Truth summary Markdown: {repo_display(truth_summary_md)}",
        f"- Hard private-upload blockers: {len(truth_summary.get('current_blockers', []))}",
        f"- Optional/external/non-private blockers: {len(truth_summary.get('optional_or_external_blockers', []))}",
        f"- Stale/superseded reports: {len(truth_summary.get('stale_or_nonblocking_reports', []))}",
        f"- Next owner action: {truth_summary.get('next_owner_action', 'missing')}",
        f"- Canonical release candidate: {canonical_release.get('release_candidate_id', 'missing')}",
        f"- Canonical release package hash: {canonical_release.get('package_sha256', 'missing')}",
        f"- Canonical evidence renderer: {canonical_render.get('status', 'missing')}",
        f"- Canonical render quality: {render_quality.get('status', 'missing')}",
        f"- Owner-review canonical blockers: {', '.join(owner_review_blocker_list) if owner_review_blocker_list else 'none'}",
        f"- Canonical owner-review gate report: {repo_display(canonical_gate_path)} ({canonical_gate_report['status']})",
        "",
        "## Review Order",
        "",
        "1. Watch the long-form review file for voice, pacing, source proof in the first 20 seconds, real-media quality, and private-info risk.",
        "2. Check the visual rebuild source pack: historical images should carry the story; modern stock/context visuals should support atmosphere only.",
        "3. Review all thumbnail candidates at mobile size: curiosity, trust/proof, and contrast.",
        "4. Review the James avatar concepts and approve exactly one before any avatar appears publicly.",
        "5. Watch all approved Shorts for hook strength, crop, pacing, and connection back to the long-form video.",
        "6. Approve or reject using Discord or the Pattern Lab dashboard controls.",
        "",
        "## Full Automation QA",
        "",
        f"- Full-auto production: {full_auto_production.get('full_auto_production_status', 'missing')}",
        f"- Shorts target: {full_auto_production.get('shorts_target', 'missing')} (3-5 allowed; owner approval still required before public publish)",
        f"- Shorts script package: {shorts_script_package.get('status', 'missing')} ({shorts_script_package.get('shorts_count', 0)} scripts; {repo_display(approval / 'shorts-script-package.md')})",
        f"- Shorts audio economy: {shorts_audio_economy.get('status', 'missing')} ({repo_display(approval / 'shorts-audio-economy-report.md')})",
        f"- Shorts boundary quality: {shorts_boundary_quality.get('status', 'missing')} ({repo_display(approval / 'shorts-boundary-quality-report.md')})",
        f"- Shorts first-frame quality: {shorts_first_frame_quality.get('status', 'missing')} ({repo_display(approval / 'shorts-first-frame-quality-report.md')})",
        f"- Shorts pacing quality: {shorts_pacing_quality.get('status', 'missing')} ({repo_display(approval / 'shorts-pacing-quality-report.md')})",
        f"- Shorts engagement loop: {shorts_engagement_loop.get('status', 'missing')} ({repo_display(approval / 'shorts-engagement-loop-report.md')})",
        f"- Shorts free-first toolchain: {shorts_toolchain_handoff.get('status', 'missing')} ({repo_display(approval / 'shorts-toolchain-handoff.md')})",
        f"- Shorts render readiness: {shorts_render_readiness.get('status', 'missing')} ({repo_display(approval / 'shorts-render-readiness-report.md')})",
        f"- Voice-to-visual match: {voice_visual_match.get('voice_visual_match_status', 'missing')} ({voice_visual_match.get('matched_media_row_count', 0)} matched media rows)",
        f"- Finished-video watchdown: {finished_watchdown.get('finished_video_watchdown_status', 'missing')} ({finished_watchdown.get('duration_seconds', 'missing')} seconds)",
        f"- Episode standard: {episode_standard.get('status', 'missing')} ({len(episode_standard.get('blockers', []))} blocker(s); {repo_display(approval / 'episode-standard-report.md')})",
        f"- Transcript viral quality: {transcript_viral.get('status', 'missing')} ({repo_display(approval / 'transcript-viral-quality-report.md')})",
        f"- Comment/source-lead quality: {comment_quality.get('status', 'missing')} ({repo_display(approval / 'comment-quality-report.md')})",
        f"- Transcript watch-time score: {transcript_watchtime.get('status', 'missing')} ({transcript_watchtime.get('total_score', 0)}/{transcript_watchtime.get('max_score', 55)}; {repo_display(approval / 'transcript-watchtime-score-report.md')})",
        f"- Public YouTube mutation: {full_auto_production.get('public_youtube_mutation', 'not_performed')}",
        "",
        "## Long-Form Draft",
        "",
        f"- File: {repo_display(long_form)}",
        f"- Duration: {duration_label(long_form)}",
        f"- Size: {size_label(long_form)}",
        f"- Discord review proxy: {'present' if discord_proxy.exists() else 'missing'} ({repo_display(discord_proxy)})",
        f"- Discord proxy duration: {duration_label(discord_proxy) if discord_proxy.exists() else 'missing'}",
        "- Monetization target: 8-14 minutes",
        "- Source proof requirement: source proof appears first in the build order",
        "- Visual repair state: current private upload is superseded by this rebuilt review draft; do not publish the old private draft",
        "",
        "## Visual Rebuild Source Pack",
        "",
        f"- Manifest: {repo_display(visual_manifest)} ({visual_rebuild_status})",
        f"- Rights-logged historical/real-photo assets: {historical_count}",
        f"- Rights-logged modern stock/context assets: {modern_context_count}",
        f"- Visual quality gate: {visual_quality.get('status', 'missing')}",
        f"- Real-media runtime share: {visual_quality.get('real_runtime_share', 0) * 100:.1f}%",
        f"- Generated/support runtime share: {visual_quality.get('generated_runtime_share', 0) * 100:.1f}%",
        f"- Source-grounded overlay beats: {visual_quality.get('source_grounded_overlay_count', 0)}",
        f"- Old photo-backed support composite beats: {visual_quality.get('old_photo_backed_support_composite_count', 0)}",
        f"- Visual-match gate: {visual_match.get('status', 'missing')}",
        f"- Visual-match strong / acceptable / weak: {visual_match.get('strong_count', 0)} / {visual_match.get('acceptable_count', 0)} / {visual_match.get('weak_count', 0)}",
        f"- Visual-match weak share: {visual_match.get('weak_share', 1) * 100:.1f}%",
        f"- Visual-match fallback count: {visual_match.get('fallback_count', 0)}",
        f"- Visual-variety gate: {visual_variety.get('status', 'missing')}",
        f"- Visual-variety categories: {visual_variety.get('distinct_category_count', 0)} ({', '.join(visual_variety.get('distinct_categories', [])) or 'missing'})",
        f"- Visual-variety max category share: {visual_variety.get('max_category_runtime_share', 1) * 100:.1f}%",
        f"- Benchmark growth gate: {benchmark_growth.get('status', 'missing')}",
        f"- Benchmark series family: {benchmark_growth.get('series_family', 'missing')}",
        f"- Benchmark thesis: {benchmark_growth.get('core_thesis', 'missing')}",
        f"- Guru growth gate: {guru_growth.get('status', 'missing')}",
        f"- Guru growth milestones passing: {sum(1 for item in guru_growth.get('milestones', []) if item.get('status') == 'pass')}/{len(guru_growth.get('milestones', []))}",
        f"- First-5 hook gate: {first5_hook.get('status', 'missing')}",
        f"- First-5 hook: {first5_hook.get('opening_hook', 'missing')}",
        f"- Motion polish gate: {motion_polish.get('status', 'missing')}",
        f"- Motion documentary share: {motion_polish.get('documentary_motion_share', 0) * 100:.1f}%",
        f"- Motion replacement review/upload required: {motion_polish.get('local_rerender_requires_review_upload', False)}",
        "- Rule: real historical/context media carries the edit; maps, evidence boards, then/now moments, and CTA cards must be source-grounded overlays rather than slide-deck graphics.",
        "",
        "## Real-City Thumbnail Test Source Assets",
        "",
        f"- Real-city thumbnail test: {bool(real_city_source_assets.get('real_city_asset_count'))}",
        f"- Active city: {real_city_source_assets.get('active_city', thumbnail_factory.get('active_city', 'missing'))}",
        f"- Source asset report: {repo_display(approval / 'real-city-source-asset-report.json')}",
        f"- Real city asset count: {real_city_source_assets.get('real_city_asset_count', 0)}",
        f"- Synthetic mockup count: {real_city_source_assets.get('synthetic_mockup_count', 'missing')}",
        f"- Paid asset used: {real_city_source_assets.get('paid_asset_used', 'missing')}",
        "- Requirement: these thumbnails must use rights-ledgered active-city photos, maps, landmarks, or documents; generic/synthetic support is non-proof only.",
        "",
        "### Real-City Source Assets",
        "",
    ]
    for asset in real_city_source_assets.get("assets", []):
        lines.append(f"- {asset.get('source_title', 'missing')}: `{asset.get('filename', 'missing')}` | {asset.get('license_status', 'missing')} | {asset.get('source_url', 'missing')}")
    lines.extend(["", "## Shorts", ""])
    lines.append(f"- Script package: {shorts_script_package.get('status', 'missing')} | {shorts_script_package.get('shorts_count', 0)} standalone scripts | {repo_display(approval / 'shorts-script-package.md')}")
    lines.append(f"- Audio economy: {shorts_audio_economy.get('status', 'missing')} | default={shorts_audio_economy.get('default_policy_when_unproven', 'missing')} | ElevenLabs call={shorts_audio_economy.get('external_elevenlabs_call_performed', 'missing')}")
    lines.append(f"- Boundary quality: {shorts_boundary_quality.get('status', 'missing')} | rendered alignment={shorts_boundary_quality.get('rendered_cut_alignment_status', 'missing')}")
    lines.append(f"- First-frame quality: {shorts_first_frame_quality.get('status', 'missing')} | overlay checks={shorts_first_frame_quality.get('overlay_checks_status', 'missing')}")
    lines.append(f"- Pacing quality: {shorts_pacing_quality.get('status', 'missing')} | rendered checks={shorts_pacing_quality.get('rendered_mp4_checks_status', 'missing')}")
    lines.append(f"- Engagement loop: {shorts_engagement_loop.get('status', 'missing')} | YouTube mutations={shorts_engagement_loop.get('public_youtube_mutation', 'missing')}")
    lines.append(f"- Free-first toolchain: {shorts_toolchain_handoff.get('status', 'missing')} | paid tools={shorts_toolchain_handoff.get('paid_tool_usage_status', 'missing')}")
    lines.append(f"- Render readiness: {shorts_render_readiness.get('status', 'missing')} | render performed={shorts_render_readiness.get('render_performed', 'missing')}")
    for item in shorts_script_package.get("shorts", []):
        lines.append(f"- Scripted Short {item.get('index')}: {item.get('title')} | score={item.get('score')}/100 | duration={item.get('duration_seconds')}s | hook={item.get('hook')}")
    for index, short in enumerate(shorts, 1):
        lines.append(f"- Rendered Short {index}: {repo_display(short)} | {duration_label(short)} | {size_label(short)}")
    lines.extend(
        [
            "",
            "## Thumbnails",
            "",
            f"- Thumbnail factory: {thumbnail_factory.get('status', photo_backed_thumbnail_summary.get('status', 'missing'))}",
            f"- Active city: {thumbnail_factory.get('active_city', photo_backed_thumbnail_summary.get('city', 'missing'))}",
            f"- Photo-backed package: {photo_backed_thumbnail_summary.get('status', 'missing')} ({photo_backed_thumbnail_summary.get('thumbnail_count', 0)} thumbnails, {photo_backed_thumbnail_summary.get('visible_real_photo_count', 0)} visible real-photo-backed)",
            f"- City-agnostic templates: {thumbnail_factory.get('city_agnostic_status', 'missing')}",
            f"- Current thumbnail renderer: {thumbnail_factory.get('current_thumbnail_renderer', 'missing')}",
            f"- Current image generator: {thumbnail_factory.get('current_image_generator', 'missing')}",
            f"- Recommended free AI support generator: {thumbnail_factory.get('recommended_free_ai_support_generator', 'missing')}",
            f"- Recommended premium AI support generator: {thumbnail_factory.get('recommended_premium_ai_support_generator', 'missing')}",
            f"- AI support asset policy: {thumbnail_factory.get('ai_support_asset_policy_status', 'missing')}",
            f"- Internet reference non-derivative gate: {thumbnail_factory.get('internet_reference_non_derivative_status', 'missing')}",
            f"- Owner feedback learning: {thumbnail_factory.get('owner_feedback_learning_status', 'missing')}",
            f"- Owner rating preference: {thumbnail_factory.get('owner_rating_learning_v2_status', 'missing')} — baseline={thumbnail_factory.get('preferred_baseline_style', 'missing')}",
            f"- Rendered OCR truth: {thumbnail_factory.get('rendered_ocr_truth_status', 'missing')} — misspellings={thumbnail_factory.get('ocr_misspelling_count', 'missing')}, unexpected_words={thumbnail_factory.get('ocr_unexpected_public_word_count', 'missing')}, missing_words={thumbnail_factory.get('ocr_missing_required_word_count', 'missing')}",
            f"- Layout collision: {thumbnail_factory.get('layout_collision_status', 'missing')} — text_collisions={thumbnail_factory.get('text_collision_count', 'missing')}, subject_coverage={thumbnail_factory.get('subject_coverage_violation_count', 'missing')}",
            f"- Purpose-labeled shape: {thumbnail_factory.get('purpose_labeled_shape_status', 'missing')} — black_boxes={thumbnail_factory.get('unexplained_black_box_count', 'missing')}, random_shapes={thumbnail_factory.get('random_shape_count', 'missing')}",
            f"- Triple-review red-team: {thumbnail_factory.get('triple_review_redteam_status', 'missing')}",
            f"- Map/redrawn semantic match: {thumbnail_factory.get('redrawn_map_semantic_match_status', 'missing')}",
            f"- Underground semantic asset: {thumbnail_factory.get('underground_semantic_asset_status', 'missing')}",
            f"- Whole-word redaction: {thumbnail_factory.get('whole_word_redaction_status', 'missing')} ({thumbnail_factory.get('partial_word_redaction_count', 'missing')} partial-word redactions)",
            f"- Curiosity hook prominence: {thumbnail_factory.get('curiosity_hook_prominence_status', 'missing')}",
            f"- Lost-streets visual relevance: {thumbnail_factory.get('lost_streets_semantic_asset_status', 'missing')} (rail image used: {thumbnail_factory.get('rail_image_used_for_lost_streets', 'missing')})",
            f"- Then/now split integrity: {thumbnail_factory.get('then_now_split_integrity_status', 'missing')} ({thumbnail_factory.get('then_now_median_crossing_count', 'missing')} median crossings)",
            f"- NOW modern skyline: {thumbnail_factory.get('now_modern_skyline_status', 'missing')}",
            f"- AI support asset boundary: {thumbnail_factory.get('ai_support_asset_manifest_status', 'missing')} ({thumbnail_factory.get('ai_fake_proof_count', 'missing')} fake proof assets)",
            f"- Current-style renderer V4: {thumbnail_factory.get('current_style_renderer_v4_status', 'missing')}",
            f"- Real city source-first examples: {thumbnail_factory.get('real_city_source_first_examples_status', 'missing')} — mode={thumbnail_factory.get('official_city_example_mode', 'missing')}, ad_hoc_mockup_blocked={thumbnail_factory.get('ad_hoc_mockup_blocked', 'missing')}",
            f"- Visible Real-Photo Source Audit: {visible_source_audit.get('status', thumbnail_factory.get('visible_source_audit_status', 'missing'))}",
            f"- Visible real photo concepts: {visible_source_audit.get('visible_real_photo_count', thumbnail_factory.get('visible_real_photo_count', 0))}/{visible_source_audit.get('concept_count', thumbnail_factory.get('review_concept_count', 0))}",
            f"- Photo hero/major inset concepts: {visible_source_audit.get('photo_hero_or_major_inset_count', thumbnail_factory.get('photo_hero_or_major_inset_count', 0))}/{visible_source_audit.get('concept_count', thumbnail_factory.get('review_concept_count', 0))}",
            f"- Map-only concepts: {visible_source_audit.get('map_only_concept_count', thumbnail_factory.get('map_only_concept_count', 'missing'))}",
            f"- Unmanifested visible sources: {visible_source_audit.get('unmanifested_visible_source_count', thumbnail_factory.get('unmanifested_visible_source_count', 'missing'))}",
            f"- 10/10 art-direction path: {thumbnail_factory.get('ten_out_of_ten_art_direction_path_status', 'missing')}",
            f"- Every-word intent gate: {thumbnail_factory.get('every_word_intent_gate_status', 'missing')} ({thumbnail_factory.get('irrelevant_public_word_count', 'missing')} irrelevant words)",
            f"- Spelling/OCR verification: {thumbnail_factory.get('spelling_ocr_verification_status', 'missing')} ({thumbnail_factory.get('spelling_error_count', 'missing')} spelling errors)",
            f"- Cutoff text detection: {thumbnail_factory.get('cutoff_text_detection_status', 'missing')} ({thumbnail_factory.get('cutoff_text_count', 'missing')} cut-off text items)",
            f"- Brightness/subject visibility: {thumbnail_factory.get('brightness_subject_visibility_status', 'missing')} ({thumbnail_factory.get('too_dark_count', 'missing')} too-dark concepts)",
            f"- No image distortion: {thumbnail_factory.get('no_image_distortion_status', 'missing')} ({thumbnail_factory.get('distorted_image_count', 'missing')} distorted images)",
            f"- Layout safe zones: {thumbnail_factory.get('layout_safe_zone_status', 'missing')} ({thumbnail_factory.get('layout_safe_zone_violation_count', 'missing')} violations)",
            f"- Concept-specific art direction: {thumbnail_factory.get('concept_specific_art_direction_status', 'missing')} ({thumbnail_factory.get('concept_specific_pass_count', 'missing')}/5 concepts)",
            f"- Creative variation memory: {thumbnail_factory.get('creative_variation_memory_status', 'missing')} ({thumbnail_factory.get('creative_variation_style_count', 'missing')} style families)",
            f"- Per-thumbnail critique reports: {thumbnail_factory.get('per_thumbnail_critique_status', 'missing')} ({thumbnail_factory.get('per_thumbnail_critique_count', 'missing')} critiques)",
            f"- Fictional publication-name preflight: {thumbnail_factory.get('publication_name_preflight_status', 'missing')} — {thumbnail_factory.get('publication_name_public_use_rule', 'not applicable')}",
            f"- Typography policy gate: {thumbnail_font_quality.get('status', 'missing')}",
            f"- Main title font: {thumbnail_font_quality.get('main_title_font_family', photo_backed_thumbnail_summary.get('main_title_font_family', 'missing'))}",
            f"- Main title font families: {', '.join(thumbnail_font_quality.get('main_title_font_families', [])) or 'missing'}",
            f"- City font families: {', '.join(thumbnail_font_quality.get('city_font_families', [])) or 'missing'}",
            f"- Impact fallback used: {thumbnail_font_quality.get('impact_fallback_used', photo_backed_thumbnail_summary.get('impact_fallback_used', 'missing'))} ({thumbnail_font_quality.get('impact_fallback_count', photo_backed_thumbnail_summary.get('impact_fallback_count', 'missing'))} thumbnails)",
            f"- Typography shelf readability: {thumbnail_font_quality.get('shelf_readability_status', 'missing')} ({thumbnail_font_quality.get('shelf_preview_count', 0)}/{thumbnail_font_quality.get('required_shelf_preview_count', 0)} previews)",
            f"- Typography research: {thumbnail_typography_research.get('status', 'missing')} — {thumbnail_typography_research.get('pattern_lab_font_rule', 'missing')}",
            f"- Reference library infrastructure: {thumbnail_reference_library.get('infrastructure_status', 'missing')} — references={thumbnail_reference_library.get('existing_reference_image_count', 0)}/{thumbnail_reference_library.get('required_owner_reference_image_count', 0)}, status={thumbnail_reference_library.get('status', 'missing')}",
            f"- Reference anatomy analyzer: {thumbnail_reference_anatomy.get('analyzer_infrastructure_status', 'missing')} — status={thumbnail_reference_anatomy.get('status', 'missing')}",
            f"- Reference/pop score: heuristic={thumbnail_pop_score.get('openclaw_heuristic_status', 'missing')}, reference_match={thumbnail_pop_score.get('reference_match_score_status', 'missing')}, avg={thumbnail_pop_score.get('average_pop_score', 'missing')}/10",
            f"- Poster-depth renderer: {thumbnail_poster_depth.get('poster_depth_renderer_status', 'missing')} — hero_objects={thumbnail_poster_depth.get('hero_object_count', 0)}/{thumbnail_poster_depth.get('thumbnail_count', 0)}, same_template={thumbnail_poster_depth.get('same_template_blocker_status', 'missing')}",
            f"- Owner reference energy: {thumbnail_poster_depth.get('owner_reference_style_adaptation_status', 'missing')}",
            f"- Filler public-label blocker: {thumbnail_poster_depth.get('filler_public_label_blocker_status', 'missing')}",
            f"- Bare redaction blocker: {thumbnail_poster_depth.get('bare_redaction_blocker_status', 'missing')}",
            f"- Vivid color-energy gate: {thumbnail_poster_depth.get('vivid_color_energy_status', 'missing')}",
            f"- Mobile shelf strip: {thumbnail_shelf_strip.get('infrastructure_status', 'missing')} — current={thumbnail_shelf_strip.get('current_shelf_strip_status', 'missing')}, reference_comparison={thumbnail_shelf_strip.get('reference_comparison_status', 'missing')}",
            f"- Owner rating learning V3: {thumbnail_owner_rating_v3.get('owner_rating_learning_v3_status', 'missing')} — liked_formats={thumbnail_owner_rating_v3.get('liked_format_count', 0)}, reject_reasons={thumbnail_owner_rating_v3.get('hard_reject_reason_count', 0)}",
            f"- Title + thumbnail pair packet: {title_thumbnail_pair_packet.get('title_thumbnail_pair_packet_status', 'missing')} — variants={title_thumbnail_pair_packet.get('variant_count', 0)}, youtube_test_ready={title_thumbnail_pair_packet.get('youtube_native_test_ready', 'missing')}",
            f"- Font tournament: {thumbnail_font_tournament.get('font_tournament_status', 'missing')} — variants={thumbnail_font_tournament.get('variant_count', 0)}, winners={thumbnail_font_tournament.get('winning_count', 0)} at {thumbnail_font_tournament.get('minimum_winner_score', 8.5)}/10+, bottom_text={thumbnail_font_tournament.get('bottom_text_fit_status', 'missing')}, generic_font={thumbnail_font_tournament.get('generic_font_blocker_status', 'missing')}, reference_type={thumbnail_font_tournament.get('reference_typography_match_status', 'missing')}",
            f"- Source candidate tournament: {source_candidate_tournament.get('status', 'missing')} — min_candidates/topic={source_candidate_tournament.get('minimum_candidate_count_per_topic', 0)}, top_ranked={source_candidate_tournament.get('minimum_top_ranked_candidate_count', 0)}, local_sources={source_candidate_tournament.get('unique_local_source_image_count', 0)}",
            f"- Source provider health: {source_provider_health.get('status', 'missing')} — attempts={source_provider_health.get('provider_attempt_count', 0)}, selected_providers={source_provider_health.get('selected_provider_count', 0)}, single_source={source_provider_health.get('single_source_dependency', 'missing')}",
            f"- Proof object dominance: {source_candidate_tournament.get('proof_object_dominance_gate_status', 'missing')}",
            f"- Premium display font pack V3: {source_candidate_tournament.get('premium_display_font_pack_v3_status', 'missing')} — fonts={', '.join(source_candidate_tournament.get('premium_display_font_pack_v3_families', [])) or 'missing'}",
            f"- 20-variant thumbnail tournament: {source_candidate_tournament.get('thumbnail_tournament_20_status', 'missing')} — variants={source_candidate_tournament.get('thumbnail_tournament_variant_count', 0)}, top3={source_candidate_tournament.get('top3_owner_review_count', 0)}",
            f"- Font tournament contact sheet: {repo_display(approval / 'thumbnail-font-tournament-contact-sheet.jpg')}",
            f"- HTML/SVG renderer: {html_thumbnail_renderer.get('html_renderer_status', 'missing')} — finals={html_thumbnail_renderer.get('dimension_1920x1080_count', 0)}/{html_thumbnail_renderer.get('final_thumbnail_count', 0)}, support_fit={html_thumbnail_renderer.get('support_text_fit_status', 'missing')}, reference_type={html_thumbnail_renderer.get('reference_typography_match_status', 'missing')}",
            f"- Chrome/Fontsource renderer: {html_thumbnail_renderer.get('chrome_fontsource_renderer_status', 'missing')} — fonts={html_thumbnail_renderer.get('open_license_font_count', 0)}, OCR={html_thumbnail_renderer.get('mobile_typography_ocr_readability_status', 'missing')} ({html_thumbnail_renderer.get('mobile_typography_ocr_pass_count', 0)}/{html_thumbnail_renderer.get('mobile_typography_ocr_required_count', 0)})",
            f"- Render visual integrity: {html_thumbnail_renderer.get('render_visual_integrity_status', 'missing')} ({html_thumbnail_renderer.get('render_visual_integrity_pass_count', 0)}/{html_thumbnail_renderer.get('render_visual_integrity_required_count', 0)} full-frame checks)",
            f"- Source role integrity: {html_thumbnail_renderer.get('source_role_integrity_status', 'missing')} ({html_thumbnail_renderer.get('source_role_integrity_pass_count', 0)}/{html_thumbnail_renderer.get('source_role_integrity_required_count', 0)} approved primary sources)",
            f"- Topic-source match: {html_thumbnail_renderer.get('topic_source_match_status', 'missing')} ({html_thumbnail_renderer.get('topic_source_match_pass_count', 0)}/{html_thumbnail_renderer.get('topic_source_match_required_count', 0)})",
            f"- Better photo tournament: {html_thumbnail_renderer.get('better_photo_tournament_status', 'missing')} ({html_thumbnail_renderer.get('better_photo_tournament_pass_count', 0)}/{html_thumbnail_renderer.get('better_photo_tournament_required_count', 0)}) selected ranks {html_thumbnail_renderer.get('better_photo_tournament_min_selected_rank', 'missing')}-{html_thumbnail_renderer.get('better_photo_tournament_max_selected_rank', 'missing')}",
            f"- First 30-second payoff: {html_thumbnail_renderer.get('first_30_second_payoff_status', 'missing')}",
            f"- Chat delivery artifacts: {html_thumbnail_renderer.get('chat_delivery_artifacts_status', 'missing')} ({html_thumbnail_renderer.get('chat_delivery_artifact_count', 0)}/{html_thumbnail_renderer.get('chat_delivery_required_artifact_count', 0)}) run={html_thumbnail_renderer.get('chat_delivery_run_id', 'missing')}",
            f"- Chat delivery surface: {html_thumbnail_renderer.get('chat_delivery_surface_status', 'missing')} — {html_thumbnail_renderer.get('chat_delivery_preview_format', 'missing')}, lower_half={html_thumbnail_renderer.get('chat_delivery_lower_half_pass_count', 0)}/{html_thumbnail_renderer.get('chat_delivery_required_lower_half_pass_count', 0)}, contact={html_thumbnail_renderer.get('chat_delivery_contact_sheet_layout', 'missing')} {html_thumbnail_renderer.get('chat_delivery_contact_sheet_width', 0)}x{html_thumbnail_renderer.get('chat_delivery_contact_sheet_height', 0)}",
            f"- Chat delivery contact sheet: {html_thumbnail_renderer.get('chat_delivery_contact_sheet', 'missing')}",
            f"- Satori/resvg/Sharp renderer: {html_thumbnail_renderer.get('satori_resvg_sharp_renderer_status', 'missing')} — {html_thumbnail_renderer.get('satori_resvg_sharp_renderer_count', 0)} thumbnails",
            f"- Penpot fallback evaluation: {penpot_fallback.get('penpot_fallback_status', 'missing')} — export={penpot_fallback.get('export_validation_status', 'missing')}",
            f"- Penpot slot-fill smoke: {penpot_slot_fill.get('penpot_slot_fill_status', 'missing')} — png={penpot_slot_fill.get('production_png_path', 'missing')} chat={penpot_slot_fill.get('chat_safe_preview_status', 'missing')}",
            f"- Renderer decision gate: {renderer_decision.get('renderer_decision_gate_status', 'missing')} — selected={renderer_decision.get('selected_renderer', 'missing')} mode={renderer_decision.get('renderer_output_mode', 'missing')}",
            f"- Photopea rescue evaluation: {photopea_rescue.get('photopea_rescue_status', 'missing')} — production={photopea_rescue.get('production_ready_status', 'missing')}",
            f"- HTML/SVG renderer mobile previews: {html_thumbnail_renderer.get('mobile_shelf_preview_count', 0)}/{html_thumbnail_renderer.get('required_mobile_shelf_preview_count', 0)}",
            f"- HTML/SVG renderer contact sheet: {repo_display(approval / 'html-thumbnail-renderer-contact-sheet.jpg')}",
            f"- Public YouTube mutation in typography upgrade: tournament={thumbnail_font_tournament.get('public_youtube_mutation', 'missing')}, html_renderer={html_thumbnail_renderer.get('public_youtube_mutation', 'missing')}",
            f"- Canva template registry: {canva_template_registry.get('registry_status', 'missing')} — templates={canva_template_registry.get('template_count', 0)}, production_ready={canva_template_registry.get('production_ready_status', 'missing')}, missing_template_ids={canva_template_registry.get('template_id_missing_count', 0)}",
            f"- Canva template slot schema: {canva_template_registry.get('slot_schema_status', 'missing')} — font_preservation={canva_template_registry.get('font_preservation_gate_status', 'missing')}",
            f"- Canva render plan: {canva_render_plan.get('render_plan_status', 'missing')} — edit_plans={canva_render_plan.get('edit_plan_count', 0)}/{canva_render_plan.get('required_edit_plan_count', 0)}, execution={canva_render_plan.get('canva_template_execution_status', 'missing')}",
            f"- Renderer selection: {canva_render_plan.get('selected_renderer', 'missing')} — mode={canva_render_plan.get('renderer_output_mode', 'missing')}, coverage={canva_render_plan.get('approved_renderer_coverage_status', 'missing')} ({canva_render_plan.get('approved_renderer_coverage_count', 0)}/{canva_render_plan.get('approved_renderer_required_count', 0)})",
            f"- Canva-first fallback policy: primary={canva_render_plan.get('canva_primary_renderer', 'missing')}, free_fallback_allowed={canva_render_plan.get('approved_free_fallback_allowed', 'missing')}, blockers={', '.join(canva_render_plan.get('canva_blockers', [])) or 'none'}",
            f"- Free fallback renderer: {canva_render_plan.get('free_fallback_renderer_status', 'missing')} — {canva_render_plan.get('free_fallback_candidate_count', 0)}/{canva_render_plan.get('free_fallback_required_candidate_count', 0)} candidates, provenance={canva_render_plan.get('renderer_provenance_status', 'missing')}",
            f"- Canva QA integration: {canva_render_plan.get('canva_thumbnail_qa_integration_status', 'missing')} — negative_tests={canva_render_plan.get('negative_tests', {}).get('status', 'missing')}",
            f"- Canva-vs-local renderer tournament: {canva_render_plan.get('canva_vs_local_renderer_tournament_status', 'missing')} — canva_candidates={canva_render_plan.get('canva_candidate_reference_count', 0)}, local_renderer={canva_render_plan.get('local_renderer_status', 'missing')}",
            f"- Canva owner final approval packet V2: {canva_render_plan.get('owner_final_approval_packet_v2_status', 'missing')} — preview_capture={canva_render_plan.get('preview_capture_status', 'missing')}",
            f"- Canva source-photo upload/fill: upload={canva_render_plan.get('canva_source_photo_upload_status', 'missing')}; fill={canva_render_plan.get('canva_source_photo_fill_status', 'missing')}",
            f"- Canva export/local bridge: {canva_render_plan.get('export_local_file_bridge_status', 'missing')} — candidate={canva_render_plan.get('canva_local_export_candidate', 'missing')} dimensions={canva_render_plan.get('canva_local_export_candidate_dimensions', 'missing')}",
            f"- Canva source bridge: {canva_render_plan.get('canva_source_bridge_status', 'missing')} — url_matrix={canva_render_plan.get('canva_source_url_normalization_matrix_status', 'missing')}, fallback={canva_render_plan.get('canva_source_upload_fallback_ladder_status', 'missing')}",
            f"- Canva source-backed base composites: {canva_render_plan.get('canva_source_backed_base_composite_bridge_status', 'missing')} — {canva_render_plan.get('canva_source_bridge_base_composite_count', 0)}/{canva_render_plan.get('canva_source_bridge_required_base_composite_count', 0)}",
            f"- Canva source-filled coverage: source_filled={canva_render_plan.get('canva_source_filled_thumbnail_count', 0)}/{canva_render_plan.get('canva_required_source_filled_thumbnail_count', 0)}, canva_only_coverage={canva_render_plan.get('canva_all_thumbnails_covered_status', 'missing')}",
            f"- Canva output mode: {canva_render_plan.get('canva_output_mode', 'missing')} — draft={canva_render_plan.get('canva_draft_readiness_status', 'missing')}, production={canva_render_plan.get('canva_production_readiness_status', 'missing')}",
            f"- Canva production blocker: {canva_render_plan.get('canva_source_bridge_production_blocker', 'missing')}",
            f"- Canva final output mode: {'blocked until template IDs / owner approval' if canva_render_plan.get('canva_template_execution_status') == 'blocked_template_ids_missing' else 'ready for Canva template execution'}",
            f"- Canva live mutation: {canva_render_plan.get('canva_live_mutation', 'missing')}; paid/pro assets: {canva_render_plan.get('paid_or_pro_assets', 'missing')}; YouTube replacement: {canva_render_plan.get('youtube_replacement_status', 'missing')}",
            f"- Canva no-AI render plan: {canva_no_ai_render_plan.get('canva_no_ai_render_plan_status', 'missing')} — edit_plans={canva_no_ai_render_plan.get('edit_plan_count', 0)}/{canva_no_ai_render_plan.get('required_edit_plan_count', 0)}, ops={canva_no_ai_render_plan.get('canva_operation_allowlist_status', 'missing')}, fonts={canva_no_ai_render_plan.get('canva_template_font_preservation_audit_v2_status', 'missing')}",
            f"- Canva no-AI boundary: AI={canva_no_ai_render_plan.get('canva_ai_generation_status', 'missing')}, Magic Layers={canva_no_ai_render_plan.get('magic_layers_image_to_design_status', 'missing')}, generate-design={canva_no_ai_render_plan.get('generate_design_status', 'missing')}, preview/export={canva_no_ai_render_plan.get('canva_no_ai_preview_export_smoke_status', 'missing')}",
            f"- Canva no-AI live validation: {canva_no_ai_live_validation.get('canva_no_ai_live_validation_status', 'missing')} — copy={canva_no_ai_live_validation.get('canva_copy_status', 'missing')}, draft={canva_no_ai_live_validation.get('draft_transaction_status', 'missing')}, export={canva_no_ai_live_validation.get('export_local_file_bridge_status', 'missing')}",
            f"- External font registry: {external_font_registry.get('external_font_registry_status', 'missing')} — foundries={external_font_registry.get('foundry_count', 0)}, downloads={external_font_registry.get('external_font_download_status', 'missing')}",
            f"- Font license gate: {font_license_gate.get('external_font_license_gate_status', 'missing')} — bundled={font_license_gate.get('bundled_font_pass_count', 0)}/{font_license_gate.get('bundled_font_count', 0)}, better-font-contract={font_license_gate.get('better_font_candidate_tournament_contract_status', 'missing')}",
            f"- Canva-vs-local typography winner gate V2: {font_license_gate.get('canva_similarity_scoring_contract_status', 'missing')} — click-redteam={font_license_gate.get('click_desire_font_redteam_contract_status', 'missing')}",
            f"- Typography before/after contact sheet: {repo_display(photo_backed_thumbnail_summary.get('before_after_typography_contact_sheet', approval / 'miami-typography-before-after-contact-sheet.jpg'))}",
            f"- Font QA report: {repo_display(approval / 'thumbnail-font-quality-report.md')}",
            f"- Free-first thumbnail workflow: {thumbnail_factory.get('free_toolchain_status', 'missing')}",
            f"- Rough/shortlisted/review/selected concepts: {thumbnail_factory.get('rough_concept_count', 0)} / {thumbnail_factory.get('shortlisted_concept_count', 0)} / {thumbnail_factory.get('review_concept_count', 0)} / {thumbnail_factory.get('selected_candidate_count', 0)}",
            f"- Paid tool used: {thumbnail_factory.get('paid_tool_used', True)}",
            f"- Paid asset used: {thumbnail_factory.get('paid_asset_used', True)}",
            f"- OCR mobile readability: {thumbnail_factory.get('mobile_ocr_readability_status', 'missing')}",
            f"- Benchmark similarity scoring: {thumbnail_factory.get('benchmark_similarity_status', 'missing')}",
            f"- Photopea/GIMP handoff: {repo_display(approval / 'thumbnail-manual-handoff.json')} ({thumbnail_factory.get('manual_handoff_status', 'missing')})",
            "- Paid tool escalation: blocked unless the owner approves after a documented free-workflow failure.",
            f"- Photo-backed candidates: {thumbnail_factory.get('photo_backed_candidate_count', 0)}",
            f"- Five city-first review concepts: {thumbnail_factory.get('review_concept_count', 0)}",
            f"- Selected production candidates: {thumbnail_factory.get('selected_candidate_count', 0)}",
            f"- City name dominance: {thumbnail_factory.get('city_name_dominant_count', 0)}/5 concepts",
            f"- Clear thumbnail promise: {thumbnail_factory.get('clear_promise_count', 0)}/5 concepts",
            f"- City skyline/landmark recognition: {thumbnail_factory.get('skyline_or_landmark_count', 0)}/5 concepts",
            f"- City recognizable visuals: {thumbnail_factory.get('city_recognizable_visual_count', thumbnail_factory.get('detroit_recognizable_visual_count', 0))}/5 concepts",
            f"- Premium city typography: {thumbnail_factory.get('premium_city_font_count', 0)}/5 concepts",
            f"- Polished proof marks: {thumbnail_factory.get('polished_proof_mark_count', 0)}/5 concepts",
            f"- Competitive benchmark aesthetic: {thumbnail_factory.get('benchmark_aesthetic_match_count', 0)}/5 concepts",
            f"- Internal public labels: {thumbnail_factory.get('internal_public_label_count', 0)}",
            f"- Random arrows: {thumbnail_factory.get('random_arrow_count', 0)}",
            f"- City name phone readability: {thumbnail_factory.get('city_name_phone_readable_count', 0)}/5 concepts",
            f"- Thumbnail search shelf: {repo_display(approval / 'thumbnail-search-shelf-test.png')} ({thumbnail_factory.get('search_shelf_test_status', 'missing')})",
            f"- Five-concept contact sheet: {repo_display(approval / 'thumbnail-five-concept-contact-sheet.png')}",
            f"- Abstract placeholder candidates: {thumbnail_factory.get('abstract_placeholder_count', 0)}",
            f"- Contact sheet: {repo_display(approval / 'thumbnail-contact-sheet.png')}",
            f"- Canva handoff: {repo_display(approval / 'canva-render-handoff.json')}",
        ]
    )
    chat_by_variant = {
        item.get("variant_id"): item
        for item in html_thumbnail_renderer.get("chat_delivery_artifacts", [])
        if item.get("variant_id")
    }
    first30_rows = html_thumbnail_renderer.get("first_30_second_payoff_report", {}).get("rows", [])
    if html_thumbnail_renderer.get("entries"):
        lines.extend(["", "### Production Owner Packet V4 Thumbnail Candidate Audit", ""])
        for index, entry in enumerate(html_thumbnail_renderer.get("entries", []), start=1):
            variant_id = entry.get("variant_id", f"candidate_{index}")
            chat_artifact = chat_by_variant.get(variant_id, {})
            first30 = first30_rows[index - 1] if index - 1 < len(first30_rows) else {}
            topic_match = entry.get("topic_source_match", {})
            lines.extend(
                [
                    f"#### Candidate {index}: {entry.get('main_text', variant_id)}",
                    f"- City: {entry.get('city', real_city_source_assets.get('active_city', 'missing'))}",
                    f"- Topic: {entry.get('topic_id', topic_match.get('topic', 'missing'))}",
                    f"- Thumbnail hook: {entry.get('thumbnail_hook', entry.get('main_text', 'missing'))}",
                    f"- Production PNG: {repo_display(entry.get('path', 'missing'))}",
                    f"- Chat-safe preview: {repo_display(chat_artifact.get('chat_preview_path', 'missing'))}",
                    f"- Selected source image: {repo_display(entry.get('source_image', topic_match.get('selected_image_path', 'missing')))}",
                    f"- Proof object: {entry.get('proof_object', topic_match.get('proof_object', 'missing'))}",
                    f"- Rights/source role status: {html_thumbnail_renderer.get('source_role_integrity_status', 'missing')}",
                    f"- Topic-source match: {entry.get('topic_source_match_status', 'missing')} ({', '.join(topic_match.get('source_tag_overlap', [])) or 'no overlap'})",
                    f"- First-30-second payoff: {first30.get('status', html_thumbnail_renderer.get('first_30_second_payoff_status', 'missing'))}",
                    "",
                ]
            )
    for thumbnail in thumbnails:
        lines.append(f"- {repo_display(thumbnail)} | {size_label(thumbnail)}")
    if visible_source_audit:
        lines.extend(["", "### Visible Real-Photo Source Audit", ""])
        for concept in visible_source_audit.get("concepts", []):
            regions = concept.get("visible_source_regions", [])
            photo_regions = [region for region in regions if region.get("is_real_photo")]
            photo_summary = "; ".join(
                f"{region.get('region_id', 'region')}={region.get('source_rel_path', region.get('source_path', 'missing'))} ({region.get('region_area_pct', 0)}%)"
                for region in photo_regions
            ) or "missing"
            lines.append(
                f"- {concept.get('headline', concept.get('concept_id', 'missing'))}: {concept.get('status', 'missing')} | visible_photo={concept.get('has_visible_real_photo', False)} | major_photo={concept.get('photo_hero_or_major_inset', False)} | map_only={concept.get('map_only', False)} | photos: {photo_summary}"
            )
    lines.extend(
        [
            "",
            "## Metadata",
            "",
            f"- Selected/default title: {selected_title or 'missing'}",
            f"- Title options: {len(title_options)}",
            f"- Tags: {', '.join(tags) if tags else 'missing'}",
            f"- Chapters: {len(chapters)}",
            f"- Pinned comment: {pinned or 'missing'}",
            f"- Description present: {'yes' if description else 'no'}",
            "",
            "## Gates",
            "",
            f"- Topic economics score: {monetization.get('topic_score', 'unknown')}",
            f"- Monetization gates: {monetization.get('status', 'missing')}",
            f"- Long-form quality: {long_form_quality.get('status', 'missing')}",
            f"- Retention ladder: {retention_ladder.get('status', 'missing')}",
            f"- First-5 hook: {first5_hook.get('status', 'missing')}",
            f"- Motion polish: {motion_polish.get('status', 'missing')}",
            f"- Visual variety: {visual_variety.get('status', 'missing')}",
            f"- Benchmark growth: {benchmark_growth.get('status', 'missing')}",
            f"- Guru growth: {guru_growth.get('status', 'missing')}",
            f"- Synthetic disclosure: {synthetic_disclosure.get('status', 'missing')}",
            f"- Synthetic decision present: {synthetic_disclosure.get('synthetic_disclosure_decision_present', False)}",
            f"- Reconstruction label: {synthetic_disclosure.get('required_reconstruction_label', 'Dramatic reconstruction — not archival footage')}",
            f"- Visual upgrade plan: {visual_upgrade.get('status', 'missing')}",
            f"- Visual quality: {visual_quality.get('status', 'missing')}",
            f"- Shorts script package: {shorts_script_package.get('status', 'missing')}",
            f"- Shorts audio economy: {shorts_audio_economy.get('status', 'missing')}",
            f"- Shorts boundary quality: {shorts_boundary_quality.get('status', 'missing')}",
            f"- Shorts first-frame quality: {shorts_first_frame_quality.get('status', 'missing')}",
            f"- Shorts pacing quality: {shorts_pacing_quality.get('status', 'missing')}",
            f"- Shorts engagement loop: {shorts_engagement_loop.get('status', 'missing')}",
            f"- Shorts free-first toolchain: {shorts_toolchain_handoff.get('status', 'missing')}",
            f"- Shorts render readiness: {shorts_render_readiness.get('status', 'missing')}",
            f"- Shorts quality: {shorts_quality.get('status', 'missing')}",
            f"- Thumbnail factory: {thumbnail_factory.get('status', 'missing')}",
            f"- Thumbnail quality: {thumbnail_quality.get('status', 'missing')}",
            f"- Generated image source: {image_report.get('selected_source', 'unknown')}",
            f"- Real-media source pack: {historical_count} historical / {modern_context_count} modern context",
            f"- OpenAI backup used: {image_report.get('backup_used', False)}",
            f"- Private upload readiness: {private_status}",
            f"- Public publish readiness: {public_status}",
            f"- Pipeline private readiness: {pipeline.get('private_upload_readiness', 'unknown')}",
            f"- YPP progress report: {repo_display(ypp_report)} ({ypp.get('status', 'missing')})",
            f"- Content calendar: {repo_display(calendar_report)} ({len(calendar.get('rows', []))} rows)",
            f"- Shorts follow-up packet: {shorts_followup.get('shorts_followup_packet_status', 'missing')} ({shorts_followup.get('shorts_count', 0)} Shorts)",
            f"- Performance learning scaffold: {performance_learning.get('performance_learning_loop_scaffold_status', 'missing')} ({performance_learning.get('checkpoint_count', 0)} checkpoints, live analytics={performance_learning.get('live_analytics_status', 'missing')})",
            "",
            "## Rights Ledger Review",
            "",
        ]
    )
    for asset_type in ["thumbnail", "image", "voiceover", "proof_footage", "video", "short"]:
        lines.append(
            f"- {asset_type}: {by_type.get(asset_type, 0)} rows, {approved.get(asset_type, 0)} approved"
        )
    lines.extend(
        [
            "",
            "## Owner Decisions",
            "",
            "- Images approved:",
            "- Thumbnail A approved:",
            "- Thumbnail B approved:",
            "- Thumbnail C approved:",
            "- Voiceover approved:",
            "- Source proof footage approved:",
            "- Long-form video approved:",
            "- Shorts approved:",
            "- James avatar concept approved:",
            "- Private/unlisted upload approved:",
            "- Public publish approved after YouTube checks:",
            "",
            "## Safety Checks",
            "",
            "- No public auto-publish.",
            "- No copied scripts, thumbnails, or third-party footage.",
            "- Benchmarking adapts mechanics only; it must not copy competitor creative work.",
            "- Every city file must sell one strange visual clue, one source trail, and one hidden system.",
            "- Synthetic disclosure gate must pass before upload or publish.",
            "- AI can illustrate. It cannot prove.",
            "- Realistic reconstructions must be labeled: Dramatic reconstruction — not archival footage.",
            "- Fake lip-sync, fake quotes, and unlabeled fake archival footage are blocked.",
            "- AI-generated assets remain rights-logged and human-review gated.",
            "- Synthetic or altered content answer must be approved before upload.",
            "- Public-facing content should not mention internal automation.",
            "",
        ]
    )
    packet.write_text("\n".join(lines), encoding="utf-8")
    print(f"Owner review packet: {repo_display(packet)}")


if __name__ == "__main__":
    main()
