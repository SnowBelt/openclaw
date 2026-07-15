#!/usr/bin/env python3
import argparse
import csv
import json
import re
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_motion_polish import build_motion_polish_report
from patternlab_visual_variety import build_visual_variety_report

MIN_HISTORICAL = 20
MIN_MODERN = 10
MIN_REAL_RUNTIME_SHARE = 0.90
MAX_GENERATED_RUNTIME_SHARE = 0.08
MAX_VISUAL_BEAT_SECONDS = 12.0
MAX_WEAK_MATCH_SHARE = 0.10
MAX_FALLBACK_SHARE = 0.10
LEGACY_FULL_SCREEN_SLIDES = {
    "images/city_source_map.png",
    "images/archival_evidence_board.png",
    "images/then_now_structure.png",
    "images/subscribe_city_file_card.png",
}
OLD_PHOTO_BACKED_SUPPORT_COMPOSITES = {
    "source-packet/visual-rebuild/photo-backed-support/map-system-photo-overlay.jpg",
    "source-packet/visual-rebuild/photo-backed-support/archival-evidence-photo-overlay.jpg",
    "source-packet/visual-rebuild/photo-backed-support/then-now-photo-comparison.jpg",
    "source-packet/visual-rebuild/photo-backed-support/source-proof-photo-collage.jpg",
    "source-packet/visual-rebuild/photo-backed-support/subscribe-photo-collage.jpg",
}
REQUIRED_SOURCE_GROUNDED_OVERLAYS = {
    "source-packet/visual-rebuild/source-grounded-overlays/source-proof-source-grounded-collage.jpg",
    "source-packet/visual-rebuild/source-grounded-overlays/map-system-source-grounded-overlay.jpg",
    "source-packet/visual-rebuild/source-grounded-overlays/archival-evidence-source-grounded-overlay.jpg",
    "source-packet/visual-rebuild/source-grounded-overlays/then-now-source-grounded-comparison.jpg",
    "source-packet/visual-rebuild/source-grounded-overlays/subscribe-source-grounded-collage.jpg",
}


def read_ledger(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def parse_beats(path):
    beats = []
    if not path.exists():
        return beats
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^-\s*(\d+):\s*([0-9.]+)s-([0-9.]+)s\s*\|\s*([^|]+)\|\s*role=([^|]+)\|", line)
        if not match:
            continue
        start = float(match.group(2))
        end = float(match.group(3))
        if end <= start:
            continue
        beats.append({
            "index": int(match.group(1)),
            "start": start,
            "end": end,
            "duration": end - start,
            "path": match.group(4).strip(),
            "role": match.group(5).strip(),
            "matched_narration": "Matched narration" in line,
            "has_match_metadata": all(
                marker in line
                for marker in ["match_score=", "match_strength=", "match_dimensions=", "source_role=", "fallback_used=", "visual_category="]
            ),
        })
    return beats


def add_check(checks, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})


def build_visual_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    ledger = read_ledger(root / "rights-ledger.csv")
    manifest = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    visual_match_report = approval / "visual-match-report.json"
    visual_match = read_json(visual_match_report)
    motion_polish, _motion_json_report, motion_md_report = build_motion_polish_report(video_id)
    visual_variety, _visual_variety_json_report, visual_variety_md_report = build_visual_variety_report(video_id)
    beats = parse_beats(plan)
    historical_rows = [r for r in ledger if r.get("source_class") == "historical_evidence" and "source-packet/visual-rebuild" in r.get("filename", "")]
    modern_rows = [r for r in ledger if r.get("source_class") == "modern_context" and "source-packet/visual-rebuild" in r.get("filename", "")]
    non_proof = [beat for beat in beats if beat["role"] != "source_proof"]
    total_runtime = sum(beat["duration"] for beat in non_proof)
    photo_backed_beats = [beat for beat in non_proof if "source-packet/visual-rebuild" in beat["path"]]
    all_rebuild_beats = [beat for beat in beats if "source-packet/visual-rebuild" in beat["path"]]
    source_grounded_overlay_beats = [
        beat for beat in all_rebuild_beats if "source-packet/visual-rebuild/source-grounded-overlays/" in beat["path"]
    ]
    old_photo_backed_support_beats = [
        beat for beat in beats if beat["path"] in OLD_PHOTO_BACKED_SUPPORT_COMPOSITES or "source-packet/visual-rebuild/photo-backed-support/" in beat["path"]
    ]
    used_paths = {beat["path"] for beat in beats}
    missing_source_grounded_overlays = sorted(REQUIRED_SOURCE_GROUNDED_OVERLAYS - used_paths)
    generated_beats = [beat for beat in non_proof if beat not in photo_backed_beats]
    generated_only_beats = [
        beat
        for beat in non_proof
        if beat["path"].startswith("images/") and beat["path"] not in LEGACY_FULL_SCREEN_SLIDES
    ]
    full_screen_non_picture_slides = [
        beat for beat in beats if beat["path"] in LEGACY_FULL_SCREEN_SLIDES or beat["path"] == "artifact-proof-clip.mp4"
    ]
    modern_beats = [beat for beat in photo_backed_beats if "modern-context" in beat["path"]]
    historical_beats = [beat for beat in photo_backed_beats if "/historical/" in beat["path"] or "historical/" in beat["path"]]
    real_runtime = sum(beat["duration"] for beat in photo_backed_beats)
    generated_runtime = sum(beat["duration"] for beat in generated_beats)
    generated_only_runtime = sum(beat["duration"] for beat in generated_only_beats)
    real_share = real_runtime / total_runtime if total_runtime else 0
    generated_share = generated_runtime / total_runtime if total_runtime else 1
    generated_only_share = generated_only_runtime / total_runtime if total_runtime else 1
    longest_non_proof_beat = max((beat["duration"] for beat in non_proof), default=0)
    narration_matched_beats = [
        beat
        for beat in non_proof
        if "source-packet/visual-rebuild" in beat["path"] and beat.get("matched_narration")
    ]
    beats_with_match_metadata = [beat for beat in non_proof if beat.get("has_match_metadata")]
    checks = []
    add_check(checks, "manifest_exists", manifest.exists(), display_path(manifest))
    add_check(checks, "historical_asset_count", len(historical_rows) >= MIN_HISTORICAL, f"{len(historical_rows)} visual-rebuild historical assets")
    add_check(checks, "modern_context_asset_count", len(modern_rows) >= MIN_MODERN, f"{len(modern_rows)} visual-rebuild modern context assets")
    add_check(checks, "visual_plan_exists", plan.exists(), display_path(plan))
    add_check(checks, "visual_plan_uses_rebuild_media", bool(photo_backed_beats), f"{len(photo_backed_beats)} rebuild-media beats")
    add_check(checks, "historical_media_used", bool(historical_beats), f"{len(historical_beats)} historical rebuild beats")
    add_check(checks, "modern_context_used", bool(modern_beats), f"{len(modern_beats)} modern context rebuild beats")
    add_check(checks, "source_grounded_real_runtime_majority", real_share >= MIN_REAL_RUNTIME_SHARE, f"source-grounded/real media share {real_share:.1%}")
    add_check(
        checks,
        "generated_only_runtime_within_support_cap",
        generated_only_share <= MAX_GENERATED_RUNTIME_SHARE,
        f"generated-only runtime share {generated_only_share:.1%} (maximum {MAX_GENERATED_RUNTIME_SHARE:.0%})",
    )
    add_check(checks, "full_screen_non_picture_slide_count", len(full_screen_non_picture_slides) == 0, f"{len(full_screen_non_picture_slides)} full-screen non-picture slide beats")
    add_check(checks, "source_grounded_overlay_count", len(source_grounded_overlay_beats) >= 5, f"{len(source_grounded_overlay_beats)} source-grounded overlay beats")
    add_check(checks, "required_source_grounded_overlays_present", not missing_source_grounded_overlays, f"missing {len(missing_source_grounded_overlays)} required source-grounded overlays")
    add_check(checks, "old_photo_backed_support_composites_absent", len(old_photo_backed_support_beats) == 0, f"{len(old_photo_backed_support_beats)} old photo-backed support beats")
    add_check(checks, "generated_graphics_runtime_cap", generated_share <= MAX_GENERATED_RUNTIME_SHARE, f"generated-only/support share {generated_share:.1%}")
    add_check(checks, "not_ai_graphics_dominant", len(photo_backed_beats) > len(generated_beats), f"source-grounded/real beats {len(photo_backed_beats)} vs generated-only/support beats {len(generated_beats)}")
    add_check(checks, "dense_visual_change_cadence", longest_non_proof_beat <= MAX_VISUAL_BEAT_SECONDS + 0.05, f"longest non-proof beat {longest_non_proof_beat:.1f}s")
    add_check(checks, "narration_matched_real_media", len(narration_matched_beats) >= max(1, int(len(photo_backed_beats) * 0.8)), f"{len(narration_matched_beats)} narration-matched real-media beats")
    add_check(checks, "visual_match_report_exists", visual_match_report.exists(), display_path(visual_match_report))
    add_check(checks, "visual_match_report_passes", visual_match.get("status") == "pass", f"status {visual_match.get('status', 'missing')}")
    add_check(checks, "visual_match_metadata_complete", len(beats_with_match_metadata) == len(non_proof), f"{len(beats_with_match_metadata)}/{len(non_proof)} non-proof beats")
    add_check(checks, "weak_visual_match_share", visual_match.get("weak_share", 1) <= MAX_WEAK_MATCH_SHARE, f"weak share {visual_match.get('weak_share', 1):.1%}")
    add_check(checks, "fallback_visual_match_share", visual_match.get("fallback_share", 1) <= MAX_FALLBACK_SHARE, f"fallback share {visual_match.get('fallback_share', 1):.1%}")
    add_check(checks, "motion_polish_report_passes", motion_polish.get("status") == "pass", display_path(motion_md_report))
    add_check(checks, "visual_variety_report_passes", visual_variety.get("status") == "pass", display_path(visual_variety_md_report))
    blockers = [f"{c['name']}: {c['detail']}" for c in checks if not c["passed"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "manifest": display_path(manifest),
        "visual_plan": display_path(plan),
        "historical_asset_count": len(historical_rows),
        "modern_context_asset_count": len(modern_rows),
        "real_runtime_seconds": round(real_runtime, 2),
        "generated_runtime_seconds": round(generated_runtime, 2),
        "generated_only_runtime_seconds": round(generated_only_runtime, 2),
        "real_runtime_share": round(real_share, 4),
        "generated_runtime_share": round(generated_share, 4),
        "generated_only_runtime_share": round(generated_only_share, 4),
        "full_screen_non_picture_slide_count": len(full_screen_non_picture_slides),
        "source_grounded_overlay_count": len(source_grounded_overlay_beats),
        "old_photo_backed_support_composite_count": len(old_photo_backed_support_beats),
        "missing_source_grounded_overlays": missing_source_grounded_overlays,
        "longest_non_proof_beat_seconds": round(longest_non_proof_beat, 2),
        "visual_match_report": display_path(visual_match_report),
        "visual_match_status": visual_match.get("status", "missing"),
        "visual_match_weak_share": visual_match.get("weak_share", 1),
        "visual_match_fallback_share": visual_match.get("fallback_share", 1),
        "motion_polish_report": display_path(motion_md_report),
        "motion_polish_status": motion_polish.get("status", "missing"),
        "motion_polish_documentary_share": motion_polish.get("documentary_motion_share", 0),
        "motion_polish_requires_replacement_review_upload": motion_polish.get("local_rerender_requires_review_upload", False),
        "visual_variety_report": display_path(visual_variety_md_report),
        "visual_variety_status": visual_variety.get("status", "missing"),
        "visual_variety_distinct_category_count": visual_variety.get("distinct_category_count", 0),
        "visual_variety_distinct_categories": visual_variety.get("distinct_categories", []),
        "visual_variety_max_category_runtime_share": visual_variety.get("max_category_runtime_share", 1),
        "beats_with_match_metadata": len(beats_with_match_metadata),
        "total_non_proof_beats": len(non_proof),
        "checks": checks,
        "blockers": blockers,
    }
    json_path = approval / "visual-quality-report.json"
    md_path = approval / "visual-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Visual Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Source-grounded/real media runtime share: {real_share:.1%}",
        f"Generated-only/support runtime share: {generated_share:.1%}",
        f"Generated-only runtime: {generated_only_runtime:.1f}s",
        f"Full-screen non-picture slide count: {len(full_screen_non_picture_slides)}",
        f"Source-grounded overlay beat count: {len(source_grounded_overlay_beats)}",
        f"Old photo-backed support composite count: {len(old_photo_backed_support_beats)}",
        f"Visual match report: {visual_match.get('status', 'missing')}",
        f"Visual weak-match share: {visual_match.get('weak_share', 1):.1%}",
        f"Visual fallback-match share: {visual_match.get('fallback_share', 1):.1%}",
        f"Motion polish report: {motion_polish.get('status', 'missing')}",
        f"Motion documentary share: {motion_polish.get('documentary_motion_share', 0):.1%}",
        f"Visual variety report: {visual_variety.get('status', 'missing')}",
        f"Visual variety categories: {visual_variety.get('distinct_category_count', 0)}",
        f"Visual variety max category share: {visual_variety.get('max_category_runtime_share', 1):.1%}",
        "",
        "## Checks",
        "",
    ]
    lines.extend([f"- {c['name']}: {'pass' if c['passed'] else 'fail'} ({c['detail']})" for c in checks])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {b}" for b in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab visual aesthetics for real-media majority.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json, md = build_visual_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Visual quality report: {display_path(md)}")
    if payload["blockers"]:
        for blocker in payload["blockers"]:
            print(f"- {blocker}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
