#!/usr/bin/env python3
import argparse
import copy
import json
from pathlib import Path

import patternlab_script_bootstrap  # noqa: F401

from patternlab.city import CityContractError, city_from_sources, require_city
from patternlab_common import BASE, display_path, ensure_dir, load_dotenv, output_root, utc_now


def metadata_for_video(video_id):
    package = BASE / "launch" / f"video-{video_id}" / "package.json"
    if not package.is_file():
        raise SystemExit(f"No deterministic episode package exists for video {video_id}.")
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Episode package is not valid JSON: {display_path(package)}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("upload_metadata"), dict):
        raise SystemExit(f"Episode package has no upload_metadata object: {display_path(package)}")
    metadata = copy.deepcopy(data["upload_metadata"])
    try:
        city = city_from_sources(
            (("package", data.get("city")), ("upload_metadata", metadata.get("city"))),
            required=True,
        )
    except CityContractError as exc:
        raise SystemExit(f"Upload metadata city contract blocked: {exc}") from exc
    metadata["city"] = require_city(city, source="upload_metadata")
    metadata["generated_at"] = utc_now()
    metadata["video_id"] = video_id
    return metadata


def write_metadata(root, metadata):
    approval = ensure_dir(root / "approval")
    json_path = approval / "upload-metadata.json"
    md_path = approval / "upload-metadata.md"
    json_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Upload Metadata: Video {metadata['video_id']}",
        "",
        f"Generated: {metadata['generated_at']}",
        "",
        "Public publishing: blocked until explicit owner approval",
        "",
        "## Title Options",
        "",
    ]
    lines.extend([f"{index}. {title}" for index, title in enumerate(metadata["title_options"], 1)])
    lines.extend(
        [
            "",
            "## Default Package",
            "",
            f"- Title: {metadata['default_title']}",
            f"- Thumbnail: {metadata['default_thumbnail']}",
            f"- Category ID: {metadata['category_id']}",
            f"- Made for kids: {metadata['made_for_kids']}",
            "",
            "## Description",
            "",
            metadata["description"],
            "",
            metadata["description_footer"],
            "",
            "## Tags",
            "",
            ", ".join(metadata["tags"]),
            "",
            "## Chapters",
            "",
        ]
    )
    lines.extend([f"- {chapter['time']} {chapter['title']}" for chapter in metadata["chapters"]])
    lines.extend(
        [
            "",
            "## Pinned Comment",
            "",
            metadata["pinned_comment"],
            "",
            "## Synthetic Or Altered Content Decision",
            "",
            metadata["synthetic_disclosure_decision"],
            "",
            "## Shorts Metadata",
            "",
        ]
    )
    for short in metadata["shorts"]:
        lines.extend(
            [
                f"### {short['id']}: {short['title']}",
                "",
                f"- Pinned comment: {short['pinned_comment']}",
                f"- Related-video promise: {short['related_video_promise']}",
                f"- Related-video checklist: {short['related_video_checklist']}",
                "",
            ]
        )
    benchmark = metadata.get("benchmark_growth_playbook") or {}
    shorts_concepts = metadata.get("shorts_concepts") or []
    youtube_testing = metadata.get("youtube_testing_plan") or {}
    guru_growth = metadata.get("guru_growth_system") or {}
    if benchmark or shorts_concepts or youtube_testing:
        lines.extend(["", "## Benchmark Growth Playbook", ""])
        if benchmark:
            lines.extend(
                [
                    f"- Series family: {benchmark.get('series_family', 'missing')}",
                    f"- Core thesis: {benchmark.get('core_thesis', 'missing')}",
                    f"- Style mix: {', '.join(benchmark.get('benchmark_style_mix', [])) or 'missing'}",
                    f"- Title-thumbnail thesis: {benchmark.get('title_thumbnail_thesis', 'missing')}",
                    f"- Shorts strategy: {benchmark.get('shorts_strategy', 'missing')}",
                    "",
                ]
            )
        if shorts_concepts:
            lines.extend(["### Shorts Concept Pack", ""])
            for concept in shorts_concepts:
                lines.extend(
                    [
                        f"- {concept.get('id', 'unknown')}: {concept.get('standalone_hook', 'missing')}",
                        f"  - Visual clue: {concept.get('source_or_visual_clue', 'missing')}",
                        f"  - Proof/payoff: {concept.get('proof_payoff', 'missing')}",
                        f"  - Long-form bridge: {concept.get('long_form_bridge', 'missing')}",
                    ]
                )
            lines.append("")
        if youtube_testing:
            lines.extend(
                [
                    "### YouTube Testing Plan",
                    "",
                    f"- Title/thumbnail test enabled: {youtube_testing.get('title_thumbnail_test_enabled', False)}",
                    f"- Candidate count: {youtube_testing.get('candidate_count', 0)}",
                    f"- Winner metric: {youtube_testing.get('winner_metric', 'missing')}",
                    f"- Traffic surfaces: {', '.join(youtube_testing.get('traffic_surfaces', [])) or 'missing'}",
                    f"- Rule: {youtube_testing.get('rule', 'missing')}",
                    "",
                ]
            )
    if guru_growth:
        lines.extend(["", "## Guru Growth System", ""])
        outlier = guru_growth.get("outlier_topic_mining") or {}
        testing = guru_growth.get("title_thumbnail_test_discipline") or {}
        viewer = guru_growth.get("viewer_avatar_topic_filter") or {}
        lock = guru_growth.get("packaging_lock_before_script") or {}
        first30 = guru_growth.get("first_30_seconds_mini_product") or {}
        boredom = guru_growth.get("retention_boredom_cut") or {}
        thumb_score = guru_growth.get("thumbnail_pre_score") or {}
        shorts_funnel = guru_growth.get("shorts_discovery_funnel") or {}
        guru_shorts = guru_growth.get("shorts_concepts") or shorts_funnel.get("concepts") or []
        satisfaction = guru_growth.get("audience_satisfaction_tracking") or {}
        governor = guru_growth.get("sustainable_production_governor") or {}
        lines.extend(
            [
                f"- Outlier rationale: {outlier.get('benchmark_or_outlier_rationale', 'missing')}",
                f"- Viewer demand: {outlier.get('viewer_demand_reason', 'missing')}",
                f"- Proof object: {outlier.get('proof_object', 'missing')}",
                f"- Why it can beat generic city history: {outlier.get('beats_generic_city_history_because', 'missing')}",
                f"- Title/thumbnail test pairs: {len(testing.get('test_pairs') or [])}",
                f"- Winner metric: {testing.get('winner_metric', 'missing')}",
                f"- No misleading promise: {testing.get('no_misleading_promise', False)}",
                f"- Morgan viewer question: {viewer.get('morgan_viewer_question', viewer.get('target_viewer_question', 'missing'))}",
                f"- Curiosity trigger: {viewer.get('curiosity_trigger', 'missing')}",
                f"- Packaging locked before script approval: {lock.get('locked_before_script_approval', False)}",
                f"- First-30 payoff by seconds: {first30.get('payoff_by_seconds', 'missing')}",
                f"- Boredom-cut pass recorded: {boredom.get('retention_edit_pass_recorded', False)}",
                f"- Thumbnail selected candidate: {thumb_score.get('selected_candidate', 'missing')}",
                f"- Thumbnail score threshold: {thumb_score.get('threshold', 'missing')}",
                f"- Shorts concepts: {len(guru_shorts)}",
                f"- Audience satisfaction signals: {', '.join(satisfaction.get('tracked_signals', [])) or 'missing'}",
                f"- Sustainable cadence target: {governor.get('long_form_per_week_target', 'missing')} long-form/week",
                f"- Quality over frequency: {governor.get('quality_over_frequency', False)}",
                "",
                "### Guru Shorts Discovery Concepts",
                "",
            ]
        )
        for concept in guru_shorts:
            lines.extend(
                [
                    f"- {concept.get('id', 'unknown')}: {concept.get('standalone_hook', 'missing')}",
                    f"  - Visual clue: {concept.get('visual_clue', concept.get('source_or_visual_clue', 'missing'))}",
                    f"  - Proof/payoff: {concept.get('proof_payoff', 'missing')}",
                    f"  - Comment prompt: {concept.get('comment_prompt', 'missing')}",
                    f"  - Long-form bridge: {concept.get('long_form_bridge', 'missing')}",
                ]
            )
        lines.append("")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Generate Pattern Lab upload metadata.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    json_path, md_path = write_metadata(root, metadata_for_video(args.video_id))
    print(f"Upload metadata JSON: {display_path(json_path)}")
    print(f"Upload metadata Markdown: {display_path(md_path)}")


if __name__ == "__main__":
    main()
