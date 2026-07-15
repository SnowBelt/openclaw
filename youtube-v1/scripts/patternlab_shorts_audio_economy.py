#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import patternlab_script_bootstrap  # noqa: F401

from patternlab.shorts_alignment import locate_all
from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import minimum_script_package_ok, script_items, script_package, write_report

AUDIO_POLICIES = {"reuse_long_form_audio", "hybrid_elevenlabs_wrapper", "full_short_voiceover"}


def word_timestamp_candidates(root: Path) -> list[Path]:
    return [
        root / "audio" / "voiceover_words.json",
        root / "audio" / "word-timestamps.json",
        root / "approval" / "word-timestamps.json",
        root / "captions" / "word-alignment.json",
    ]


def aligned_words(paths: list[Path]) -> tuple[list[dict], Path | None]:
    for path in paths:
        if not path.is_file() or path.stat().st_size == 0:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        words = payload.get("words") if isinstance(payload, dict) else None
        if isinstance(words, list) and words:
            return words, path
    return [], None


def build_audio_economy_report(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    blockers = minimum_script_package_ok(package)
    warnings: list[str] = []
    long_form = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    timestamp_paths = word_timestamp_candidates(root)
    words, timestamp_path = aligned_words(timestamp_paths)
    timestamps_exist = bool(words)
    rows = []
    for item in script_items(package):
        sentences = [str(value) for value in item.get("narration_sentences", []) if str(value).strip()]
        alignment_error = ""
        intervals: list[tuple[float, float]] = []
        if words and sentences:
            try:
                intervals = locate_all(words, sentences)
            except ValueError as exc:
                alignment_error = str(exc)
        clean_reuse_available = bool(words and sentences and intervals and not alignment_error)
        policy = "reuse_long_form_audio" if clean_reuse_available else "blocked_missing_exact_alignment"
        reason = "all complete approved narration sentences have exact word-aligned intervals" if clean_reuse_available else "exact complete-sentence alignment is unavailable; rendering must stop"
        elevenlabs_required = False
        rows.append(
            {
                "id": item.get("id"),
                "index": item.get("index"),
                "title": item.get("title"),
                "audio_policy": policy,
                "policy_reason": reason,
                "elevenlabs_scope": "hook/payoff wrapper lines only" if policy == "hybrid_elevenlabs_wrapper" else "none",
                "owner_approval_required_before_external_call": elevenlabs_required,
                "external_service_call_performed": False,
                "sentence_intervals": [
                    {"start": round(start, 3), "end": round(end, 3)} for start, end in intervals
                ],
                "alignment_error": alignment_error,
            }
        )
    full_without_reason = [row for row in rows if row["audio_policy"] == "full_short_voiceover" and not row["policy_reason"]]
    if full_without_reason:
        blockers.append("Full Short voiceover policy appears without a blocker reason.")
    for row in rows:
        if row["audio_policy"] not in AUDIO_POLICIES:
            blockers.append(f"Short {row['index']} has no renderable approved audio policy: {row['audio_policy']}.")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "long_form_draft": display_path(long_form),
        "long_form_exists": long_form.exists(),
        "word_timestamp_candidates": [display_path(path) for path in timestamp_paths],
        "word_timestamps_exist": timestamps_exist,
        "word_timestamp_source": display_path(timestamp_path) if timestamp_path else "missing",
        "default_policy_when_unproven": "block; never synthesize or clip placeholder audio",
        "external_elevenlabs_call_performed": False,
        "owner_approval_required_before_elevenlabs": True,
        "shorts": rows,
    }
    sections = [
        (
            "Audio Policies",
            [
                f"- Short {row['index']}: {row['audio_policy']} — {row['policy_reason']} — ElevenLabs scope: {row['elevenlabs_scope']}"
                for row in rows
            ],
        ),
        (
            "Boundary",
            [
                "- No ElevenLabs call was made.",
                "- The production path reuses only exact complete sentences from the approved long-form narration.",
                "- New wrapper or full narration remains a separate exact script-hash approval outside this renderer.",
            ],
        ),
    ]
    return write_report(video_id, "shorts-audio-economy-report", "Pattern Lab Shorts Audio Economy Report", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts audio economy policy.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_audio_economy_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Audio economy report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
