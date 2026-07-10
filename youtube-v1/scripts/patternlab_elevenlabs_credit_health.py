#!/usr/bin/env python3
"""Fail-closed ElevenLabs credit preflight without exposing credentials."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import BASE, ensure_dir, load_dotenv, output_root, read_text, require_env, strip_markdown_for_voiceover, utc_now


def approved_script_characters(video_id: str) -> int:
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    return len(strip_markdown_for_voiceover(read_text(script)))


def estimate_normal_episode_characters(video_id: str) -> int:
    # Use a current approved script as a conservative fallback until there are
    # three completed hash-bound narrations available to calculate a median.
    return max(1, approved_script_characters(video_id))


def evaluate_subscription(payload: dict, episode_characters: int) -> dict:
    used = int(payload.get("character_count") or 0)
    limit = int(payload.get("character_limit") or 0)
    remaining = max(0, limit - used)
    estimate = max(1, episode_characters)
    two_episode_threshold = estimate * 2
    one_episode_with_margin = int(estimate * 1.1)
    return {
        "character_count": used,
        "character_limit": limit,
        "remaining_characters": remaining,
        "estimated_normal_episode_characters": estimate,
        "warn_under_two_episodes": remaining < two_episode_threshold,
        "block_under_one_episode_with_margin": remaining < one_episode_with_margin,
        "status": "blocked" if remaining < one_episode_with_margin else "warn" if remaining < two_episode_threshold else "pass",
    }


def fetch_subscription(api_key: str) -> dict:
    import requests

    response = requests.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": api_key}, timeout=30)
    response.raise_for_status()
    return response.json()


def build_report(video_id: str, *, live: bool, subscription: dict | None = None) -> tuple[dict, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    estimate = estimate_normal_episode_characters(video_id)
    if subscription is None:
        status = "planned" if not live else "blocked"
        payload = {
            "generated_at": utc_now(), "video_id": video_id, "status": status,
            "estimated_normal_episode_characters": estimate,
            "reason": "live_subscription_not_queried" if not live else "subscription_unavailable",
            "discord_alert_required": False,
            "external_call": "not_performed",
        }
    else:
        result = evaluate_subscription(subscription, estimate)
        payload = {
            "generated_at": utc_now(), "video_id": video_id, **result,
            "discord_alert_required": result["warn_under_two_episodes"],
            "external_call": "performed_read_only",
        }
    path = approval / "elevenlabs-credit-health.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, path


def main() -> None:
    parser = argparse.ArgumentParser(description="Check ElevenLabs capacity without generating narration.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    subscription = fetch_subscription(require_env("ELEVENLABS_API_KEY")) if args.live else None
    payload, path = build_report(args.video_id, live=args.live, subscription=subscription)
    print(json.dumps({"status": payload["status"], "report": str(path), "discord_alert_required": payload["discord_alert_required"]}, indent=2))
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
