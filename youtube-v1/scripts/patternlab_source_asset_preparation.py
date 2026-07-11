#!/usr/bin/env python3
"""Prepare approved evidence for rendering without altering its provenance or meaning."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab.state import sha256_file


MAX_EDGE = 3840


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def focus_box(value: object) -> tuple[float, float, float, float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    try:
        x, y, width, height = (float(item) for item in value)
    except (TypeError, ValueError):
        return None
    if not (0 <= x < 1 and 0 <= y < 1 and 0 < width <= 1 and 0 < height <= 1 and x + width <= 1 and y + height <= 1):
        return None
    return x, y, width, height


def build_report(video_id: str, *, prepare: bool = False) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    intake_path = root / "source-packet" / "evidence-intake.json"
    intake = read_json(intake_path)
    blockers: list[str] = []
    rows: list[dict] = []
    assets = intake.get("assets") if isinstance(intake.get("assets"), list) else []
    if not assets:
        blockers.append("evidence_intake_assets_missing")
    prepared_dir = root / "evidence" / "prepared"
    for item in assets:
        if not isinstance(item, dict):
            blockers.append("evidence_intake_asset_not_object")
            continue
        asset_id = str(item.get("asset_id") or "unknown")
        source = root / str(item.get("relative_path") or "")
        row_blockers: list[str] = []
        if not source.is_file():
            row_blockers.append("source_file_missing")
        if str(item.get("human_accepted") or "").lower() not in {"true", "yes", "approved"}:
            row_blockers.append("source_not_human_accepted")
        box = focus_box(item.get("focus_box"))
        if box is None:
            row_blockers.append("focus_box_missing_or_invalid")
        prepared = prepared_dir / f"{asset_id}.png"
        if prepare and not row_blockers:
            from PIL import Image
            with Image.open(source) as image:
                image = image.convert("RGB")
                x, y, width, height = box
                left = round(image.width * x)
                top = round(image.height * y)
                right = round(image.width * (x + width))
                bottom = round(image.height * (y + height))
                crop = image.crop((left, top, right, bottom))
                scale = min(1.0, MAX_EDGE / max(crop.width, crop.height))
                if scale < 1:
                    crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
                prepared.parent.mkdir(parents=True, exist_ok=True)
                crop.save(prepared, "PNG", optimize=True)
        if prepare and not prepared.is_file() and not row_blockers:
            row_blockers.append("prepared_asset_missing_after_prepare")
        rows.append({
            "asset_id": asset_id, "source": display_path(source), "source_sha256": sha256_file(source) if source.is_file() else "",
            "focus_box": list(box) if box else None, "prepared": display_path(prepared),
            "prepared_sha256": sha256_file(prepared) if prepared.is_file() else "", "blockers": row_blockers,
        })
        blockers.extend(f"{asset_id}:{blocker}" for blocker in row_blockers)
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass" if not blockers else "blocked",
        "prepared": prepare, "intake": display_path(intake_path), "assets": rows,
        "blockers": sorted(set(blockers)), "youtube_mutation": "not_performed",
    }
    json_path = approval / "source-asset-preparation-report.json"
    md_path = approval / "source-asset-preparation-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Source Asset Preparation: Video {video_id}", "", f"Status: {payload['status']}",
        f"Prepared: {prepare}", "", "## Assets", "",
        *[f"- {row['asset_id']}: {row['prepared']} ({'blocked' if row['blockers'] else 'pass'})" for row in rows],
        "", "## Blockers", "", *([f"- {item}" for item in payload["blockers"]] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare explicitly accepted Pattern Lab evidence crops.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), prepare=args.prepare)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
