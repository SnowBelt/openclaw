#!/usr/bin/env python3
"""Compile typed Pattern Lab visual beats into reproducible local-AI prompts."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import patternlab_script_bootstrap  # noqa: F401

from patternlab.visual_system import resolve_episode_identity
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_local_media_runtime import atomic_write_json, atomic_write_text, read_json, sha256_file


POLICY_PATH = BASE / "resources" / "local-visual-prompt-policy.json"
DISCLOSURE = "Dramatic reconstruction — not archival footage"


def text(value: Any, fallback: str) -> str:
    rendered = str(value or "").strip()
    return rendered or fallback


def compile_beat(
    beat: dict[str, Any], policy: dict[str, Any], index: int, *, city: str
) -> dict[str, Any]:
    mode = str(beat.get("visual_mode") or "").lower()
    allowed = mode in set(policy.get("generation_roles", [])) and beat.get("ai_support_allowed", mode == "reconstruction") is True
    blockers: list[str] = []
    if mode in set(policy.get("blocked_generation_roles", [])) and beat.get("ai_support_allowed"):
        blockers.append("ai_generation_for_proof_or_system_role_forbidden")
    narration = text(beat.get("narration_excerpt"), "missing narration")
    actions = [str(item).replace("_", " ") for item in beat.get("semantic_actions", []) if str(item).strip()]
    visible_action = text(beat.get("visible_action"), ", ".join(actions) or "one observable human action")
    story_function = text(beat.get("emotional_function"), "clarify the human consequence")
    setting = text(beat.get("setting"), "historically plausible American urban environment; no identifiable named-city landmark")
    subject = text(beat.get("subject"), "ordinary people and built environment appropriate to the narration")
    camera = text(beat.get("camera"), "documentary medium-wide composition, natural eye level, realistic depth")
    composition = text(beat.get("composition"), "one clear focal subject; unobstructed edges; no public text; 16:9 crop safe")
    light_color = text(beat.get("light_and_color"), "bright focal light, vivid but credible color, deep clean shadows, no gray haze")
    historical = text(beat.get("historical_constraints"), "period-consistent clothing, architecture, vehicles, materials, and objects; no anachronisms")
    preserve = text(beat.get("preserve"), "coherent faces, hands, body count, architecture, perspective, and object relationships")
    avoid = text(beat.get("avoid"), policy.get("default_negative_prompt", "text, logo, watermark, AI artifacts"))
    disclosure = DISCLOSURE if mode == "reconstruction" else "internal context-only asset; never imply the named city or event"
    geographic_scope = str(beat.get("claim_scope") or "").lower()
    if allowed and geographic_scope != "generic":
        blockers.append("generated_context_or_reconstruction_must_use_generic_geographic_scope")
    fields = {
        "asset_role": "non-proof dramatic reconstruction" if mode == "reconstruction" else "non-proof generic context",
        "narration": narration,
        "story_function": story_function,
        "visible_action": visible_action,
        "setting": setting,
        "subject": subject,
        "camera": camera,
        "composition": composition,
        "light_and_color": light_color,
        "historical_constraints": historical,
        "preserve": preserve,
        "avoid": avoid,
        "disclosure": disclosure,
    }
    # Image models follow concise visible instructions better than a transcript
    # dump. Keep narration in the receipt and judge prompt, but compile only the
    # visual facts the generator must render.
    generation_order = [
        "asset_role",
        "historical_constraints",
        "visible_action",
        "subject",
        "setting",
        "camera",
        "composition",
        "light_and_color",
        "preserve",
        "story_function",
    ]
    prompt = "PREMIUM EDITORIAL DOCUMENTARY STILL; ONE COHERENT MOMENT; NO PUBLIC TEXT.\n"
    prompt += "\n".join(
        f"{name.upper().replace('_', ' ')}: {fields[name]}" for name in generation_order
    )
    prompt += (
        "\nTRUTH BOUNDARY: This image may illustrate atmosphere or human consequence only. "
        f"It is not evidence of {city}, any named neighborhood, person, date, or event."
    )
    tournament = policy.get("candidate_tournament", {})
    candidate_count = int(tournament.get("draft_candidate_count", 8))
    seed_base = int(tournament.get("seed_base", 40400)) + index * 100
    return {
        "beat_id": beat.get("beat_id", f"beat-{index:02d}"),
        "city": city,
        "visual_mode": mode,
        "claim_ids": [str(value) for value in beat.get("claim_ids", []) if str(value).strip()],
        "planned_ai_asset_id": str(beat.get("planned_ai_asset_id") or "").strip(),
        "generation_allowed": allowed and not blockers,
        "prompt_fields": fields,
        "generation_prompt_version": 2,
        "prompt": prompt,
        "negative_prompt": avoid,
        "candidate_seeds": [seed_base + offset for offset in range(candidate_count)],
        "draft_size": [int(tournament.get("draft_width", 768)), int(tournament.get("draft_height", 512))],
        "winner_size": [int(tournament.get("winner_width", 1536)), int(tournament.get("winner_height", 1024))],
        "requires_local_visual_judge": allowed,
        "on_screen_disclosure": disclosure if mode == "reconstruction" else "",
        "blockers": blockers,
    }


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    contract_path = root / "source-packet" / "visual-contract.json"
    contract = read_json(contract_path)
    policy = read_json(POLICY_PATH)
    package = read_json(BASE / "launch" / f"video-{video_id}" / "package.json")
    evidence = read_json(BASE / "launch" / f"video-{video_id}" / "evidence-queries.json")
    identity, identity_blockers = resolve_episode_identity(package, evidence)
    beats = [
        compile_beat(beat, policy, index, city=identity.city)
        for index, beat in enumerate(contract.get("beats", []), start=1)
        if isinstance(beat, dict)
    ]
    blockers: list[str] = []
    blockers.extend(identity_blockers)
    if not policy:
        blockers.append("local_visual_prompt_policy_missing")
    if contract.get("status") != "ready":
        blockers.append("visual_contract_not_ready")
    blockers.extend(f"{beat['beat_id']}:{item}" for beat in beats for item in beat["blockers"])
    generation_beats = [beat for beat in beats if beat["generation_allowed"]]
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "city": identity.city,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH), "policy_sha256": sha256_file(POLICY_PATH),
        "visual_contract": display_path(contract_path), "visual_contract_sha256": sha256_file(contract_path) if contract_path.is_file() else "",
        "beats": beats, "generation_beat_count": len(generation_beats), "blockers": blockers,
        "final_text_generation": "forbidden; deterministic renderer only",
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-visual-prompt-plan.json"
    md_path = approval / "local-visual-prompt-plan.md"
    atomic_write_json(json_path, payload)
    lines = [f"# Local Visual Prompt Plan: Video {video_id}", "", f"Status: {payload['status']}", f"Generation beats: {len(generation_beats)}", "", "## Beats", ""]
    lines.extend(f"- {beat['beat_id']}: {beat['visual_mode']} | generation={'yes' if beat['generation_allowed'] else 'no'}" for beat in beats)
    lines.extend(["", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]), "", "Paid provider calls: not performed", "YouTube mutation: not performed", ""])
    atomic_write_text(md_path, "\n".join(lines))
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile narration-bound local visual prompts.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "generation_beat_count": payload["generation_beat_count"], "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
