#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_brand_common import BRAND_TOKENS_PATH, display, official_brand_tokens, write_brand_report, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Write official Pattern Lab brand tokens.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--direction", default="archival-civic-investigation")
    args = parser.parse_args()
    payload = official_brand_tokens(args.direction)
    write_json(BRAND_TOKENS_PATH, payload)
    bullets = [
        f"- Brand ID: `{payload['brand_id']}`.",
        f"- Source direction: `{payload['source_direction_id']}`.",
        f"- Hook font: `{payload['typography']['hook']}` with `{payload['typography']['fallback_hook']}` fallback.",
        f"- Caption font: `{payload['typography']['caption']}` with `{payload['typography']['fallback_caption']}` fallback.",
        "- YouTube mutation: not performed.",
    ]
    _json, md = write_brand_report(args.video_id, "brand-tokens-report", "Pattern Lab Brand Tokens Report", payload, bullets)
    print(f"Status: {payload['status']}")
    print(f"Brand tokens report: {display(md)}")


if __name__ == "__main__":
    main()
