#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, utc_now


POWER_TITLE_TERMS = {
    "hidden",
    "map",
    "changed",
    "rewired",
    "decline",
    "vanished",
    "under",
    "before",
    "moved",
    "myth",
    "proof",
    "source",
    "explains",
}
REQUIRED_STYLE_COMPONENTS = ("Bright Sun Films", "The B1M", "Not Just Bikes", "Here Grows New York")
REQUIRED_SHORT_FIELDS = ("standalone_hook", "source_or_visual_clue", "proof_payoff", "long_form_bridge")
PLACE_CATEGORIES = {
    "attractions_landmarks_civic",
    "neighborhoods_housing_street_life",
    "geography_waterfront_routes",
    "skyline_cityscape_context",
}
PEOPLE_CATEGORIES = {"people_community", "industry_workers_transport"}


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def words(text):
    return re.findall(r"[A-Za-z0-9']+", str(text or "").lower())


def package_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "package.json"


def generic_history_title(title):
    normalized = " ".join(words(title))
    return bool(re.match(r"^(the\s+)?history\s+of\s+[a-z0-9' ]+$", normalized))


def title_has_power(title):
    tokens = set(words(title))
    return bool(tokens & POWER_TITLE_TERMS)


def add_check(checks, blockers, name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})
    if not passed:
        blockers.append(f"{name}: {detail}")


def status_payload(report):
    return report if isinstance(report, dict) else {}


def build_benchmark_growth_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    playbook_path = BASE / "resources" / "benchmark-channel-growth-playbook.json"
    workflow_path = BASE / "workflows" / "benchmark-channel-production-workflow.md"
    package_file = package_path(video_id)
    metadata_file = approval / "upload-metadata.json"
    shorts_plan_file = approval / "shorts-upload-plan.md"

    playbook = read_json(playbook_path) or {}
    package = read_json(package_file) or {}
    metadata = read_json(metadata_file) or {}
    first5 = status_payload(read_json(approval / "first5-hook-report.json"))
    thumbnail = status_payload(read_json(approval / "thumbnail-quality-report.json"))
    thumbnail_factory = status_payload(read_json(approval / "thumbnail-factory-report.json"))
    retention = status_payload(read_json(approval / "retention-ladder-report.json"))
    visual_variety = status_payload(read_json(approval / "visual-variety-report.json"))
    motion = status_payload(read_json(approval / "motion-polish-report.json"))
    shorts = status_payload(read_json(approval / "shorts-quality-report.json"))

    contract = package.get("benchmark_growth_playbook") or metadata.get("benchmark_growth_playbook") or {}
    metadata_contract = metadata.get("benchmark_growth_playbook") or {}
    testing_plan = metadata.get("youtube_testing_plan") or package.get("youtube_testing_plan") or {}
    shorts_concepts = metadata.get("shorts_concepts") or package.get("shorts_concepts") or []
    approved_series = set(playbook.get("approved_series_families") or [])
    minimums = playbook.get("minimums") or {}
    title_options = metadata.get("title_options") or (package.get("upload_metadata") or {}).get("title_options") or []
    selected_title = metadata.get("selected_title") or metadata.get("default_title") or package.get("working_title") or ""
    visual_categories = set(visual_variety.get("distinct_categories") or [])
    rendered_shorts = metadata.get("shorts") or []
    shorts_plan_text = read_text(shorts_plan_file) if shorts_plan_file.exists() else ""

    checks = []
    blockers = []
    warnings = []

    add_check(checks, blockers, "playbook_exists", bool(playbook), display_path(playbook_path))
    add_check(
        checks,
        blockers,
        "workflow_doc_exists",
        workflow_path.exists() and "One city. One strange visual clue. One source trail. One hidden system." in read_text(workflow_path),
        display_path(workflow_path),
    )
    add_check(
        checks,
        blockers,
        "mandatory_rules_present",
        len(playbook.get("mandatory_rules") or []) >= 10,
        f"{len(playbook.get('mandatory_rules') or [])} mandatory benchmark rules",
    )
    add_check(checks, blockers, "package_has_benchmark_contract", bool(contract), display_path(package_file))
    add_check(
        checks,
        blockers,
        "metadata_has_benchmark_contract",
        bool(metadata_contract),
        display_path(metadata_file),
    )
    add_check(
        checks,
        blockers,
        "approved_series_family",
        contract.get("series_family") in approved_series,
        contract.get("series_family") or "missing",
    )
    style_mix = " | ".join(contract.get("benchmark_style_mix") or [])
    add_check(
        checks,
        blockers,
        "benchmark_style_mix_complete",
        all(component in style_mix for component in REQUIRED_STYLE_COMPONENTS),
        style_mix or "missing",
    )
    add_check(
        checks,
        blockers,
        "title_not_generic_history",
        selected_title and not generic_history_title(selected_title),
        selected_title or "missing",
    )
    add_check(
        checks,
        blockers,
        "title_has_mystery_system_or_contradiction",
        title_has_power(selected_title),
        selected_title or "missing",
    )
    add_check(
        checks,
        blockers,
        "title_options_minimum",
        len(title_options) >= int(minimums.get("title_options_min", 5)),
        f"{len(title_options)} title options",
    )
    add_check(checks, blockers, "first5_hook_pass", first5.get("status") == "pass", "first-5 hook gate")
    add_check(checks, blockers, "retention_ladder_pass", retention.get("status") == "pass", "retention ladder gate")
    add_check(checks, blockers, "motion_polish_pass", motion.get("status") == "pass", "motion polish gate")
    add_check(checks, blockers, "thumbnail_quality_pass", thumbnail.get("status") == "pass", "thumbnail quality gate")
    add_check(
        checks,
        blockers,
        "thumbnail_factory_photo_first",
        thumbnail_factory.get("status") == "pass"
        and thumbnail_factory.get("photo_backed_candidate_count") == int(minimums.get("thumbnail_candidate_count", 3))
        and thumbnail_factory.get("abstract_placeholder_count") == 0,
        f"factory={thumbnail_factory.get('status', 'missing')}, photo_backed={thumbnail_factory.get('photo_backed_candidate_count', 0)}, abstract={thumbnail_factory.get('abstract_placeholder_count', 0)}",
    )
    add_check(checks, blockers, "visual_variety_pass", visual_variety.get("status") == "pass", "visual variety gate")
    add_check(
        checks,
        blockers,
        "visual_categories_minimum",
        int(visual_variety.get("distinct_category_count") or 0) >= int(minimums.get("visual_categories_min", 7)),
        f"{visual_variety.get('distinct_category_count', 0)} categories",
    )
    add_check(
        checks,
        blockers,
        "people_visuals_available",
        bool(visual_categories & PEOPLE_CATEGORIES),
        ", ".join(sorted(visual_categories & PEOPLE_CATEGORIES)) or "missing",
    )
    add_check(
        checks,
        blockers,
        "place_visuals_available",
        bool(visual_categories & PLACE_CATEGORIES),
        ", ".join(sorted(visual_categories & PLACE_CATEGORIES)) or "missing",
    )
    add_check(
        checks,
        blockers,
        "shorts_quality_pass",
        shorts.get("status") == "pass",
        f"shorts quality={shorts.get('status', 'missing')}",
    )
    add_check(
        checks,
        blockers,
        "rendered_shorts_minimum",
        len(rendered_shorts) >= int(minimums.get("rendered_shorts_min_current_package", 3)),
        f"{len(rendered_shorts)} rendered/upload metadata shorts",
    )
    add_check(
        checks,
        blockers,
        "shorts_are_related_video_bridged",
        shorts_plan_file.exists()
        and shorts_plan_text.count("Related-video checklist:") >= int(minimums.get("rendered_shorts_min_current_package", 3)),
        display_path(shorts_plan_file),
    )
    add_check(
        checks,
        blockers,
        "shorts_concept_pack_minimum",
        len(shorts_concepts) >= int(minimums.get("shorts_concepts_min_future_package", 5)),
        f"{len(shorts_concepts)} Short concepts",
    )
    missing_concept_fields = [
        concept.get("id", f"concept-{index}")
        for index, concept in enumerate(shorts_concepts, 1)
        if any(not concept.get(field) for field in REQUIRED_SHORT_FIELDS)
    ]
    add_check(
        checks,
        blockers,
        "shorts_concepts_are_standalone_clues",
        not missing_concept_fields and bool(shorts_concepts),
        ", ".join(missing_concept_fields) if missing_concept_fields else "all concepts include hook, visual clue, payoff, and bridge",
    )
    add_check(
        checks,
        blockers,
        "youtube_testing_plan_present",
        testing_plan.get("title_thumbnail_test_enabled") is True
        and int(testing_plan.get("candidate_count") or 0) >= 3
        and "watch_time" in str(testing_plan.get("winner_metric", "")),
        json.dumps(testing_plan, sort_keys=True)[:500] if testing_plan else "missing",
    )

    if "copy" not in " ".join(playbook.get("blocked_patterns") or []).lower():
        warnings.append("Benchmark playbook should explicitly block copying competitor layouts.")

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "playbook": display_path(playbook_path),
        "workflow": display_path(workflow_path),
        "series_family": contract.get("series_family", ""),
        "style_target": playbook.get("style_target", ""),
        "core_thesis": playbook.get("core_thesis", ""),
        "benchmark_channels": [item.get("name") for item in playbook.get("benchmark_channels", [])],
        "selected_title": selected_title,
        "shorts_concept_count": len(shorts_concepts),
        "visual_categories": sorted(visual_categories),
        "youtube_testing_plan": testing_plan,
    }

    json_report = approval / "benchmark-growth-report.json"
    md_report = approval / "benchmark-growth-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        f"# Pattern Lab Benchmark Growth Gate: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        f"Core thesis: {payload['core_thesis']}",
        f"Style target: {payload['style_target']}",
        f"Series family: {payload['series_family'] or 'missing'}",
        "",
        "## Checks",
        "",
    ]
    for check in checks:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Benchmark Channels", ""])
    lines.extend([f"- {name}" for name in payload["benchmark_channels"]] or ["- missing"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab benchmark-channel growth mechanics.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_report, md_report = build_benchmark_growth_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Benchmark growth report: {display_path(md_report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
