#!/usr/bin/env python3
import argparse
import csv
import json
import mimetypes
import re
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from patternlab_content_calendar import build_calendar
from patternlab_monetization_tracker import build_tracker_report
from patternlab_profit_analytics import build_profit_analytics
from patternlab_approval_package import build_approval_package_report
from patternlab_common import output_root
from patternlab_legacy import is_legacy_video_id
from patternlab_review_action import apply_review_action


REPO = Path(__file__).resolve().parents[2]
BASE = REPO / "youtube-v1"
PORT = 8765
DEFAULT_VIDEO_ID = "03"
ASSET_TYPES = ["image", "thumbnail", "voiceover", "proof_footage", "video", "short"]
FFPROBE_CANDIDATES = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"]
METRIC_FIELDS = [
    "recorded_at_utc",
    "video_id",
    "surface",
    "publish_url",
    "title",
    "thumbnail_variant",
    "hours_since_publish",
    "views",
    "impressions",
    "ctr_percent",
    "average_view_duration_seconds",
    "average_percentage_viewed",
    "retention_30s_percent",
    "retention_50_percent",
    "subscribers_gained",
    "estimated_revenue_usd",
    "rpm_usd",
    "shorts_viewed_percent",
    "shorts_swiped_away_percent",
    "related_video_clicks",
    "comments_signal_summary",
    "decision_label",
    "next_action",
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
]


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def rel(path):
    try:
        return str(Path(path).relative_to(BASE))
    except ValueError:
        return str(path)


def latest_video_id():
    ids = []
    for path in (BASE / "local-output").glob("video-*"):
        suffix = path.name.removeprefix("video-")
        if suffix.isdigit() and not is_legacy_video_id(suffix):
            ids.append(suffix.zfill(2))
    for path in (BASE / "launch").glob("video-*"):
        suffix = path.name.removeprefix("video-")
        if suffix.isdigit() and not is_legacy_video_id(suffix):
            ids.append(suffix.zfill(2))
    return sorted(set(ids))[-1] if ids else DEFAULT_VIDEO_ID


def normalize_video_id(value):
    raw = (value or "").strip()
    if not raw:
        return DEFAULT_VIDEO_ID
    if raw.isdigit():
        return raw.zfill(2)
    if raw.startswith("video-"):
        suffix = raw.removeprefix("video-")
        if suffix.isdigit():
            return suffix.zfill(2)
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,63}", suffix):
            return suffix
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,63}", raw):
        return raw
    return DEFAULT_VIDEO_ID


def video_output(video_id):
    return output_root(normalize_video_id(video_id))


def ffprobe_duration(path):
    if not Path(path).exists():
        return None
    for ffprobe in FFPROBE_CANDIDATES:
        try:
            output = subprocess.check_output(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(path),
                ],
                text=True,
            ).strip()
            return round(float(output), 2)
        except Exception:
            continue
    return None


def file_info(path):
    path = Path(path)
    return {
        "path": rel(path),
        "url": "/" + rel(path),
        "exists": path.exists(),
        "size_bytes": path.stat().st_size if path.exists() else 0,
        "duration_seconds": ffprobe_duration(path) if path.suffix.lower() in {".mp3", ".mp4", ".mov", ".m4a"} else None,
    }


def read_ledger(video_id):
    ledger = video_output(video_id) / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_ledger(video_id, rows):
    if not rows:
        return
    ledger = video_output(video_id) / "rights-ledger.csv"
    fields = list(rows[0].keys())
    with ledger.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def ensure_metrics_file(video_id):
    metrics = video_output(video_id) / "metrics" / f"video-{video_id}-performance.csv"
    if metrics.exists():
        return
    metrics.parent.mkdir(parents=True, exist_ok=True)
    with metrics.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=METRIC_FIELDS)
        writer.writeheader()
        for hours in [24, 72, 168, 720]:
            writer.writerow(
                {
                    "recorded_at_utc": utc_now(),
                    "video_id": video_id,
                    "surface": "long-form",
                    "publish_url": "",
                    "title": f"Pattern Lab Video {video_id}",
                    "thumbnail_variant": "A",
                    "hours_since_publish": hours,
                    "views": "",
                    "impressions": "",
                    "ctr_percent": "",
                    "average_view_duration_seconds": "",
                    "average_percentage_viewed": "",
                    "retention_30s_percent": "",
                    "retention_50_percent": "",
                    "subscribers_gained": "",
                    "estimated_revenue_usd": "",
                    "rpm_usd": "",
                    "shorts_viewed_percent": "",
                    "shorts_swiped_away_percent": "",
                    "related_video_clicks": "",
                    "comments_signal_summary": f"Pending {hours}h YouTube Studio export.",
                    "decision_label": "pending_publish",
                    "next_action": "Approve assets, upload private/unlisted, then record the scheduled performance checkpoint.",
                    "subscriber_conversion_per_1000_views": "",
                    "returning_viewers": "",
                    "browse_ctr_percent": "",
                    "suggested_ctr_percent": "",
                    "search_ctr_percent": "",
                    "thumbnail_family": "THIS EXPLAINS DETROIT",
                    "thumbnail_candidate_role": "emotional mystery",
                    "title_thumbnail_promise": "Detroit city-file promise: hidden system explained with sources",
                    "youtube_ab_test_status": "pending_public_publish",
                    "watch_time_share_winner": "pending",
                    "expectation_mismatch_comments": "",
                    "city_requests": "",
                    "local_corrections": "",
                    "source_suggestions": "",
                    "nostalgia_or_local_emotion": "",
                    "geography_confusion": "",
                    "source_disputes": "",
                    "sponsor_fit": "local history, travel, maps, education",
                    "media_quality_tags": "historical-photo-ready;map-proof-ready;stock-broll-context-only",
                    "watch_hours": "",
                }
            )
            for index, psychology in enumerate(["curiosity", "utility", "identity"], start=1):
                writer.writerow(
                    {
                        "recorded_at_utc": utc_now(),
                        "video_id": f"{video_id}-short-{index:02d}",
                        "surface": "short",
                        "publish_url": "",
                        "title": f"Video {video_id} Short {index}",
                        "thumbnail_variant": psychology,
                        "hours_since_publish": hours,
                        "views": "",
                        "impressions": "",
                        "ctr_percent": "",
                        "average_view_duration_seconds": "",
                        "average_percentage_viewed": "",
                        "retention_30s_percent": "",
                        "retention_50_percent": "",
                        "subscribers_gained": "",
                        "estimated_revenue_usd": "",
                        "rpm_usd": "",
                        "shorts_viewed_percent": "",
                        "shorts_swiped_away_percent": "",
                        "related_video_clicks": "",
                        "comments_signal_summary": f"Pending {hours}h Shorts publish and viewed-vs-swiped data.",
                        "decision_label": "pending_publish",
                        "next_action": "Approve Short, upload private/unlisted, then compare related-video clicks.",
                        "subscriber_conversion_per_1000_views": "",
                        "returning_viewers": "",
                        "browse_ctr_percent": "",
                        "suggested_ctr_percent": "",
                        "search_ctr_percent": "",
                        "thumbnail_family": "Pattern Lab Shorts",
                        "thumbnail_candidate_role": "shorts bridge",
                        "title_thumbnail_promise": "Short city clue bridges to the Detroit city file",
                        "youtube_ab_test_status": "pending_public_publish",
                        "watch_time_share_winner": "pending",
                        "expectation_mismatch_comments": "",
                        "city_requests": "",
                        "local_corrections": "",
                        "source_suggestions": "",
                        "nostalgia_or_local_emotion": "",
                        "geography_confusion": "",
                        "source_disputes": "",
                        "sponsor_fit": "local history, travel, maps, education",
                        "media_quality_tags": "shorts-bridge;context-only-broll",
                        "watch_hours": "",
                    }
                )


def read_metrics(video_id):
    ensure_metrics_file(video_id)
    metrics = video_output(video_id) / "metrics" / f"video-{video_id}-performance.csv"
    with metrics.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def metric_value(row, key, suffix=""):
    value = (row.get(key) or "").strip()
    if not value:
        return "pending"
    return f"{value}{suffix}"


def build_performance_state(video_id):
    rows = read_metrics(video_id)
    long_form = next((row for row in rows if row.get("surface") == "long-form"), rows[0] if rows else {})
    shorts = [row for row in rows if row.get("surface") == "short"]
    cards = [
        {
            "label": "Views",
            "value": metric_value(long_form, "views"),
            "why": "Top-of-funnel city demand.",
        },
        {
            "label": "CTR",
            "value": metric_value(long_form, "ctr_percent", "%"),
            "why": "Title-thumbnail promise strength.",
        },
        {
            "label": "30s retention",
            "value": metric_value(long_form, "retention_30s_percent", "%"),
            "why": "Hook and source-proof speed.",
        },
        {
            "label": "Avg viewed",
            "value": metric_value(long_form, "average_percentage_viewed", "%"),
            "why": "City-file pacing and payoff.",
        },
        {
            "label": "Subs",
            "value": metric_value(long_form, "subscribers_gained"),
            "why": "City-file audience fit.",
        },
        {
            "label": "RPM",
            "value": metric_value(long_form, "rpm_usd"),
            "why": "Monetization quality.",
        },
        {
            "label": "Shorts viewed",
            "value": metric_value(shorts[0], "shorts_viewed_percent", "%") if shorts else "pending",
            "why": "City clue and swipe resistance.",
        },
        {
            "label": "Related clicks",
            "value": metric_value(shorts[0], "related_video_clicks") if shorts else "pending",
            "why": "Short-to-long conversion.",
        },
        {
            "label": "Subs / 1k",
            "value": metric_value(long_form, "subscriber_conversion_per_1000_views"),
            "why": "Subscribe conversion quality.",
        },
        {
            "label": "City requests",
            "value": metric_value(long_form, "city_requests"),
            "why": "Demand for follow-up city files.",
        },
        {
            "label": "Source disputes",
            "value": metric_value(long_form, "source_disputes"),
            "why": "Research risk and correction pressure.",
        },
        {
            "label": "Thumbnail test",
            "value": long_form.get("youtube_ab_test_status") or "pending",
            "why": long_form.get("thumbnail_candidate_role") or "Packaging experiment status.",
        },
    ]
    metrics = video_output(video_id) / "metrics" / f"video-{video_id}-performance.csv"
    return {
        "path": rel(metrics),
        "rows": rows,
        "cards": cards,
        "decision_label": long_form.get("decision_label") or "pending_publish",
        "next_action": long_form.get("next_action") or "Record first city-file performance metrics.",
        "comments_signal_summary": long_form.get("comments_signal_summary") or "",
        "required_exports": [
            "24h long-form overview: views, impressions, CTR, average view duration, retention.",
            "24h Shorts overview: viewed vs swiped, average percentage viewed, related-video clicks.",
            "7d long-form and Shorts comparison with city-request and local-correction notes.",
            "Source suggestions, geography confusion, and source-dispute comments.",
            "Revenue/RPM once monetization data exists.",
        ],
        "decision_labels": [
            "double_down",
            "repackage",
            "revise_hook",
            "improve_visual_pacing",
            "retire_topic",
            "expand_into_series",
            "spin_off_city_series",
        ],
    }


def read_json_file(path):
    if not Path(path).exists():
        return None
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def build_monetization_state(video_id):
    output = video_output(video_id)
    report = read_json_file(output / "approval" / "monetization-gates-report.json")
    metadata = read_json_file(output / "approval" / "upload-metadata.json")
    private_approval = read_json_file(output / "approval" / "private-upload-approval.json")
    review_package_approval = read_json_file(output / "approval" / "review-package-approval.json")
    public_approval = read_json_file(output / "approval" / "public-publish-approval.json")
    upload_report = read_json_file(output / "approval" / "youtube-upload-report.json")
    ypp, _ypp_report = build_tracker_report()
    profit = build_profit_analytics(video_id)
    calendar, _calendar_report = build_calendar()
    return {
        "gate_status": report.get("status") if report else "missing",
        "topic_score": report.get("topic_score") if report else None,
        "threshold": report.get("threshold") if report else 80,
        "lane": report.get("lane") if report else "hidden systems behind American cities",
        "sub_lane": report.get("sub_lane") if report else "pending",
        "default_title": metadata.get("default_title") if metadata else "",
        "title_options": metadata.get("title_options", []) if metadata else [],
        "private_upload_approved": bool(private_approval),
        "review_package_approved": bool(review_package_approval),
        "public_publish_approved": bool(public_approval),
        "uploaded_private_or_unlisted": bool(upload_report and upload_report.get("status") == "uploaded"),
        "youtube_url": upload_report.get("youtube_url", "") if upload_report else "",
        "ypp_progress": ypp.get("progress", {}),
        "ypp_status": ypp.get("status", "missing"),
        "ypp_blockers": ypp.get("blockers", []),
        "calendar_rows": len(calendar.get("rows", [])),
        "profit_analytics": profit,
    }


def approval_summary(rows):
    summary = {}
    for asset_type in ASSET_TYPES:
        typed = [row for row in rows if row.get("asset_type") == asset_type]
        approved = [row for row in typed if row.get("human_review_status") == "approved"]
        summary[asset_type] = {
            "total": len(typed),
            "approved": len(approved),
            "complete": bool(typed) and len(typed) == len(approved),
        }
    return summary


def parse_blockers(video_id):
    report = video_output(video_id) / "approval" / "private-upload-readiness.md"
    if not report.exists():
        return []
    lines = report.read_text(encoding="utf-8").splitlines()
    try:
        start = lines.index("## Blockers") + 1
    except ValueError:
        return []
    blockers = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        if line.startswith("- "):
            blockers.append(line[2:])
    return blockers


def build_state(video_id=None):
    video_id = normalize_video_id(video_id)
    output = video_output(video_id)
    rows = read_ledger(video_id)
    approvals = approval_summary(rows)
    blockers = parse_blockers(video_id)
    review_package, _, review_package_report = build_approval_package_report(video_id, refresh_quality=False)
    thumbnail_factory = read_json_file(output / "approval" / "thumbnail-factory-report.json") or {}
    thumbnail_quality = read_json_file(output / "approval" / "thumbnail-quality-report.json") or {}
    quality_gates = read_json_file(output / "approval" / "quality-gates-report.json") or {}
    thumbnail_rendered_ocr = read_json_file(output / "approval" / "thumbnail-rendered-ocr-report.json") or {}
    thumbnail_layout_audit = read_json_file(output / "approval" / "thumbnail-layout-audit-report.json") or {}
    thumbnail_redteam_audit = read_json_file(output / "approval" / "thumbnail-redteam-audit-report.json") or {}
    thumbnail_visible_source_audit = read_json_file(output / "approval" / "thumbnail-visible-source-audit-report.json") or {}
    thumbnail_replacement = read_json_file(output / "approval" / "youtube-thumbnail-replacement-report.json") or {}
    thumbnail_click_quality = read_json_file(output / "approval" / "thumbnail-click-quality-report.json") or {}
    thumbnail_font_quality = read_json_file(output / "approval" / "thumbnail-font-quality-report.json") or {}
    thumbnail_photo_summary = read_json_file(output / "approval" / "miami-photo-backed-thumbnail-report.json") or {}
    thumbnail_reference_library = read_json_file(output / "approval" / "thumbnail-reference-library-report.json") or {}
    thumbnail_reference_anatomy = read_json_file(output / "approval" / "thumbnail-reference-anatomy-report.json") or {}
    thumbnail_pop_score = read_json_file(output / "approval" / "thumbnail-pop-score-report.json") or {}
    thumbnail_poster_depth = read_json_file(output / "approval" / "thumbnail-poster-depth-renderer-report.json") or {}
    thumbnail_shelf_strip = read_json_file(output / "approval" / "thumbnail-mobile-shelf-strip-report.json") or {}
    thumbnail_owner_rating_v3 = read_json_file(output / "approval" / "thumbnail-owner-rating-learning-report.json") or {}
    title_thumbnail_pair_packet = read_json_file(output / "approval" / "title-thumbnail-pair-packet.json") or {}
    thumbnail_font_tournament = read_json_file(output / "approval" / "thumbnail-font-tournament-report.json") or {}
    html_thumbnail_renderer = read_json_file(output / "approval" / "html-thumbnail-renderer-report.json") or {}
    source_candidate_tournament = read_json_file(output / "approval" / "source-candidate-tournament-report.json") or {}
    source_provider_health = read_json_file(output / "approval" / "source-provider-health-report.json") or {}
    shorts_followup = read_json_file(output / "approval" / "shorts-followup-packet.json") or {}
    performance_learning = read_json_file(output / "metrics" / f"video-{video_id}-performance-learning-scaffold.json") or {}
    penpot_fallback = read_json_file(output / "approval" / "penpot-fallback-evaluation-report.json") or {}
    penpot_slot_fill = read_json_file(output / "approval" / "penpot-slot-fill-smoke-report.json") or {}
    renderer_decision = read_json_file(output / "approval" / "renderer-decision-gate-report.json") or {}
    photopea_rescue = read_json_file(output / "approval" / "photopea-rescue-evaluation-report.json") or {}
    canva_template_registry = read_json_file(output / "approval" / "thumbnail-canva-template-registry-report.json") or {}
    canva_render_plan = read_json_file(output / "approval" / "thumbnail-canva-render-plan-report.json") or {}
    canva_no_ai_render_plan = read_json_file(output / "approval" / "canva-no-ai-render-plan-report.json") or {}
    canva_no_ai_live_validation = read_json_file(output / "approval" / "canva-no-ai-live-validation-report.json") or {}
    external_font_registry = read_json_file(output / "approval" / "external-font-registry-report.json") or {}
    font_license_gate = read_json_file(output / "approval" / "thumbnail-font-license-gate-report.json") or {}
    full_auto_production = read_json_file(output / "approval" / "full-auto-production-report.json") or {}
    voice_visual_match = read_json_file(output / "approval" / "voice-visual-match-report.json") or {}
    finished_watchdown = read_json_file(output / "approval" / "finished-video-watchdown-report.json") or {}
    thumbnail_topic_bank = read_json_file(output / "approval" / "thumbnail-topic-bank.json") or {}
    youtube_ab_readiness = read_json_file(output / "approval" / "youtube-ab-readiness-packet.json") or {}
    thumbnail_market_research = read_json_file(output / "approval" / "thumbnail-market-research-workflow-report.json") or {}
    thumbnail_typography_research = read_json_file(output / "approval" / "thumbnail-market-typography-research-report.json") or {}
    review_concepts = []
    for concept in thumbnail_factory.get("review_concepts", []):
        concept_filename = concept.get("concept_filename", "")
        concept_path = output / "review" / "thumbnail-concepts" / concept_filename
        review_concepts.append(
            {
                **file_info(concept_path),
                "headline": concept.get("headline", ""),
                "style_family": concept.get("style_family", ""),
                "benchmark_family": concept.get("benchmark_family", ""),
                "selected_for_production": bool(concept.get("selected_for_production")),
                "proof_object": concept.get("proof_object", ""),
                "visual_strategy": concept.get("visual_strategy", ""),
                "click_interest_trigger": concept.get("click_interest_trigger", ""),
            }
        )
    media = {
        "long_form": file_info(output / "video" / f"pattern-lab-video-{video_id}-draft.mp4"),
        "voiceover": file_info(output / "audio" / "voiceover_full_normalized.mp3"),
        "shorts": [
            file_info(output / "shorts" / f"pattern-lab-video-{video_id}-short-01.mp4"),
            file_info(output / "shorts" / f"pattern-lab-video-{video_id}-short-02.mp4"),
            file_info(output / "shorts" / f"pattern-lab-video-{video_id}-short-03.mp4"),
        ],
        "thumbnails": [
            file_info(path)
            for path in sorted((output / "images").glob("thumbnail_candidate_*.png"))
        ],
        "avatar_concepts": [
            {
                **file_info(path),
                "filename": str(path.relative_to(output)),
            }
            for path in sorted((output / "visual-upgrade").glob("james_avatar_concept_*.png"))
        ],
        "visual_plan": file_info(output / "approval" / "visual-upgrade-plan.md"),
        "review_packet": file_info(output / "review" / "owner-review-packet.md"),
        "readiness_report": file_info(output / "approval" / "private-upload-readiness.md"),
        "review_package_report": file_info(review_package_report),
        "thumbnail_review_concepts": review_concepts,
        "thumbnail_five_concept_contact_sheet": file_info(output / "approval" / "thumbnail-five-concept-contact-sheet.png"),
        "thumbnail_search_shelf_test": file_info(output / "approval" / "thumbnail-search-shelf-test.png"),
        "thumbnail_rendered_ocr_report": file_info(output / "approval" / "thumbnail-rendered-ocr-report.json"),
        "thumbnail_layout_audit_report": file_info(output / "approval" / "thumbnail-layout-audit-report.json"),
        "thumbnail_redteam_audit_report": file_info(output / "approval" / "thumbnail-redteam-audit-report.json"),
        "thumbnail_visible_source_audit_report": file_info(output / "approval" / "thumbnail-visible-source-audit-report.json"),
        "thumbnail_font_quality_report": file_info(output / "approval" / "thumbnail-font-quality-report.json"),
        "thumbnail_font_quality_markdown": file_info(output / "approval" / "thumbnail-font-quality-report.md"),
        "thumbnail_reference_library_report": file_info(output / "approval" / "thumbnail-reference-library-report.json"),
        "thumbnail_reference_anatomy_report": file_info(output / "approval" / "thumbnail-reference-anatomy-report.json"),
        "thumbnail_pop_score_report": file_info(output / "approval" / "thumbnail-pop-score-report.json"),
        "thumbnail_poster_depth_report": file_info(output / "approval" / "thumbnail-poster-depth-renderer-report.json"),
        "thumbnail_poster_depth_contact_sheet": file_info(output / "approval" / "thumbnail-poster-depth-contact-sheet.jpg"),
        "thumbnail_mobile_shelf_strip": file_info(output / "approval" / "thumbnail-mobile-shelf-strip.jpg"),
        "thumbnail_title_pair_packet": file_info(output / "approval" / "title-thumbnail-pair-packet.json"),
        "thumbnail_font_tournament_report": file_info(output / "approval" / "thumbnail-font-tournament-report.json"),
        "thumbnail_font_tournament_contact_sheet": file_info(output / "approval" / "thumbnail-font-tournament-contact-sheet.jpg"),
        "html_thumbnail_renderer_report": file_info(output / "approval" / "html-thumbnail-renderer-report.json"),
        "source_candidate_tournament_report": file_info(output / "approval" / "source-candidate-tournament-report.json"),
        "source_provider_health_report": file_info(output / "approval" / "source-provider-health-report.json"),
        "shorts_followup_packet": file_info(output / "approval" / "shorts-followup-packet.json"),
        "performance_learning_scaffold": file_info(output / "metrics" / f"video-{video_id}-performance-learning-scaffold.json"),
        "full_auto_production_report": file_info(output / "approval" / "full-auto-production-report.json"),
        "voice_visual_match_report": file_info(output / "approval" / "voice-visual-match-report.json"),
        "finished_video_watchdown_report": file_info(output / "approval" / "finished-video-watchdown-report.json"),
        "html_thumbnail_renderer_contact_sheet": file_info(output / "approval" / "html-thumbnail-renderer-contact-sheet.jpg"),
        "penpot_fallback_report": file_info(output / "approval" / "penpot-fallback-evaluation-report.json"),
        "penpot_slot_fill_report": file_info(output / "approval" / "penpot-slot-fill-smoke-report.json"),
        "penpot_slot_fill_thumbnail": file_info(output / "review" / "penpot-slot-fill" / f"penpot_slot_fill_{str(penpot_slot_fill.get('city', '')).lower().replace(' ', '_')}.png"),
        "renderer_decision_gate_report": file_info(output / "approval" / "renderer-decision-gate-report.json"),
        "photopea_rescue_report": file_info(output / "approval" / "photopea-rescue-evaluation-report.json"),
        "canva_template_registry_report": file_info(output / "approval" / "thumbnail-canva-template-registry-report.json"),
        "canva_render_plan_report": file_info(output / "approval" / "thumbnail-canva-render-plan-report.json"),
        "canva_no_ai_render_plan_report": file_info(output / "approval" / "canva-no-ai-render-plan-report.json"),
        "canva_no_ai_live_validation_report": file_info(output / "approval" / "canva-no-ai-live-validation-report.json"),
        "external_font_registry_report": file_info(output / "approval" / "external-font-registry-report.json"),
        "font_license_gate_report": file_info(output / "approval" / "thumbnail-font-license-gate-report.json"),
        "thumbnail_poster_depth_examples": [
            file_info(path)
            for path in sorted((output / "review" / "poster-depth-thumbnails").glob("poster_depth_*.jpg"))
        ],
        "thumbnail_font_tournament_examples": [
            file_info(path)
            for path in sorted((output / "review" / "font-tournament-thumbnails").glob("font_tournament_*.jpg"))
        ],
        "html_thumbnail_renderer_examples": [
            file_info(path)
            for path in sorted((output / "review" / "html-thumbnail-renderer").glob("html_thumb_*.jpg"))
        ],
    }
    ready_for_private = not blockers
    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "private-upload-ready" if ready_for_private else "owner-review-required",
        "public_publish": "blocked_until_explicit_owner_approval",
        "approvals": approvals,
        "blockers": blockers,
        "media": media,
        "review_package": {
            "status": review_package.get("status", "missing"),
            "approved": (output / "approval" / "review-package-approval.json").exists(),
            "pending_target_count": review_package.get("pending_target_count", 0),
            "selected_thumbnail": review_package.get("selected_thumbnail", ""),
            "report": file_info(review_package_report),
        },
        "thumbnail_process": {
            "factory_status": thumbnail_factory.get("status", thumbnail_photo_summary.get("status", "missing")),
            "quality_status": thumbnail_quality.get("status", thumbnail_photo_summary.get("status", "missing")),
            "aggregate_gate_status": quality_gates.get("status", "missing"),
            "review_concept_count": thumbnail_factory.get("review_concept_count", thumbnail_photo_summary.get("thumbnail_count", 0)),
            "selected_candidate_count": thumbnail_factory.get("selected_candidate_count", min(3, int(thumbnail_photo_summary.get("thumbnail_count", 0) or 0))),
            "rendered_ocr_truth_status": thumbnail_factory.get("rendered_ocr_truth_status", thumbnail_rendered_ocr.get("status", "missing")),
            "ocr_misspelling_count": thumbnail_factory.get("ocr_misspelling_count", thumbnail_rendered_ocr.get("ocr_misspelling_count", 0)),
            "ocr_unexpected_public_word_count": thumbnail_factory.get("ocr_unexpected_public_word_count", thumbnail_rendered_ocr.get("ocr_unexpected_public_word_count", 0)),
            "ocr_missing_required_word_count": thumbnail_factory.get("ocr_missing_required_word_count", thumbnail_rendered_ocr.get("ocr_missing_required_word_count", 0)),
            "layout_collision_status": thumbnail_factory.get("layout_collision_status", thumbnail_layout_audit.get("status", "missing")),
            "text_collision_count": thumbnail_factory.get("text_collision_count", thumbnail_layout_audit.get("text_collision_count", 0)),
            "subject_coverage_violation_count": thumbnail_factory.get("subject_coverage_violation_count", thumbnail_layout_audit.get("subject_coverage_violation_count", 0)),
            "purpose_labeled_shape_status": thumbnail_factory.get("purpose_labeled_shape_status", thumbnail_layout_audit.get("status", "missing")),
            "unexplained_black_box_count": thumbnail_factory.get("unexplained_black_box_count", thumbnail_layout_audit.get("unexplained_black_box_count", 0)),
            "random_shape_count": thumbnail_factory.get("random_shape_count", thumbnail_layout_audit.get("random_shape_count", 0)),
            "then_now_pixel_split_status": thumbnail_factory.get("then_now_pixel_split_status", "missing"),
            "image_distortion_detected_count": thumbnail_factory.get("image_distortion_detected_count", thumbnail_layout_audit.get("image_distortion_detected_count", 0)),
            "redaction_prop_spelling_status": thumbnail_factory.get("redaction_prop_spelling_status", "missing"),
            "ai_support_asset_interface_status": thumbnail_factory.get("ai_support_asset_interface_status", "missing"),
            "triple_review_redteam_status": thumbnail_factory.get("triple_review_redteam_status", thumbnail_redteam_audit.get("status", "missing")),
            "redteam_open_blocker_count": thumbnail_redteam_audit.get("open_blocker_count", 0),
            "dashboard_thumbnail_qa_status": thumbnail_factory.get("dashboard_thumbnail_qa_status", "missing"),
            "owner_rating_learning_v2_status": thumbnail_factory.get("owner_rating_learning_v2_status", "missing"),
            "current_style_renderer_v4_status": thumbnail_factory.get("current_style_renderer_v4_status", "missing"),
            "real_city_source_first_examples_status": thumbnail_factory.get("real_city_source_first_examples_status", "pass" if thumbnail_photo_summary.get("status") == "pass" else "missing"),
            "official_city_example_mode": thumbnail_factory.get("official_city_example_mode", "photo_backed_source_ready" if thumbnail_photo_summary.get("status") == "pass" else "missing"),
            "ad_hoc_mockup_blocked": thumbnail_factory.get("ad_hoc_mockup_blocked", bool(thumbnail_photo_summary)),
            "visible_source_audit_status": thumbnail_factory.get("visible_source_audit_status", thumbnail_visible_source_audit.get("status", "missing")),
            "visible_real_photo_count": thumbnail_factory.get("visible_real_photo_count", thumbnail_visible_source_audit.get("visible_real_photo_count", thumbnail_photo_summary.get("visible_real_photo_count", 0))),
            "photo_hero_or_major_inset_count": thumbnail_factory.get("photo_hero_or_major_inset_count", thumbnail_visible_source_audit.get("photo_hero_or_major_inset_count", thumbnail_photo_summary.get("visible_real_photo_count", 0))),
            "map_only_concept_count": thumbnail_factory.get("map_only_concept_count", thumbnail_visible_source_audit.get("map_only_concept_count", 0)),
            "unmanifested_visible_source_count": thumbnail_factory.get("unmanifested_visible_source_count", thumbnail_visible_source_audit.get("unmanifested_visible_source_count", 0)),
            "search_shelf_test_status": thumbnail_factory.get("search_shelf_test_status", "missing"),
            "paid_tool_used": bool(thumbnail_factory.get("paid_tool_used", True)),
            "paid_asset_used": bool(thumbnail_factory.get("paid_asset_used", True)),
            "click_quality_status": thumbnail_click_quality.get("status", "missing"),
            "font_quality_status": thumbnail_font_quality.get("status", "missing"),
            "main_title_font_family": thumbnail_font_quality.get("main_title_font_family", "missing"),
            "main_title_font_families": thumbnail_font_quality.get("main_title_font_families", []),
            "city_font_families": thumbnail_font_quality.get("city_font_families", []),
            "impact_fallback_used": bool(thumbnail_font_quality.get("impact_fallback_used", False)),
            "impact_fallback_count": thumbnail_font_quality.get("impact_fallback_count", 0),
            "font_shelf_readability_status": thumbnail_font_quality.get("shelf_readability_status", "missing"),
            "font_shelf_preview_count": thumbnail_font_quality.get("shelf_preview_count", 0),
            "font_required_shelf_preview_count": thumbnail_font_quality.get("required_shelf_preview_count", 0),
            "font_reject_reasons": thumbnail_font_quality.get("font_reject_reasons", []),
            "topic_bank_status": thumbnail_click_quality.get("topic_bank_status", thumbnail_topic_bank.get("status", "missing")),
            "topic_score": thumbnail_click_quality.get("topic_score", "missing"),
            "hook_score": thumbnail_click_quality.get("hook_score", "missing"),
            "hook_first_brief_status": thumbnail_click_quality.get("hook_first_brief_status", "missing"),
            "intentionality_status": thumbnail_click_quality.get("intentionality_status", "missing"),
            "source_photo_tag_match_status": thumbnail_click_quality.get("source_photo_tag_match_status", "missing"),
            "reject_reasons": thumbnail_click_quality.get("reject_reasons", []),
            "liked_format_reuse_status": thumbnail_click_quality.get("liked_format_reuse_status", "missing"),
            "ab_readiness_status": thumbnail_click_quality.get("ab_readiness_status", youtube_ab_readiness.get("status", "missing")),
            "market_research_workflow_status": thumbnail_market_research.get("status", "missing"),
            "typography_market_research_status": thumbnail_typography_research.get("status", "missing"),
            "reference_library_status": thumbnail_reference_library.get("status", "missing"),
            "reference_library_infrastructure_status": thumbnail_reference_library.get("infrastructure_status", "missing"),
            "reference_image_count": thumbnail_reference_library.get("existing_reference_image_count", 0),
            "required_reference_image_count": thumbnail_reference_library.get("required_owner_reference_image_count", 0),
            "reference_analyzer_status": thumbnail_reference_anatomy.get("status", "missing"),
            "reference_analyzer_infrastructure_status": thumbnail_reference_anatomy.get("analyzer_infrastructure_status", "missing"),
            "heuristic_pop_score_status": thumbnail_pop_score.get("openclaw_heuristic_status", "missing"),
            "reference_match_score_status": thumbnail_pop_score.get("reference_match_score_status", "missing"),
            "average_pop_score": thumbnail_pop_score.get("average_pop_score", "missing"),
            "minimum_pop_score": thumbnail_pop_score.get("minimum_pop_score", "missing"),
            "poster_depth_renderer_status": thumbnail_poster_depth.get("poster_depth_renderer_status", "missing"),
            "hero_object_requirement_status": thumbnail_poster_depth.get("hero_object_requirement_status", "missing"),
            "hero_object_count": thumbnail_poster_depth.get("hero_object_count", 0),
            "poster_depth_thumbnail_count": thumbnail_poster_depth.get("thumbnail_count", 0),
            "same_template_blocker_status": thumbnail_poster_depth.get("same_template_blocker_status", "missing"),
            "same_template_reuse_violation_count": thumbnail_poster_depth.get("same_template_reuse_violation_count", 0),
            "owner_reference_style_adaptation_status": thumbnail_poster_depth.get("owner_reference_style_adaptation_status", "missing"),
            "filler_public_label_blocker_status": thumbnail_poster_depth.get("filler_public_label_blocker_status", "missing"),
            "bare_redaction_blocker_status": thumbnail_poster_depth.get("bare_redaction_blocker_status", "missing"),
            "vivid_color_energy_status": thumbnail_poster_depth.get("vivid_color_energy_status", "missing"),
            "mobile_shelf_strip_status": thumbnail_shelf_strip.get("current_shelf_strip_status", "missing"),
            "mobile_shelf_reference_comparison_status": thumbnail_shelf_strip.get("reference_comparison_status", "missing"),
            "owner_rating_learning_v3_status": thumbnail_owner_rating_v3.get("owner_rating_learning_v3_status", "missing"),
            "owner_liked_format_count": thumbnail_owner_rating_v3.get("liked_format_count", 0),
            "title_thumbnail_pair_packet_status": title_thumbnail_pair_packet.get("title_thumbnail_pair_packet_status", "missing"),
            "title_thumbnail_pair_variant_count": title_thumbnail_pair_packet.get("variant_count", 0),
            "youtube_native_test_ready": title_thumbnail_pair_packet.get("youtube_native_test_ready", "missing"),
            "font_tournament_status": thumbnail_font_tournament.get("font_tournament_status", "missing"),
            "font_tournament_variant_count": thumbnail_font_tournament.get("variant_count", 0),
            "font_tournament_winning_count": thumbnail_font_tournament.get("winning_count", 0),
            "font_tournament_bottom_text_fit_status": thumbnail_font_tournament.get("bottom_text_fit_status", "missing"),
            "font_tournament_generic_font_blocker_status": thumbnail_font_tournament.get("generic_font_blocker_status", "missing"),
            "font_tournament_reference_typography_match_status": thumbnail_font_tournament.get("reference_typography_match_status", "missing"),
            "font_tournament_mobile_shelf_preview_status": thumbnail_font_tournament.get("mobile_shelf_preview_status", "missing"),
            "font_tournament_mobile_shelf_preview_count": thumbnail_font_tournament.get("mobile_shelf_preview_count", 0),
            "font_tournament_required_mobile_shelf_preview_count": thumbnail_font_tournament.get("required_mobile_shelf_preview_count", 0),
            "source_candidate_tournament_status": source_candidate_tournament.get("status", "missing"),
            "source_candidate_minimum_candidate_count_per_topic": source_candidate_tournament.get("minimum_candidate_count_per_topic", 0),
            "source_candidate_minimum_top_ranked_candidate_count": source_candidate_tournament.get("minimum_top_ranked_candidate_count", 0),
            "source_candidate_unique_local_source_image_count": source_candidate_tournament.get("unique_local_source_image_count", 0),
            "source_provider_health_status": source_provider_health.get("status", "missing"),
            "source_provider_attempt_count": source_provider_health.get("provider_attempt_count", 0),
            "source_provider_selected_count": source_provider_health.get("selected_provider_count", 0),
            "single_source_dependency": source_provider_health.get("single_source_dependency", True),
            "premium_display_font_pack_v3_status": source_candidate_tournament.get("premium_display_font_pack_v3_status", "missing"),
            "premium_display_font_pack_v3_count": len(source_candidate_tournament.get("premium_display_font_pack_v3_families", [])),
            "proof_object_dominance_gate_status": source_candidate_tournament.get("proof_object_dominance_gate_status", "missing"),
            "thumbnail_tournament_20_status": source_candidate_tournament.get("thumbnail_tournament_20_status", "missing"),
            "thumbnail_tournament_variant_count": source_candidate_tournament.get("thumbnail_tournament_variant_count", 0),
            "top3_owner_review_selector_status": source_candidate_tournament.get("top3_owner_review_selector_status", "missing"),
            "top3_owner_review_count": source_candidate_tournament.get("top3_owner_review_count", 0),
            "html_renderer_status": html_thumbnail_renderer.get("html_renderer_status", "missing"),
            "chrome_fontsource_renderer_status": html_thumbnail_renderer.get("chrome_fontsource_renderer_status", "missing"),
            "chrome_fontsource_open_license_font_count": html_thumbnail_renderer.get("open_license_font_count", 0),
            "chrome_fontsource_font_ledger_status": html_thumbnail_renderer.get("font_ledger_status", "missing"),
            "chrome_fontsource_ocr_status": html_thumbnail_renderer.get("mobile_typography_ocr_readability_status", "missing"),
            "chrome_fontsource_ocr_pass_count": html_thumbnail_renderer.get("mobile_typography_ocr_pass_count", 0),
            "chrome_fontsource_ocr_required_count": html_thumbnail_renderer.get("mobile_typography_ocr_required_count", 0),
            "render_visual_integrity_status": html_thumbnail_renderer.get("render_visual_integrity_status", "missing"),
            "render_visual_integrity_pass_count": html_thumbnail_renderer.get("render_visual_integrity_pass_count", 0),
            "render_visual_integrity_required_count": html_thumbnail_renderer.get("render_visual_integrity_required_count", 0),
            "source_role_integrity_status": html_thumbnail_renderer.get("source_role_integrity_status", "missing"),
            "source_role_integrity_pass_count": html_thumbnail_renderer.get("source_role_integrity_pass_count", 0),
            "source_role_integrity_required_count": html_thumbnail_renderer.get("source_role_integrity_required_count", 0),
            "topic_source_match_status": html_thumbnail_renderer.get("topic_source_match_status", "missing"),
            "topic_source_match_pass_count": html_thumbnail_renderer.get("topic_source_match_pass_count", 0),
            "topic_source_match_required_count": html_thumbnail_renderer.get("topic_source_match_required_count", 0),
            "better_photo_tournament_status": html_thumbnail_renderer.get("better_photo_tournament_status", "missing"),
            "better_photo_tournament_pass_count": html_thumbnail_renderer.get("better_photo_tournament_pass_count", 0),
            "better_photo_tournament_required_count": html_thumbnail_renderer.get("better_photo_tournament_required_count", 0),
            "first_30_second_payoff_status": html_thumbnail_renderer.get("first_30_second_payoff_status", "missing"),
            "chat_delivery_artifacts_status": html_thumbnail_renderer.get("chat_delivery_artifacts_status", "missing"),
            "chat_delivery_surface_status": html_thumbnail_renderer.get("chat_delivery_surface_status", "missing"),
            "chat_delivery_preview_format": html_thumbnail_renderer.get("chat_delivery_preview_format", "missing"),
            "chat_delivery_lower_half_pass_count": html_thumbnail_renderer.get("chat_delivery_lower_half_pass_count", 0),
            "chat_delivery_required_lower_half_pass_count": html_thumbnail_renderer.get("chat_delivery_required_lower_half_pass_count", 0),
            "chat_delivery_contact_sheet_layout": html_thumbnail_renderer.get("chat_delivery_contact_sheet_layout", "missing"),
            "chat_delivery_contact_sheet_status": html_thumbnail_renderer.get("chat_delivery_contact_sheet_status", "missing"),
            "chat_delivery_contact_sheet_width": html_thumbnail_renderer.get("chat_delivery_contact_sheet_width", 0),
            "chat_delivery_contact_sheet_height": html_thumbnail_renderer.get("chat_delivery_contact_sheet_height", 0),
            "chat_delivery_run_id": html_thumbnail_renderer.get("chat_delivery_run_id", ""),
            "chat_delivery_artifact_count": html_thumbnail_renderer.get("chat_delivery_artifact_count", 0),
            "chat_delivery_required_artifact_count": html_thumbnail_renderer.get("chat_delivery_required_artifact_count", 0),
            "chat_delivery_contact_sheet": html_thumbnail_renderer.get("chat_delivery_contact_sheet", ""),
            "satori_resvg_sharp_renderer_status": html_thumbnail_renderer.get("satori_resvg_sharp_renderer_status", "missing"),
            "satori_resvg_sharp_renderer_count": html_thumbnail_renderer.get("satori_resvg_sharp_renderer_count", 0),
            "penpot_fallback_status": penpot_fallback.get("penpot_fallback_status", "missing"),
            "penpot_export_validation_status": penpot_fallback.get("export_validation_status", "missing"),
            "penpot_template_slot_contract_status": penpot_slot_fill.get("penpot_template_slot_contract_status", "missing"),
            "penpot_slot_fill_status": penpot_slot_fill.get("penpot_slot_fill_status", "missing"),
            "penpot_slot_fill_chat_safe_preview_status": penpot_slot_fill.get("chat_safe_preview_status", "missing"),
            "penpot_slot_fill_production_png": penpot_slot_fill.get("production_png_path", ""),
            "penpot_slot_fill_lower_half_pass_count": penpot_slot_fill.get("chat_delivery_lower_half_pass_count", 0),
            "penpot_slot_fill_required_lower_half_pass_count": penpot_slot_fill.get("chat_delivery_required_lower_half_pass_count", 0),
            "renderer_decision_gate_status": renderer_decision.get("renderer_decision_gate_status", "missing"),
            "renderer_decision_selected_renderer": renderer_decision.get("selected_renderer", "missing"),
            "renderer_decision_output_mode": renderer_decision.get("renderer_output_mode", "missing"),
            "renderer_decision_reason": renderer_decision.get("selection_reason", "missing"),
            "photopea_rescue_status": photopea_rescue.get("photopea_rescue_status", "missing"),
            "photopea_production_ready_status": photopea_rescue.get("production_ready_status", "missing"),
            "html_renderer_final_thumbnail_count": html_thumbnail_renderer.get("final_thumbnail_count", 0),
            "html_renderer_1920_count": html_thumbnail_renderer.get("dimension_1920x1080_count", 0),
            "html_renderer_support_text_fit_status": html_thumbnail_renderer.get("support_text_fit_status", "missing"),
            "html_renderer_generic_font_blocker_status": html_thumbnail_renderer.get("generic_font_blocker_status", "missing"),
            "html_renderer_reference_typography_match_status": html_thumbnail_renderer.get("reference_typography_match_status", "missing"),
            "html_renderer_mobile_shelf_preview_status": html_thumbnail_renderer.get("mobile_shelf_preview_status", "missing"),
            "html_renderer_mobile_shelf_preview_count": html_thumbnail_renderer.get("mobile_shelf_preview_count", 0),
            "html_renderer_required_mobile_shelf_preview_count": html_thumbnail_renderer.get("required_mobile_shelf_preview_count", 0),
            "html_renderer_no_filler_words_status": html_thumbnail_renderer.get("no_filler_public_words_v2_status", "missing"),
            "html_renderer_click_desire_redteam_status": html_thumbnail_renderer.get("click_desire_redteam_status", "missing"),
            "html_renderer_watch_time_ab_packet_status": html_thumbnail_renderer.get("watch_time_ab_packet_status", "missing"),
            "shorts_followup_packet_status": shorts_followup.get("shorts_followup_packet_status", "missing"),
            "shorts_followup_count": shorts_followup.get("shorts_count", 0),
            "performance_learning_loop_scaffold_status": performance_learning.get("performance_learning_loop_scaffold_status", "missing"),
            "performance_learning_checkpoint_count": performance_learning.get("checkpoint_count", 0),
            "performance_learning_live_analytics_status": performance_learning.get("live_analytics_status", "missing"),
            "canva_template_registry_status": canva_template_registry.get("registry_status", "missing"),
            "canva_template_count": canva_template_registry.get("template_count", 0),
            "canva_template_id_missing_count": canva_template_registry.get("template_id_missing_count", 0),
            "canva_template_production_ready_status": canva_template_registry.get("production_ready_status", "missing"),
            "canva_template_slot_schema_status": canva_template_registry.get("slot_schema_status", "missing"),
            "canva_font_preservation_gate_status": canva_template_registry.get("font_preservation_gate_status", "missing"),
            "canva_render_plan_status": canva_render_plan.get("render_plan_status", "missing"),
            "canva_edit_plan_count": canva_render_plan.get("edit_plan_count", 0),
            "canva_required_edit_plan_count": canva_render_plan.get("required_edit_plan_count", 0),
            "canva_template_execution_status": canva_render_plan.get("canva_template_execution_status", "missing"),
            "canva_required_for_all_thumbnails": canva_render_plan.get("canva_required_for_all_thumbnails", False),
            "canva_primary_renderer": canva_render_plan.get("canva_primary_renderer", False),
            "approved_free_fallback_allowed": canva_render_plan.get("approved_free_fallback_allowed", False),
            "selected_renderer": canva_render_plan.get("selected_renderer", "missing"),
            "renderer_output_mode": canva_render_plan.get("renderer_output_mode", "missing"),
            "renderer_selection_status": canva_render_plan.get("renderer_selection_status", "missing"),
            "renderer_registry_status": canva_render_plan.get("renderer_registry_status", "missing"),
            "canva_blocker_status": canva_render_plan.get("canva_blocker_status", "missing"),
            "canva_blockers": canva_render_plan.get("canva_blockers", []),
            "approved_renderer_coverage_status": canva_render_plan.get("approved_renderer_coverage_status", "missing"),
            "approved_renderer_coverage_count": canva_render_plan.get("approved_renderer_coverage_count", 0),
            "approved_renderer_required_count": canva_render_plan.get("approved_renderer_required_count", 0),
            "free_fallback_renderer_status": canva_render_plan.get("free_fallback_renderer_status", "missing"),
            "free_fallback_candidate_count": canva_render_plan.get("free_fallback_candidate_count", 0),
            "free_fallback_required_candidate_count": canva_render_plan.get("free_fallback_required_candidate_count", 0),
            "renderer_provenance_status": canva_render_plan.get("renderer_provenance_status", "missing"),
            "canva_source_filled_thumbnail_count": canva_render_plan.get("canva_source_filled_thumbnail_count", 0),
            "canva_required_source_filled_thumbnail_count": canva_render_plan.get("canva_required_source_filled_thumbnail_count", 0),
            "canva_all_thumbnails_covered_status": canva_render_plan.get("canva_all_thumbnails_covered_status", "missing"),
            "canva_thumbnail_qa_integration_status": canva_render_plan.get("canva_thumbnail_qa_integration_status", "missing"),
            "canva_negative_tests_status": canva_render_plan.get("negative_tests", {}).get("status", "missing"),
            "canva_preview_capture_status": canva_render_plan.get("preview_capture_status", "missing"),
            "canva_local_audit_packet_status": canva_render_plan.get("local_audit_packet_status", "missing"),
            "canva_vs_local_renderer_tournament_status": canva_render_plan.get("canva_vs_local_renderer_tournament_status", "missing"),
            "canva_candidate_reference_count": canva_render_plan.get("canva_candidate_reference_count", 0),
            "canva_owner_final_approval_packet_v2_status": canva_render_plan.get("owner_final_approval_packet_v2_status", "missing"),
            "canva_fully_automated_city_run_smoke_status": canva_render_plan.get("fully_automated_city_run_smoke_status", "missing"),
            "canva_export_local_file_bridge_status": canva_render_plan.get("export_local_file_bridge_status", "missing"),
            "canva_source_bridge_status": canva_render_plan.get("canva_source_bridge_status", "missing"),
            "canva_source_url_normalization_matrix_status": canva_render_plan.get("canva_source_url_normalization_matrix_status", "missing"),
            "canva_source_upload_fallback_ladder_status": canva_render_plan.get("canva_source_upload_fallback_ladder_status", "missing"),
            "canva_source_backed_base_composite_bridge_status": canva_render_plan.get("canva_source_backed_base_composite_bridge_status", "missing"),
            "canva_visual_source_presence_audit_status": canva_render_plan.get("canva_visual_source_presence_audit_status", "missing"),
            "canva_preview_text_audit_v2_status": canva_render_plan.get("canva_preview_text_audit_v2_status", "missing"),
            "canva_draft_readiness_status": canva_render_plan.get("canva_draft_readiness_status", "missing"),
            "canva_production_readiness_status": canva_render_plan.get("canva_production_readiness_status", "missing"),
            "canva_output_mode": canva_render_plan.get("canva_output_mode", "missing"),
            "canva_source_bridge_base_composite_count": canva_render_plan.get("canva_source_bridge_base_composite_count", 0),
            "canva_source_bridge_required_base_composite_count": canva_render_plan.get("canva_source_bridge_required_base_composite_count", 0),
            "canva_source_bridge_production_blocker": canva_render_plan.get("canva_source_bridge_production_blocker", "missing"),
            "canva_no_ai_render_plan_status": canva_no_ai_render_plan.get("canva_no_ai_render_plan_status", "missing"),
            "canva_no_ai_production_mode_status": canva_no_ai_render_plan.get("canva_no_ai_production_mode_status", "missing"),
            "canva_no_ai_operation_allowlist_status": canva_no_ai_render_plan.get("canva_operation_allowlist_status", "missing"),
            "canva_no_ai_font_preservation_audit_v2_status": canva_no_ai_render_plan.get("canva_template_font_preservation_audit_v2_status", "missing"),
            "canva_no_ai_generation_status": canva_no_ai_render_plan.get("canva_ai_generation_status", "missing"),
            "canva_no_ai_magic_layers_status": canva_no_ai_render_plan.get("magic_layers_image_to_design_status", "missing"),
            "canva_no_ai_edit_plan_count": canva_no_ai_render_plan.get("edit_plan_count", 0),
            "canva_no_ai_required_edit_plan_count": canva_no_ai_render_plan.get("required_edit_plan_count", 0),
            "canva_no_ai_preview_export_smoke_status": canva_no_ai_render_plan.get("canva_no_ai_preview_export_smoke_status", "missing"),
            "canva_no_ai_live_validation_status": canva_no_ai_live_validation.get("canva_no_ai_live_validation_status", "missing"),
            "canva_no_ai_live_copy_status": canva_no_ai_live_validation.get("canva_copy_status", "missing"),
            "canva_no_ai_live_draft_transaction_status": canva_no_ai_live_validation.get("draft_transaction_status", "missing"),
            "canva_no_ai_live_export_local_file_bridge_status": canva_no_ai_live_validation.get("export_local_file_bridge_status", "missing"),
            "external_font_registry_status": external_font_registry.get("external_font_registry_status", "missing"),
            "external_font_foundry_count": external_font_registry.get("foundry_count", 0),
            "external_font_download_status": external_font_registry.get("external_font_download_status", "missing"),
            "external_font_license_gate_status": font_license_gate.get("external_font_license_gate_status", "missing"),
            "bundled_font_license_gate_status": font_license_gate.get("bundled_font_license_gate_status", "missing"),
            "bundled_font_license_pass_count": font_license_gate.get("bundled_font_pass_count", 0),
            "bundled_font_count": font_license_gate.get("bundled_font_count", 0),
            "better_font_candidate_tournament_contract_status": font_license_gate.get("better_font_candidate_tournament_contract_status", "missing"),
            "canva_similarity_scoring_contract_status": font_license_gate.get("canva_similarity_scoring_contract_status", "missing"),
            "click_desire_font_redteam_contract_status": font_license_gate.get("click_desire_font_redteam_contract_status", "missing"),
            "youtube_ab_variant_count": len(youtube_ab_readiness.get("variants", [])) if isinstance(youtube_ab_readiness.get("variants", []), list) else 0,
            "thumbnail_replacement_status": thumbnail_replacement.get("status", "not_performed"),
            "approved_candidate": thumbnail_replacement.get("approved_candidate", ""),
            "youtube_video_id": thumbnail_replacement.get("youtube_video_id", ""),
            "public_publish": thumbnail_replacement.get("public_publish", "not_performed"),
            "other_youtube_mutations": thumbnail_replacement.get("other_youtube_mutations", "not_performed"),
        },
        "automation": {
            "full_auto_production_status": full_auto_production.get("full_auto_production_status", "missing"),
            "shorts_target": full_auto_production.get("shorts_target", 0),
            "public_youtube_mutation": full_auto_production.get("public_youtube_mutation", "not_performed"),
            "voice_visual_match_status": voice_visual_match.get("voice_visual_match_status", "missing"),
            "matched_media_row_count": voice_visual_match.get("matched_media_row_count", 0),
            "proof_visual_row_count": voice_visual_match.get("proof_visual_row_count", 0),
            "finished_video_watchdown_status": finished_watchdown.get("finished_video_watchdown_status", "missing"),
            "finished_video_duration_seconds": finished_watchdown.get("duration_seconds"),
            "blank_or_black_segment_status": finished_watchdown.get("blank_or_black_segment_status", "missing"),
        },
        "performance": build_performance_state(video_id),
        "monetization": build_monetization_state(video_id),
        "next_actions": [
            "Review the source proof in the active city file before approving assets.",
            "Verify historical image rights and AI reconstruction labels before private upload.",
            "Inspect all three thumbnail candidates for city/source promise match.",
            "Review all three Shorts for city clue, hook strength, and related-video bridge.",
            "Approve private/unlisted upload only after all gates pass.",
        ],
    }


def approve_asset_type(video_id, asset_type):
    return apply_review_action(video_id, "approve", asset_type=asset_type, reason="dashboard_approval")


def review_action(video_id, payload):
    return apply_review_action(
        video_id,
        payload.get("action", ""),
        asset_type=payload.get("asset_type", ""),
        asset_id=payload.get("asset_id") or None,
        filename=payload.get("filename") or None,
        reason=payload.get("reason") or "dashboard_review",
    )


def dashboard_html():
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pattern Lab Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #020607;
      --panel: rgba(8, 24, 27, 0.86);
      --panel-strong: rgba(5, 15, 18, 0.96);
      --line: rgba(19, 216, 232, 0.26);
      --line-strong: rgba(19, 216, 232, 0.66);
      --cyan: #13d8e8;
      --gold: #f2c84b;
      --red: #ff6b61;
      --green: #38d989;
      --text: #f5f7f8;
      --muted: #9fb1b6;
      --shadow: rgba(0, 240, 255, 0.12);
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; }
    body {
      min-height: 100%;
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 18% 8%, rgba(19,216,232,0.16), transparent 28rem),
        radial-gradient(circle at 78% 18%, rgba(242,200,75,0.09), transparent 24rem),
        linear-gradient(rgba(19,216,232,0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(19,216,232,0.055) 1px, transparent 1px),
        var(--bg);
      background-size: auto, auto, 64px 64px, 64px 64px, auto;
      color: var(--text);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, transparent, rgba(19,216,232,0.08), transparent),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.026) 0, rgba(255,255,255,0.026) 1px, transparent 1px, transparent 7px);
      mix-blend-mode: screen;
      opacity: 0.46;
    }
    .shell { position: relative; padding: 28px 32px 48px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 18px;
    }
    .brand-panel {
      min-height: 240px;
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line-strong);
      border-radius: 10px;
      background:
        linear-gradient(100deg, rgba(5, 15, 18, 0.98), rgba(5, 31, 35, 0.91)),
        linear-gradient(90deg, rgba(19,216,232,0.10), transparent);
      box-shadow: 0 0 42px var(--shadow), inset 0 0 54px rgba(19,216,232,0.06);
      padding: 34px;
    }
    .brand-panel::after {
      content: "";
      position: absolute;
      inset: auto -10% 0 -10%;
      height: 5px;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--gold), var(--cyan), transparent);
      filter: blur(0.5px);
    }
    .eyebrow {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: var(--cyan);
      font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }
    .eyebrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 99px;
      background: var(--cyan);
      box-shadow: 0 0 18px var(--cyan);
    }
    h1 {
      margin: 14px 0 6px;
      font-size: clamp(42px, 6vw, 88px);
      line-height: 0.92;
      letter-spacing: 0;
    }
    .tagline {
      margin: 0 0 22px;
      color: #d8e4e7;
      font-size: clamp(18px, 2vw, 28px);
      font-weight: 800;
    }
    .mission {
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.55;
    }
    h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 13px; color: var(--cyan); text-transform: uppercase; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    p { color: var(--muted); line-height: 1.5; }
    main { display: grid; gap: 18px; }
    .grid { display:grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap:16px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 18px;
      box-shadow: inset 0 0 32px rgba(19,216,232,0.04);
      backdrop-filter: blur(14px);
    }
    .panel--hero { background: var(--panel-strong); }
    .span-8 { grid-column:span 8; } .span-4 { grid-column:span 4; } .span-6 { grid-column:span 6; } .span-12 { grid-column:span 12; }
    .status-card {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 14px;
      min-height: 240px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 13px;
      width: fit-content;
    }
    .dot { width:9px; height:9px; border-radius:99px; background:var(--red); box-shadow:0 0 16px var(--red); }
    .dot.ok { background:var(--green); box-shadow:0 0 16px var(--green); }
    .proof-stack { display: grid; gap: 10px; }
    .proof-card {
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 12px;
      background: rgba(2, 9, 11, 0.64);
    }
    .proof-card strong { display:block; font-size: 28px; line-height: 1; color: var(--cyan); }
    .proof-card--gold strong, .proof-card--gold h3 { color: var(--gold); }
    .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:16px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:14px; background:rgba(3,10,12,0.58); }
    .metric b { display:block; font-size:28px; color:var(--cyan); line-height: 1; }
    .approvals { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .approval-card { border:1px solid var(--line); border-radius:8px; padding:12px; background:rgba(3,10,12,0.58); }
    .approval-card h3 { margin-bottom:10px; }
    .approval-actions { display:grid; grid-template-columns:1fr; gap:8px; }
    button { width:100%; border:1px solid var(--line); background:#081013; color:var(--text); border-radius:8px; padding:12px; font-weight:800; cursor:pointer; }
    button:hover { border-color:var(--cyan); }
    button.approved { color:#06110b; background:var(--green); border-color:var(--green); }
    button.danger { border-color: rgba(255,107,97,0.62); color: #ffd3cf; }
    button.secondary { border-color: rgba(242,200,75,0.55); color: var(--gold); }
    video, img { width:100%; border-radius:8px; border:1px solid var(--line); background:#020405; }
    .media-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    ul { padding-left:20px; color:var(--muted); }
    a { color:var(--cyan); text-decoration:none; }
    .warn { color:var(--gold); }
    .small { font-size:13px; color:var(--muted); }
    .readiness-rail { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 14px; }
    .rail-step {
      position: relative;
      min-height: 74px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      overflow: hidden;
      background: rgba(3,10,12,0.66);
    }
    .rail-step::after {
      content: "";
      position: absolute;
      inset: auto 0 0;
      height: 3px;
      background: var(--red);
    }
    .rail-step.complete::after { background: var(--green); }
    .rail-step b { display: block; font-size: 12px; text-transform: uppercase; color: #dfe9eb; }
    .rail-step span { display: block; margin-top: 5px; color: var(--muted); font-size: 12px; }
    .media-title { display:flex; align-items:center; justify-content:space-between; gap: 12px; }
    .media-title code { color: var(--cyan); font-size: 12px; }
    .performance-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .performance-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: rgba(3,10,12,0.62);
    }
    .performance-card b {
      display: block;
      margin: 6px 0;
      color: var(--gold);
      font-size: 22px;
      line-height: 1;
    }
    .decision-strip {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 12px;
      margin-top: 14px;
    }
    .decision-label {
      border: 1px solid rgba(242,200,75,0.5);
      border-radius: 8px;
      padding: 14px;
      background: rgba(242,200,75,0.08);
      color: var(--gold);
      font-weight: 900;
      text-transform: uppercase;
    }
    .console {
      margin: 0;
      padding: 14px;
      border: 1px solid rgba(242,200,75,0.36);
      border-radius: 8px;
      color: #dfe9eb;
      background: rgba(2, 6, 7, 0.82);
      white-space: pre-wrap;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    @media (max-width: 1100px) {
      .hero { grid-template-columns: 1fr; }
      .span-8,.span-4,.span-6 { grid-column:span 12; }
      .approvals,.metrics,.media-grid,.readiness-rail,.performance-grid,.decision-strip { grid-template-columns:1fr; }
      .shell { padding:18px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="brand-panel">
        <span class="eyebrow">Pattern Lab Control</span>
        <h1>Pattern Lab</h1>
        <p class="tagline">Hidden systems behind American cities.</p>
        <p class="mission">Review the active Pattern Lab city file, approve rights-safe assets, inspect Shorts, and track the learning loop before any private upload or public publish decision.</p>
      </div>
      <aside class="panel status-card">
        <div>
          <h2>Upload State</h2>
          <span class="status"><span id="status-dot" class="dot"></span><span id="status">Loading</span></span>
        </div>
        <div class="proof-stack">
          <div class="proof-card">
            <h3>City</h3>
            <strong id="pattern-score">--</strong>
            <span class="small">City-file assets</span>
          </div>
          <div class="proof-card proof-card--gold">
            <h3>Source</h3>
            <strong id="criteria-score">--</strong>
            <span class="small">Source gates passed</span>
          </div>
          <div class="proof-card">
            <h3>System</h3>
            <strong id="proof-score">--</strong>
            <span class="small">Human review required</span>
          </div>
        </div>
      </aside>
    </section>
    <main>
    <section class="grid">
      <div class="panel panel--hero span-8">
        <h2>Command Center</h2>
        <p id="generated" class="small"></p>
        <div class="metrics">
          <div class="metric"><b id="long-duration">--</b><span>Long-form seconds</span></div>
          <div class="metric"><b id="short-count">--</b><span>Shorts ready</span></div>
          <div class="metric"><b id="blocker-count">--</b><span>Open blockers</span></div>
          <div class="metric"><b id="approval-count">--</b><span>Approval groups</span></div>
        </div>
        <div class="readiness-rail" id="readiness-rail"></div>
      </div>
      <div class="panel span-4">
        <h2>Next Actions</h2>
        <ul id="next-actions"></ul>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>Monetization Gates</h2><code id="monetization-status">pending</code></div>
        <p class="small">The channel optimizes for public long-form watch hours first, with Shorts used for discovery and subscriber growth.</p>
        <div class="performance-grid" id="monetization-cards"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <h2>Approval Gates</h2>
        <p class="small">Click only after you personally review the asset group. Reject/repair actions are logged so the system can learn what failed.</p>
        <div class="approvals" id="approvals"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>Thumbnail Quality Lab</h2><code id="thumbnail-process-status">loading</code></div>
        <p class="small">Current owner-preferred process: 20 rough concepts → 8 shortlisted → 5 review thumbnails → 3 production candidates, with city readability, semantic-image, no-filler-word, safe-zone, and search-shelf gates.</p>
        <div class="performance-grid" id="thumbnail-process-cards"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>Five Current-Process Thumbnail Examples</h2><code id="thumbnail-shelf-path"></code></div>
        <p class="small">These are the five review examples generated by OpenClaw Pattern Lab before it selects the three production candidates.</p>
        <div class="media-grid" id="thumbnail-review-concepts"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>Poster-Depth Thumbnail Experiments</h2><code id="poster-depth-path"></code></div>
        <p class="small">Local source-backed experiments testing hero-object depth, stronger mystery, and less template repetition. No YouTube mutation or paid tools.</p>
        <div class="media-grid" id="poster-depth-thumbnails"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-8">
        <div class="media-title"><h2>Long-Form Draft</h2><code>first proof visible in first 20s</code></div>
        <video id="long-form" controls playsinline></video>
      </div>
      <div class="panel span-4">
        <h2>Blockers</h2>
        <ul id="blockers"></ul>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <h2>Shorts</h2>
        <div class="media-grid" id="shorts"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>James Avatar Approval</h2><code id="visual-plan-path"></code></div>
        <p class="small">Approve exactly one stylized James concept before any avatar appears in a public video.</p>
        <div class="media-grid" id="avatar-concepts"></div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <div class="media-title"><h2>Learning Metrics</h2><code id="metrics-path"></code></div>
        <p class="small">These are the numbers that decide whether Pattern Lab doubles down, repackages, revises the hook, or retires a topic.</p>
        <div class="performance-grid" id="performance-cards"></div>
        <div class="decision-strip">
          <div class="decision-label" id="decision-label">pending</div>
          <div class="console" id="decision-summary"></div>
        </div>
      </div>
    </section>
    <section class="grid">
      <div class="panel span-4">
        <h2>Thumbnail A</h2>
        <img id="thumb-a" alt="Thumbnail A" />
      </div>
      <div class="panel span-4">
        <h2>Thumbnail B</h2>
        <img id="thumb-b" alt="Thumbnail B" />
      </div>
      <div class="panel span-4">
        <h2>Thumbnail C</h2>
        <img id="thumb-c" alt="Thumbnail C" />
      </div>
    </section>
    <section class="grid">
      <div class="panel span-12">
        <h2>Safety Lock</h2>
        <pre class="console" id="safety-lock">Public publishing blocked until explicit owner approval.</pre>
        <div class="approval-actions" id="publish-actions" style="margin-top:12px"></div>
      </div>
    </section>
    </main>
  </div>
  <script>
    async function api(path, options) {
      const video = new URLSearchParams(window.location.search).get("video") || "";
      const separator = path.includes("?") ? "&" : "?";
      const response = await fetch(video ? path + separator + "video=" + encodeURIComponent(video) : path, options);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    function seconds(value) { return value == null ? "--" : Math.round(value); }
    async function approve(type) {
      await api("/api/approve", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ asset_type:type, video_id:new URLSearchParams(window.location.search).get("video") || "" }) });
      await load();
    }
    async function reviewAction(action, type, reason, filename) {
      await api("/api/review-action", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ action:action, asset_type:type, reason:reason, filename:filename || "", video_id:new URLSearchParams(window.location.search).get("video") || "" }) });
      await load();
    }
    async function load() {
      const state = await api("/api/state");
      document.querySelector(".mission").textContent = "Hidden systems behind American cities for Video " + state.video_id + ". Review source proof, historical image rights, Shorts, and approval gates before any private upload or public publish decision.";
      document.getElementById("status").textContent = state.status.replaceAll("_", " ");
      document.getElementById("status-dot").className = "dot" + (state.status === "private-upload-ready" ? " ok" : "");
      document.getElementById("generated").textContent = "Updated " + state.generated_at + " | public publish " + state.public_publish.replaceAll("_", " ");
      document.getElementById("long-duration").textContent = seconds(state.media.long_form.duration_seconds);
      document.getElementById("short-count").textContent = state.media.shorts.filter(s => s.exists).length;
      document.getElementById("blocker-count").textContent = state.blockers.length;
      const groups = Object.values(state.approvals);
      const completeGroups = groups.filter(item => item.complete).length;
      const totalAssets = groups.reduce((sum, item) => sum + item.total, 0);
      const approvedAssets = groups.reduce((sum, item) => sum + item.approved, 0);
      document.getElementById("approval-count").textContent = completeGroups + "/" + groups.length;
      document.getElementById("pattern-score").textContent = totalAssets;
      document.getElementById("criteria-score").textContent = approvedAssets + "/" + totalAssets;
      document.getElementById("proof-score").textContent = state.status === "private-upload-ready" ? "PASS" : "REVIEW";
      document.getElementById("next-actions").innerHTML = state.next_actions.map(x => `<li>${x}</li>`).join("");
      document.getElementById("blockers").innerHTML = (state.blockers.length ? state.blockers : ["none"]).map(x => `<li>${x}</li>`).join("");
      document.getElementById("safety-lock").textContent = [
        "public_publish=" + state.public_publish,
        "status=" + state.status,
        "review_package_approved=" + String(state.review_package.approved),
        "private_upload_ready=" + String(state.status === "private-upload-ready"),
        "human_approval_required=true"
      ].join("\\n");
      document.getElementById("publish-actions").innerHTML = [
        `<button onclick="reviewAction('approve_review_package','','dashboard_review_package_approval')">Approve full review package</button>`,
        `<button class="secondary" onclick="reviewAction('approve_private_upload','','dashboard_private_upload_approval')">Approve private/unlisted upload</button>`,
        `<button class="danger" onclick="reviewAction('approve_public_publish','','dashboard_public_publish_approval_after_youtube_checks')">Approve public publish</button>`,
        `<button class="danger" onclick="reviewAction('kill_topic','topic','dashboard_topic_kill')">Kill topic</button>`,
        `<button class="secondary" onclick="reviewAction('revise_hook','video','dashboard_revise_hook')">Revise hook</button>`
      ].join("");
      document.getElementById("long-form").src = state.media.long_form.url;
      const thumbnails = state.media.thumbnails || [];
      document.getElementById("thumb-a").src = thumbnails[0]?.url || "";
      document.getElementById("thumb-b").src = thumbnails[1]?.url || "";
      document.getElementById("thumb-c").src = thumbnails[2]?.url || "";
      document.getElementById("shorts").innerHTML = state.media.shorts.map((item, index) => `<div><video controls playsinline src="${item.url}"></video><p class="small">Short ${index + 1} | ${seconds(item.duration_seconds)}s</p></div>`).join("");
      document.getElementById("visual-plan-path").textContent = state.media.visual_plan.path;
      document.getElementById("avatar-concepts").innerHTML = state.media.avatar_concepts.map((item, index) => {
        const label = String.fromCharCode(65 + index);
        return `<div><img src="${item.url}" alt="James avatar concept ${label}" /><p class="small">James avatar ${label}</p><div class="approval-actions"><button onclick="reviewAction('approve','avatar','dashboard_avatar_approval',item.filename)">Approve</button><button class="secondary" onclick="reviewAction('regenerate','avatar','dashboard_avatar_regenerate',item.filename)">Regenerate</button><button class="danger" onclick="reviewAction('reject','avatar','dashboard_avatar_reject',item.filename)">Reject</button></div></div>`;
      }).join("");
      document.getElementById("metrics-path").textContent = state.performance.path;
      document.getElementById("performance-cards").innerHTML = state.performance.cards.map((card) => `<div class="performance-card"><h3>${card.label}</h3><b>${card.value}</b><span class="small">${card.why}</span></div>`).join("");
      document.getElementById("monetization-status").textContent = state.monetization.gate_status + " | " + (state.monetization.topic_score ?? "pending") + "/" + state.monetization.threshold;
      document.getElementById("monetization-cards").innerHTML = [
        { label:"Lane", value:state.monetization.lane, why:state.monetization.sub_lane },
        { label:"Topic score", value:(state.monetization.topic_score ?? "pending") + "/" + state.monetization.threshold, why:"Reject below 80/100." },
        { label:"Review package", value:state.review_package.approved ? "approved" : "blocked", why:state.review_package.status },
        { label:"Private upload", value:state.monetization.private_upload_approved ? "approved" : "blocked", why:"Private/unlisted only." },
        { label:"Public publish", value:state.monetization.public_publish_approved ? "approved" : "locked", why:"Manual final approval only." },
        { label:"Subscribers", value:state.monetization.ypp_progress.subscribers ?? 0, why:"YPP subscriber progress." },
        { label:"Watch hours", value:state.monetization.ypp_progress.valid_public_long_form_watch_hours_12m ?? 0, why:"Primary monetization path." },
        { label:"Shorts views", value:state.monetization.ypp_progress.valid_public_shorts_views_90d ?? 0, why:"Secondary discovery path." },
        { label:"Calendar", value:state.monetization.calendar_rows + " rows", why:"Two-week cadence plan." }
      ].map((card) => `<div class="performance-card"><h3>${card.label}</h3><b>${card.value}</b><span class="small">${card.why}</span></div>`).join("");
      document.getElementById("decision-label").textContent = state.performance.decision_label.replaceAll("_", " ");
      document.getElementById("decision-summary").textContent = [
        "next_action=" + state.performance.next_action,
        "comments=" + state.performance.comments_signal_summary,
        "allowed_decisions=" + state.performance.decision_labels.join(", ")
      ].join("\\n");
      document.getElementById("readiness-rail").innerHTML = Object.entries(state.approvals).map(([type, item]) => {
        const cls = item.complete ? "complete" : "";
        return `<div class="rail-step ${cls}"><b>${type.replace("_"," ")}</b><span>${item.approved}/${item.total} approved</span></div>`;
      }).join("");
      document.getElementById("approvals").innerHTML = Object.entries(state.approvals).map(([type, item]) => {
        const cls = item.complete ? "approved" : "";
        const label = type.replace("_"," ");
        return `<div class="approval-card"><h3>${label}</h3><div class="small">${item.approved}/${item.total} approved</div><div class="approval-actions"><button class="${cls}" onclick="approve('${type}')">Approve</button><button class="secondary" onclick="reviewAction('regenerate','${type}','dashboard_requested_regeneration')">Regenerate</button><button class="danger" onclick="reviewAction('reject','${type}','dashboard_rejected_asset_group')">Reject</button></div></div>`;
      }).join("");
      document.getElementById("thumbnail-process-status").textContent = [
        "factory=" + state.thumbnail_process.factory_status,
        "quality=" + state.thumbnail_process.quality_status,
        "gates=" + state.thumbnail_process.aggregate_gate_status
      ].join(" | ");
      document.getElementById("thumbnail-process-cards").innerHTML = [
        { label:"Review concepts", value:state.thumbnail_process.review_concept_count + "/5", why:"Five examples shown below." },
        { label:"Selected candidates", value:state.thumbnail_process.selected_candidate_count + "/3", why:"Production candidates A/B/C." },
        { label:"Owner learning", value:state.thumbnail_process.owner_rating_learning_v2_status, why:"Uses the latest owner feedback baseline." },
        { label:"Renderer V4", value:state.thumbnail_process.current_style_renderer_v4_status, why:"Current owner-preferred renderer." },
        { label:"Example mode", value:state.thumbnail_process.real_city_source_first_examples_status, why:"Mode " + state.thumbnail_process.official_city_example_mode + "; ad-hoc mockups blocked=" + String(state.thumbnail_process.ad_hoc_mockup_blocked) + "." },
        { label:"Shelf test", value:state.thumbnail_process.search_shelf_test_status, why:"Phone/search-result readability gate." },
        { label:"Font QA", value:state.thumbnail_process.font_quality_status, why:"Main title font " + state.thumbnail_process.main_title_font_family + "; Impact fallback count " + state.thumbnail_process.impact_fallback_count + "; reject reasons " + (state.thumbnail_process.font_reject_reasons || []).length + "." },
        { label:"Font shelf", value:state.thumbnail_process.font_shelf_readability_status, why:"Typography previews " + state.thumbnail_process.font_shelf_preview_count + "/" + state.thumbnail_process.font_required_shelf_preview_count + " at phone/search sizes." },
        { label:"Font tournament", value:state.thumbnail_process.font_tournament_status, why:state.thumbnail_process.font_tournament_variant_count + " variants; " + state.thumbnail_process.font_tournament_winning_count + " scored 8/10+." },
        { label:"Bottom text fit", value:state.thumbnail_process.font_tournament_bottom_text_fit_status, why:"Support labels must stay useful, short, and unsqueezed." },
        { label:"Generic font block", value:state.thumbnail_process.font_tournament_generic_font_blocker_status, why:"Blocks default-looking city/main fonts." },
        { label:"Reference type match", value:state.thumbnail_process.font_tournament_reference_typography_match_status, why:"Compares scale, contrast, outline discipline, and phone readability against owner references." },
        { label:"Source candidates", value:state.thumbnail_process.source_candidate_tournament_status, why:state.thumbnail_process.source_candidate_minimum_candidate_count_per_topic + " candidates/topic; " + state.thumbnail_process.source_candidate_unique_local_source_image_count + " local source images." },
        { label:"Provider health", value:state.thumbnail_process.source_provider_health_status, why:state.thumbnail_process.source_provider_attempt_count + " provider attempts; " + state.thumbnail_process.source_provider_selected_count + " selected providers; single-source=" + String(state.thumbnail_process.single_source_dependency) + "." },
        { label:"Proof object gate", value:state.thumbnail_process.proof_object_dominance_gate_status, why:"Every thumbnail needs one dominant visual proof object tied to the hook." },
        { label:"Premium fonts V3", value:state.thumbnail_process.premium_display_font_pack_v3_status, why:state.thumbnail_process.premium_display_font_pack_v3_count + " expressive display fonts available." },
        { label:"20-variant tournament", value:state.thumbnail_process.thumbnail_tournament_20_status, why:state.thumbnail_process.thumbnail_tournament_variant_count + " source/font/composition variants; top " + state.thumbnail_process.top3_owner_review_count + " selected." },
        { label:"HTML/SVG renderer", value:state.thumbnail_process.html_renderer_status, why:state.thumbnail_process.html_renderer_1920_count + "/" + state.thumbnail_process.html_renderer_final_thumbnail_count + " final thumbnails rendered at 1920x1080." },
        { label:"Chrome Fontsource", value:state.thumbnail_process.chrome_fontsource_renderer_status, why:state.thumbnail_process.chrome_fontsource_open_license_font_count + " open-license fonts; OCR " + state.thumbnail_process.chrome_fontsource_ocr_pass_count + "/" + state.thumbnail_process.chrome_fontsource_ocr_required_count + "." },
        { label:"Render visual integrity", value:state.thumbnail_process.render_visual_integrity_status, why:state.thumbnail_process.render_visual_integrity_pass_count + "/" + state.thumbnail_process.render_visual_integrity_required_count + " thumbnails passed full-frame nonblank checks." },
        { label:"Source role integrity", value:state.thumbnail_process.source_role_integrity_status, why:state.thumbnail_process.source_role_integrity_pass_count + "/" + state.thumbnail_process.source_role_integrity_required_count + " primary sources are source-packet media, not unsafe bridge composites." },
        { label:"Topic-source match", value:state.thumbnail_process.topic_source_match_status, why:state.thumbnail_process.topic_source_match_pass_count + "/" + state.thumbnail_process.topic_source_match_required_count + " hooks matched their source proof." },
        { label:"Photo tournament", value:state.thumbnail_process.better_photo_tournament_status, why:state.thumbnail_process.better_photo_tournament_pass_count + "/" + state.thumbnail_process.better_photo_tournament_required_count + " selected images ranked top 3." },
        { label:"First 30s payoff", value:state.thumbnail_process.first_30_second_payoff_status, why:"The opening metadata must pay off the title/thumbnail promise." },
        { label:"Chat delivery artifacts", value:state.thumbnail_process.chat_delivery_artifacts_status, why:state.thumbnail_process.chat_delivery_artifact_count + "/" + state.thumbnail_process.chat_delivery_required_artifact_count + " immutable artifacts; run " + state.thumbnail_process.chat_delivery_run_id + "." },
        { label:"Chat delivery surface", value:state.thumbnail_process.chat_delivery_surface_status, why:state.thumbnail_process.chat_delivery_preview_format + "; lower half " + state.thumbnail_process.chat_delivery_lower_half_pass_count + "/" + state.thumbnail_process.chat_delivery_required_lower_half_pass_count + "; contact " + state.thumbnail_process.chat_delivery_contact_sheet_layout + " " + state.thumbnail_process.chat_delivery_contact_sheet_width + "x" + state.thumbnail_process.chat_delivery_contact_sheet_height + "." },
        { label:"Satori renderer", value:state.thumbnail_process.satori_resvg_sharp_renderer_status, why:state.thumbnail_process.satori_resvg_sharp_renderer_count + " Satori/resvg/Sharp fallback thumbnails rendered." },
        { label:"Penpot fallback", value:state.thumbnail_process.penpot_fallback_status, why:"Free editable-template fallback; export " + state.thumbnail_process.penpot_export_validation_status + "." },
        { label:"Photopea rescue", value:state.thumbnail_process.photopea_rescue_status, why:"Manual rescue path; production " + state.thumbnail_process.photopea_production_ready_status + "." },
        { label:"HTML/SVG mobile", value:state.thumbnail_process.html_renderer_mobile_shelf_preview_status, why:state.thumbnail_process.html_renderer_mobile_shelf_preview_count + "/" + state.thumbnail_process.html_renderer_required_mobile_shelf_preview_count + " mobile previews." },
        { label:"Click red-team", value:state.thumbnail_process.html_renderer_click_desire_redteam_status, why:"Blocks bland, filler, or non-curiosity thumbnail promises before owner review." },
        { label:"Watch-time A/B", value:state.thumbnail_process.html_renderer_watch_time_ab_packet_status, why:"Keeps title plus thumbnail variants ready for watch-time-based tests." },
        { label:"Shorts follow-up", value:state.thumbnail_process.shorts_followup_packet_status, why:state.thumbnail_process.shorts_followup_count + " Shorts point back to the long-form after URL exists." },
        { label:"Learning scaffold", value:state.thumbnail_process.performance_learning_loop_scaffold_status, why:state.thumbnail_process.performance_learning_checkpoint_count + " checkpoints; live analytics " + state.thumbnail_process.performance_learning_live_analytics_status + "." },
        { label:"Canva templates", value:state.thumbnail_process.canva_template_registry_status, why:state.thumbnail_process.canva_template_count + " template contracts; missing IDs " + state.thumbnail_process.canva_template_id_missing_count + "; production " + state.thumbnail_process.canva_template_production_ready_status + "." },
        { label:"Canva slots", value:state.thumbnail_process.canva_template_slot_schema_status, why:"Requires CITY, MAIN_HOOK, SUPPORT_LINE, and source-photo slots." },
        { label:"Canva font preserve", value:state.thumbnail_process.canva_font_preservation_gate_status, why:"Fonts are preserved by approved templates, not runtime font-family edits." },
        { label:"Canva render plan", value:state.thumbnail_process.canva_render_plan_status, why:state.thumbnail_process.canva_edit_plan_count + "/" + state.thumbnail_process.canva_required_edit_plan_count + " deterministic edit plans." },
        { label:"Renderer route", value:state.thumbnail_process.renderer_selection_status, why:"Selected " + state.thumbnail_process.selected_renderer + "; mode " + state.thumbnail_process.renderer_output_mode + "." },
        { label:"Approved coverage", value:state.thumbnail_process.approved_renderer_coverage_status, why:state.thumbnail_process.approved_renderer_coverage_count + "/" + state.thumbnail_process.approved_renderer_required_count + " candidates covered by Canva or approved free fallback." },
        { label:"Canva first", value:state.thumbnail_process.canva_blocker_status, why:"Canva primary=" + String(state.thumbnail_process.canva_primary_renderer) + "; blockers=" + ((state.thumbnail_process.canva_blockers || []).join(", ") || "none") + "." },
        { label:"Free fallback", value:state.thumbnail_process.free_fallback_renderer_status, why:state.thumbnail_process.free_fallback_candidate_count + "/" + state.thumbnail_process.free_fallback_required_candidate_count + " local fallback candidates; provenance " + state.thumbnail_process.renderer_provenance_status + "." },
        { label:"Canva execution", value:state.thumbnail_process.canva_template_execution_status, why:"Expected blocked state until owner-approved template IDs exist." },
        { label:"Canva QA", value:state.thumbnail_process.canva_thumbnail_qa_integration_status, why:"Negative fixtures " + state.thumbnail_process.canva_negative_tests_status + "; preview " + state.thumbnail_process.canva_preview_capture_status + "." },
        { label:"Canva vs local", value:state.thumbnail_process.canva_vs_local_renderer_tournament_status, why:"Canva references " + state.thumbnail_process.canva_candidate_reference_count + "; compares with local renderer." },
        { label:"Canva final approval", value:state.thumbnail_process.canva_owner_final_approval_packet_v2_status, why:"Final output still stops for owner approval." },
        { label:"Canva source bridge", value:state.thumbnail_process.canva_source_bridge_status, why:"URL matrix " + state.thumbnail_process.canva_source_url_normalization_matrix_status + "; fallback ladder " + state.thumbnail_process.canva_source_upload_fallback_ladder_status + "." },
        { label:"Canva source composites", value:state.thumbnail_process.canva_source_backed_base_composite_bridge_status, why:state.thumbnail_process.canva_source_bridge_base_composite_count + "/" + state.thumbnail_process.canva_source_bridge_required_base_composite_count + " source-backed base composites ready." },
        { label:"Canva output mode", value:state.thumbnail_process.canva_output_mode, why:"Draft " + state.thumbnail_process.canva_draft_readiness_status + "; production " + state.thumbnail_process.canva_production_readiness_status + "." },
        { label:"Canva export bridge", value:state.thumbnail_process.canva_export_local_file_bridge_status, why:state.thumbnail_process.canva_source_bridge_production_blocker },
        { label:"Canva no-AI plan", value:state.thumbnail_process.canva_no_ai_render_plan_status, why:state.thumbnail_process.canva_no_ai_edit_plan_count + "/" + state.thumbnail_process.canva_no_ai_required_edit_plan_count + " approved-template edit plans; AI=" + state.thumbnail_process.canva_no_ai_generation_status + "; Magic Layers=" + state.thumbnail_process.canva_no_ai_magic_layers_status + "." },
        { label:"Canva no-AI ops", value:state.thumbnail_process.canva_no_ai_operation_allowlist_status, why:"Allowed ops only; font preservation " + state.thumbnail_process.canva_no_ai_font_preservation_audit_v2_status + "; export " + state.thumbnail_process.canva_no_ai_preview_export_smoke_status + "." },
        { label:"Canva no-AI live", value:state.thumbnail_process.canva_no_ai_live_validation_status, why:"Copy " + state.thumbnail_process.canva_no_ai_live_copy_status + "; draft " + state.thumbnail_process.canva_no_ai_live_draft_transaction_status + "; export " + state.thumbnail_process.canva_no_ai_live_export_local_file_bridge_status + "." },
        { label:"External font registry", value:state.thumbnail_process.external_font_registry_status, why:state.thumbnail_process.external_font_foundry_count + " foundries registered; downloads " + state.thumbnail_process.external_font_download_status + "." },
        { label:"Font license gate", value:state.thumbnail_process.external_font_license_gate_status, why:"Bundled " + state.thumbnail_process.bundled_font_license_pass_count + "/" + state.thumbnail_process.bundled_font_count + "; better-font contract " + state.thumbnail_process.better_font_candidate_tournament_contract_status + "." },
        { label:"Font click red-team", value:state.thumbnail_process.click_desire_font_redteam_contract_status, why:"Blocks generic, low-energy, unreadable, non-thumbnail-loud font choices." },
        { label:"Type research", value:state.thumbnail_process.typography_market_research_status, why:"Read-only successful-channel typography principles; no copied competitor assets." },
        { label:"Reference library", value:state.thumbnail_process.reference_library_infrastructure_status, why:"Owner reference images " + state.thumbnail_process.reference_image_count + "/" + state.thumbnail_process.required_reference_image_count + "; status " + state.thumbnail_process.reference_library_status + "." },
        { label:"Reference anatomy", value:state.thumbnail_process.reference_analyzer_infrastructure_status, why:"Analyzer status " + state.thumbnail_process.reference_analyzer_status + "; no reference copying allowed." },
        { label:"Pop score", value:state.thumbnail_process.heuristic_pop_score_status, why:"Avg " + state.thumbnail_process.average_pop_score + "/10, min " + state.thumbnail_process.minimum_pop_score + "/10; reference match " + state.thumbnail_process.reference_match_score_status + "." },
        { label:"Hero object", value:state.thumbnail_process.hero_object_requirement_status, why:"Hero objects " + state.thumbnail_process.hero_object_count + "/" + state.thumbnail_process.poster_depth_thumbnail_count + "." },
        { label:"Poster-depth", value:state.thumbnail_process.poster_depth_renderer_status, why:"Local renderer; source-backed; no paid tools." },
        { label:"Template reuse", value:state.thumbnail_process.same_template_blocker_status, why:"Same-template violations " + state.thumbnail_process.same_template_reuse_violation_count + "." },
        { label:"Reference energy", value:state.thumbnail_process.owner_reference_style_adaptation_status, why:"Adapt vivid owner reference mechanics without copying." },
        { label:"No filler labels", value:state.thumbnail_process.filler_public_label_blocker_status, why:"Blocks SOURCE PHOTO, RECEIPT, and generic proof labels when they are not click-worthy." },
        { label:"No bare redactions", value:state.thumbnail_process.bare_redaction_blocker_status, why:"Blocks black bars without readable meaningful surrounding words." },
        { label:"Vivid colors", value:state.thumbnail_process.vivid_color_energy_status, why:"Blocks bland or muddy color systems." },
        { label:"Mobile shelf strip", value:state.thumbnail_process.mobile_shelf_strip_status, why:"Reference comparison " + state.thumbnail_process.mobile_shelf_reference_comparison_status + "." },
        { label:"Owner rating V3", value:state.thumbnail_process.owner_rating_learning_v3_status, why:"Liked formats " + state.thumbnail_process.owner_liked_format_count + " and hard reject reasons are machine-readable." },
        { label:"Title + thumbnail", value:state.thumbnail_process.title_thumbnail_pair_packet_status, why:state.thumbnail_process.title_thumbnail_pair_variant_count + " variants; " + state.thumbnail_process.youtube_native_test_ready + "." },
        { label:"Visible photos", value:state.thumbnail_process.visible_source_audit_status, why:"Real photo concepts " + state.thumbnail_process.visible_real_photo_count + "/" + state.thumbnail_process.review_concept_count + ", major photo regions " + state.thumbnail_process.photo_hero_or_major_inset_count + "/" + state.thumbnail_process.review_concept_count + ", map-only " + state.thumbnail_process.map_only_concept_count + ", unmanifested " + state.thumbnail_process.unmanifested_visible_source_count + "." },
        { label:"Rendered OCR", value:state.thumbnail_process.rendered_ocr_truth_status, why:"Misspellings " + state.thumbnail_process.ocr_misspelling_count + ", unexpected words " + state.thumbnail_process.ocr_unexpected_public_word_count + ", missing words " + state.thumbnail_process.ocr_missing_required_word_count + "." },
        { label:"Layout collisions", value:state.thumbnail_process.layout_collision_status, why:"Text collisions " + state.thumbnail_process.text_collision_count + ", subject coverage " + state.thumbnail_process.subject_coverage_violation_count + "." },
        { label:"Shape audit", value:state.thumbnail_process.purpose_labeled_shape_status, why:"Black boxes " + state.thumbnail_process.unexplained_black_box_count + ", random shapes " + state.thumbnail_process.random_shape_count + "." },
        { label:"Red-team", value:state.thumbnail_process.triple_review_redteam_status, why:"Open blockers " + state.thumbnail_process.redteam_open_blocker_count + "." },
        { label:"AI support", value:state.thumbnail_process.ai_support_asset_interface_status, why:"Support assets must remain non-proof." },
        { label:"Paid tools", value:state.thumbnail_process.paid_tool_used || state.thumbnail_process.paid_asset_used ? "blocked" : "none", why:"Free-first workflow only." },
        { label:"YouTube thumbnail", value:state.thumbnail_process.thumbnail_replacement_status, why:state.thumbnail_process.approved_candidate || "No replacement report." },
        { label:"Public publish", value:state.thumbnail_process.public_publish, why:"Must remain blocked without separate approval." },
      ].map((card) => `<div class="performance-card"><h3>${card.label}</h3><b>${card.value}</b><span class="small">${card.why}</span></div>`).join("");
      document.getElementById("thumbnail-shelf-path").textContent = state.media.thumbnail_search_shelf_test.path;
      document.getElementById("thumbnail-review-concepts").innerHTML = state.media.thumbnail_review_concepts.map((item, index) => {
        const label = String(index + 1);
        const selected = item.selected_for_production ? "selected candidate" : "review concept";
        return `<div><img src="${item.url}" alt="${item.headline}" /><p class="small"><b>${label}. ${item.headline}</b><br>${selected} | ${item.style_family}<br>${item.click_interest_trigger}</p></div>`;
      }).join("");
      document.getElementById("poster-depth-path").textContent = state.media.thumbnail_poster_depth_contact_sheet.path;
      document.getElementById("poster-depth-thumbnails").innerHTML = (state.media.thumbnail_poster_depth_examples || []).map((item, index) => {
        return `<div><img src="${item.url}" alt="Poster-depth thumbnail ${index + 1}" /><p class="small"><b>Poster-depth ${index + 1}</b><br>${item.path}</p></div>`;
      }).join("");
    }
    load().catch(error => { document.body.insertAdjacentHTML("beforeend", `<pre>${error.stack}</pre>`); });
  </script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def send_json(self, value, status=200):
        body = json.dumps(value, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        video_id = normalize_video_id(parse_qs(parsed.query).get("video", [""])[0])
        if path == "/" or path == "/dashboard":
            body = dashboard_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/state":
            self.send_json(build_state(video_id))
            return
        file_path = (BASE / path.lstrip("/")).resolve()
        if BASE not in file_path.parents and file_path != BASE:
            self.send_error(403)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = parsed.path
        video_id = normalize_video_id(parse_qs(parsed.query).get("video", [""])[0])
        if path == "/" or path == "/dashboard":
            body = dashboard_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        if path == "/api/state":
            body = json.dumps(build_state(video_id), indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query_video_id = normalize_video_id(parse_qs(parsed.query).get("video", [""])[0])
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        video_id = normalize_video_id(payload.get("video_id") or query_video_id)
        if path == "/api/approve":
            try:
                self.send_json(approve_asset_type(video_id, payload.get("asset_type", "")))
            except Exception as error:
                self.send_json({"ok": False, "error": str(error)}, status=400)
            return
        if path == "/api/review-action":
            try:
                self.send_json(review_action(video_id, payload))
            except Exception as error:
                self.send_json({"ok": False, "error": str(error)}, status=400)
            return
        self.send_error(404)


def main():
    parser = argparse.ArgumentParser(description="Serve or validate the Pattern Lab dashboard.")
    parser.add_argument("--check", action="store_true", help="Build dashboard state once without binding a port.")
    parser.add_argument("--video-id", default="")
    args = parser.parse_args()
    if args.check:
        state = build_state(args.video_id)
        print(json.dumps({"ok": True, "video_id": state["video_id"], "status": state["status"]}, indent=2))
        return
    server = ReusableThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Pattern Lab dashboard: http://127.0.0.1:{PORT}/dashboard")
    server.serve_forever()


if __name__ == "__main__":
    main()
