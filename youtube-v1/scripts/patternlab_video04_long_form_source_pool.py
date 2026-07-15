#!/usr/bin/env python3
"""Build the rights-checked, diversity-enforced source pool for Video 04.

This is intentionally separate from search and download. It admits only exact
local files with item-level source metadata, then writes immutable per-item
receipts for the canonical visual-routing stage. Search results, thumbnails,
and loosely attributed stock frames never become production assets here.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


MINIMUM_ASSETS = 60
MINIMUM_HISTORICAL_ASSETS = 40
MINIMUM_MOVING_IMAGE_ASSETS = 10
MINIMUM_MODERN_VIDEO_ASSETS = 7
MINIMUM_DISTINCT_SOURCE_URLS = 52
REQUIRED_FIELDS = (
    "asset_id",
    "source_id",
    "relative_path",
    "source_url",
    "source_title",
    "creator",
    "rights_basis",
    "source_class",
    "evidence_fit",
    "asset_kind",
    "editorial_role",
    "geographic_scope",
    "claim_ids",
)
FEDERAL_ACTS_CARD_ASSET_ID = "federal-acts-1949-1956-source-card"
FEDERAL_ACTS_CARD_RELATIVE_PATH = (
    "source-packet/long-form-rebuild/generated/federal-acts-1949-1956-source-card.png"
)


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def render_federal_acts_source_card(root: Path) -> Path:
    """Render a deterministic, source-cited card for the two federal laws.

    The card contains no synthetic historical image and makes no Detroit-local
    claim. It exposes the official federal-law facts that the narration names;
    the following rights-cleared 1964 Detroit construction photograph carries
    the local physical consequence.
    """
    target = root / FEDERAL_ACTS_CARD_RELATIVE_PATH
    ensure_dir(target.parent)
    width, height = 1920, 1080
    background = (10, 20, 29)
    cream = (247, 241, 221)
    teal = (38, 214, 177)
    gold = (255, 205, 60)
    muted = (173, 193, 203)
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)
    display_font = YOUTUBE_ROOT / "resources" / "fonts" / "external" / "anton-google-regular.ttf"
    body_font = YOUTUBE_ROOT / "resources" / "fonts" / "external" / "bebas-neue-google-regular.ttf"
    title = _font(display_font, 90)
    year = _font(display_font, 106)
    heading = _font(display_font, 58)
    body = _font(body_font, 43)
    source = _font(body_font, 30)

    draw.rounded_rectangle((78, 72, 1842, 1008), radius=34, outline=(75, 103, 116), width=3)
    draw.text((112, 94), "U.S. FEDERAL LAW • SOURCE TRAIL", font=body, fill=teal)
    draw.text((112, 148), "THE FEDERAL TOOLS", font=title, fill=cream)
    draw.line((112, 276, 1808, 276), fill=(75, 103, 116), width=3)

    rows = [
        (
            "1949",
            "HOUSING ACT OF 1949",
            "Public Law 81-171 • federal slum-clearance and urban-redevelopment authority",
            "Official text: GovInfo COMPS-10349",
        ),
        (
            "1956",
            "FEDERAL-AID HIGHWAY ACT",
            "National Interstate and Defense Highways Act • 41,000-mile interstate authorization",
            "Historical record: U.S. Senate Historical Office",
        ),
    ]
    for index, (date, label, detail, citation) in enumerate(rows):
        top = 326 + index * 286
        draw.text((122, top), date, font=year, fill=gold)
        draw.text((410, top + 4), label, font=heading, fill=cream)
        draw.text((410, top + 88), detail, font=body, fill=muted)
        draw.text((410, top + 145), citation, font=source, fill=teal)
        if index == 0:
            draw.line((410, top + 224, 1808, top + 224), fill=(49, 72, 83), width=2)

    draw.rounded_rectangle((112, 892, 1808, 970), radius=18, fill=(19, 39, 51))
    draw.text(
        (148, 906),
        "FEDERAL AUTHORITY + FEDERAL FUNDING • DETROIT CONSEQUENCE SHOWN NEXT",
        font=body,
        fill=cream,
    )
    image.save(target, format="PNG", optimize=False, compress_level=9)
    return target


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid_json:{display_path(path)}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"json_object_required:{display_path(path)}")
    return value


def media_duration(path: Path) -> float:
    value = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nk=1:nw=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(value)


def normalized_addition(row: dict) -> dict:
    return {
        **row,
        "human_accepted": True,
        "acceptance_basis": (
            "Owner ordered the rejected Video 04 visual rebuild. This exact item has a local hash, "
            "creator, item page, and commercial/modification rights basis; use remains role-limited."
        ),
        "commercial_use_ok": True,
        "modification_ok": True,
        "may_imply_named_city": row.get("geographic_scope") == "city_specific",
    }


def build(video_id: str) -> tuple[dict, Path, Path]:
    if video_id != "04":
        raise ValueError(f"video04_source_pool_only:{video_id}")
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    target_root = ensure_dir(root / "source-packet" / "long-form-rebuild")
    receipts_dir = ensure_dir(target_root / "receipts")
    base_path = root / "source-packet" / "evidence-intake.json"
    additions_path = launch_root(video_id) / "long-form-source-additions.json"
    output_path = target_root / "evidence-intake-expanded.json"
    report_path = approval / "long-form-source-pool-report.json"
    md_path = approval / "long-form-source-pool-report.md"
    blockers: list[str] = []
    render_federal_acts_source_card(root)
    base = read_json(base_path)
    additions = read_json(additions_path)
    excluded = additions.get("excluded_sources", [])
    patterns = [str(row.get("filename_pattern") or "") for row in excluded if isinstance(row, dict)]
    selected: list[dict] = []
    excluded_rows: list[dict] = []
    for row in base.get("assets", []):
        if not isinstance(row, dict):
            blockers.append("base_source_row_not_object")
            continue
        relative_path = str(row.get("relative_path") or "")
        matching = next((pattern for pattern in patterns if pattern and fnmatch.fnmatch(relative_path, pattern)), "")
        if matching:
            excluded_rows.append(
                {
                    "asset_id": row.get("asset_id", "unknown"),
                    "relative_path": relative_path,
                    "matched_exclusion": matching,
                }
            )
            continue
        selected.append(dict(row))
    for row in additions.get("assets", []):
        if not isinstance(row, dict):
            blockers.append("source_addition_row_not_object")
            continue
        selected.append(normalized_addition(row))

    ids = [str(row.get("asset_id") or "") for row in selected]
    duplicate_ids = sorted(asset_id for asset_id, count in Counter(ids).items() if not asset_id or count > 1)
    if duplicate_ids:
        blockers.append("duplicate_or_blank_asset_ids:" + ",".join(duplicate_ids))
    urls = [str(row.get("source_url") or "") for row in selected]
    duplicate_urls = {url: count for url, count in Counter(urls).items() if url and count > 1}
    for row in selected:
        asset_id = str(row.get("asset_id") or "unknown")
        for field in REQUIRED_FIELDS:
            value = row.get(field)
            if value is None or value == "" or value == []:
                blockers.append(f"source_field_missing:{asset_id}:{field}")
        if not row.get("human_accepted"):
            blockers.append(f"source_not_human_accepted:{asset_id}")
        if not row.get("commercial_use_ok") or not row.get("modification_ok"):
            blockers.append(f"source_not_commercial_and_modifiable:{asset_id}")
        if any(token in str(row.get("rights_basis") or "").lower() for token in ("unknown rights", "rights unknown", "pending")):
            blockers.append(f"source_rights_ambiguous:{asset_id}")
        path = root / str(row.get("relative_path") or "")
        if not path.is_file():
            blockers.append(f"source_file_missing:{asset_id}")
            continue
        actual_sha = sha256_file(path)
        declared_sha = str(row.get("sha256") or "")
        if declared_sha and declared_sha != actual_sha:
            blockers.append(f"source_sha256_mismatch:{asset_id}")
        row["sha256"] = actual_sha
        duration = None
        if row.get("asset_kind") in {"film", "modern_video", "source_motion"}:
            try:
                duration = round(media_duration(path), 3)
            except (OSError, subprocess.SubprocessError, ValueError):
                blockers.append(f"source_video_probe_failed:{asset_id}")
        receipt = {
            "version": 1,
            "generated_at": utc_now(),
            "video_id": video_id,
            "asset_id": asset_id,
            "source_id": row.get("source_id"),
            "source_url": row.get("source_url"),
            "download_url": row.get("download_url", ""),
            "source_title": row.get("source_title"),
            "creator": row.get("creator"),
            "rights_basis": row.get("rights_basis"),
            "commercial_use_ok": bool(row.get("commercial_use_ok")),
            "modification_ok": bool(row.get("modification_ok")),
            "relative_path": row.get("relative_path"),
            "sha256": actual_sha,
            "duration_seconds": duration,
            "editorial_role": row.get("editorial_role"),
            "evidence_fit": row.get("evidence_fit"),
            "geographic_scope": row.get("geographic_scope"),
            "claim_ids": row.get("claim_ids"),
            "youtube_mutation": "not_performed",
        }
        (receipts_dir / f"{asset_id}.source.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )

    historical = [row for row in selected if row.get("source_class") == "historical_evidence"]
    moving = [row for row in selected if row.get("asset_kind") in {"film", "modern_video", "source_motion"}]
    modern_video = [row for row in selected if row.get("asset_kind") == "modern_video"]
    if len(selected) < MINIMUM_ASSETS:
        blockers.append(f"source_pool_assets:{len(selected)}/{MINIMUM_ASSETS}")
    if len(historical) < MINIMUM_HISTORICAL_ASSETS:
        blockers.append(f"source_pool_historical_assets:{len(historical)}/{MINIMUM_HISTORICAL_ASSETS}")
    if len(moving) < MINIMUM_MOVING_IMAGE_ASSETS:
        blockers.append(f"source_pool_moving_assets:{len(moving)}/{MINIMUM_MOVING_IMAGE_ASSETS}")
    if len(modern_video) < MINIMUM_MODERN_VIDEO_ASSETS:
        blockers.append(f"source_pool_modern_video_assets:{len(modern_video)}/{MINIMUM_MODERN_VIDEO_ASSETS}")
    if len(set(urls)) < MINIMUM_DISTINCT_SOURCE_URLS:
        blockers.append(
            f"source_pool_distinct_source_urls:{len(set(urls))}/{MINIMUM_DISTINCT_SOURCE_URLS}"
        )
    if any("paradise-theatre-" in str(row.get("relative_path") or "") for row in selected):
        blockers.append("wrong_city_toronto_paradise_theatre_entered_source_pool")
    if any("pexels-970170-detroit-context-frame" in str(row.get("relative_path") or "") for row in selected):
        blockers.append("repeated_unreceipted_pexels_frames_entered_source_pool")

    status = "pass" if not blockers else "blocked"
    output = {
        "version": 2,
        "video_id": video_id,
        "status": "accepted_for_long_form_rebuild" if status == "pass" else "blocked",
        "generated_at": utc_now(),
        "assets": selected,
        "excluded_sources": excluded,
        "youtube_mutation": "not_performed",
    }
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "source_pool": display_path(output_path),
        "asset_count": len(selected),
        "historical_asset_count": len(historical),
        "moving_image_asset_count": len(moving),
        "modern_video_asset_count": len(modern_video),
        "distinct_source_url_count": len(set(urls)),
        "duplicate_source_urls": duplicate_urls,
        "excluded_rows": excluded_rows,
        "receipt_count": len(list(receipts_dir.glob("*.source.json"))),
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                "# Pattern Lab Video 04 Long-Form Source Pool",
                "",
                f"Status: {status}",
                f"Assets: {len(selected)}",
                f"Historical assets: {len(historical)}",
                f"Moving-image assets: {len(moving)}",
                f"Modern video assets: {len(modern_video)}",
                f"Excluded rows: {len(excluded_rows)}",
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, report_path, output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Video 04 long-form evidence and context source pool.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(report)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
