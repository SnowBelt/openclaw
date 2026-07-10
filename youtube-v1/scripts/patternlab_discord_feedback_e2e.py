#!/usr/bin/env python3
import argparse
import json

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_discord_feedback import parse_owner_note, summarize_events
from patternlab_review_action import apply_review_action


SCENARIOS = [
    {
        "name": "approve_long_form_video",
        "kwargs": {"action": "approve", "asset_type": "video", "asset_id": "video-04-long-form", "reason": "good_visual_match", "repair_scope": "asset_only"},
    },
    {
        "name": "reject_short_2_random_text_box",
        "kwargs": {"action": "reject", "asset_type": "short", "asset_id": "video-04-short-02", "reason": "random_text_box", "repair_scope": "this_short_only"},
        "would_block_private_readiness": True,
    },
    {
        "name": "reject_short_1_starts_mid_sentence",
        "kwargs": {"action": "reject", "asset_type": "short", "asset_id": "video-04-short-01", "reason": "starts_mid_sentence", "repair_scope": "this_short_only"},
        "would_block_private_readiness": True,
    },
    {
        "name": "approve_short_3_use_this_style_more",
        "kwargs": {"action": "approve", "asset_type": "short", "asset_id": "video-04-short-03", "reason": "use_this_style_more", "repair_scope": "this_short_only"},
    },
    {
        "name": "reject_thumbnail_b_bad_font_color",
        "kwargs": {"action": "reject", "asset_type": "thumbnail", "asset_id": "video-04-thumbnail-b", "filename": "images/thumbnail_candidate_b.png", "reason": "bad_font_color", "repair_scope": "thumbnail_same_idea"},
        "would_block_private_readiness": True,
    },
]


def run_e2e(video_id, dry_run=True):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    scenario_results = []
    simulated_feedback = []
    blockers = []
    for scenario in SCENARIOS:
        kwargs = dict(scenario["kwargs"])
        # Keep scenario asset ids aligned with the requested video id.
        kwargs["asset_id"] = kwargs.get("asset_id", "").replace("video-04", f"video-{video_id}")
        result = apply_review_action(video_id, dry_run=dry_run, auto_repair=False, auto_upload=False, **kwargs)
        feedback = result.get("owner_feedback_event", {})
        simulated_feedback.append(feedback)
        ok = bool(result.get("ok")) and bool(feedback)
        if not ok:
            blockers.append(f"Scenario failed: {scenario['name']}")
        scenario_results.append(
            {
                "scenario": scenario["name"],
                "ok": ok,
                "action": kwargs["action"],
                "asset_type": kwargs["asset_type"],
                "asset_id": kwargs.get("asset_id", ""),
                "reason": kwargs["reason"],
                "repair_scope": kwargs["repair_scope"],
                "would_block_private_readiness": bool(scenario.get("would_block_private_readiness")),
                "dry_run_event": result.get("event", {}),
                "owner_feedback_event": feedback,
            }
        )
    note_event = parse_owner_note(video_id, "Short 2 — 0:11 — random box with text appears")
    simulated_feedback.append(note_event)
    scenario_results.append(
        {
            "scenario": "parse_timestamp_note_for_short_2",
            "ok": note_event.get("asset_type") == "short" and note_event.get("timestamp_start") == "00:11" and note_event.get("reason") == "random_text_box",
            "owner_feedback_event": note_event,
            "would_block_private_readiness": True,
        }
    )
    if not scenario_results[-1]["ok"]:
        blockers.append("Timestamp note scenario failed.")
    unresolved = [item for item in scenario_results if item.get("would_block_private_readiness")]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "dry_run": dry_run,
        "scenarios": scenario_results,
        "simulated_feedback_summary": summarize_events(simulated_feedback),
        "simulated_unresolved_repair_count": len(unresolved),
        "simulated_private_readiness_result": "would_block_unresolved_repairs" if unresolved else "would_pass_repair_gate",
        "production_files_mutated": False,
        "youtube_mutation": "not_performed",
        "blockers": blockers,
    }
    json_path = approval / "discord-feedback-e2e-report.json"
    md_path = approval / "discord-feedback-e2e-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Discord Feedback E2E Dry Run: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "Dry run: true",
        "Production approval files mutated: false",
        "YouTube mutation: not performed",
        "",
        "## Scenarios",
        "",
    ]
    for result in scenario_results:
        lines.append(
            f"- {result['scenario']}: {'pass' if result['ok'] else 'blocked'}; "
            f"reason={result.get('reason', result.get('owner_feedback_event', {}).get('reason', ''))}; "
            f"scope={result.get('repair_scope', result.get('owner_feedback_event', {}).get('repair_scope', ''))}"
        )
    lines.extend(["", "## Simulated Private Readiness", "", f"- {payload['simulated_private_readiness_result']}"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Dry-run Pattern Lab Discord owner feedback loop without YouTube mutation.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.dry_run:
        raise SystemExit("This harness is dry-run only. Pass --dry-run.")
    payload, _, md_path = run_e2e(args.video_id, dry_run=True)
    print(json.dumps(payload, indent=2))
    print(f"Discord feedback E2E report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
