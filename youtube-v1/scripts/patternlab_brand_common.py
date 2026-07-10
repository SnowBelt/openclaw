#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

RESOURCE_DIR = BASE / "resources"
BRAND_DIRECTIONS_PATH = RESOURCE_DIR / "pattern-lab-brand-directions.json"
BRAND_TOKENS_PATH = RESOURCE_DIR / "pattern-lab-brand-tokens.json"
REJECTED_STYLE_TERMS = (
    "cyberpunk",
    "neon",
    "glossy-ai",
    "glossy ai",
    "generic slideshow",
    "dashboard aesthetic",
    "cyan",
    "electric blue",
    "signal yellow",
)
REQUIRED_TOKEN_GROUPS = (
    "colors",
    "typography",
    "shorts",
    "thumbnail",
    "captions",
    "map_overlays",
    "source_labels",
)


def brand_directions() -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "status": "pass",
        "policy": {
            "free_fonts_only": True,
            "public_youtube_mutation": "not_performed",
            "paid_services": "not_used",
            "brand_promise": "hidden American city history, one city, one mystery, one source trail",
        },
        "recommended_direction_id": "archival-civic-investigation",
        "directions": [
            {
                "id": "archival-civic-investigation",
                "name": "Archival Civic Investigation",
                "summary": "Premium city-history evidence board: charcoal, archival paper, map blue, amber, copper.",
                "colors": {
                    "background": "#111315",
                    "panel": "#1B1A17",
                    "paper": "#E8DDC5",
                    "map_blue": "#2E5E73",
                    "evidence_amber": "#C88A2D",
                    "copper": "#9B4F2F",
                    "caption": "#F4F0E8",
                    "proof_red": "#B23A2E",
                    "muted": "#AFA58F",
                },
                "fonts": {
                    "hook": "Archivo Black",
                    "caption": "Inter",
                    "source_label": "IBM Plex Mono",
                    "fallback_hook": "Avenir Next Condensed Heavy",
                    "fallback_caption": "Avenir Next",
                    "fallback_source_label": "SF Mono",
                },
                "shorts_first_frame": "City/neighborhood + proof object + 2-5 words, no skyline-only frame.",
                "thumbnail": "One strong map/photo/document proof object, city name visible, 2-4 word mystery.",
                "why_recommended": "Best match for source-first hidden-city-history and owner rejection of the old loud social palette.",
            },
            {
                "id": "map-room-noir",
                "name": "Map Room Noir",
                "summary": "Darker investigative look with map-grid depth and restrained parchment labels.",
                "colors": {
                    "background": "#0E1113",
                    "panel": "#171D20",
                    "paper": "#DDD0B3",
                    "map_blue": "#1F4E5F",
                    "evidence_amber": "#D19A3B",
                    "copper": "#8E4A32",
                    "caption": "#F6F0DF",
                    "proof_red": "#A8372D",
                    "muted": "#9B927F",
                },
                "fonts": {
                    "hook": "Oswald",
                    "caption": "Libre Franklin",
                    "source_label": "Roboto Mono",
                    "fallback_hook": "Avenir Next Condensed Heavy",
                    "fallback_caption": "Helvetica Neue",
                    "fallback_source_label": "SF Mono",
                },
                "shorts_first_frame": "Bolder noir map label with short location clue and amber proof marker.",
                "thumbnail": "High-contrast map cut plus document/photo insert.",
                "why_recommended": "Good for darker investigative episodes but slightly less warm/local than the default.",
            },
            {
                "id": "city-file-archive",
                "name": "City File Archive",
                "summary": "Warmer archive-folder look with paper cards, stamped source labels, and less dark contrast.",
                "colors": {
                    "background": "#241F1A",
                    "panel": "#332B22",
                    "paper": "#F0E2C2",
                    "map_blue": "#3B6576",
                    "evidence_amber": "#BD7A24",
                    "copper": "#A65E3B",
                    "caption": "#FFF5DF",
                    "proof_red": "#A63C2F",
                    "muted": "#B7AA8E",
                },
                "fonts": {
                    "hook": "League Spartan",
                    "caption": "Source Sans 3",
                    "source_label": "Source Code Pro",
                    "fallback_hook": "Avenir Next Heavy",
                    "fallback_caption": "Avenir Next",
                    "fallback_source_label": "SF Mono",
                },
                "shorts_first_frame": "Archive folder card with large city clue and source-object stamp.",
                "thumbnail": "Warm paper dossier with a single proof photo/map tearout.",
                "why_recommended": "Most archival, but may feel less modern in Shorts feeds than the default.",
            },
        ],
    }


def official_brand_tokens(direction_id: str = "archival-civic-investigation") -> dict[str, Any]:
    directions = brand_directions()["directions"]
    direction = next((item for item in directions if item["id"] == direction_id), directions[0])
    return {
        "generated_at": utc_now(),
        "status": "pass",
        "brand_id": "pattern-lab-archival-civic-v1",
        "source_direction_id": direction["id"],
        "public_youtube_mutation": "not_performed",
        "font_license_policy": "free Google Fonts preferred; local system fallbacks allowed when fonts are unavailable",
        "colors": direction["colors"],
        "typography": direction["fonts"],
        "shorts": {
            "canvas": "1080x1920",
            "first_frame_rule": "city/neighborhood + proof object + 2-5 words visible without sound",
            "phase_order": ["first_frame", "hook", "proof", "payoff", "long_form_bridge"],
            "safe_margin_px": 72,
            "old_style_blocked": ["bright electric borders", "loud warning-yellow panels", "generic tech panels", "scorecard look"],
        },
        "thumbnail": {
            "canvas": "1280x720",
            "must_include": ["city name", "one proof visual", "2-4 word hook"],
            "blocked": ["generic skyline-only", "unexplained arrows", "unlabeled boxes", "vibe-only mystery"],
        },
        "captions": {
            "case": "sentence case for explanatory captions; uppercase only for 2-5 word first-frame hooks",
            "background": "semi-opaque charcoal panel",
            "text_color": direction["colors"]["caption"],
            "accent_color": direction["colors"]["evidence_amber"],
        },
        "map_overlays": {
            "route_line": direction["colors"]["evidence_amber"],
            "neighborhood_outline": direction["colors"]["map_blue"],
            "destruction_or_displacement_marker": direction["colors"]["proof_red"],
            "label_background": direction["colors"]["panel"],
        },
        "source_labels": {
            "font": direction["fonts"]["source_label"],
            "fallback_font": direction["fonts"]["fallback_source_label"],
            "prefix": "SOURCE",
            "rule": "source labels identify proof objects; AI reconstructions must be labeled non-proof",
        },
    }


def write_json(path: Path, payload: dict[str, Any]) -> Path:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_brand_report(video_id: str, stem: str, title: str, payload: dict[str, Any], bullets: list[str]) -> tuple[Path, Path]:
    approval = ensure_dir(output_root(video_id) / "approval")
    json_path = approval / f"{stem}.json"
    md_path = approval / f"{stem}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# {title}: Video {video_id}",
        "",
        f"Generated: {payload.get('generated_at', utc_now())}",
        f"Status: {payload.get('status', 'missing')}",
        "Public YouTube mutation: not_performed",
        "Paid font/service usage: not_performed",
        "",
        "## Summary",
        "",
        *bullets,
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in payload.get("blockers", [])] or ["- none"]),
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def display(path: Path) -> str:
    return display_path(path)
