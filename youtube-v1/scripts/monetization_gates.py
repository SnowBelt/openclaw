#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, media_duration_seconds, output_root, utc_now
from patternlab_content_quality import build_content_quality_report
from patternlab_long_form_quality import build_long_form_quality_report
from patternlab_shorts_quality import build_shorts_quality_report
from patternlab_thumbnail_quality import build_thumbnail_quality_report


STRATEGY_PATH = BASE / "state" / "monetization" / "strategy.json"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_ledger(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def weighted_score(strategy, video_config):
    weights = strategy["topic_scoring_weights"]
    scores = video_config["topic_scores"]
    weighted = 0.0
    for key, weight in weights.items():
        weighted += (float(scores.get(key, 0)) / 10.0) * float(weight)
    return round(weighted, 1)


def parse_metadata_json(root):
    metadata = root / "approval" / "upload-metadata.json"
    if not metadata.exists():
        return None
    return read_json(metadata)


def check_required_package(root, video_config):
    packaging = video_config.get("packaging_gates", {})
    metadata = parse_metadata_json(root)
    checks = []
    if metadata is None:
        checks.append(("upload_metadata", False, "upload metadata is missing"))
        return checks

    title_options = metadata.get("title_options") or []
    tags = metadata.get("tags") or []
    chapters = metadata.get("chapters") or []
    shorts = metadata.get("shorts") or []
    thumbnail_candidates = sorted((root / "images").glob("thumbnail_candidate_*.png"))
    checks.extend(
        [
            (
                "title_options",
                len(title_options) >= int(packaging.get("title_options_required", 0)),
                f"{len(title_options)} title options",
            ),
            (
                "default_title_thumbnail_pairing",
                bool(metadata.get("default_title") and metadata.get("default_thumbnail")),
                "default title-thumbnail pairing",
            ),
            (
                "thumbnail_candidates",
                len(thumbnail_candidates) >= int(packaging.get("thumbnail_candidates_required", 0)),
                f"{len(thumbnail_candidates)} thumbnail candidates",
            ),
            ("description", bool(metadata.get("description")), "description"),
            ("tags", bool(tags), f"{len(tags)} tags"),
            ("chapters", bool(chapters), f"{len(chapters)} chapters"),
            ("pinned_comment", bool(metadata.get("pinned_comment")), "pinned comment"),
            (
                "shorts_related_video_checklist",
                all(short.get("related_video_checklist") for short in shorts) and len(shorts) >= 2,
                f"{len(shorts)} Shorts metadata rows",
            ),
            (
                "synthetic_disclosure_decision",
                bool(metadata.get("synthetic_disclosure_decision")),
                "synthetic disclosure decision",
            ),
        ]
    )
    return checks


def script_word_count(video_id):
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    if not script.exists():
        return None
    text = script.read_text(encoding="utf-8")
    words = [word for word in text.replace("#", " ").split() if word.strip()]
    return len(words)


def build_report(video_id):
    load_dotenv()
    strategy = read_json(STRATEGY_PATH)
    video_config_path = BASE / "state" / "monetization" / f"video-{video_id}-gates.json"
    if not video_config_path.exists():
        raise SystemExit(f"Missing monetization gate config: {display_path(video_config_path)}")
    video_config = read_json(video_config_path)
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    score = weighted_score(strategy, video_config)
    blockers = []
    warnings = []

    if score < float(strategy["topic_score_threshold"]):
        blockers.append(f"Topic economics score is below threshold: {score}/100.")

    word_count = script_word_count(video_id)
    if word_count is None:
        blockers.append("Final script is missing.")
    elif word_count < 1100:
        blockers.append(f"Final script is below the 8 minute long-form target: {word_count} words.")
    elif word_count > 2300:
        blockers.append(f"Final script is above the 14 minute long-form target: {word_count} words.")

    scores = video_config.get("topic_scores", {})
    for key, minimum in strategy.get("minimum_quality_scores", {}).items():
        if float(scores.get(key, 0)) < float(minimum):
            blockers.append(f"Minimum score not met for {key}: {scores.get(key, 0)}/10.")

    artifact = video_config.get("original_artifact", {})
    if not artifact.get("type") or not artifact.get("source"):
        blockers.append("Original artifact is not defined.")

    ledger = root / "rights-ledger.csv"
    ledger_rows = read_ledger(ledger)
    if not ledger_rows:
        blockers.append("Rights ledger is missing or empty.")
    elif not any(row.get("asset_type") in {"artifact", "image", "proof_footage", "video"} for row in ledger_rows):
        blockers.append("Rights ledger does not include proof-bearing assets.")

    shorts_plan = root / "approval" / "shorts-upload-plan.md"
    if not shorts_plan.exists():
        blockers.append("Shorts related-video upload plan is missing.")

    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    if long_form.exists():
        try:
            duration = media_duration_seconds(long_form)
            cadence = strategy.get("cadence", {})
            min_seconds = float(cadence.get("long_form_target_minutes_min", 8)) * 60
            max_seconds = float(cadence.get("long_form_target_minutes_max", 14)) * 60
            if duration < min_seconds:
                blockers.append(f"Long-form duration is below target: {duration:.1f}s.")
            if duration > max_seconds:
                blockers.append(f"Long-form duration is above target: {duration:.1f}s.")
        except Exception as exc:
            blockers.append(f"Could not verify long-form duration: {exc}.")

    content_quality, content_quality_report = build_content_quality_report(video_id)
    if content_quality.get("status") != "pass":
        blockers.append(f"Content quality gates are blocked: {display_path(content_quality_report)}.")

    long_form_quality, long_form_quality_report = build_long_form_quality_report(video_id)
    if long_form_quality.get("status") != "pass":
        blockers.append(f"Long-form quality gates are blocked: {display_path(long_form_quality_report)}.")

    thumbnail_quality, thumbnail_quality_report = build_thumbnail_quality_report(video_id)
    if thumbnail_quality.get("status") != "pass":
        blockers.append(f"Thumbnail quality gates are blocked: {display_path(thumbnail_quality_report)}.")

    shorts_quality, shorts_quality_report = build_shorts_quality_report(video_id)
    if shorts_quality.get("status") != "pass":
        blockers.append(f"Shorts quality gates are blocked: {display_path(shorts_quality_report)}.")

    package_checks = check_required_package(root, video_config)
    for _, passed, detail in package_checks:
        if not passed:
            blockers.append(f"Packaging gate failed: {detail}.")

    for topic in strategy.get("blocked_public_topics", []):
        if topic in (video_config.get("public_angle", "").lower()):
            blockers.append(f"Blocked public topic detected: {topic}.")

    if video_config.get("lane") != strategy.get("lane"):
        warnings.append("Video lane differs from the Pattern Lab primary lane.")

    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "topic_score": score,
        "threshold": strategy["topic_score_threshold"],
        "lane": video_config.get("lane"),
        "sub_lane": video_config.get("sub_lane"),
        "original_artifact": artifact,
        "blockers": blockers,
        "warnings": warnings,
        "script_words": word_count,
        "content_quality_status": content_quality.get("status"),
        "long_form_quality_status": long_form_quality.get("status"),
        "thumbnail_quality_status": thumbnail_quality.get("status"),
        "shorts_quality_status": shorts_quality.get("status"),
        "package_checks": [
            {"name": name, "passed": passed, "detail": detail}
            for name, passed, detail in package_checks
        ],
        "official_policy_sources": strategy.get("official_policy_sources", []),
    }

    report_json = approval / "monetization-gates-report.json"
    report_md = approval / "monetization-gates-report.md"
    report_json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Monetization Gates: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        "",
        f"Status: {status}",
        f"Topic economics score: {score}/100",
        f"Threshold: {strategy['topic_score_threshold']}/100",
        f"Lane: {payload['lane']}",
        f"Sub-lane: {payload['sub_lane']}",
        f"Final script words: {word_count if word_count is not None else 'missing'}",
        f"Content quality: {payload['content_quality_status']}",
        f"Long-form quality: {payload['long_form_quality_status']}",
        f"Thumbnail quality: {payload['thumbnail_quality_status']}",
        f"Shorts quality: {payload['shorts_quality_status']}",
        "",
        "## Original Artifact",
        "",
        f"- Type: {artifact.get('type', '')}",
        f"- Source: {artifact.get('source', '')}",
        f"- Required in first 20 seconds: {artifact.get('required_in_first_20_seconds', False)}",
        "",
        "## Package Checks",
        "",
    ]
    for check in payload["package_checks"]:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    lines.extend(["", "## Policy Sources", ""])
    lines.extend([f"- {source}" for source in payload["official_policy_sources"]])
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, report_md


def main():
    parser = argparse.ArgumentParser(description="Evaluate Pattern Lab monetization gates.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, report = build_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Topic score: {payload['topic_score']}/100")
    print(f"Monetization gates report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()
