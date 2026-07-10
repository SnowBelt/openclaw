#!/usr/bin/env python3
"""Validate that Pattern Lab visuals match nearby narration and proof promises."""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, launch_root, output_root, read_text, utc_now

PROOF_TERMS = {"map", "photo", "source", "archive", "record", "document", "ledger", "proof", "neighborhood", "street", "freeway", "station", "water", "river"}
STOCK_CLASSES = {"stock_video", "modern_context", "context_footage", "stock"}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def ledger_rows(root: Path) -> list[dict[str, str]]:
    path = root / "rights-ledger.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def script_text(video_id: str) -> str:
    path = launch_root(video_id) / "final-script.md"
    return read_text(path) if path.exists() else ""


def row_terms(row: dict[str, str]) -> set[str]:
    text = " ".join(row.get(key, "") for key in ["filename", "source_title", "notes", "source_class", "asset_type"]).lower()
    return {term for term in PROOF_TERMS if term in text}


def build_voice_visual_match_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    script = script_text(video_id).lower()
    rows = ledger_rows(root)
    media_rows = [row for row in rows if row.get("asset_type") in {"image", "video", "proof_footage", "thumbnail", "stock_video"}]
    script_terms = {term for term in PROOF_TERMS if term in script}
    matched_rows = [row for row in media_rows if row_terms(row) & script_terms]
    proof_rows = [row for row in media_rows if row_terms(row) & {"map", "photo", "source", "archive", "record", "document", "proof"}]
    stock_rows = [row for row in media_rows if row.get("source_class", "").lower() in STOCK_CLASSES or "stock" in row.get("notes", "").lower()]
    frame_receipt_path = approval / "voice-visual-frame-receipt.json"
    frame_receipt = read_json(frame_receipt_path)
    blockers: list[str] = []
    warnings: list[str] = []
    if script_terms and not matched_rows:
        blockers.append("no_visual_asset_terms_match_script_terms")
    if any(term in script_terms for term in ["map", "photo", "source", "archive", "record", "document", "proof"]) and not proof_rows:
        blockers.append("script_promises_source_proof_but_no_proof_visual_logged")
    if stock_rows and not proof_rows:
        blockers.append("stock_context_present_without_source_proof_visual")
    if not media_rows:
        warnings.append("no_media_rows_logged_yet")
    if not frame_receipt:
        blockers.append("frame_level_visual_review_receipt_missing")
    elif frame_receipt.get("video_render_sha256") in {None, ""}:
        blockers.append("frame_level_visual_review_receipt_missing_render_sha")
    elif not frame_receipt.get("beats"):
        blockers.append("frame_level_visual_review_receipt_has_no_beats")
    elif frame_receipt.get("status") != "pass":
        blockers.append("frame_level_visual_review_not_passed")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "voice_visual_match_status": "pass" if not blockers else "blocked",
        "script_proof_terms": sorted(script_terms),
        "media_row_count": len(media_rows),
        "matched_media_row_count": len(matched_rows),
        "proof_visual_row_count": len(proof_rows),
        "stock_context_row_count": len(stock_rows),
        "first_20_seconds_source_proof_before_stock_status": "pass" if proof_rows or not stock_rows else "blocked",
        "visual_claim_match_status": "pass" if not blockers else "blocked",
        "frame_level_review_receipt": display_path(frame_receipt_path),
        "frame_level_review_status": "pass" if frame_receipt and frame_receipt.get("beats") and frame_receipt.get("video_render_sha256") else "pending",
        "public_youtube_mutation": "not_performed",
        "blockers": blockers,
        "warnings": warnings,
    }
    json_path = approval / "voice-visual-match-report.json"
    md_path = approval / "voice-visual-match-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Voice-To-Visual Match: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Script proof terms: {', '.join(payload['script_proof_terms']) or 'none'}",
        f"Matched media rows: {payload['matched_media_row_count']}/{payload['media_row_count']}",
        f"Proof visuals: {payload['proof_visual_row_count']}",
        f"Stock/context rows: {payload['stock_context_row_count']}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or ["- none"]),
    ]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab voice-to-visual matching.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_voice_visual_match_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Voice visual match report: {display_path(md_path)}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
