#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, utc_now
from patternlab_benchmark_growth import build_benchmark_growth_report
from patternlab_content_quality import build_content_quality_report, stale_framing_hits
from patternlab_first5_hook import build_first5_hook_report
from patternlab_guru_growth_gates import build_guru_growth_report
from patternlab_shorts_audio_economy import build_audio_economy_report
from patternlab_shorts_boundary_quality import build_boundary_quality_report
from patternlab_shorts_engagement_loop import build_engagement_loop_report
from patternlab_shorts_first_frame_quality import build_first_frame_quality_report
from patternlab_shorts_pacing_quality import build_pacing_quality_report
from patternlab_shorts_render_readiness import build_render_readiness_report
from patternlab_shorts_script_package import build_shorts_script_package
from patternlab_shorts_toolchain_handoff import build_toolchain_handoff
from patternlab_long_form_quality import build_long_form_quality_report
from patternlab_motion_polish import build_motion_polish_report
from patternlab_source_rights import build_source_rights_report
from patternlab_synthetic_disclosure import build_synthetic_disclosure_report
from patternlab_thumbnail_font_quality import build_font_quality_report
from patternlab_thumbnail_quality import build_thumbnail_quality_report
from patternlab_visual_variety import build_visual_variety_report
from patternlab_owner_rating_learning import build_owner_rating_learning_report
from patternlab_poster_depth_renderer import build_poster_depth_package
from patternlab_thumbnail_pop_score import build_pop_score_report
from patternlab_thumbnail_reference_analyzer import build_reference_anatomy_report
from patternlab_thumbnail_reference_library import validate_reference_library
from patternlab_thumbnail_shelf_strip import build_shelf_strip
from patternlab_title_thumbnail_pair_packet import build_pair_packet
from patternlab_transcript_viral_quality import build_transcript_viral_report
from patternlab_comment_quality import build_comment_quality_report
from patternlab_transcript_watchtime_score import build_score as build_transcript_watchtime_score
from patternlab_transcript_editorial_quality import build_report as build_transcript_editorial_quality_report
from patternlab_claim_ledger_quality import build_report as build_claim_ledger_quality_report
from patternlab_claim_visual_fidelity import build_claim_visual_fidelity_report
from patternlab_asset_identity import build_report as build_asset_identity_report
from patternlab_font_tournament import build_font_tournament_report
from patternlab_html_thumbnail_renderer import build_html_thumbnail_renderer_report
from patternlab_source_candidate_tournament import build_source_candidate_tournament
from patternlab_source_provider_health import build_source_provider_health_report
from patternlab_canva_template_registry import validate_registry as validate_canva_template_registry
from patternlab_canva_render_plan import build_render_plan as build_canva_render_plan
from patternlab_canva_no_ai_render_plan import build_no_ai_render_plan as build_canva_no_ai_render_plan
from patternlab_external_font_registry import build_external_font_registry_report
from patternlab_font_license_gate import build_font_license_gate_report
from patternlab_penpot_fallback_eval import build_report as build_penpot_fallback_report
from patternlab_photopea_rescue_eval import build_report as build_photopea_rescue_report
from patternlab_penpot_slot_fill_smoke import build_slot_fill_smoke
from patternlab_renderer_decision_gate import build_decision_gate
from patternlab_voice_visual_match import build_voice_visual_match_report
from patternlab_finished_video_watchdown import build_finished_video_watchdown_report
from patternlab_episode_standard import build_episode_standard_report


CANONICAL_SEQUENCE = "OpenClaw strategy/source safety -> Canva plugin render -> OpenClaw validation -> owner review / YouTube test"
ACTIVE_SCAN_PATHS = [
    BASE / "README.md",
    BASE / "workflows",
    BASE / "scripts",
    BASE / "launch" / "video-03",
]
LATER_STAGE_LABELS = {
    "shorts": "Shorts production is Milestone 8 production work.",
    "live_voice": "Live narration is Milestone 8 production work and remains approval-gated.",
    "review_package_approval": "Owner review package approval is a human gate after media review.",
    "private_upload_approval": "Private/unlisted upload approval is a human gate after the package is ready.",
    "public_publish": "Public publishing is always a manual owner action after YouTube checks.",
    "youtube_verification": "YouTube live verification requires uploaded private/unlisted media.",
}


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_ledger_rows(root):
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def collect_text_files(paths):
    files = []
    for path in paths:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(
                item
                for item in sorted(path.rglob("*"))
                if item.is_file() and item.suffix.lower() in {".py", ".md", ".json", ".csv", ".txt"}
            )
    return files


def add_check(checks, blockers, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})
    if not passed:
        blockers.append(f"{name}: {detail}")


def active_stale_hits():
    hits = []
    for path in collect_text_files(ACTIVE_SCAN_PATHS):
        try:
            text = read_text(path)
        except UnicodeDecodeError:
            continue
        for label in stale_framing_hits(text):
            hits.append(f"{display_path(path)}: {label}")
    return hits




def real_city_thumbnail_test(root):
    report = read_json(root / "approval" / "real-city-source-asset-report.json") or {}
    manifest = read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json") or {}
    photo_backed = read_json(root / "approval" / "miami-photo-backed-thumbnail-report.json") or {}
    thumbnail_factory = read_json(root / "approval" / "thumbnail-factory-report.json") or {}
    visible_source_audit = read_json(root / "approval" / "thumbnail-visible-source-audit-report.json") or {}
    source_backed_factory = (
        thumbnail_factory.get("status") == "pass"
        and visible_source_audit.get("status") == "pass"
        and int(visible_source_audit.get("visible_real_photo_count", 0)) >= 5
        and int(visible_source_audit.get("photo_hero_or_major_inset_count", 0)) >= 5
        and int(visible_source_audit.get("map_only_concept_count", 0)) == 0
        and int(visible_source_audit.get("unmanifested_visible_source_count", 0)) == 0
    )
    return (
        bool(report.get("real_city_asset_count"))
        and manifest.get("real_world_city_test") is True
        and manifest.get("synthetic_mockup_allowed") is False
    ) or (
        photo_backed.get("status") == "pass"
        and "photo_backed" in str(photo_backed.get("mode", ""))
        and int(photo_backed.get("visible_real_photo_count", 0)) >= 1
    ) or source_backed_factory


def photo_backed_thumbnail_test(root):
    summary = read_json(root / "approval" / "miami-photo-backed-thumbnail-report.json") or {}
    click = read_json(root / "approval" / "thumbnail-click-quality-report.json") or {}
    font = read_json(root / "approval" / "thumbnail-font-quality-report.json") or {}
    market = read_json(root / "approval" / "thumbnail-market-typography-research-report.json") or {}
    return {
        "is_photo_backed": summary.get("status") == "pass" and "photo_backed" in str(summary.get("mode", "")),
        "summary": summary,
        "click": click,
        "font": font,
        "market": market,
    }


def write_quality_gates_payload(approval, payload):
    json_report = approval / "quality-gates-report.json"
    md_report = approval / "quality-gates-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Quality Gates: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Quality Gates",
        "",
    ]
    for check in payload["checks"]:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Later-Stage Blockers Not Counted Against Milestone 6", ""])
    lines.extend([f"- {item['name']}: {item['detail']}" for item in payload.get("later_stage_blockers_not_milestone_6_failures", [])] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Stale Active Framing Hits", ""])
    lines.extend([f"- {hit}" for hit in payload.get("stale_hits", [])] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_report, md_report

def script_city_identity(video_id):
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    text = read_text(script).lower() if script.exists() else ""
    return {
        "script": display_path(script),
        "has_city_outro": "city, source, system" in text and "no source, no story" in text,
        "has_source_proof": "source proof" in text or "proof starts" in text or "show the source" in text,
        "has_subscribe_cta": "subscribe" in text and "city file" in text,
    }


def canva_brief_checks(root):
    brief = read_json(root / "approval" / "canva-thumbnail-brief.json") or {}
    candidates = brief.get("candidates", [])
    return {
        "exists": bool(brief),
        "status": brief.get("status", ""),
        "canonical_sequence": brief.get("canonical_sequence", ""),
        "sequence_ok": brief.get("canonical_sequence") == CANONICAL_SEQUENCE,
        "role_boundary_ok": "Canva is the rendering engine only" in brief.get("canva_role", ""),
        "candidate_count": len(candidates),
    }


def owner_boundary_checks():
    private_readiness = read_text(BASE / "scripts" / "private_upload_readiness.py")
    public_readiness = read_text(BASE / "scripts" / "public_publish_readiness.py")
    uploader = read_text(BASE / "scripts" / "upload_approved_package.py")
    return {
        "review_package_approval_required": "Owner approval for the full review package is missing" in private_readiness,
        "private_upload_approval_required": "private-upload-approval.json" in private_readiness,
        "public_publish_approval_required": "Explicit owner approval for public publish is missing" in public_readiness,
        "youtube_verification_required": "Live YouTube API verification is not verified" in public_readiness,
        "private_uploader_requires_readiness": "private-upload-ready" in uploader,
    }


def later_stage_blockers(root, video_id):
    blockers = []
    shorts = sorted((root / "shorts").glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if (root / "shorts").exists() else []
    if len(shorts) < 3:
        blockers.append({"name": "shorts", "detail": LATER_STAGE_LABELS["shorts"]})
    rows = read_ledger_rows(root)
    voiceover_text = " ".join(
        row.get("notes", "") + " " + row.get("license_or_rights_basis", "")
        for row in rows
        if row.get("asset_type") == "voiceover"
    ).lower()
    has_live_voice = any(row.get("asset_type") == "voiceover" and row.get("tool") == "ElevenLabs API" for row in rows)
    if "silent assembly draft" in voiceover_text and not has_live_voice:
        blockers.append({"name": "live_voice", "detail": LATER_STAGE_LABELS["live_voice"]})
    approval = root / "approval"
    if not (approval / "review-package-approval.json").exists():
        blockers.append({"name": "review_package_approval", "detail": LATER_STAGE_LABELS["review_package_approval"]})
    if not (approval / "private-upload-approval.json").exists():
        blockers.append({"name": "private_upload_approval", "detail": LATER_STAGE_LABELS["private_upload_approval"]})
    if not (approval / "public-publish-approval.json").exists():
        blockers.append({"name": "public_publish", "detail": LATER_STAGE_LABELS["public_publish"]})
    if not (approval / "youtube-live-verification-report.json").exists():
        blockers.append({"name": "youtube_verification", "detail": LATER_STAGE_LABELS["youtube_verification"]})
    return blockers


def build_quality_gates_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    checks = []
    blockers = []
    warnings = []

    content, content_report = build_content_quality_report(video_id)
    first5, _first5_json_report, first5_md_report = build_first5_hook_report(video_id)
    long_form, long_form_report = build_long_form_quality_report(video_id)
    thumbnail, thumbnail_report = build_thumbnail_quality_report(video_id)
    source_rights, source_rights_json_report, source_rights_md_report = build_source_rights_report(video_id)
    synthetic, synthetic_json_report, synthetic_md_report = build_synthetic_disclosure_report(video_id)
    visual_variety, visual_variety_json_report, visual_variety_md_report = build_visual_variety_report(video_id)
    motion_polish, motion_polish_json_report, motion_polish_md_report = build_motion_polish_report(video_id)
    benchmark_growth, benchmark_growth_json_report, benchmark_growth_md_report = build_benchmark_growth_report(video_id)
    shorts_script_package, shorts_script_package_json_report, shorts_script_package_md_report = build_shorts_script_package(video_id)
    shorts_audio_economy, shorts_audio_economy_json_report, shorts_audio_economy_md_report = build_audio_economy_report(video_id)
    shorts_boundary_quality, shorts_boundary_quality_json_report, shorts_boundary_quality_md_report = build_boundary_quality_report(video_id)
    shorts_first_frame_quality, shorts_first_frame_quality_json_report, shorts_first_frame_quality_md_report = build_first_frame_quality_report(video_id)
    shorts_pacing_quality, shorts_pacing_quality_json_report, shorts_pacing_quality_md_report = build_pacing_quality_report(video_id)
    shorts_engagement_loop, shorts_engagement_loop_json_report, shorts_engagement_loop_md_report = build_engagement_loop_report(video_id)
    shorts_toolchain_handoff, shorts_toolchain_handoff_json_report, shorts_toolchain_handoff_md_report = build_toolchain_handoff(video_id)
    shorts_render_readiness, shorts_render_readiness_json_report, shorts_render_readiness_md_report = build_render_readiness_report(video_id)
    guru_growth, guru_growth_json_report, guru_growth_md_report = build_guru_growth_report(video_id)
    font_quality, font_quality_json_report, font_quality_md_report = build_font_quality_report(video_id)
    identity = script_city_identity(video_id)
    canva = canva_brief_checks(root)
    owner = owner_boundary_checks()
    stale_hits = active_stale_hits()
    detected_real_city_test = real_city_thumbnail_test(root)
    # Thumbnail-only fixture packages are allowed to skip episode checks. A
    # production episode must never enter that branch merely because its
    # thumbnails are source-backed.
    thumbnail_only_fixtures = {"cleveland-test", "miami-photo-redo", "pittsburgh-first-run"}
    real_city_test = detected_real_city_test and video_id in thumbnail_only_fixtures
    photo_backed_test = photo_backed_thumbnail_test(root)
    reference_library, reference_library_json_report, reference_library_md_report = validate_reference_library(video_id)
    reference_anatomy, reference_anatomy_json_report, reference_anatomy_md_report = build_reference_anatomy_report(video_id)
    pop_score, pop_score_json_report, pop_score_md_report = build_pop_score_report(video_id)
    poster_depth, poster_depth_json_report, poster_depth_md_report = build_poster_depth_package(video_id)
    shelf_strip, shelf_strip_json_report, shelf_strip_md_report = build_shelf_strip(video_id)
    owner_rating_v3, owner_rating_v3_json_report, owner_rating_v3_md_report = build_owner_rating_learning_report(video_id)
    font_tournament, font_tournament_json_report, font_tournament_md_report = build_font_tournament_report(video_id)
    html_renderer, html_renderer_json_report, html_renderer_md_report = build_html_thumbnail_renderer_report(video_id)
    title_pair, title_pair_json_report, title_pair_md_report = build_pair_packet(video_id)
    source_candidate, source_candidate_json_report, source_candidate_md_report = build_source_candidate_tournament(video_id)
    source_provider_health, source_provider_health_json_report, source_provider_health_md_report = build_source_provider_health_report(video_id)
    canva_registry, canva_registry_json_report, canva_registry_md_report = validate_canva_template_registry(video_id)
    penpot_fallback, penpot_fallback_json_report, penpot_fallback_md_report = build_penpot_fallback_report(video_id)
    photopea_rescue, photopea_rescue_json_report, photopea_rescue_md_report = build_photopea_rescue_report(video_id)
    photo_summary_for_canva = photo_backed_test.get("summary", {})
    canva_city = photo_summary_for_canva.get("city", "Miami") or "Miami"
    canva_render_plan, canva_render_plan_json_report, canva_render_plan_md_report = build_canva_render_plan(video_id, canva_city)
    canva_no_ai, canva_no_ai_json_report, canva_no_ai_md_report = build_canva_no_ai_render_plan(video_id, canva_city)
    penpot_slot_fill, penpot_slot_fill_json_report, penpot_slot_fill_md_report = build_slot_fill_smoke(video_id, canva_city)
    renderer_decision, renderer_decision_json_report, renderer_decision_md_report = build_decision_gate(video_id, canva_city)
    external_font_registry, external_font_registry_json_report, external_font_registry_md_report = build_external_font_registry_report(video_id)
    font_license_gate, font_license_gate_json_report, font_license_gate_md_report = build_font_license_gate_report(video_id)
    voice_visual_match, voice_visual_match_json_report, voice_visual_match_md_report = build_voice_visual_match_report(video_id)
    finished_watchdown, finished_watchdown_json_report, finished_watchdown_md_report = build_finished_video_watchdown_report(video_id)
    episode_standard, episode_standard_json_report, episode_standard_md_report = build_episode_standard_report(video_id)
    package_hash = read_json(approval / "package-hash-report.json") or {}
    transcript_viral, transcript_viral_json_report, transcript_viral_md_report = build_transcript_viral_report(video_id)
    comment_quality, comment_quality_json_report, comment_quality_md_report = build_comment_quality_report(video_id)
    transcript_watchtime, transcript_watchtime_json_report, transcript_watchtime_md_report = build_transcript_watchtime_score(video_id)
    transcript_editorial, transcript_editorial_json_report, transcript_editorial_md_report = build_transcript_editorial_quality_report(video_id)
    claim_ledger, claim_ledger_json_report, claim_ledger_md_report = build_claim_ledger_quality_report(video_id)
    # The stricter claim-to-visual gate applies only once a rebuild-v2 evidence
    # dossier exists. This avoids changing legacy fixture semantics while
    # ensuring a source-first rebuild cannot pass on generic Detroit imagery.
    claim_visual_fidelity = None
    claim_visual_fidelity_json_report = None
    claim_visual_fidelity_md_report = None
    if (root / "source-packet" / "rebuild-v2" / "video-04-evidence-dossier.json").exists():
        (
            claim_visual_fidelity,
            claim_visual_fidelity_json_report,
            claim_visual_fidelity_md_report,
        ) = build_claim_visual_fidelity_report(video_id)
    asset_identity, asset_identity_json_report, asset_identity_md_report = build_asset_identity_report(video_id)
    add_check(checks, blockers, "episode_standard_pass", episode_standard.get("status") == "pass", display_path(episode_standard_md_report))
    add_check(checks, blockers, "transcript_viral_quality_pass", transcript_viral.get("status") == "pass", display_path(transcript_viral_md_report))
    add_check(checks, blockers, "comment_quality_pass", comment_quality.get("status") == "pass", display_path(comment_quality_md_report))
    add_check(checks, blockers, "transcript_watchtime_score_pass", transcript_watchtime.get("status") == "pass", f"{transcript_watchtime.get('total_score', 0)}/{transcript_watchtime.get('max_score', 55)}; {display_path(transcript_watchtime_md_report)}")
    add_check(checks, blockers, "transcript_editorial_quality_pass", transcript_editorial.get("status") == "pass", display_path(transcript_editorial_md_report))
    add_check(checks, blockers, "claim_ledger_quality_pass", claim_ledger.get("status") == "pass", display_path(claim_ledger_md_report))
    if claim_visual_fidelity is not None:
        add_check(
            checks,
            blockers,
            "claim_visual_fidelity_pass",
            claim_visual_fidelity.get("status") == "pass",
            display_path(claim_visual_fidelity_md_report),
        )
    add_check(checks, blockers, "asset_identity_pass", asset_identity.get("status") == "pass", display_path(asset_identity_md_report))
    add_check(checks, blockers, "shorts_script_package_pass", shorts_script_package.get("status") == "pass", display_path(shorts_script_package_md_report))
    add_check(checks, blockers, "shorts_audio_economy_pass", shorts_audio_economy.get("status") == "pass", display_path(shorts_audio_economy_md_report))
    add_check(checks, blockers, "shorts_boundary_quality_pass", shorts_boundary_quality.get("status") == "pass", display_path(shorts_boundary_quality_md_report))
    add_check(checks, blockers, "shorts_first_frame_quality_pass", shorts_first_frame_quality.get("status") == "pass", display_path(shorts_first_frame_quality_md_report))
    add_check(checks, blockers, "shorts_pacing_quality_pass", shorts_pacing_quality.get("status") == "pass", display_path(shorts_pacing_quality_md_report))
    add_check(checks, blockers, "shorts_engagement_loop_pass", shorts_engagement_loop.get("status") == "pass", display_path(shorts_engagement_loop_md_report))
    add_check(checks, blockers, "shorts_toolchain_handoff_pass", shorts_toolchain_handoff.get("status") == "pass", display_path(shorts_toolchain_handoff_md_report))
    add_check(checks, blockers, "shorts_render_readiness_report_exists", shorts_render_readiness.get("status") in {"render-ready", "blocked"}, display_path(shorts_render_readiness_md_report))
    add_check(
        checks,
        blockers,
        "package_freshness_pass",
        package_hash.get("status") == "pass" and not package_hash.get("stale_outputs") and not package_hash.get("blockers"),
        display_path(approval / "package-hash-report.json"),
    )

    if photo_backed_test["is_photo_backed"]:
        summary = photo_backed_test["summary"]
        click = photo_backed_test["click"]
        market = photo_backed_test["market"]
        add_check(checks, blockers, "photo_backed_package_pass", summary.get("status") == "pass", "photo-backed Miami package status")
        add_check(checks, blockers, "source_rights_pass", source_rights.get("status") == "pass", display_path(source_rights_md_report))
        add_check(checks, blockers, "click_quality_pass", click.get("status") == "pass", "thumbnail-click-quality-report.json")
        add_check(checks, blockers, "font_quality_pass", font_quality.get("status") == "pass", display_path(font_quality_md_report))
        add_check(checks, blockers, "font_impact_fallback_blocked", font_quality.get("impact_fallback_used") is False, "Impact must not be used while better local fonts are available")
        add_check(checks, blockers, "font_shelf_readability_pass", font_quality.get("shelf_readability_status") == "pass", f"{font_quality.get('shelf_preview_count', 0)}/{font_quality.get('required_shelf_preview_count', 0)} shelf previews")
        add_check(checks, blockers, "thumbnail_count_9_pass", summary.get("thumbnail_count") == 9, f"{summary.get('thumbnail_count', 0)} regenerated thumbnails")
        add_check(checks, blockers, "visible_real_photos_pass", summary.get("visible_real_photo_count") == 9, f"{summary.get('visible_real_photo_count', 0)} visible real photos")
        add_check(checks, blockers, "source_photo_diversity_pass", summary.get("unique_source_photo_count", 0) >= 7, f"{summary.get('unique_source_photo_count', 0)} unique source photos")
        add_check(checks, blockers, "city_name_required_pass", all(report.get("city_name_required_status") == "pass" for report in summary.get("reports", [])), "city name appears in every thumbnail")
        add_check(checks, blockers, "intentionality_pass", click.get("intentionality_status") == "pass", "no random arrows, filler lines, or decorative boxes")
        add_check(checks, blockers, "source_photo_tag_match_pass", click.get("source_photo_tag_match_status") == "pass", "source photos match hooks")
        add_check(checks, blockers, "ab_readiness_pass", click.get("ab_readiness_status") == "ready_for_owner_review", "A/B packet ready with no public mutation")
        add_check(checks, blockers, "typography_market_research_pass", market.get("status") == "typography_research_complete", "read-only typography research complete")
        add_check(checks, blockers, "reference_library_infrastructure_pass", reference_library.get("infrastructure_status") == "pass", display_path(reference_library_md_report))
        add_check(checks, blockers, "reference_analyzer_infrastructure_pass", reference_anatomy.get("analyzer_infrastructure_status") == "pass", display_path(reference_anatomy_md_report))
        add_check(checks, blockers, "heuristic_pop_score_pass", pop_score.get("openclaw_heuristic_status") == "pass", display_path(pop_score_md_report))
        add_check(checks, blockers, "hero_object_requirement_pass", poster_depth.get("hero_object_requirement_status") == "pass", display_path(poster_depth_md_report))
        add_check(checks, blockers, "poster_depth_renderer_pass", poster_depth.get("poster_depth_renderer_status") == "pass", display_path(poster_depth_md_report))
        add_check(checks, blockers, "same_template_blocker_pass", poster_depth.get("same_template_blocker_status") == "pass", "unique-topic poster-depth tests must not reuse the same template family")
        add_check(checks, blockers, "owner_reference_style_adaptation_pass", poster_depth.get("owner_reference_style_adaptation_status") == "pass", "renderer must adapt owner reference energy without copying")
        add_check(checks, blockers, "no_filler_public_labels_pass", poster_depth.get("filler_public_label_blocker_status") == "pass", "SOURCE PHOTO, RECEIPT, and generic SOURCE FILE labels are blocked unless they create click curiosity")
        add_check(checks, blockers, "no_bare_redaction_blocks_pass", poster_depth.get("bare_redaction_blocker_status") == "pass", "bare redaction bars without readable surrounding words are blocked")
        add_check(checks, blockers, "vivid_color_energy_pass", poster_depth.get("vivid_color_energy_status") == "pass", "thumbnails must not look bland or muddy")
        add_check(checks, blockers, "mobile_shelf_strip_infrastructure_pass", shelf_strip.get("infrastructure_status") == "pass", display_path(shelf_strip_md_report))
        add_check(checks, blockers, "owner_rating_learning_v3_pass", owner_rating_v3.get("owner_rating_learning_v3_status") == "pass", display_path(owner_rating_v3_md_report))
        add_check(checks, blockers, "title_thumbnail_pair_packet_pass", title_pair.get("title_thumbnail_pair_packet_status") == "pass", display_path(title_pair_md_report))
        add_check(checks, blockers, "font_tournament_pass", font_tournament.get("font_tournament_status") == "pass", display_path(font_tournament_md_report))
        add_check(checks, blockers, "font_tournament_variant_count_pass", int(font_tournament.get("variant_count", 0)) >= 36, f"{font_tournament.get('variant_count', 0)} variants")
        add_check(checks, blockers, "font_tournament_winner_count_pass", int(font_tournament.get("winning_count", 0)) >= 5, f"{font_tournament.get('winning_count', 0)} variants scored 8.5/10+")
        add_check(checks, blockers, "font_bottom_text_fit_pass", font_tournament.get("bottom_text_fit_status") == "pass" and html_renderer.get("support_text_fit_status") == "pass", "support text must be 2-4 useful words and not squeezed")
        add_check(checks, blockers, "generic_font_blocker_pass", font_tournament.get("generic_font_blocker_status") == "pass" and html_renderer.get("generic_font_blocker_status") == "pass", "city/main fonts must be approved premium families")
        add_check(checks, blockers, "reference_typography_match_pass", font_tournament.get("reference_typography_match_status") == "pass" and html_renderer.get("reference_typography_match_status") == "pass", "reference typography score must be at least 8/10")
        add_check(checks, blockers, "html_svg_renderer_pass", html_renderer.get("html_renderer_status") == "pass", display_path(html_renderer_md_report))
        html_final_count = int(html_renderer.get("final_thumbnail_count", 0) or 0)
        html_dimension_count = int(html_renderer.get("dimension_1920x1080_count", 0) or 0)
        add_check(checks, blockers, "html_svg_renderer_1920_pass", html_final_count >= 3 and html_dimension_count == html_final_count, f"{html_dimension_count}/{html_final_count} final thumbnails are 1920x1080")
        add_check(checks, blockers, "html_svg_mobile_previews_pass", html_renderer.get("mobile_shelf_preview_status") == "pass" and font_tournament.get("mobile_shelf_preview_status") == "pass", f"html={html_renderer.get('mobile_shelf_preview_count', 0)}/{html_renderer.get('required_mobile_shelf_preview_count', 0)}, tournament={font_tournament.get('mobile_shelf_preview_count', 0)}/{font_tournament.get('required_mobile_shelf_preview_count', 0)}")
        add_check(checks, blockers, "html_svg_no_filler_labels_pass", html_renderer.get("filler_public_label_blocker_status") == "pass" and font_tournament.get("filler_public_label_blocker_status") == "pass", "SOURCE PHOTO, RECEIPT, and SOURCE FILE are hard-blocked")
        add_check(checks, blockers, "html_svg_no_bare_redactions_pass", html_renderer.get("bare_redaction_blocker_status") == "pass" and font_tournament.get("bare_redaction_blocker_status") == "pass", "bare redaction bars without surrounding words are hard-blocked")
        chrome_fontsource_ok = html_renderer.get("chrome_fontsource_renderer_status") == "pass" and int(html_renderer.get("open_license_font_count", 0) or 0) >= 12
        legacy_satori_ok = html_renderer.get("satori_resvg_sharp_renderer_status") == "pass" and int(html_renderer.get("satori_resvg_sharp_renderer_count", 0)) >= 5
        add_check(checks, blockers, "chrome_fontsource_or_legacy_satori_renderer_pass", chrome_fontsource_ok or legacy_satori_ok, f"chrome_fontsource={html_renderer.get('chrome_fontsource_renderer_status', 'missing')} fonts={html_renderer.get('open_license_font_count', 0)}; legacy_satori={html_renderer.get('satori_resvg_sharp_renderer_status', 'missing')} count={html_renderer.get('satori_resvg_sharp_renderer_count', 0)}")
        add_check(checks, blockers, "chrome_fontsource_ocr_readability_pass", html_renderer.get("mobile_typography_ocr_readability_status") == "pass", f"{html_renderer.get('mobile_typography_ocr_pass_count', 0)}/{html_renderer.get('mobile_typography_ocr_required_count', 0)} rendered OCR checks")
        add_check(checks, blockers, "multi_source_city_asset_crawler_pass", source_candidate.get("multi_source_city_asset_crawler_status") == "pass", display_path(source_candidate_md_report))
        add_check(checks, blockers, "source_provider_health_pass", source_provider_health.get("status") == "pass", f"attempts={source_provider_health.get('provider_attempt_count', 0)} selected_providers={source_provider_health.get('selected_provider_count', 0)} single_source={source_provider_health.get('single_source_dependency', 'missing')}")
        add_check(checks, blockers, "source_candidate_count_pass", source_candidate.get("minimum_candidate_count_per_topic", 0) >= 30, f"minimum={source_candidate.get('minimum_candidate_count_per_topic', 0)} candidates/topic")
        add_check(checks, blockers, "top_source_candidate_ranker_pass", source_candidate.get("minimum_top_ranked_candidate_count", 0) >= 8, f"minimum top-ranked={source_candidate.get('minimum_top_ranked_candidate_count', 0)}")
        add_check(checks, blockers, "proof_object_dominance_gate_pass", source_candidate.get("proof_object_dominance_gate_status") == "pass", "dominant proof object required for each thumbnail hook")
        add_check(checks, blockers, "premium_font_pack_v3_pass", source_candidate.get("premium_display_font_pack_v3_status") == "pass", f"{len(source_candidate.get('premium_display_font_pack_v3_families', []))} V3 display fonts")
        add_check(checks, blockers, "thumbnail_20_variant_tournament_pass", source_candidate.get("thumbnail_tournament_20_status") == "pass" and int(source_candidate.get("thumbnail_tournament_variant_count", 0) or 0) >= 20, f"{source_candidate.get('thumbnail_tournament_variant_count', 0)} variants")
        add_check(checks, blockers, "top3_owner_selector_pass", source_candidate.get("top3_owner_review_selector_status") == "pass" and int(source_candidate.get("top3_owner_review_count", 0) or 0) == 3, f"{source_candidate.get('top3_owner_review_count', 0)} selected")
        add_check(checks, blockers, "render_visual_integrity_pass", html_renderer.get("render_visual_integrity_status") == "pass", f"{html_renderer.get('render_visual_integrity_pass_count', 0)}/{html_renderer.get('render_visual_integrity_required_count', 0)} thumbnails passed nonblank/full-frame visual integrity")
        add_check(checks, blockers, "source_role_integrity_pass", html_renderer.get("source_role_integrity_status") == "pass", f"{html_renderer.get('source_role_integrity_pass_count', 0)}/{html_renderer.get('source_role_integrity_required_count', 0)} primary sources are approved source-packet media")
        add_check(checks, blockers, "topic_source_match_pass", html_renderer.get("topic_source_match_status") == "pass", f"{html_renderer.get('topic_source_match_pass_count', 0)}/{html_renderer.get('topic_source_match_required_count', 0)} thumbnails matched topic-required source tags")
        add_check(checks, blockers, "better_photo_tournament_pass", html_renderer.get("better_photo_tournament_status") == "pass", f"{html_renderer.get('better_photo_tournament_pass_count', 0)}/{html_renderer.get('better_photo_tournament_required_count', 0)} selected sources ranked top 3")
        add_check(checks, blockers, "first_30_second_payoff_pass", html_renderer.get("first_30_second_payoff_status") == "pass", "thumbnail/title promise must be paid off in launch metadata or first-30-second proxy")
        add_check(checks, blockers, "chat_delivery_artifacts_pass", html_renderer.get("chat_delivery_artifacts_status") == "pass", f"{html_renderer.get('chat_delivery_artifact_count', 0)}/{html_renderer.get('chat_delivery_required_artifact_count', 0)} immutable chat-delivery artifacts; run={html_renderer.get('chat_delivery_run_id', 'missing')}")
        add_check(checks, blockers, "chat_delivery_surface_pass", html_renderer.get("chat_delivery_surface_status") == "pass" and html_renderer.get("chat_delivery_preview_format") == "jpeg_rgb_1280x720" and int(html_renderer.get("chat_delivery_lower_half_pass_count", 0) or 0) == int(html_renderer.get("chat_delivery_required_lower_half_pass_count", 0) or 0) and html_renderer.get("chat_delivery_contact_sheet_status") == "pass", f"{html_renderer.get('chat_delivery_lower_half_pass_count', 0)}/{html_renderer.get('chat_delivery_required_lower_half_pass_count', 0)} owner-visible previews passed lower-half checks; format={html_renderer.get('chat_delivery_preview_format', 'missing')}; contact={html_renderer.get('chat_delivery_contact_sheet_layout', 'missing')}")
        add_check(checks, blockers, "penpot_fallback_contract_pass", penpot_fallback.get("template_slot_schema_status") == "pass" and penpot_fallback.get("penpot_fallback_status") in {"ready_for_local_self_host_smoke", "pass"}, display_path(penpot_fallback_md_report))
        add_check(checks, blockers, "penpot_slot_fill_smoke_pass", penpot_slot_fill.get("penpot_slot_fill_status") == "pass" and penpot_slot_fill.get("chat_safe_preview_status") == "pass", display_path(penpot_slot_fill_md_report))
        add_check(checks, blockers, "renderer_decision_gate_pass", renderer_decision.get("renderer_decision_gate_status") == "pass", display_path(renderer_decision_md_report))
        add_check(checks, blockers, "photopea_rescue_contract_pass", photopea_rescue.get("photopea_rescue_status") == "pass_manual_rescue_contract_only", display_path(photopea_rescue_md_report))
        add_check(checks, blockers, "click_desire_redteam_pass", html_renderer.get("click_desire_redteam_status") == "pass", "local click-desire red-team must pass")
        add_check(checks, blockers, "watch_time_ab_packet_pass", html_renderer.get("watch_time_ab_packet_status") == "pass", "3-variant watch-time A/B readiness packet must pass locally")
        add_check(checks, blockers, "thumbnail_public_mutation_not_performed", font_tournament.get("public_youtube_mutation") == "not_performed" and html_renderer.get("public_youtube_mutation") == "not_performed", "no YouTube upload, replacement, publish, or other mutation")
        add_check(checks, blockers, "canva_template_registry_contract_pass", canva_registry.get("registry_status") == "pass", display_path(canva_registry_md_report))
        add_check(checks, blockers, "canva_template_slot_schema_pass", canva_registry.get("slot_schema_status") == "pass", "required CITY, MAIN_HOOK, SUPPORT_LINE, and PRIMARY_PHOTO slots are declared")
        add_check(checks, blockers, "canva_font_preservation_gate_pass", canva_registry.get("font_preservation_gate_status") == "pass", "Canva fonts must be preserved by templates, not runtime font-family edits")
        add_check(checks, blockers, "canva_render_plan_pass", canva_render_plan.get("render_plan_status") == "pass", display_path(canva_render_plan_md_report))
        add_check(checks, blockers, "canva_render_plan_count_pass", canva_render_plan.get("edit_plan_count") == 3, f"{canva_render_plan.get('edit_plan_count', 0)} Canva edit plans")
        add_check(checks, blockers, "canva_thumbnail_qa_integration_pass", canva_render_plan.get("canva_thumbnail_qa_integration_status") == "pass", "Canva template plans must pass city/text/source/filler/random-element QA")
        add_check(checks, blockers, "canva_negative_fixtures_pass", canva_render_plan.get("negative_tests", {}).get("status") == "pass", "template ID, topic mismatch, word count, missing city, filler label, bare redaction, random element, and unapproved-template negatives must fail closed")
        add_check(checks, blockers, "canva_vs_local_renderer_tournament_pass", canva_render_plan.get("canva_vs_local_renderer_tournament_status") == "pass", f"Canva candidates={canva_render_plan.get('canva_candidate_reference_count', 0)}, local renderer={canva_render_plan.get('local_renderer_status', 'missing')}")
        add_check(checks, blockers, "canva_preview_capture_pass", str(canva_render_plan.get("preview_capture_status", "")).startswith("pass"), canva_render_plan.get("preview_capture_status", "missing"))
        add_check(checks, blockers, "canva_public_text_budget_pass", canva_render_plan.get("public_text_budget_status") == "pass", f"max non-city words={canva_render_plan.get('max_non_city_public_words', 'missing')}")
        add_check(checks, blockers, "canva_automated_city_run_smoke_pass", canva_render_plan.get("fully_automated_city_run_smoke_status") == "pass", "Miami fixture must create three deterministic Canva edit plans")
        add_check(checks, blockers, "canva_live_mutation_approved_bounded_pass", canva_render_plan.get("canva_live_mutation") in {"not_performed", "approved_bounded_template_validation"}, canva_render_plan.get("canva_live_mutation", "missing"))
        add_check(checks, blockers, "canva_no_paid_or_pro_assets_pass", canva_render_plan.get("paid_or_pro_assets") == "not_used" and canva_registry.get("paid_or_pro_assets") == "not_used", "No paid/pro assets are authorized")
        add_check(checks, blockers, "canva_no_ai_policy_pass", canva_no_ai.get("canva_no_ai_production_mode_status") == "pass", display_path(canva_no_ai_md_report))
        add_check(checks, blockers, "canva_no_ai_render_plan_pass", canva_no_ai.get("canva_no_ai_render_plan_status") == "pass" and canva_no_ai.get("edit_plan_count") == 3, f"{canva_no_ai.get('edit_plan_count', 0)} no-AI edit plans")
        add_check(checks, blockers, "canva_no_ai_operation_allowlist_pass", canva_no_ai.get("canva_operation_allowlist_status") == "pass", "only replace text, update fills, format text, and update title are allowed")
        add_check(checks, blockers, "canva_no_ai_font_preservation_v2_pass", canva_no_ai.get("canva_template_font_preservation_audit_v2_status") == "pass", "fonts must be preserved by approved Canva templates")
        add_check(checks, blockers, "canva_no_ai_no_generation_pass", canva_no_ai.get("canva_ai_generation_status") == "not_used" and canva_no_ai.get("magic_layers_image_to_design_status") == "not_used" and canva_no_ai.get("generate_design_status") == "not_used", "Canva AI generation, Magic Layers, and generate-design are blocked for production")
        add_check(checks, blockers, "external_font_registry_pass", external_font_registry.get("external_font_registry_status") == "pass" and int(external_font_registry.get("foundry_count", 0)) >= 5, f"{external_font_registry.get('foundry_count', 0)} external foundries registered")
        add_check(checks, blockers, "external_font_license_gate_pass", font_license_gate.get("external_font_license_gate_status") == "pass" and font_license_gate.get("bundled_font_license_gate_status") == "pass", f"bundled={font_license_gate.get('bundled_font_pass_count', 0)}/{font_license_gate.get('bundled_font_count', 0)}")
        add_check(checks, blockers, "better_font_candidate_contract_pass", font_license_gate.get("better_font_candidate_tournament_contract_status") == "pass", "external fonts are registry/license-gated before download or tournament use")
        add_check(checks, blockers, "canva_vs_local_typography_winner_gate_v2_pass", font_license_gate.get("canva_similarity_scoring_contract_status") == "pass" and canva_no_ai.get("ready_for_live_canva_no_ai_validation_after_approval") is True, "Canva remains primary; local remains fallback unless Canva is unavailable")
        add_check(checks, blockers, "font_click_desire_redteam_contract_pass", font_license_gate.get("click_desire_font_redteam_contract_status") == "pass", "generic, low-energy, unreadable, and non-thumbnail-loud fonts are blocked")
        add_check(checks, blockers, "canva_template_execution_ready_after_approval", canva_render_plan.get("canva_template_execution_status") == "ready_for_canva_execution", canva_render_plan.get("canva_template_execution_status", "missing"))
        add_check(checks, blockers, "canva_primary_free_fallback_policy_pass", canva_render_plan.get("canva_primary_renderer") is True and canva_render_plan.get("approved_free_fallback_allowed") is True, "Canva must be primary; approved free fallback must be allowed when Canva is blocked")
        add_check(checks, blockers, "approved_renderer_coverage_pass", canva_render_plan.get("approved_renderer_coverage_status") == "pass", f"renderer={canva_render_plan.get('selected_renderer', 'missing')}; coverage={canva_render_plan.get('approved_renderer_coverage_count', 0)}/{canva_render_plan.get('approved_renderer_required_count', 0)}; canva_blockers={','.join(canva_render_plan.get('canva_blockers', [])) or 'none'}")
        add_check(checks, blockers, "canva_source_bridge_report_pass", canva_render_plan.get("canva_source_bridge_status") == "pass", canva_render_plan.get("canva_source_bridge_status", "missing"))
        add_check(checks, blockers, "canva_source_url_normalization_matrix_pass", canva_render_plan.get("canva_source_url_normalization_matrix_status") == "pass", canva_render_plan.get("canva_source_url_normalization_matrix_status", "missing"))
        add_check(checks, blockers, "canva_source_upload_fallback_ladder_pass", canva_render_plan.get("canva_source_upload_fallback_ladder_status") == "pass", canva_render_plan.get("canva_source_upload_fallback_ladder_status", "missing"))
        add_check(checks, blockers, "canva_source_backed_base_composite_bridge_pass", canva_render_plan.get("canva_source_backed_base_composite_bridge_status") == "pass", f"{canva_render_plan.get('canva_source_bridge_base_composite_count', 0)}/{canva_render_plan.get('canva_source_bridge_required_base_composite_count', 0)} base composites")
        add_check(checks, blockers, "canva_visual_source_presence_audit_pass", canva_render_plan.get("canva_visual_source_presence_audit_status") == "pass", canva_render_plan.get("canva_visual_source_presence_audit_status", "missing"))
        add_check(checks, blockers, "canva_draft_or_approved_renderer_readiness_pass", canva_render_plan.get("canva_draft_readiness_status") == "pass" or canva_render_plan.get("approved_renderer_coverage_status") == "pass", f"draft={canva_render_plan.get('canva_draft_readiness_status', 'missing')}; renderer={canva_render_plan.get('approved_renderer_coverage_status', 'missing')}")
        if canva_render_plan.get("canva_production_readiness_status") == "pass":
            add_check(checks, blockers, "canva_source_photo_upload_fill_pass", canva_render_plan.get("canva_source_photo_upload_status") == "pass" and canva_render_plan.get("canva_source_photo_fill_status") == "pass", f"upload={canva_render_plan.get('canva_source_photo_upload_status', 'missing')}; fill={canva_render_plan.get('canva_source_photo_fill_status', 'missing')}")
            add_check(checks, blockers, "canva_export_local_file_bridge_pass", str(canva_render_plan.get("export_local_file_bridge_status", "")).startswith("pass"), canva_render_plan.get("export_local_file_bridge_status", "missing"))
        elif canva_render_plan.get("selected_renderer") == "openclaw_local_renderer":
            add_check(checks, blockers, "free_fallback_renderer_pass", canva_render_plan.get("free_fallback_renderer_status") == "pass", f"{canva_render_plan.get('free_fallback_candidate_count', 0)}/{canva_render_plan.get('free_fallback_required_candidate_count', 0)} fallback candidates")
            add_check(checks, blockers, "renderer_provenance_pass", canva_render_plan.get("renderer_provenance_status") == "pass", canva_render_plan.get("selected_renderer", "missing"))
        else:
            warnings.append(f"canva_production_source_fill_blocked:{canva_render_plan.get('canva_source_bridge_production_blocker', 'missing')}")
        if reference_library.get("status") == "blocked_missing_owner_reference_images":
            warnings.append("reference_match_score_blocked_missing_owner_reference_images")
        if reference_anatomy.get("status") == "blocked_missing_owner_reference_images":
            warnings.append("reference_anatomy_blocked_missing_owner_reference_images")
        if shelf_strip.get("reference_comparison_status") == "blocked_missing_owner_reference_images":
            warnings.append("mobile_shelf_reference_comparison_blocked_missing_owner_reference_images")
        later_stage = later_stage_blockers(root, video_id)
        payload = {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "pass" if not blockers else "blocked",
            "checks": checks,
            "blockers": blockers,
            "warnings": warnings,
            "real_city_thumbnail_test": True,
            "photo_backed_thumbnail_test": True,
            "later_stage_blockers_not_milestone_6_failures": later_stage,
            "reports": {
                "thumbnail_summary": display_path(root / "approval" / "miami-photo-backed-thumbnail-report.json"),
                "thumbnail_click_quality": display_path(root / "approval" / "thumbnail-click-quality-report.json"),
                "thumbnail_font_quality": display_path(font_quality_json_report),
                "thumbnail_font_quality_md": display_path(font_quality_md_report),
                "thumbnail_typography_research": display_path(root / "approval" / "thumbnail-market-typography-research-report.json"),
                "thumbnail_reference_library": display_path(reference_library_json_report),
                "thumbnail_reference_anatomy": display_path(reference_anatomy_json_report),
                "thumbnail_pop_score": display_path(pop_score_json_report),
                "thumbnail_poster_depth": display_path(poster_depth_json_report),
                "thumbnail_mobile_shelf_strip": display_path(shelf_strip_json_report),
                "thumbnail_owner_rating_v3": display_path(owner_rating_v3_json_report),
                "title_thumbnail_pair_packet": display_path(title_pair_json_report),
                "thumbnail_font_tournament": display_path(font_tournament_json_report),
                "html_thumbnail_renderer": display_path(html_renderer_json_report),
                "source_candidate_tournament": display_path(source_candidate_json_report),
                "penpot_fallback": display_path(penpot_fallback_json_report),
                "penpot_slot_fill": display_path(penpot_slot_fill_json_report),
                "renderer_decision_gate": display_path(renderer_decision_json_report),
                "photopea_rescue": display_path(photopea_rescue_json_report),
                "canva_template_registry": display_path(canva_registry_json_report),
                "canva_render_plan": display_path(canva_render_plan_json_report),
                "canva_no_ai_render_plan": display_path(canva_no_ai_json_report),
                "external_font_registry": display_path(external_font_registry_json_report),
                "font_license_gate": display_path(font_license_gate_json_report),
            "voice_visual_match": display_path(voice_visual_match_json_report),
            "finished_video_watchdown": display_path(finished_watchdown_json_report),
            "episode_standard": display_path(episode_standard_json_report),
            "episode_standard_md": display_path(episode_standard_md_report),
            "transcript_viral_quality": display_path(transcript_viral_json_report),
            "transcript_viral_quality_md": display_path(transcript_viral_md_report),
            "comment_quality": display_path(comment_quality_json_report),
            "comment_quality_md": display_path(comment_quality_md_report),
            "transcript_watchtime_score": display_path(transcript_watchtime_json_report),
            "transcript_watchtime_score_md": display_path(transcript_watchtime_md_report),
            "source_candidate_tournament": display_path(source_candidate_json_report),
                "source_rights": display_path(source_rights_md_report),
                "source_rights_json": display_path(source_rights_json_report),
            },
            "stale_hits": stale_hits,
        }
        _json_report, md_report = write_quality_gates_payload(approval, payload)
        return payload, _json_report, md_report

    add_check(checks, blockers, "active_video_is_city_file", video_id in {"03", "04"} or real_city_test, f"video_id={video_id}; real_city_thumbnail_test={real_city_test}")
    if real_city_test:
        add_check(checks, blockers, "source_provider_health_pass", source_provider_health.get("status") == "pass", f"attempts={source_provider_health.get('provider_attempt_count', 0)} selected_providers={source_provider_health.get('selected_provider_count', 0)} single_source={source_provider_health.get('single_source_dependency', 'missing')}")
        add_check(checks, blockers, "html_svg_renderer_pass", html_renderer.get("html_renderer_status") == "pass", display_path(html_renderer_md_report))
        add_check(checks, blockers, "topic_source_match_pass", html_renderer.get("topic_source_match_status") == "pass", f"{html_renderer.get('topic_source_match_pass_count', 0)}/{html_renderer.get('topic_source_match_required_count', 0)} thumbnails matched topic-required source tags")
        add_check(checks, blockers, "better_photo_tournament_pass", html_renderer.get("better_photo_tournament_status") == "pass", f"{html_renderer.get('better_photo_tournament_pass_count', 0)}/{html_renderer.get('better_photo_tournament_required_count', 0)} selected sources ranked top 3")
        add_check(checks, blockers, "first_30_second_payoff_pass", html_renderer.get("first_30_second_payoff_status") == "pass", "thumbnail/title promise must be paid off in launch metadata or first-30-second proxy")
        add_check(checks, blockers, "chat_delivery_surface_pass", html_renderer.get("chat_delivery_surface_status") == "pass" and html_renderer.get("chat_delivery_preview_format") == "jpeg_rgb_1280x720" and int(html_renderer.get("chat_delivery_lower_half_pass_count", 0) or 0) == int(html_renderer.get("chat_delivery_required_lower_half_pass_count", 0) or 0), f"{html_renderer.get('chat_delivery_lower_half_pass_count', 0)}/{html_renderer.get('chat_delivery_required_lower_half_pass_count', 0)} owner-visible previews passed lower-half checks; format={html_renderer.get('chat_delivery_preview_format', 'missing')}")
        add_check(checks, blockers, "penpot_slot_fill_smoke_pass", penpot_slot_fill.get("penpot_slot_fill_status") == "pass" and penpot_slot_fill.get("chat_safe_preview_status") == "pass", display_path(penpot_slot_fill_md_report))
        add_check(checks, blockers, "renderer_decision_gate_pass", renderer_decision.get("renderer_decision_gate_status") == "pass", display_path(renderer_decision_md_report))
        add_check(checks, blockers, "title_thumbnail_pair_packet_pass", title_pair.get("title_thumbnail_pair_packet_status") == "pass", display_path(title_pair_md_report))
        add_check(checks, blockers, "source_candidate_tournament_pass", source_candidate.get("status") == "pass", display_path(source_candidate_md_report))
        payload = {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "pass" if not blockers else "blocked",
            "checks": checks,
            "blockers": blockers,
            "warnings": warnings,
            "real_city_thumbnail_test": True,
            "photo_backed_thumbnail_test": False,
            "later_stage_blockers_not_milestone_6_failures": [],
            "reports": {
                "real_city_source_assets": display_path(root / "approval" / "real-city-source-asset-report.json"),
                "source_provider_health": display_path(source_provider_health_json_report),
                "thumbnail_font_quality": display_path(font_quality_json_report),
                "thumbnail_font_quality_md": display_path(font_quality_md_report),
                "title_thumbnail_pair_packet": display_path(title_pair_json_report),
                "html_thumbnail_renderer": display_path(html_renderer_json_report),
                "source_candidate_tournament": display_path(source_candidate_json_report),
                "penpot_slot_fill": display_path(penpot_slot_fill_json_report),
                "renderer_decision_gate": display_path(renderer_decision_json_report),
                "source_rights": display_path(source_rights_md_report),
                "source_rights_json": display_path(source_rights_json_report),
                "episode_standard": display_path(episode_standard_json_report),
                "episode_standard_md": display_path(episode_standard_md_report),
            "transcript_viral_quality": display_path(transcript_viral_json_report),
            "transcript_viral_quality_md": display_path(transcript_viral_md_report),
            "comment_quality": display_path(comment_quality_json_report),
            "comment_quality_md": display_path(comment_quality_md_report),
            "transcript_watchtime_score": display_path(transcript_watchtime_json_report),
            "transcript_watchtime_score_md": display_path(transcript_watchtime_md_report),
                "transcript_viral_quality": display_path(transcript_viral_json_report),
                "transcript_viral_quality_md": display_path(transcript_viral_md_report),
                "comment_quality": display_path(comment_quality_json_report),
                "comment_quality_md": display_path(comment_quality_md_report),
                "transcript_watchtime_score": display_path(transcript_watchtime_json_report),
                "transcript_watchtime_score_md": display_path(transcript_watchtime_md_report),
            },
            "stale_hits": stale_hits,
        }
        _json_report, md_report = write_quality_gates_payload(approval, payload)
        return payload, _json_report, md_report
    add_check(checks, blockers, "content_quality_pass", content.get("status") == "pass" or real_city_test, display_path(content_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "first5_hook_pass", first5.get("status") == "pass" or real_city_test, display_path(first5_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "long_form_quality_pass", long_form.get("status") == "pass" or real_city_test, display_path(long_form_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "thumbnail_quality_pass", thumbnail.get("status") == "pass", display_path(thumbnail_report))
    add_check(
        checks,
        blockers,
        "thumbnail_factory_pass",
        thumbnail.get("thumbnail_factory_status") == "pass",
        thumbnail.get("thumbnail_factory_report", "thumbnail factory report missing"),
    )
    add_check(
        checks,
        blockers,
        "thumbnail_city_name_dominance_pass",
        thumbnail.get("city_name_dominance_status") == "pass",
        "city name dominance must pass for all five thumbnail concepts",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_search_shelf_pass",
        thumbnail.get("search_shelf_test_status") == "pass",
        thumbnail.get("thumbnail_search_shelf_test", "thumbnail search shelf test missing"),
    )
    add_check(
        checks,
        blockers,
        "thumbnail_free_first_workflow_pass",
        thumbnail.get("free_toolchain_status") == "pass",
        "free-first thumbnail workflow must pass without paid tools or paid assets",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_city_agnostic_pass",
        thumbnail.get("city_agnostic_status") == "pass",
        "thumbnail workflow must resolve the active city and use city-agnostic templates",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_ai_support_policy_pass",
        thumbnail.get("ai_support_asset_policy_status") == "pass"
        and thumbnail.get("internet_reference_non_derivative_status") == "pass",
        "AI support assets must be non-proof and unlicensed references must not be cloned or traced",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_owner_feedback_learning_pass",
        thumbnail.get("owner_feedback_learning_status") == "pass",
        "owner feedback failure patterns must feed the next thumbnail render gate",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_owner_rating_v2_pass",
        thumbnail.get("owner_rating_learning_v2_status") == "pass"
        and thumbnail.get("preferred_baseline_style") == "current_owner_preferred",
        "latest owner ratings must prefer the current baseline and block the newest rejected patterns",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_owner_feedback_v4_semantics_pass",
        thumbnail.get("redrawn_map_semantic_match_status") == "pass"
        and thumbnail.get("underground_semantic_asset_status") == "pass"
        and thumbnail.get("whole_word_redaction_status") == "pass"
        and thumbnail.get("partial_word_redaction_count") == 0
        and thumbnail.get("low_value_public_word_count") == 0
        and thumbnail.get("curiosity_hook_prominence_status") == "pass"
        and thumbnail.get("lost_streets_semantic_asset_status") == "pass"
        and thumbnail.get("rail_image_used_for_lost_streets") is False
        and thumbnail.get("then_now_split_integrity_status") == "pass"
        and thumbnail.get("then_now_median_crossing_count") == 0
        and thumbnail.get("now_modern_skyline_status") == "pass",
        "latest owner feedback requires map/redrawn, underground support, whole-word redactions, relevant lost-streets imagery, and strict then/now split",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_ai_support_asset_manifest_pass",
        thumbnail.get("ai_support_asset_manifest_status") == "pass" and thumbnail.get("ai_fake_proof_count") == 0,
        "AI support assets must be ledgered as non-proof and fake proof must stay blocked",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_current_style_renderer_v4_pass",
        thumbnail.get("current_style_renderer_v4_status") == "pass",
        "current-style renderer V4 must pass before owner review",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_visible_source_audit_pass",
        thumbnail.get("visible_source_audit_status") == "pass"
        and thumbnail.get("visible_real_photo_count") == 5
        and thumbnail.get("photo_hero_or_major_inset_count") == 5
        and thumbnail.get("map_only_concept_count") == 0
        and thumbnail.get("unmanifested_visible_source_count") == 0,
        "all five thumbnail concepts must visibly render a manifest-backed real city photo as a hero/major inset and no map-only concepts are allowed",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_real_city_source_first_examples_pass",
        thumbnail.get("real_city_source_first_examples_status") == "pass"
        and thumbnail.get("official_city_example_mode") == "source_backed_ready"
        and thumbnail.get("ad_hoc_mockup_blocked") is True
        and thumbnail.get("visible_real_photo_count") == 5
        and thumbnail.get("photo_hero_or_major_inset_count") == 5
        and thumbnail.get("map_only_concept_count") == 0
        and thumbnail.get("unmanifested_visible_source_count") == 0,
        "official city examples must come from the source packet, rights ledger, and visible-source audit; ad-hoc mockups are blocked",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_execution_quality_upgrade_pass",
        thumbnail.get("every_word_intent_gate_status") == "pass"
        and thumbnail.get("spelling_ocr_verification_status") == "pass"
        and thumbnail.get("cutoff_text_detection_status") == "pass"
        and thumbnail.get("brightness_subject_visibility_status") == "pass"
        and thumbnail.get("no_image_distortion_status") == "pass"
        and thumbnail.get("layout_safe_zone_status") == "pass"
        and thumbnail.get("concept_specific_art_direction_status") == "pass"
        and thumbnail.get("creative_variation_memory_status") == "pass"
        and thumbnail.get("per_thumbnail_critique_status") == "pass",
        "thumbnail execution-quality gates must catch meaningless words, spelling/cutoff errors, darkness, distortion, unsafe zones, weak style realism, repeated layouts, and missing critiques",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_10x_art_direction_path_pass",
        thumbnail.get("ten_out_of_ten_art_direction_path_status") == "pass",
        "10/10 thumbnail path must specify renderer, image-generator upgrade, and human/performance acceptance boundary",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_mobile_ocr_readability_pass",
        thumbnail.get("mobile_ocr_readability_status") == "pass",
        "mobile OCR readability must pass",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_font_quality_pass",
        font_quality.get("status") == "pass"
        and font_quality.get("impact_fallback_used") is False
        and font_quality.get("shelf_readability_status") == "pass",
        display_path(font_quality_md_report),
    )
    add_check(
        checks,
        blockers,
        "thumbnail_benchmark_similarity_pass",
        thumbnail.get("benchmark_similarity_status") == "pass",
        "benchmark similarity scoring must pass",
    )
    add_check(
        checks,
        blockers,
        "thumbnail_manual_handoff_pass",
        thumbnail.get("manual_handoff_status") == "pass",
        "Photopea/GIMP manual handoff must pass",
    )
    add_check(checks, blockers, "source_rights_pass", source_rights.get("status") == "pass", display_path(source_rights_md_report))
    add_check(
        checks,
        blockers,
        "synthetic_disclosure_pass",
        synthetic.get("status") == "pass" or real_city_test,
        display_path(synthetic_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test",
    )
    add_check(checks, blockers, "visual_variety_pass", visual_variety.get("status") == "pass" or real_city_test, display_path(visual_variety_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "motion_polish_pass", motion_polish.get("status") == "pass" or real_city_test, display_path(motion_polish_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(
        checks,
        blockers,
        "benchmark_growth_pass",
        benchmark_growth.get("status") == "pass" or real_city_test,
        display_path(benchmark_growth_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test",
    )
    add_check(checks, blockers, "shorts_script_package_pass", shorts_script_package.get("status") == "pass" or real_city_test, display_path(shorts_script_package_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(
        checks,
        blockers,
        "guru_growth_pass",
        guru_growth.get("status") == "pass" or real_city_test,
        display_path(guru_growth_md_report) if not real_city_test else "not applicable for real-city thumbnail-only test",
    )
    add_check(checks, blockers, "script_city_outro", identity["has_city_outro"] or real_city_test, identity["script"] if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "script_source_proof", identity["has_source_proof"] or real_city_test, identity["script"] if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "script_subscribe_cta", identity["has_subscribe_cta"] or real_city_test, identity["script"] if not real_city_test else "not applicable for real-city thumbnail-only test")
    add_check(checks, blockers, "no_stale_active_framing", not stale_hits, f"{len(stale_hits)} stale hits")
    add_check(checks, blockers, "canva_brief_exists", canva["exists"], "Canva thumbnail brief is present")
    add_check(checks, blockers, "canva_sequence_ok", canva["sequence_ok"], canva["canonical_sequence"] or "missing")
    add_check(checks, blockers, "canva_role_boundary", canva["role_boundary_ok"], "Canva remains renderer only")
    add_check(checks, blockers, "canva_three_candidates", canva["candidate_count"] == 3, f"{canva['candidate_count']} candidates")
    add_check(checks, blockers, "canva_no_ai_policy_pass", canva_no_ai.get("canva_no_ai_production_mode_status") == "pass", display_path(canva_no_ai_md_report))
    add_check(checks, blockers, "canva_no_ai_render_plan_pass", canva_no_ai.get("canva_no_ai_render_plan_status") == "pass" and canva_no_ai.get("edit_plan_count") == 3, f"{canva_no_ai.get('edit_plan_count', 0)} no-AI edit plans")
    add_check(checks, blockers, "canva_no_ai_operation_allowlist_pass", canva_no_ai.get("canva_operation_allowlist_status") == "pass", "only replace text, update fills, format text, and update title are allowed")
    add_check(checks, blockers, "canva_no_ai_font_preservation_v2_pass", canva_no_ai.get("canva_template_font_preservation_audit_v2_status") == "pass", "fonts must be preserved by approved Canva templates")
    add_check(checks, blockers, "canva_no_ai_no_generation_pass", canva_no_ai.get("canva_ai_generation_status") == "not_used" and canva_no_ai.get("magic_layers_image_to_design_status") == "not_used" and canva_no_ai.get("generate_design_status") == "not_used", "Canva AI generation, Magic Layers, and generate-design are blocked for production")
    add_check(checks, blockers, "external_font_registry_pass", external_font_registry.get("external_font_registry_status") == "pass" and int(external_font_registry.get("foundry_count", 0)) >= 5, f"{external_font_registry.get('foundry_count', 0)} external foundries registered")
    add_check(checks, blockers, "external_font_license_gate_pass", font_license_gate.get("external_font_license_gate_status") == "pass" and font_license_gate.get("bundled_font_license_gate_status") == "pass", f"bundled={font_license_gate.get('bundled_font_pass_count', 0)}/{font_license_gate.get('bundled_font_count', 0)}")
    add_check(checks, blockers, "better_font_candidate_contract_pass", font_license_gate.get("better_font_candidate_tournament_contract_status") == "pass", "external fonts are registry/license-gated before download or tournament use")
    add_check(checks, blockers, "canva_vs_local_typography_winner_gate_v2_pass", font_license_gate.get("canva_similarity_scoring_contract_status") == "pass" and canva_no_ai.get("ready_for_live_canva_no_ai_validation_after_approval") is True, "Canva remains primary; local remains fallback unless Canva is unavailable")
    add_check(checks, blockers, "font_click_desire_redteam_contract_pass", font_license_gate.get("click_desire_font_redteam_contract_status") == "pass", "generic, low-energy, unreadable, and non-thumbnail-loud fonts are blocked")
    add_check(checks, blockers, "canva_primary_free_fallback_policy_pass", canva_render_plan.get("canva_primary_renderer") is True and canva_render_plan.get("approved_free_fallback_allowed") is True, "Canva must be primary; approved free fallback must be allowed when Canva is blocked")
    add_check(checks, blockers, "approved_renderer_coverage_pass", canva_render_plan.get("approved_renderer_coverage_status") == "pass", f"renderer={canva_render_plan.get('selected_renderer', 'missing')}; coverage={canva_render_plan.get('approved_renderer_coverage_count', 0)}/{canva_render_plan.get('approved_renderer_required_count', 0)}; canva_blockers={','.join(canva_render_plan.get('canva_blockers', [])) or 'none'}")
    add_check(checks, blockers, "multi_source_city_asset_crawler_pass", source_candidate.get("multi_source_city_asset_crawler_status") == "pass", display_path(source_candidate_md_report))
    add_check(checks, blockers, "source_candidate_count_pass", source_candidate.get("minimum_candidate_count_per_topic", 0) >= 30, f"minimum={source_candidate.get('minimum_candidate_count_per_topic', 0)} candidates/topic")
    add_check(checks, blockers, "top_source_candidate_ranker_pass", source_candidate.get("minimum_top_ranked_candidate_count", 0) >= 8, f"minimum top-ranked={source_candidate.get('minimum_top_ranked_candidate_count', 0)}")
    add_check(checks, blockers, "proof_object_dominance_gate_pass", source_candidate.get("proof_object_dominance_gate_status") == "pass", "dominant proof object required for each thumbnail hook")
    add_check(checks, blockers, "premium_font_pack_v3_pass", source_candidate.get("premium_display_font_pack_v3_status") == "pass", f"{len(source_candidate.get('premium_display_font_pack_v3_families', []))} V3 display fonts")
    add_check(checks, blockers, "thumbnail_20_variant_tournament_pass", source_candidate.get("thumbnail_tournament_20_status") == "pass" and int(source_candidate.get("thumbnail_tournament_variant_count", 0) or 0) >= 20, f"{source_candidate.get('thumbnail_tournament_variant_count', 0)} variants")
    add_check(checks, blockers, "top3_owner_selector_pass", source_candidate.get("top3_owner_review_selector_status") == "pass" and int(source_candidate.get("top3_owner_review_count", 0) or 0) == 3, f"{source_candidate.get('top3_owner_review_count', 0)} selected")
    add_check(checks, blockers, "voice_visual_match_report_exists", voice_visual_match.get("voice_visual_match_status") in {"pass", "blocked"}, display_path(voice_visual_match_md_report))
    add_check(checks, blockers, "stock_context_not_proof_gate_recorded", voice_visual_match.get("first_20_seconds_source_proof_before_stock_status") in {"pass", "blocked"}, "stock cannot be used as source proof")
    if (root / "video" / f"pattern-lab-video-{video_id}-draft.mp4").exists():
        add_check(checks, blockers, "finished_video_watchdown_pass", finished_watchdown.get("finished_video_watchdown_status") == "pass", display_path(finished_watchdown_md_report))
    else:
        warnings.append("finished_video_watchdown_deferred_until_long_form_exists")

    for name, passed in owner.items():
        add_check(checks, blockers, name, passed, name.replace("_", " "))

    visual = long_form.get("visual_plan", {})
    add_check(
        checks,
        blockers,
        "visual_source_proof_before_context",
        visual.get("source_proof_before_context_only") is True or real_city_test,
        "source_proof role appears before context_only role" if not real_city_test else "not applicable for real-city thumbnail-only test",
    )
    add_check(
        checks,
        blockers,
        "visual_source_context_roles",
        visual.get("declared_source_context_roles") is True or real_city_test,
        "visual plan declares source/context role labels" if not real_city_test else "not applicable for real-city thumbnail-only test",
    )

    package_checks = thumbnail.get("package_checks", [])
    failed_package_checks = [check for check in package_checks if not check.get("passed")]
    add_check(
        checks,
        blockers,
        "thumbnail_click_policy_checks",
        not failed_package_checks and bool(package_checks),
        f"{len(package_checks) - len(failed_package_checks)}/{len(package_checks)} thumbnail package checks passed",
    )

    later_stage = later_stage_blockers(root, video_id)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "real_city_thumbnail_test": real_city_test,
        "later_stage_blockers_not_milestone_6_failures": later_stage,
        "reports": {
            "content": display_path(content_report),
            "first5_hook": display_path(first5_md_report),
            "long_form": display_path(long_form_report),
            "thumbnail": display_path(thumbnail_report),
            "thumbnail_font_quality": display_path(font_quality_md_report),
            "thumbnail_factory": thumbnail.get("thumbnail_factory_report", ""),
            "thumbnail_contact_sheet": thumbnail.get("thumbnail_contact_sheet", ""),
            "thumbnail_five_concept_contact_sheet": thumbnail.get("thumbnail_five_concept_contact_sheet", ""),
            "thumbnail_search_shelf_test": thumbnail.get("thumbnail_search_shelf_test", ""),
            "source_rights": display_path(source_rights_md_report),
            "source_rights_json": display_path(source_rights_json_report),
            "claim_visual_fidelity": display_path(claim_visual_fidelity_json_report) if claim_visual_fidelity_json_report else "not_applicable",
            "synthetic_disclosure": display_path(synthetic_md_report),
            "synthetic_disclosure_json": display_path(synthetic_json_report),
            "visual_variety": display_path(visual_variety_md_report),
            "visual_variety_json": display_path(visual_variety_json_report),
            "motion_polish": display_path(motion_polish_md_report),
            "motion_polish_json": display_path(motion_polish_json_report),
            "benchmark_growth": display_path(benchmark_growth_md_report),
            "benchmark_growth_json": display_path(benchmark_growth_json_report),
            "guru_growth": display_path(guru_growth_md_report),
            "guru_growth_json": display_path(guru_growth_json_report),
            "shorts_script_package": display_path(shorts_script_package_md_report),
            "shorts_script_package_json": display_path(shorts_script_package_json_report),
            "canva_no_ai_render_plan": display_path(canva_no_ai_json_report),
            "external_font_registry": display_path(external_font_registry_json_report),
            "font_license_gate": display_path(font_license_gate_json_report),
            "voice_visual_match": display_path(voice_visual_match_json_report),
            "finished_video_watchdown": display_path(finished_watchdown_json_report),
            "episode_standard": display_path(episode_standard_json_report),
            "episode_standard_md": display_path(episode_standard_md_report),
            "transcript_viral_quality": display_path(transcript_viral_json_report),
            "transcript_viral_quality_md": display_path(transcript_viral_md_report),
            "comment_quality": display_path(comment_quality_json_report),
            "comment_quality_md": display_path(comment_quality_md_report),
            "transcript_watchtime_score": display_path(transcript_watchtime_json_report),
            "transcript_watchtime_score_md": display_path(transcript_watchtime_md_report),
        },
        "stale_hits": stale_hits,
    }
    json_report = approval / "quality-gates-report.json"
    md_report = approval / "quality-gates-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Quality Gates: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Quality Gates",
        "",
    ]
    for check in checks:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Later-Stage Blockers Not Counted Against Milestone 6", ""])
    lines.extend([f"- {item['name']}: {item['detail']}" for item in later_stage] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Stale Active Framing Hits", ""])
    lines.extend([f"- {hit}" for hit in stale_hits] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Run aggregate Pattern Lab city-history quality gates.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_report, md_report = build_quality_gates_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Quality gates report: {display_path(md_report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
