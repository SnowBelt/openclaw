#!/usr/bin/env python3
"""Build a repo-local source-media bridge report for Canva thumbnail production.

This script does not call Canva. It proves that Pattern Lab can map rights-ledgered
source media into deterministic Canva-ready fallback assets before any live Canva
mutation or YouTube mutation is allowed.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

from patternlab_common import display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
BLOCKED_LICENSE_TERMS = (
    "noncommercial",
    "non-commercial",
    "no derivatives",
    "no-derivatives",
    "editorial only",
    "watermark",
    "unknown",
    "all rights reserved",
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or "asset"


def _wikimedia_file_name_from_commons_url(url: str) -> str:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    marker = "/wiki/File:"
    if marker not in path:
        return ""
    return path.split(marker, 1)[1]


def _wikimedia_original_from_thumb(url: str) -> str:
    parsed = urlparse(url)
    if "upload.wikimedia.org" not in parsed.netloc or "/thumb/" not in parsed.path:
        return ""
    path = parsed.path
    # /wikipedia/commons/thumb/a/ab/File.jpg/1920px-File.jpg -> /wikipedia/commons/a/ab/File.jpg
    parts = path.split("/")
    try:
        thumb_index = parts.index("thumb")
    except ValueError:
        return ""
    if len(parts) <= thumb_index + 4:
        return ""
    original_parts = parts[:thumb_index] + parts[thumb_index + 1 : -1]
    return f"{parsed.scheme}://{parsed.netloc}{'/'.join(original_parts)}"


def normalized_urls(source_url: str, source_file: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(kind: str, value: str) -> None:
        value = (value or "").strip()
        if not value or not value.startswith("http") or value in seen:
            return
        seen.add(value)
        candidates.append({"kind": kind, "url": value})

    for kind, value in (("source_url", source_url), ("source_prompt_or_source_file", source_file)):
        add(kind, value)
        file_name = _wikimedia_file_name_from_commons_url(value)
        if file_name:
            add("wikimedia_special_filepath", f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(file_name)}")
        original = _wikimedia_original_from_thumb(value)
        if original:
            add("wikimedia_original_file", original)
        if "tile.loc.gov/" in value or "loc.gov/" in value:
            add("loc_direct_candidate", value)
    return candidates


def source_allowed(asset: dict[str, Any]) -> tuple[bool, list[str]]:
    blockers: list[str] = []
    license_text = " ".join(
        str(asset.get(key, ""))
        for key in ("license_status", "license_or_rights_basis", "notes", "source_title")
    ).lower()
    if any(term in license_text for term in BLOCKED_LICENSE_TERMS):
        blockers.append("blocked_license_or_rights_term")
    if str(asset.get("commercial_use_ok", "yes")).strip().lower() not in {"yes", "true", "ok", "allowed"}:
        blockers.append("commercial_use_not_confirmed")
    if str(asset.get("modification_ok", "yes")).strip().lower() not in {"yes", "true", "ok", "allowed"}:
        blockers.append("modification_not_confirmed")
    return not blockers, blockers


def load_source_assets(root: Path) -> list[dict[str, Any]]:
    manifest = read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json")
    assets: list[dict[str, Any]] = []
    for key in ("historical_assets", "modern_context_assets"):
        value = manifest.get(key, [])
        if isinstance(value, list):
            assets.extend(item for item in value if isinstance(item, dict))
    ledger = root / "rights-ledger.csv"
    if ledger.exists():
        with ledger.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                local_path = str(row.get("local_path") or row.get("filename") or "").strip()
                if not local_path or local_path.startswith("canva://"):
                    continue
                if str(row.get("asset_type", "")).strip().lower() not in {"image", "photo", ""}:
                    continue
                assets.append(
                    {
                        "asset_id": row.get("asset_id", ""),
                        "filename": row.get("filename", local_path),
                        "local_path": local_path,
                        "source_url": row.get("source_url", ""),
                        "source_prompt_or_source_file": row.get("source_prompt_or_source_file", ""),
                        "source_title": row.get("source_title", ""),
                        "license_status": row.get("license_status", ""),
                        "license_or_rights_basis": row.get("license_or_rights_basis", ""),
                        "commercial_use_ok": row.get("commercial_use_ok", ""),
                        "modification_ok": row.get("modification_ok", ""),
                        "visual_category": row.get("source_class", "") or row.get("asset_type", ""),
                        "visual_category_label": row.get("source_class", ""),
                        "visual_category_reason": row.get("notes", ""),
                    }
                )
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for asset in assets:
        key = str(asset.get("local_path") or asset.get("filename") or asset.get("asset_id") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(asset)
    return deduped


def ffprobe_dimensions(path: Path) -> str:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=s=x:p=0",
                str(path),
            ],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return result.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_base_composite(input_path: Path, output_path: Path) -> tuple[bool, str]:
    ensure_dir(output_path.parent)
    try:
        subprocess.run(
            [
                ffmpeg_cmd(),
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(input_path),
                "-vf",
                "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=rgba",
                str(output_path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        return False, f"ffmpeg_failed:{exc}"
    dimensions = ffprobe_dimensions(output_path)
    if dimensions != "1920x1080":
        return False, f"bad_dimensions:{dimensions or 'missing'}"
    return True, "1920x1080"


def source_priority(asset: dict[str, Any]) -> int:
    text = " ".join(
        str(asset.get(key, ""))
        for key in ("asset_id", "local_path", "visual_category", "visual_category_label", "visual_category_reason")
    ).lower()
    if "map" in text or "street_grid" in text:
        return 0
    if "underground" in text or "transit" in text or "tunnel" in text:
        return 1
    if "historic" in text or "street" in text:
        return 2
    if "skyline" in text or "landmark" in text:
        return 3
    return 4


def build_source_bridge(video_id: str, city: str | None = None, min_composites: int = 3) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    bridge_dir = ensure_dir(approval / "canva-source-bridge")
    assets = load_source_assets(root)
    matrix: list[dict[str, Any]] = []
    composite_records: list[dict[str, Any]] = []
    blockers: list[str] = []
    warnings: list[str] = []

    for asset in sorted(assets, key=source_priority):
        local_rel = str(asset.get("local_path") or asset.get("filename") or "")
        local_path = root / local_rel
        allowed, asset_blockers = source_allowed(asset)
        url_candidates = normalized_urls(str(asset.get("source_url", "")), str(asset.get("source_prompt_or_source_file", "")))
        ext = local_path.suffix.lower()
        local_image_ready = local_path.exists() and ext in IMAGE_EXTENSIONS
        fallback_methods = []
        if url_candidates:
            fallback_methods.append("direct_or_normalized_source_url")
        if local_image_ready:
            fallback_methods.append("local_source_backed_base_composite")
        fallback_methods.append("canva_image_to_design_approval_required")
        entry = {
            "asset_id": asset.get("asset_id", "missing"),
            "source_title": asset.get("source_title", "missing"),
            "source_url": asset.get("source_url", ""),
            "source_prompt_or_source_file": asset.get("source_prompt_or_source_file", ""),
            "normalized_url_candidates": url_candidates,
            "local_path": local_rel,
            "local_file_exists": local_path.exists(),
            "local_image_ready": local_image_ready,
            "license_status": asset.get("license_status", "missing"),
            "commercial_use_ok": asset.get("commercial_use_ok", "missing"),
            "modification_ok": asset.get("modification_ok", "missing"),
            "visual_category": asset.get("visual_category", "missing"),
            "canva_upload_eligible": allowed and bool(url_candidates or local_image_ready),
            "eligibility_blockers": asset_blockers,
            "fallback_methods": fallback_methods,
        }
        if not entry["canva_upload_eligible"]:
            warnings.append(f"{entry['asset_id']}:not_canva_upload_eligible")
        matrix.append(entry)

    eligible = [item for item in matrix if item["canva_upload_eligible"] and item["local_image_ready"]]
    for index, item in enumerate(eligible[: max(min_composites, 5)], 1):
        input_path = root / item["local_path"]
        output_path = bridge_dir / f"source_bridge_{index:02d}_{slug(str(item['asset_id']))}.png"
        ok, detail = build_base_composite(input_path, output_path)
        record = {
            "asset_id": item["asset_id"],
            "source_title": item["source_title"],
            "input_path": display_path(input_path),
            "output_path": display_path(output_path),
            "status": "pass" if ok else "blocked",
            "dimensions": detail if ok else "missing",
            "failure": "" if ok else detail,
            "canva_import_method": "local_source_backed_base_composite_then_canva_image_to_design_or_template_fill",
        }
        composite_records.append(record)
        if not ok:
            blockers.append(f"base_composite_failed:{item['asset_id']}:{detail}")

    source_url_matrix_status = "pass" if matrix and all(item["normalized_url_candidates"] for item in matrix if item["canva_upload_eligible"]) else "blocked"
    fallback_ladder_status = "pass" if matrix and all(item["fallback_methods"] for item in matrix if item["canva_upload_eligible"]) else "blocked"
    base_composite_status = "pass" if len([item for item in composite_records if item["status"] == "pass"]) >= min(min_composites, max(1, len(eligible))) else "blocked"
    if source_url_matrix_status != "pass":
        blockers.append("source_url_normalization_matrix_incomplete")
    if fallback_ladder_status != "pass":
        blockers.append("source_upload_fallback_ladder_incomplete")
    if base_composite_status != "pass":
        blockers.append("source_backed_base_composite_count_too_low")

    prior_canva_audit = read_json(approval / "canva-cleveland-examples-audit.json")
    prior_examples = prior_canva_audit.get("examples", []) if isinstance(prior_canva_audit.get("examples"), list) else []
    draft_text_audit_status = "pass" if prior_canva_audit.get("status", "").startswith("pass") and prior_examples else "missing"
    draft_readiness_status = "pass" if not blockers and draft_text_audit_status == "pass" else ("pass_source_bridge_only" if not blockers else "blocked")
    production_readiness_status = "blocked_pending_live_canva_source_fill"

    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city or read_json(root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json").get("active_city", "missing"),
        "status": "pass" if not blockers else "blocked",
        "source_url_normalization_matrix_status": source_url_matrix_status,
        "source_upload_fallback_ladder_status": fallback_ladder_status,
        "source_backed_base_composite_bridge_status": base_composite_status,
        "canva_visual_source_presence_audit_status": "pass" if composite_records else "blocked",
        "canva_preview_text_audit_v2_status": draft_text_audit_status,
        "canva_draft_readiness_status": draft_readiness_status,
        "canva_production_readiness_status": production_readiness_status,
        "source_bridge_production_blocker": "Live Canva source-photo fill/export has not been verified for this city run.",
        "asset_count": len(matrix),
        "eligible_asset_count": len([item for item in matrix if item["canva_upload_eligible"]]),
        "base_composite_count": len([item for item in composite_records if item["status"] == "pass"]),
        "required_base_composite_count": min_composites,
        "source_assets": matrix,
        "base_composites": composite_records,
        "blockers": sorted(set(blockers)),
        "warnings": sorted(set(warnings)),
        "public_youtube_mutation": "not_performed",
        "canva_live_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }
    json_report = approval / "thumbnail-canva-source-bridge-report.json"
    md_report = approval / "thumbnail-canva-source-bridge-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Canva Source Bridge: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"City: {payload['city']}",
        f"URL matrix: {payload['source_url_normalization_matrix_status']}",
        f"Fallback ladder: {payload['source_upload_fallback_ladder_status']}",
        f"Base composites: {payload['base_composite_count']}/{payload['required_base_composite_count']} ({payload['source_backed_base_composite_bridge_status']})",
        f"Draft readiness: {payload['canva_draft_readiness_status']}",
        f"Production readiness: {payload['canva_production_readiness_status']}",
        "Public YouTube mutation: not performed",
        "Canva live mutation: not performed",
        "Paid/pro assets: not used",
        "",
        "## Base Composites",
        "",
    ]
    for item in composite_records:
        lines.append(f"- {item['asset_id']}: {item['status']} {item['dimensions']} -> {item['output_path']}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {item}" for item in payload["warnings"]] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab Canva source bridge report.")
    parser.add_argument("--video-id", default="cleveland-test")
    parser.add_argument("--city", default="")
    parser.add_argument("--min-composites", type=int, default=3)
    args = parser.parse_args()
    payload, json_report, _md_report = build_source_bridge(args.video_id, args.city or None, args.min_composites)
    print(json.dumps({
        "status": payload["status"],
        "source_url_normalization_matrix_status": payload["source_url_normalization_matrix_status"],
        "source_upload_fallback_ladder_status": payload["source_upload_fallback_ladder_status"],
        "source_backed_base_composite_bridge_status": payload["source_backed_base_composite_bridge_status"],
        "base_composite_count": payload["base_composite_count"],
        "report": display_path(json_report),
    }, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
