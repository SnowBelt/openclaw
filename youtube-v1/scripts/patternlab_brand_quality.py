#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_brand_common import (
    BRAND_DIRECTIONS_PATH,
    BRAND_TOKENS_PATH,
    REQUIRED_TOKEN_GROUPS,
    REJECTED_STYLE_TERMS,
    display,
    load_json,
    utc_now,
    write_brand_report,
)


def has_hex(value: str) -> bool:
    value = str(value or "")
    return len(value) == 7 and value.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in value[1:])


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab brand packet and official tokens.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    directions = load_json(BRAND_DIRECTIONS_PATH)
    tokens = load_json(BRAND_TOKENS_PATH)
    blockers: list[str] = []
    warnings: list[str] = []

    if not directions:
        blockers.append("Brand direction packet is missing.")
    elif len(directions.get("directions") or []) < 3:
        blockers.append("Brand direction packet must include at least 3 directions.")
    else:
        for item in directions.get("directions") or []:
            if not item.get("colors") or not item.get("fonts"):
                blockers.append(f"Direction {item.get('id', 'unknown')} lacks colors or fonts.")

    if not tokens:
        blockers.append("Official brand tokens are missing.")
    else:
        for group in REQUIRED_TOKEN_GROUPS:
            if group not in tokens:
                blockers.append(f"Brand tokens missing `{group}` group.")
        for name, value in (tokens.get("colors") or {}).items():
            if not has_hex(value):
                blockers.append(f"Color token `{name}` is not a valid hex value.")
        text_blob = str(tokens).lower()
        for term in REJECTED_STYLE_TERMS:
            if term in text_blob:
                blockers.append(f"Rejected old-style term remains in brand tokens: {term}.")
        typography = tokens.get("typography") or {}
        for key in ["hook", "caption", "source_label", "fallback_hook", "fallback_caption", "fallback_source_label"]:
            if not typography.get(key):
                blockers.append(f"Typography token `{key}` is missing.")
        if "font_license_policy" in tokens and "free" not in str(tokens["font_license_policy"]).lower():
            warnings.append("Font license policy does not explicitly say free.")

    payload = {
        "generated_at": utc_now(),
        "video_id": args.video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "direction_packet": str(BRAND_DIRECTIONS_PATH),
        "brand_tokens": str(BRAND_TOKENS_PATH),
        "public_youtube_mutation": "not_performed",
    }
    bullets = [
        f"- Direction packet: `{display(BRAND_DIRECTIONS_PATH)}`.",
        f"- Brand tokens: `{display(BRAND_TOKENS_PATH)}`.",
        "- Rejected old neon/cyberpunk/dashboard styling is blocked.",
    ]
    _json, md = write_brand_report(args.video_id, "brand-quality-report", "Pattern Lab Brand Quality Report", payload, bullets)
    print(f"Status: {payload['status']}")
    print(f"Brand quality report: {display(md)}")
    for blocker in blockers:
        print(f"- {blocker}")
    raise SystemExit(0 if not blockers else 1)


if __name__ == "__main__":
    main()
