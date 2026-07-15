#!/usr/bin/env python3
"""Fail closed on thin, generic, weakly licensed, or visually weak source pools."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.thumbnail import load_thumbnail_candidate_manifest


POLICY_PATH = BASE / "resources" / "visual-acquisition-routing-policy.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
UNKNOWN_CREATOR_MARKERS = {
    "",
    "unknown",
    "unknown creator",
    "not exposed",
    "pexels contributor; item-level creator not exposed in local source packet",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_path(root: Path, asset: dict[str, Any]) -> Path | None:
    raw = str(asset.get("local_path") or asset.get("filename") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else root / path


def source_url_is_exact(url: str, blocked_patterns: list[str]) -> bool:
    lowered = url.strip().lower()
    if not lowered.startswith(("https://", "http://")):
        return False
    if any(pattern.lower() in lowered for pattern in blocked_patterns):
        return False
    parsed = urllib.parse.urlparse(lowered)
    if parsed.netloc.endswith("pexels.com") and "/video/" not in parsed.path and "/photo/" not in parsed.path:
        return False
    if parsed.netloc.endswith("pixabay.com") and not any(token in parsed.path for token in ("/videos/", "/photos/", "/illustrations/", "/vectors/")):
        return False
    return True


def is_video_asset(asset: dict[str, Any], path: Path | None) -> bool:
    if str(asset.get("asset_type") or "").lower() in {"video", "clip", "proof_footage", "archival_video"}:
        return True
    return bool(path and path.suffix.lower() in VIDEO_SUFFIXES)


def image_metrics(path: Path) -> dict[str, float] | None:
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        return None
    try:
        from PIL import Image, ImageStat

        with Image.open(path) as image:
            rgb = image.convert("RGB")
            rgb.thumbnail((320, 320))
            hsv = rgb.convert("HSV")
            luma = rgb.convert("L")
            return {
                "mean_luma": round(ImageStat.Stat(luma).mean[0] / 255, 4),
                "mean_saturation": round(ImageStat.Stat(hsv).mean[1] / 255, 4),
                "luma_standard_deviation": round(ImageStat.Stat(luma).stddev[0] / 255, 4),
            }
    except (OSError, ValueError):
        return None


def manifest_assets(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key in (
        "historical_assets",
        "modern_context_assets",
        "modern_context_video_assets",
        "archival_video_assets",
    ):
        values = manifest.get(key, [])
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, dict):
                continue
            identity = str(item.get("asset_id") or item.get("local_path") or item.get("filename") or id(item))
            if identity in seen:
                continue
            seen.add(identity)
            rows.append(item)
    return rows


def historical_entity_match(asset: dict[str, Any], city_terms: list[str], entity_terms: list[str]) -> bool:
    # Deliberately exclude query/notes fields. A search query can contain
    # "Black Bottom Detroit" even when the returned item is the unrelated dance.
    text = " ".join(
        str(asset.get(key) or "")
        for key in ("source_title", "source_url", "source_description", "geographic_terms", "subjects")
    ).lower()
    return any(term in text for term in city_terms) and any(term in text for term in entity_terms)


def thumbnail_energy_rows(root: Path, policy: dict[str, Any]) -> list[dict[str, Any]]:
    rules = policy.get("modern_thumbnail_visual_energy", {})
    rows: list[dict[str, Any]] = []
    for candidate in load_thumbnail_candidate_manifest(root).candidates:
        for visual in candidate.get("visual_objects", []) if isinstance(candidate.get("visual_objects"), list) else []:
            if not isinstance(visual, dict) or visual.get("kind") != "modern_photo":
                continue
            raw = str(visual.get("local_path") or "").strip()
            path = Path(raw) if raw else None
            if path and not path.is_absolute():
                path = root / path
            metrics = image_metrics(path) if path and path.is_file() else None
            monochrome = visual.get("monochrome_intent") is True and visual.get("human_monochrome_approval") is True
            blockers: list[str] = []
            if not path or not path.is_file():
                blockers.append("modern_thumbnail_source_file_missing")
            elif not metrics:
                blockers.append("modern_thumbnail_source_metrics_unavailable")
            elif not monochrome:
                if metrics["mean_luma"] < float(rules.get("minimum_mean_luma", 0)):
                    blockers.append("modern_thumbnail_source_luma_below_floor")
                if metrics["mean_saturation"] < float(rules.get("minimum_mean_saturation", 0)):
                    blockers.append("modern_thumbnail_source_saturation_below_floor")
                if metrics["luma_standard_deviation"] < float(rules.get("minimum_luma_standard_deviation", 0)):
                    blockers.append("modern_thumbnail_source_contrast_below_floor")
            rows.append(
                {
                    "candidate_id": candidate.get("id", ""),
                    "slot": visual.get("slot", ""),
                    "path": display_path(path) if path else "missing",
                    "metrics": metrics or {},
                    "monochrome_exception": monochrome,
                    "status": "pass" if not blockers else "blocked",
                    "blockers": blockers,
                }
            )
    return rows


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    floors = policy.get("production_pool_floors", {})
    generic_requirements = policy.get("generic_context_asset_requirements", {})
    blocked_patterns = [str(item) for item in policy.get("blocked_source_urls", [])]
    manifest_path = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    manifest = read_json(manifest_path)
    assets = manifest_assets(manifest)
    rows: list[dict[str, Any]] = []
    blockers: list[str] = []
    provider_names: set[str] = set()
    source_urls: list[str] = []
    historical_count = 0
    modern_count = 0
    modern_video_count = 0
    exact_item_count = 0
    for asset in assets:
        asset_id = str(asset.get("asset_id") or "missing")
        source_class = str(asset.get("source_class") or "").lower()
        path = local_path(root, asset)
        row_blockers: list[str] = []
        url = str(asset.get("source_url") or "").strip()
        creator = str(asset.get("creator") or "").strip()
        provider = str(asset.get("archive_or_platform") or asset.get("tool") or "").strip()
        if provider:
            provider_names.add(provider)
        if url:
            source_urls.append(url)
        exact = source_url_is_exact(url, blocked_patterns)
        if exact:
            exact_item_count += 1
        else:
            row_blockers.append("exact_item_source_url_missing_or_search_url")
        if creator.lower() in UNKNOWN_CREATOR_MARKERS or "not exposed" in creator.lower():
            row_blockers.append("item_creator_missing")
        if not str(asset.get("license_or_rights_basis") or asset.get("license_status") or "").strip():
            row_blockers.append("item_rights_basis_missing")
        if str(asset.get("commercial_use_ok") or "").lower() != "yes":
            row_blockers.append("commercial_use_not_approved")
        if str(asset.get("modification_ok") or "").lower() != "yes":
            row_blockers.append("modification_not_approved")
        if not path or not path.is_file() or path.stat().st_size == 0:
            row_blockers.append("local_source_file_missing")
            file_hash = ""
        else:
            file_hash = sha256_file(path)
        video = is_video_asset(asset, path)
        if source_class == "historical_evidence":
            historical_count += 1
            if not historical_entity_match(
                asset,
                [str(item).lower() for item in manifest.get("required_city_terms", [])],
                [str(item).lower() for item in manifest.get("required_entity_terms", [])],
            ):
                row_blockers.append("historical_item_not_geographically_entity_specific")
        if source_class == "modern_context":
            modern_count += 1
            if video:
                modern_video_count += 1
            generic_context = asset.get("geographic_scope") == "generic" or asset.get("editorial_role") == "context_only"
            if generic_context:
                for field in generic_requirements.get("required_fields", []):
                    if field not in asset:
                        row_blockers.append(f"generic_context_missing_{field}")
                for field, expected in (generic_requirements.get("required_values") or {}).items():
                    if asset.get(field) != expected:
                        row_blockers.append(f"generic_context_wrong_{field}")
        rows.append(
            {
                "asset_id": asset_id,
                "source_class": source_class,
                "provider": provider,
                "source_url": url,
                "local_path": display_path(path) if path else "missing",
                "sha256": file_hash,
                "is_video": video,
                "editorial_role": asset.get("editorial_role", ""),
                "geographic_scope": asset.get("geographic_scope", ""),
                "status": "pass" if not row_blockers else "blocked",
                "blockers": row_blockers,
            }
        )
        blockers.extend(f"{asset_id}:{item}" for item in row_blockers)

    if manifest.get("status") not in {"ready", "pass"}:
        blockers.append(f"visual_rebuild_manifest_status:{manifest.get('status', 'missing')}")
    if historical_count < int(floors.get("historical_or_proof_assets", 0)):
        blockers.append(f"historical_or_proof_assets:{historical_count}/{floors.get('historical_or_proof_assets', 0)}")
    if modern_count < int(floors.get("modern_context_assets", 0)):
        blockers.append(f"modern_context_assets:{modern_count}/{floors.get('modern_context_assets', 0)}")
    if modern_video_count < int(floors.get("modern_context_video_assets", 0)):
        blockers.append(f"modern_context_video_assets:{modern_video_count}/{floors.get('modern_context_video_assets', 0)}")
    if len(provider_names) < int(floors.get("selected_provider_count", 0)):
        blockers.append(f"selected_provider_count:{len(provider_names)}/{floors.get('selected_provider_count', 0)}")
    unique_share = len(set(source_urls)) / len(source_urls) if source_urls else 0.0
    if unique_share < float(floors.get("unique_source_url_share", 0)):
        blockers.append(f"unique_source_url_share:{unique_share:.3f}/{floors.get('unique_source_url_share', 0)}")

    energy_rows = thumbnail_energy_rows(root, policy)
    blockers.extend(
        f"{row['candidate_id']}:{item}" for row in energy_rows for item in row.get("blockers", [])
    )
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH),
        "manifest": display_path(manifest_path),
        "asset_count": len(assets),
        "historical_or_proof_asset_count": historical_count,
        "modern_context_asset_count": modern_count,
        "modern_context_video_asset_count": modern_video_count,
        "selected_provider_count": len(provider_names),
        "selected_providers": sorted(provider_names),
        "exact_item_receipt_count": exact_item_count,
        "unique_source_url_share": round(unique_share, 4),
        "asset_rows": rows,
        "thumbnail_visual_energy_rows": energy_rows,
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
        "paid_provider_calls": "not_performed",
    }
    json_path = approval / "visual-acquisition-quality-report.json"
    md_path = approval / "visual-acquisition-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Visual Acquisition Quality: Video {video_id}",
        "",
        f"Status: {payload['status']}",
        f"Historical/proof assets: {historical_count}",
        f"Modern context assets: {modern_count}",
        f"Modern context video assets: {modern_video_count}",
        f"Providers: {len(provider_names)} ({', '.join(sorted(provider_names)) or 'none'})",
        f"Exact item receipts: {exact_item_count}/{len(assets)}",
        f"Unique source URL share: {unique_share:.1%}",
        "",
        "## Thumbnail Visual Energy",
        "",
    ]
    lines.extend(
        f"- {row['candidate_id']} {row['slot']}: {row['status']} {row['metrics']}"
        for row in energy_rows
    )
    if not energy_rows:
        lines.append("- no modern thumbnail hero/inset rows")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload["blockers"]] or ["- none"])
    lines.extend(["", "Paid provider calls: not performed", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab real-media acquisition depth and item receipts.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
