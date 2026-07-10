#!/usr/bin/env python3
from __future__ import annotations

import argparse

from patternlab_brand_common import BRAND_DIRECTIONS_PATH, brand_directions, display, write_brand_report, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Create Pattern Lab brand direction packet.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload = brand_directions()
    write_json(BRAND_DIRECTIONS_PATH, payload)
    bullets = [
        f"- Recommended direction: `{payload['recommended_direction_id']}`.",
        f"- Directions: {', '.join(item['id'] for item in payload['directions'])}.",
        "- Free-font policy: Google Fonts preferred, local fallbacks allowed.",
        "- YouTube mutation: not performed.",
    ]
    _json, md = write_brand_report(args.video_id, "brand-direction-packet", "Pattern Lab Brand Direction Packet", payload, bullets)
    print(f"Status: {payload['status']}")
    print(f"Brand direction packet: {display(md)}")


if __name__ == "__main__":
    main()
