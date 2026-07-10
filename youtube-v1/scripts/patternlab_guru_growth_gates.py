#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, utc_now


REQUIRED_AUDIENCE_SIGNALS = {
    "i_never_knew_this",
    "city_requests",
    "local_corrections",
    "source_disputes",
    "confusion",
    "visual_praise",
    "expectation_mismatch",
}
REQUIRED_PACKAGING_LOCK_FIELDS = [
    "title",
    "thumbnail_hypothesis",
    "first_hook",
    "proof_object",
    "first_30_second_payoff",
    "audience_promise",
]
REQUIRED_FIRST30_FIELDS = ["visual_clue", "contradiction", "source_proof", "stakes", "title_thumbnail_payoff"]
REQUIRED_BOREDOM_CUTS = ["repeated_points", "slow_setup", "unsupported_tangents", "non_advancing_visuals"]
REQUIRED_THUMBNAIL_SCORE_FIELDS = [
    "phone_readability",
    "visual_mystery",
    "city_anchor",
    "proof_object",
    "emotion",
    "payoff_match",
]
REQUIRED_SHORT_FIELDS = ["standalone_hook", "visual_clue", "proof_payoff", "comment_prompt", "long_form_bridge"]
EXPECTED_WINNER_METRIC = "watch_time_share_first_then_ctr"


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_csv_header(path):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return reader.fieldnames or []


def words_present(value, minimum=1):
    if isinstance(value, str):
        return len([word for word in value.split() if word.strip()]) >= minimum
    return bool(value)


def add_check(checks, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})


def milestone(number, key, name, checks):
    failed = [check for check in checks if not check["passed"]]
    return {
        "number": number,
        "id": key,
        "name": name,
        "status": "pass" if not failed else "blocked",
        "checks": checks,
        "blockers": [f"{check['name']}: {check['detail']}" for check in failed],
    }


def package_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "package.json"


def output_metrics_path(root, video_id):
    return root / "metrics" / f"video-{video_id}-performance.csv"


def normalized_short_concepts(guru):
    nested = ((guru or {}).get("shorts_discovery_funnel") or {}).get("concepts") or []
    top_level = (guru or {}).get("shorts_concepts") or []
    return top_level or nested


def build_guru_growth_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy_path = BASE / "resources" / "youtube-guru-growth-policy.json"
    workflow_path = BASE / "workflows" / "youtube-guru-growth-workflow.md"
    package_file = package_path(video_id)
    metadata_file = approval / "upload-metadata.json"
    metrics_file = output_metrics_path(root, video_id)

    policy = read_json(policy_path) or {}
    package = read_json(package_file) or {}
    metadata = read_json(metadata_file) or {}
    guru = package.get("guru_growth_system") or metadata.get("guru_growth_system") or {}
    metadata_guru = metadata.get("guru_growth_system") or {}
    upload_metadata = package.get("upload_metadata") or {}
    benchmark = read_json(approval / "benchmark-growth-report.json") or {}
    first5 = read_json(approval / "first5-hook-report.json") or {}
    retention = read_json(approval / "retention-ladder-report.json") or {}
    thumbnail = read_json(approval / "thumbnail-quality-report.json") or {}
    thumbnail_factory = read_json(approval / "thumbnail-factory-report.json") or {}
    shorts_quality = read_json(approval / "shorts-quality-report.json") or {}
    shorts_script_package = read_json(approval / "shorts-script-package.json") or {}
    shorts_plan = approval / "shorts-upload-plan.md"
    shorts_plan_text = read_text(shorts_plan) if shorts_plan.exists() else ""
    workflow_text = read_text(workflow_path) if workflow_path.exists() else ""
    metrics_header = set(read_csv_header(metrics_file))

    minimums = policy.get("minimums") or {}
    milestones = []

    outlier = guru.get("outlier_topic_mining") or {}
    checks = []
    add_check(checks, "policy_exists", bool(policy), display_path(policy_path))
    add_check(checks, "workflow_doc_exists", workflow_path.exists() and "Outlier topic mining" in workflow_text, display_path(workflow_path))
    add_check(checks, "benchmark_outlier_rationale", words_present(outlier.get("benchmark_or_outlier_rationale"), 8), outlier.get("benchmark_or_outlier_rationale", "missing"))
    add_check(checks, "viewer_demand_reason", words_present(outlier.get("viewer_demand_reason"), 8), outlier.get("viewer_demand_reason", "missing"))
    add_check(checks, "proof_object", words_present(outlier.get("proof_object")), outlier.get("proof_object", "missing"))
    add_check(checks, "beats_generic_city_history", words_present(outlier.get("beats_generic_city_history_because"), 8), outlier.get("beats_generic_city_history_because", "missing"))
    add_check(checks, "benchmark_growth_report_pass", benchmark.get("status") == "pass", display_path(approval / "benchmark-growth-report.json"))
    milestones.append(milestone(41, "outlier_topic_mining", "Outlier Topic Mining System", checks))

    testing = guru.get("title_thumbnail_test_discipline") or {}
    test_pairs = testing.get("test_pairs") or []
    checks = []
    add_check(checks, "three_test_pairs", len(test_pairs) >= int(minimums.get("title_thumbnail_test_pairs", 3)), f"{len(test_pairs)} pairs")
    add_check(checks, "winner_metric", testing.get("winner_metric") == EXPECTED_WINNER_METRIC, testing.get("winner_metric", "missing"))
    add_check(checks, "no_misleading_promise", testing.get("no_misleading_promise") is True, str(testing.get("no_misleading_promise")))
    for index, pair in enumerate(test_pairs[:3], 1):
        add_check(checks, f"pair_{index}_title", words_present(pair.get("title"), 3), pair.get("title", "missing"))
        add_check(checks, f"pair_{index}_thumbnail", str(pair.get("thumbnail", "")).startswith("images/thumbnail_candidate_"), pair.get("thumbnail", "missing"))
        add_check(checks, f"pair_{index}_hypothesis", words_present(pair.get("hypothesis"), 3), pair.get("hypothesis", "missing"))
    add_check(checks, "thumbnail_quality_pass", thumbnail.get("status") == "pass", display_path(approval / "thumbnail-quality-report.json"))
    milestones.append(milestone(42, "title_thumbnail_test_discipline", "Title/Thumbnail Test Discipline", checks))

    viewer = guru.get("viewer_avatar_topic_filter") or {}
    checks = []
    question = viewer.get("morgan_viewer_question") or viewer.get("target_viewer_question")
    trigger = viewer.get("curiosity_trigger")
    add_check(checks, "morgan_question", words_present(question, 6), question or "missing")
    add_check(checks, "curiosity_trigger", words_present(trigger, 5), trigger or "missing")
    add_check(checks, "not_only_historically_interesting", viewer.get("reject_if_only_historically_interesting") is True, str(viewer.get("reject_if_only_historically_interesting")))
    milestones.append(milestone(43, "viewer_avatar_topic_filter", "Viewer-Avatar Topic Filter", checks))

    lock = guru.get("packaging_lock_before_script") or {}
    locked_fields = lock.get("locked_fields") or {}
    checks = []
    add_check(checks, "locked_before_script_approval", lock.get("locked_before_script_approval") is True, str(lock.get("locked_before_script_approval")))
    for field in REQUIRED_PACKAGING_LOCK_FIELDS:
        add_check(checks, f"lock_{field}", words_present(locked_fields.get(field), 2), locked_fields.get(field, "missing"))
    milestones.append(milestone(44, "packaging_lock_before_script", "Packaging Lock Before Scriptwriting", checks))

    first30 = guru.get("first_30_seconds_mini_product") or {}
    included = first30.get("opening_plan_includes") or {}
    checks = []
    for field in REQUIRED_FIRST30_FIELDS:
        add_check(checks, f"first30_{field}", words_present(included.get(field), 2), included.get(field, "missing"))
    add_check(checks, "payoff_by_30_seconds", first30.get("payoff_by_seconds") == 30, str(first30.get("payoff_by_seconds")))
    add_check(checks, "first5_report_pass", first5.get("status") == "pass", display_path(approval / "first5-hook-report.json"))
    milestones.append(milestone(45, "first_30_seconds_mini_product", "First-30-Seconds Mini-Product Gate", checks))

    boredom = guru.get("retention_boredom_cut") or {}
    removed = set(boredom.get("removed") or boredom.get("cut_categories") or [])
    checks = []
    add_check(checks, "boredom_cut_recorded", boredom.get("retention_edit_pass_recorded") is True, str(boredom.get("retention_edit_pass_recorded")))
    for field in REQUIRED_BOREDOM_CUTS:
        add_check(checks, f"removed_{field}", field in removed, ", ".join(sorted(removed)) or "missing")
    add_check(checks, "retention_report_pass", retention.get("status") == "pass", display_path(approval / "retention-ladder-report.json"))
    milestones.append(milestone(46, "retention_boredom_cut", "Retention Boredom-Cut Pass", checks))

    thumb_score = guru.get("thumbnail_pre_score") or {}
    candidate_scores = thumb_score.get("candidates") or []
    selected = thumb_score.get("selected_candidate") or "A"
    threshold = int(thumb_score.get("threshold") or minimums.get("thumbnail_selected_min_score", 80))
    selected_row = next((item for item in candidate_scores if item.get("candidate") == selected), {})
    checks = []
    add_check(checks, "three_scored_candidates", len(candidate_scores) >= int(minimums.get("thumbnail_candidates", 3)), f"{len(candidate_scores)} scored")
    for candidate in candidate_scores[:3]:
        label = candidate.get("candidate", "unknown")
        scores = candidate.get("scores") or {}
        for field in REQUIRED_THUMBNAIL_SCORE_FIELDS:
            add_check(checks, f"candidate_{label}_{field}", isinstance(scores.get(field), (int, float)) and scores.get(field) > 0, str(scores.get(field, "missing")))
        add_check(checks, f"candidate_{label}_total", isinstance(candidate.get("total_score"), (int, float)) and candidate.get("total_score") >= threshold, str(candidate.get("total_score", "missing")))
    add_check(checks, "selected_candidate_threshold", isinstance(selected_row.get("total_score"), (int, float)) and selected_row.get("total_score") >= threshold, f"{selected}={selected_row.get('total_score', 'missing')} threshold={threshold}")
    add_check(checks, "thumbnail_factory_pass", thumbnail_factory.get("status") == "pass", display_path(approval / "thumbnail-factory-report.json"))
    milestones.append(milestone(47, "thumbnail_pre_score", "Thumbnail Pre-Score Gate", checks))

    shorts = guru.get("shorts_discovery_funnel") or {}
    concepts = normalized_short_concepts(guru)
    checks = []
    add_check(checks, "shorts_concept_count", int(minimums.get("shorts_concepts_min", 5)) <= len(concepts) <= int(minimums.get("shorts_concepts_max", 7)), f"{len(concepts)} concepts")
    for concept in concepts:
        concept_id = concept.get("id", "unknown")
        for field in REQUIRED_SHORT_FIELDS:
            add_check(checks, f"{concept_id}_{field}", words_present(concept.get(field), 2), concept.get(field, "missing"))
    add_check(checks, "standalone_not_trailer_only", shorts.get("standalone_not_trailer_only") is True, str(shorts.get("standalone_not_trailer_only")))
    add_check(checks, "shorts_script_package_pass", shorts_script_package.get("status") == "pass", display_path(approval / "shorts-script-package.json"))
    add_check(checks, "shorts_plan_uses_scripted_package", "Timestamp source: scripted-short-package" in shorts_plan_text, display_path(shorts_plan))
    add_check(checks, "shorts_quality_pass", shorts_quality.get("status") == "pass", display_path(approval / "shorts-quality-report.json"))
    add_check(checks, "shorts_plan_bridges_long_form", "Related Video: long-form video" in shorts_plan_text, display_path(shorts_plan))
    milestones.append(milestone(48, "shorts_discovery_funnel", "Shorts Discovery Funnel System", checks))

    satisfaction = guru.get("audience_satisfaction_tracking") or {}
    tracked = set(satisfaction.get("tracked_signals") or [])
    checks = []
    add_check(checks, "audience_signal_count", len(tracked) >= int(minimums.get("audience_satisfaction_signals_min", 7)), f"{len(tracked)} signals")
    for signal in REQUIRED_AUDIENCE_SIGNALS:
        add_check(checks, f"tracks_{signal}", signal in tracked, ", ".join(sorted(tracked)) or "missing")
    metric_column_map = {
        "city_requests": "city_requests",
        "local_corrections": "local_corrections",
        "source_disputes": "source_disputes",
        "expectation_mismatch": "expectation_mismatch_comments",
    }
    for signal, column in metric_column_map.items():
        add_check(checks, f"metrics_column_{signal}", column in metrics_header, column)
    add_check(checks, "comments_signal_summary_column", "comments_signal_summary" in metrics_header, "comments_signal_summary")
    milestones.append(milestone(49, "audience_satisfaction_tracking", "Audience Satisfaction Tracking", checks))

    governor = guru.get("sustainable_production_governor") or {}
    checks = []
    add_check(checks, "cadence_target_three_long_form", governor.get("long_form_per_week_target") == 3, str(governor.get("long_form_per_week_target")))
    add_check(checks, "quality_over_frequency", governor.get("quality_over_frequency") is True, str(governor.get("quality_over_frequency")))
    add_check(checks, "failed_gate_blocks_publish", governor.get("failed_quality_gate_blocks_publish") is True, str(governor.get("failed_quality_gate_blocks_publish")))
    add_check(checks, "public_publish_owner_gated", governor.get("public_publish_owner_gated") is True, str(governor.get("public_publish_owner_gated")))
    milestones.append(milestone(50, "sustainable_production_governor", "Sustainable Production Governor", checks))

    blockers = [blocker for item in milestones for blocker in item["blockers"]]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(policy_path),
        "workflow": display_path(workflow_path),
        "package": display_path(package_file),
        "metadata": display_path(metadata_file),
        "metrics_baseline": display_path(metrics_file),
        "milestones": milestones,
        "blockers": blockers,
        "warnings": [] if metadata_guru else ["Upload metadata did not contain a separate guru_growth_system object before regeneration."],
        "inputs": {
            "benchmark_growth": display_path(approval / "benchmark-growth-report.json"),
            "thumbnail_quality": display_path(approval / "thumbnail-quality-report.json"),
            "thumbnail_factory": display_path(approval / "thumbnail-factory-report.json"),
            "first5_hook": display_path(approval / "first5-hook-report.json"),
            "retention_ladder": display_path(approval / "retention-ladder-report.json"),
            "shorts_quality": display_path(approval / "shorts-quality-report.json"),
            "shorts_script_package": display_path(approval / "shorts-script-package.json"),
            "shorts_plan": display_path(shorts_plan),
        },
    }

    json_report = approval / "guru-growth-report.json"
    md_report = approval / "guru-growth-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        f"# Pattern Lab Guru Growth Gates: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Milestone Gates",
        "",
    ]
    for item in milestones:
        lines.append(f"- Milestone {item['number']} — {item['name']}: {item['status']}")
        for check in item["checks"]:
            lines.append(f"  - {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Boundary", "", "- This report does not upload, publish, replace thumbnails, or mutate YouTube Studio tests."])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab YouTube guru growth gates.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_report, md_report = build_guru_growth_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Guru growth report: {display_path(md_report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
