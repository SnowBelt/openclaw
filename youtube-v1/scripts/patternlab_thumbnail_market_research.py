#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import BASE, ensure_dir, output_root, utc_now

WORKFLOW = BASE / "resources" / "thumbnail-market-research-workflow.json"
TYPOGRAPHY_POLICY = BASE / "resources" / "thumbnail-typography-policy.json"

TYPOGRAPHY_RESEARCH_SOURCES = [
    {
        "source": "YouTube Help: Custom thumbnails",
        "url": "https://support.google.com/youtube/answer/72431?hl=en",
        "finding": "Use high-resolution 16:9 thumbnails and keep the visual clear enough to represent the video at multiple sizes.",
        "pattern_lab_translation": "Render 1920x1080 source-backed thumbnails, then downscale-check 320x180 and 160x90 previews.",
    },
    {
        "source": "YouTube Help: Test and compare",
        "url": "https://support.google.com/youtube/answer/13861714?hl=en",
        "finding": "Use up to three diverse title/thumbnail variants and judge winners by watch time share, not CTR alone.",
        "pattern_lab_translation": "Typography variants must be materially different enough to test, but the first 30 seconds must pay off the promise.",
    },
    {
        "source": "Johnny Harris public YouTube video page review",
        "url": "https://www.youtube.com/@johnnyharris/videos",
        "finding": "Successful map/documentary packaging often uses big condensed text, a simple color block, and one concrete map/photo proof object.",
        "pattern_lab_translation": "Use large condensed city/source hooks, but never copy a competitor layout or use their thumbnail as an asset.",
    },
    {
        "source": "The B1M public YouTube video page review",
        "url": "https://www.youtube.com/@TheB1M/videos",
        "finding": "Successful infrastructure packaging often pairs dark backgrounds with high-contrast white/yellow text and one dominant focal object.",
        "pattern_lab_translation": "Use high-contrast title typography over real city photos and remove filler labels, lines, and decorative boxes.",
    },
    {
        "source": "Vox public YouTube video page review",
        "url": "https://www.youtube.com/@Vox/videos",
        "finding": "Successful explainer packaging often uses restrained high-contrast typography and one clear visual claim.",
        "pattern_lab_translation": "Keep Pattern Lab titles short, clear, and tied to a real city proof object.",
    },
]

TYPOGRAPHY_PATTERNS = [
    {
        "pattern": "bold_condensed_sans_main_hook",
        "what_others_do": "Large condensed all-caps sans type that reads at phone size.",
        "pattern_lab_rule": "Use Avenir Next Condensed Heavy, Helvetica Neue Condensed Black, DIN Condensed Bold, or Arial Black for main hooks.",
    },
    {
        "pattern": "small_word_count",
        "what_others_do": "One short phrase carries the curiosity gap; supporting copy is minimal or absent.",
        "pattern_lab_rule": "Keep hook text to 1-4 words plus mandatory city name.",
    },
    {
        "pattern": "contrast_panel_not_muddy_outline",
        "what_others_do": "Readable text usually comes from contrast, color blocks, and simple shadows rather than huge outlines.",
        "pattern_lab_rule": "Limit main-hook stroke to 4 or less and prefer clean backplates/contrast zones.",
    },
    {
        "pattern": "dominant_source_object",
        "what_others_do": "The title points to one visible object: map, person, building, file, or infrastructure scar.",
        "pattern_lab_rule": "Each thumbnail needs one real city photo/map/document proof object that matches the hook.",
    },
    {
        "pattern": "distinct_test_variants",
        "what_others_do": "Useful thumbnail tests vary composition and emotional trigger, not just wording.",
        "pattern_lab_rule": "A/B/C variants must differ in proof object, crop, title typography treatment, or emotional angle unless explicitly doing controlled AB text tests.",
    },
]


def build_report(video_id: str, city: str, mode: str = "workflow") -> dict:
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    report = {
        "generated_at": utc_now(),
        "status": "workflow_ready",
        "video_id": video_id,
        "city": city,
        "mode": "read_only_market_research_workflow",
        "network_collection_status": "not_run_by_default",
        "workflow": workflow,
        "what_other_creators_do_that_pattern_lab_must_track": workflow["pattern_lab_gaps_to_measure"],
        "public_youtube_mutation": "not_authorized",
        "paid_tools": "not_used",
    }
    if mode == "typography":
        typography_policy = json.loads(TYPOGRAPHY_POLICY.read_text(encoding="utf-8"))
        report.update(
            {
                "status": "typography_research_complete",
                "mode": "read_only_typography_market_research",
                "network_collection_status": "completed_with_public_web_sources_no_assets_copied",
                "typography_policy_file": str(TYPOGRAPHY_POLICY.relative_to(BASE)),
                "research_sources": TYPOGRAPHY_RESEARCH_SOURCES,
                "typography_patterns_to_translate_not_copy": TYPOGRAPHY_PATTERNS,
                "recommended_main_title_stack": typography_policy["font_roles"]["main_hook"]["preferred_stack"],
                "impact_default_status": "blocked_when_preferred_local_fonts_are_available",
                "pattern_lab_font_rule": "Use bold condensed modern sans typography with small word count, visible city anchor, and clean contrast; do not copy competitor layouts.",
            }
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Create Pattern Lab read-only thumbnail market research workflow report.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    parser.add_argument("--city", default="Miami")
    parser.add_argument("--mode", choices=["workflow", "typography"], default="workflow")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    root = output_root(args.video_id)
    approval = ensure_dir(root / "approval")
    report = build_report(args.video_id, args.city, args.mode)
    json_path = Path(args.output) if args.output else approval / "thumbnail-market-research-workflow-report.json"
    if not json_path.is_absolute():
        json_path = BASE / json_path
    ensure_dir(json_path.parent)
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if args.mode == "typography":
        (approval / "thumbnail-market-typography-research-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Thumbnail Market Research Workflow: {args.city}",
        "",
        f"Generated: {report['generated_at']}",
        f"Status: {report['status']}",
        "Mode: read-only; no competitor assets are copied.",
        "",
        "## Track What Others Do Better",
        "",
    ]
    lines.extend(f"- {item}" for item in report["what_other_creators_do_that_pattern_lab_must_track"])
    if args.mode == "typography":
        lines.extend(["", "## Typography Patterns", ""])
        for item in report["typography_patterns_to_translate_not_copy"]:
            lines.append(f"- {item['pattern']}: {item['pattern_lab_rule']}")
        lines.extend(["", "## Research Sources", ""])
        for item in report["research_sources"]:
            lines.append(f"- {item['source']}: {item['url']}")
    lines.extend(["", "## Blocked", ""])
    lines.extend(f"- {item}" for item in report["workflow"]["blocked_actions"])
    (approval / "thumbnail-market-research-workflow-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "video_id": args.video_id, "city": args.city}, indent=2))


if __name__ == "__main__":
    main()
