#!/usr/bin/env python3
import argparse
import json
from datetime import datetime

from patternlab_common import display_path, ensure_dir, load_dotenv, output_root, utc_now


def read_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def latest_upload_time(upload_report, short_reports):
    times = []
    for report in [upload_report, *short_reports]:
        if not report:
            continue
        parsed = parse_time(report.get("uploaded_at") or report.get("generated_at"))
        if parsed:
            times.append(parsed)
    return max(times) if times else None


def main():
    parser = argparse.ArgumentParser(description="Check Pattern Lab public publish readiness.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    report = approval / "public-publish-readiness.md"
    upload_report = read_json(approval / "youtube-upload-report.json")
    short_reports = [read_json(approval / f"youtube-upload-report-short-{index:02d}.json") for index in [1, 2, 3]]
    public_approval = read_json(approval / "public-publish-approval.json")
    public_report = read_json(approval / "public-publish-report.json")
    upload_currency = read_json(approval / "upload-currency-report.json") or {}
    related_video_report = read_json(approval / "related-video-setup-report.json") or {}
    bridge_comments_report = read_json(approval / "bridge-comments-report.json") or {}
    live_verification = read_json(approval / "youtube-live-verification-report.json")
    first5_hook = read_json(approval / "first5-hook-report.json")
    motion_polish = read_json(approval / "motion-polish-report.json")
    visual_variety = read_json(approval / "visual-variety-report.json")
    benchmark_growth = read_json(approval / "benchmark-growth-report.json")
    guru_growth = read_json(approval / "guru-growth-report.json")
    synthetic_disclosure = read_json(approval / "synthetic-disclosure-report.json")
    thumbnail_factory = read_json(approval / "thumbnail-factory-report.json")
    thumbnail_quality = read_json(approval / "thumbnail-quality-report.json")
    shorts_plan = approval / "shorts-upload-plan.md"
    metadata = read_json(approval / "upload-metadata.json") or {}
    blockers = []
    latest_private_upload = latest_upload_time(upload_report, short_reports)
    public_approval_time = parse_time((public_approval or {}).get("created_at") or (public_approval or {}).get("generated_at"))

    if not upload_report or upload_report.get("status") != "uploaded":
        blockers.append("Private/unlisted YouTube upload report is missing.")
    elif upload_report.get("privacy") not in {"private", "unlisted"}:
        blockers.append("Upload report is not private or unlisted.")

    if upload_report and not upload_report.get("youtube_checks_result"):
        blockers.append("YouTube checks result has not been recorded.")
    if upload_currency.get("status") != "pass":
        blockers.append("Upload currency report is missing or not passing.")
    for index, short_report in enumerate(short_reports, start=1):
        if not short_report or short_report.get("status") != "uploaded":
            blockers.append(f"Private/unlisted Short {index} upload report is missing.")
        elif short_report.get("privacy") not in {"private", "unlisted"}:
            blockers.append(f"Short {index} upload report is not private or unlisted.")
    live_status = ((live_verification or {}).get("live_api_verification") or {}).get("status", "missing")
    if live_status != "verified":
        blockers.append("Live YouTube API verification is not verified.")
    first5_status = (first5_hook or {}).get("status", "missing")
    if first5_status != "pass":
        blockers.append("First-5 hook gate is not passing.")
    motion_status = (motion_polish or {}).get("status", "missing")
    if motion_status != "pass":
        blockers.append("Motion polish gate is not passing.")
    visual_variety_status = (visual_variety or {}).get("status", "missing")
    if visual_variety_status != "pass":
        blockers.append("Visual variety gate is not passing.")
    benchmark_growth_status = (benchmark_growth or {}).get("status", "missing")
    if benchmark_growth_status != "pass":
        blockers.append("Benchmark growth gate is not passing.")
    guru_growth_status = (guru_growth or {}).get("status", "missing")
    if guru_growth_status != "pass":
        blockers.append("Guru growth gate is not passing.")
    synthetic_disclosure_status = (synthetic_disclosure or {}).get("status", "missing")
    if synthetic_disclosure_status != "pass":
        blockers.append("Synthetic disclosure gate is not passing.")
    thumbnail_quality_status = (thumbnail_quality or {}).get("status", "missing")
    if thumbnail_quality_status != "pass":
        blockers.append("Thumbnail quality gate is not passing.")
    if (motion_polish or {}).get("local_rerender_requires_review_upload"):
        blockers.append("Motion-polished local render is newer than the private YouTube upload; replacement review/upload is required before public publish.")
    if not public_approval:
        blockers.append("Explicit owner approval for public publish is missing.")
    elif latest_private_upload and (not public_approval_time or public_approval_time < latest_private_upload):
        blockers.append("Fresh explicit owner approval for public publish is missing after the latest replacement private upload.")
    elif public_approval.get("youtube_live_verification_status") != "verified":
        blockers.append("Public publish approval was not recorded after verified live YouTube API evidence.")
    elif not public_approval.get("synthetic_disclosure_owner_attested"):
        blockers.append("Owner synthetic disclosure attestation is missing.")
    if not shorts_plan.exists():
        blockers.append("Shorts upload plan is missing.")
    else:
        shorts_plan_text = shorts_plan.read_text(encoding="utf-8")
        if "Related Video: long-form video" not in shorts_plan_text:
            blockers.append("Shorts upload plan does not require the long-form Related Video.")
        if shorts_plan_text.count("Related-video checklist:") < 3:
            blockers.append("Every Short must include a related-video checklist before public launch.")
    if len(metadata.get("shorts", [])) < 3:
        blockers.append("Upload metadata must include three Shorts before public launch.")
    for short in metadata.get("shorts", []):
        if not short.get("related_video_checklist"):
            blockers.append(f"Short {short.get('id', 'unknown')} is missing a related-video checklist.")

    # This is a pre-publication gate.  Post-publication evidence is checked by
    # publish_public_youtube.py and must not be required before the action.
    status = "public-publish-ready" if not blockers else "blocked-before-public-publish"
    related_video_plan_ready = shorts_plan.exists() and "Related-video checklist:" in shorts_plan.read_text(encoding="utf-8")
    related_video_ready = related_video_report.get("status") == "pass"
    bridge_comments_ready = bool(metadata.get("pinned_comment") or metadata.get("default_pinned_comment"))
    bridge_comments_posted = bridge_comments_report.get("status") == "pass"
    pinned_comments_ready = bridge_comments_report.get("status") == "pass"
    public_video_count = (
        len([item for item in public_report.get("published_videos", []) if item.get("privacy_after") == "public"])
        if public_report
        else 0
    )
    lines = [
        f"# Pattern Lab Public Publish Readiness: Video {args.video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        f"Status: {status}",
        "Automation: this readiness script never changes YouTube state",
        "",
        "## Required Evidence",
        "",
        f"- Private/unlisted upload report: {'present' if upload_report else 'missing'}",
        f"- YouTube URL: {upload_report.get('youtube_url', '') if upload_report else ''}",
        f"- Shorts upload reports: {sum(1 for item in short_reports if item and item.get('status') == 'uploaded')}/3",
        f"- YouTube checks result: {upload_report.get('youtube_checks_result', '') if upload_report else ''}",
        f"- Upload currency report: {upload_currency.get('status', 'missing')}",
        f"- Upload currency warnings: {len(upload_currency.get('warnings', []))}",
        f"- Live YouTube API verification: {live_status}",
        f"- First-5 hook gate: {first5_status}",
        f"- Motion polish gate: {motion_status}",
        f"- Visual variety gate: {visual_variety_status}",
        f"- Benchmark growth gate: {benchmark_growth_status}",
        f"- Benchmark series family: {(benchmark_growth or {}).get('series_family', '')}",
        f"- Guru growth gate: {guru_growth_status}",
        f"- Guru growth milestones passing: {sum(1 for item in (guru_growth or {}).get('milestones', []) if item.get('status') == 'pass')}/{len((guru_growth or {}).get('milestones', []))}",
        f"- Synthetic disclosure gate: {synthetic_disclosure_status}",
        f"- Synthetic disclosure decision present: {(synthetic_disclosure or {}).get('synthetic_disclosure_decision_present', False)}",
        f"- Thumbnail quality gate: {thumbnail_quality_status}",
        f"- Active city: {(thumbnail_factory or {}).get('active_city', 'missing')}",
        f"- City-agnostic templates: {(thumbnail_factory or {}).get('city_agnostic_status', 'missing')}",
        f"- Current thumbnail renderer: {(thumbnail_factory or {}).get('current_thumbnail_renderer', 'missing')}",
        f"- Current image generator: {(thumbnail_factory or {}).get('current_image_generator', 'missing')}",
        f"- Recommended free AI support generator: {(thumbnail_factory or {}).get('recommended_free_ai_support_generator', 'missing')}",
        f"- Recommended premium AI support generator: {(thumbnail_factory or {}).get('recommended_premium_ai_support_generator', 'missing')}",
        f"- AI support asset policy: {(thumbnail_factory or {}).get('ai_support_asset_policy_status', 'missing')}",
        f"- Internet reference non-derivative gate: {(thumbnail_factory or {}).get('internet_reference_non_derivative_status', 'missing')}",
        f"- Owner feedback learning: {(thumbnail_factory or {}).get('owner_feedback_learning_status', 'missing')}",
        f"- Owner rating preference V2: {(thumbnail_factory or {}).get('owner_rating_learning_v2_status', 'missing')} ({(thumbnail_factory or {}).get('preferred_baseline_style', 'missing')})",
        f"- Map/redrawn semantic match: {(thumbnail_factory or {}).get('redrawn_map_semantic_match_status', 'missing')}",
        f"- Underground semantic asset: {(thumbnail_factory or {}).get('underground_semantic_asset_status', 'missing')}",
        f"- Whole-word redaction: {(thumbnail_factory or {}).get('whole_word_redaction_status', 'missing')} ({(thumbnail_factory or {}).get('partial_word_redaction_count', 'missing')} partial-word redactions)",
        f"- Lost-streets visual relevance: {(thumbnail_factory or {}).get('lost_streets_semantic_asset_status', 'missing')} (rail image used: {(thumbnail_factory or {}).get('rail_image_used_for_lost_streets', 'missing')})",
        f"- Then/now split integrity: {(thumbnail_factory or {}).get('then_now_split_integrity_status', 'missing')} ({(thumbnail_factory or {}).get('then_now_median_crossing_count', 'missing')} median crossings)",
        f"- AI support asset boundary: {(thumbnail_factory or {}).get('ai_support_asset_manifest_status', 'missing')} ({(thumbnail_factory or {}).get('ai_fake_proof_count', 'missing')} fake proof assets)",
        f"- Current-style renderer V4: {(thumbnail_factory or {}).get('current_style_renderer_v4_status', 'missing')}",
        f"- Real city source-first examples: {(thumbnail_factory or {}).get('real_city_source_first_examples_status', 'missing')} (mode={(thumbnail_factory or {}).get('official_city_example_mode', 'missing')}, ad_hoc_mockup_blocked={(thumbnail_factory or {}).get('ad_hoc_mockup_blocked', 'missing')})",
        f"- Free-first thumbnail workflow: {(thumbnail_factory or {}).get('free_toolchain_status', 'missing')}",
        f"- Thumbnail rough/shortlisted/review/selected concepts: {(thumbnail_factory or {}).get('rough_concept_count', 0)} / {(thumbnail_factory or {}).get('shortlisted_concept_count', 0)} / {(thumbnail_factory or {}).get('review_concept_count', 0)} / {(thumbnail_factory or {}).get('selected_candidate_count', 0)}",
        f"- Paid tool used: {(thumbnail_factory or {}).get('paid_tool_used', True)}",
        f"- Paid asset used: {(thumbnail_factory or {}).get('paid_asset_used', True)}",
        f"- OCR mobile readability: {(thumbnail_factory or {}).get('mobile_ocr_readability_status', 'missing')}",
        f"- Benchmark similarity scoring: {(thumbnail_factory or {}).get('benchmark_similarity_status', 'missing')}",
        f"- Photopea/GIMP handoff: {(thumbnail_factory or {}).get('manual_handoff_status', 'missing')}",
        "- Paid tool escalation: blocked unless the owner approves after a documented free-workflow failure",
        f"- Thumbnail city name dominance: {(thumbnail_factory or {}).get('city_name_dominant_count', 0)}/5 concepts",
        f"- Thumbnail clear promise: {(thumbnail_factory or {}).get('clear_promise_count', 0)}/5 concepts",
        f"- City skyline/landmark recognition: {(thumbnail_factory or {}).get('skyline_or_landmark_count', 0)}/5 concepts",
        f"- City recognizable visuals: {(thumbnail_factory or {}).get('city_recognizable_visual_count', (thumbnail_factory or {}).get('detroit_recognizable_visual_count', 0))}/5 concepts",
        f"- Internal public labels: {(thumbnail_factory or {}).get('internal_public_label_count', 0)}",
        f"- Random arrows: {(thumbnail_factory or {}).get('random_arrow_count', 0)}",
        f"- Every-word intent gate: {(thumbnail_factory or {}).get('every_word_intent_gate_status', 'missing')} ({(thumbnail_factory or {}).get('irrelevant_public_word_count', 'missing')} irrelevant words)",
        f"- Spelling/OCR verification: {(thumbnail_factory or {}).get('spelling_ocr_verification_status', 'missing')} ({(thumbnail_factory or {}).get('spelling_error_count', 'missing')} spelling errors)",
        f"- Cutoff text detection: {(thumbnail_factory or {}).get('cutoff_text_detection_status', 'missing')} ({(thumbnail_factory or {}).get('cutoff_text_count', 'missing')} cut-off text items)",
        f"- No image distortion: {(thumbnail_factory or {}).get('no_image_distortion_status', 'missing')} ({(thumbnail_factory or {}).get('distorted_image_count', 'missing')} distorted images)",
        f"- Layout safe zones: {(thumbnail_factory or {}).get('layout_safe_zone_status', 'missing')} ({(thumbnail_factory or {}).get('layout_safe_zone_violation_count', 'missing')} violations)",
        f"- Creative variation memory: {(thumbnail_factory or {}).get('creative_variation_memory_status', 'missing')} ({(thumbnail_factory or {}).get('creative_variation_style_count', 'missing')} styles)",
        f"- Per-thumbnail critique reports: {(thumbnail_factory or {}).get('per_thumbnail_critique_status', 'missing')} ({(thumbnail_factory or {}).get('per_thumbnail_critique_count', 'missing')} critiques)",
        f"- Fictional publication-name preflight: {(thumbnail_factory or {}).get('publication_name_preflight_status', 'missing')}",
        f"- Competitive benchmark aesthetic: {(thumbnail_factory or {}).get('benchmark_aesthetic_match_count', 0)}/5 concepts",
        f"- Thumbnail search shelf: {(thumbnail_factory or {}).get('search_shelf_test_status', 'missing')}",
        f"- Visual variety categories: {(visual_variety or {}).get('distinct_category_count', 0)}",
        f"- Owner public publish approval: {'present' if public_approval else 'missing'}",
        f"- Latest private upload: {latest_private_upload.isoformat() if latest_private_upload else ''}",
        f"- Public publish approval time: {public_approval_time.isoformat() if public_approval_time else ''}",
        f"- Post-publication report: {'present' if public_report else 'not required before publish'}",
        f"- Public videos verified after publish: {public_video_count}/4",
        "- Launch checklist / long-form public: verified only after publish",
        "- Launch checklist / Shorts public: verified only after publish",
        f"- Launch checklist / Related Video plan present: {related_video_plan_ready}",
        f"- Launch checklist / Related Video set for each Short: {related_video_ready}",
        f"- Launch checklist / bridge comments drafted: {bridge_comments_ready}",
        f"- Launch checklist / bridge comments posted: {bridge_comments_posted}",
        f"- Launch checklist / bridge comments pinned: {pinned_comments_ready}",
        f"- Related Video setup report: {related_video_report.get('status', 'missing')}",
        f"- Bridge comments report: {bridge_comments_report.get('status', 'missing')}",
        f"- Shorts related-video plan: {'present' if shorts_plan.exists() else 'missing'}",
        f"- Shorts metadata rows: {len(metadata.get('shorts', []))}",
        "",
        "## Launch Protocol",
        "",
        "- Publish the long-form video first after YouTube checks and owner approval.",
        "- Publish the three Shorts only after the long-form URL exists.",
        "- Set each Short's Related Video to the long-form video in YouTube Studio.",
        "- Add pinned comments that bridge Shorts viewers back to the long-form video.",
        "- Keep public publishing owner-approval-gated.",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Status: {status}")
    print(f"Public publish readiness report: {display_path(report)}")
    for blocker in blockers:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()
