#!/usr/bin/env python3
"""Build local source-provider health report from the Video source packet.

This is a local/read-only validation surface. It does not fetch new assets,
call paid tools, or mutate YouTube.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def build_source_provider_health_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest_path = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    manifest = read_json(manifest_path)
    free_stock = read_json(approval / "free-stock-acquisition-report.json")
    acquisition_quality = read_json(approval / "visual-acquisition-quality-report.json")
    assets = []
    for key in ("historical_assets", "modern_context_assets"):
        rows = manifest.get(key, [])
        if isinstance(rows, list):
            assets.extend(row for row in rows if isinstance(row, dict))

    provider_counter = Counter(
        str(asset.get("archive_or_platform") or asset.get("tool") or "unknown").strip()
        for asset in assets
        if str(asset.get("archive_or_platform") or asset.get("tool") or "unknown").strip()
    )
    source_urls = {str(asset.get("source_url") or asset.get("source_prompt_or_source_file") or "").strip() for asset in assets}
    source_urls.discard("")
    compatible_assets = [
        asset
        for asset in assets
        if str(asset.get("commercial_use_ok", "")).lower() == "yes"
        and str(asset.get("modification_ok", "")).lower() == "yes"
        and str(asset.get("license_status", "")).strip()
    ]
    provider_rows = [
        {
            "provider": provider,
            "selected_count": count,
            "status": "selected",
        }
        for provider, count in sorted(provider_counter.items())
    ]
    attempted_rows = [
        row
        for row in free_stock.get("provider_rows", [])
        if isinstance(row, dict) and row.get("status") in {"queried", "failed"}
    ]
    archive_events = [
        row for row in manifest.get("provider_events", []) if isinstance(row, dict)
    ]
    provider_rows.extend(
        {
            "provider": str(row.get("provider") or "unknown"),
            "query": str(row.get("query") or ""),
            "selected_count": 0,
            "status": str(row.get("status") or "unknown"),
            "candidate_count": int(row.get("candidate_count") or 0),
        }
        for row in attempted_rows
    )
    provider_rows.extend(
        {
            "provider": str(row.get("provider") or "unknown"),
            "query": "",
            "selected_count": 0,
            "status": str(row.get("status") or "unknown"),
            "candidate_count": 0,
            "detail": str(row.get("detail") or ""),
        }
        for row in archive_events
    )
    selected_provider_count = len(provider_counter)
    asset_count = len(assets)
    compatible_count = len(compatible_assets)
    blockers: list[str] = []
    if manifest.get("status") not in {"ready", "pass"}:
        blockers.append(f"visual_rebuild_manifest_status:{manifest.get('status', 'missing')}")
    active_city = str(manifest.get("city") or manifest.get("active_city") or "").strip()
    if not active_city:
        blockers.append("visual_rebuild_manifest_city_missing")
    if asset_count < 5:
        blockers.append(f"insufficient_assets:{asset_count}/5")
    if selected_provider_count < 2:
        blockers.append(f"single_source_dependency:{selected_provider_count}")
    if compatible_count != asset_count:
        blockers.append(f"rights_compatible_assets:{compatible_count}/{asset_count}")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": active_city,
        "status": "pass" if not blockers else "blocked",
        "source_package_status": manifest.get("status", "missing"),
        "source_package_manifest": display_path(manifest_path),
        "provider_attempt_count": len(attempted_rows) + len(archive_events),
        "attempted_provider_count": len(
            {
                str(row.get("provider") or "")
                for row in attempted_rows + archive_events
                if str(row.get("provider") or "")
            }
        ),
        "selected_provider_count": selected_provider_count,
        "selected_providers": sorted(provider_counter.keys()),
        "asset_count": asset_count,
        "rights_compatible_asset_count": compatible_count,
        "unique_source_url_count": len(source_urls),
        "exact_item_receipt_count": int(acquisition_quality.get("exact_item_receipt_count") or 0),
        "free_stock_acquisition_status": free_stock.get("status", "missing"),
        "single_source_dependency": selected_provider_count <= 1,
        "provider_rows": provider_rows,
        "blockers": blockers,
        "fail_closed_reasons": blockers,
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
        "network_access": "not_used_local_manifest_only",
    }
    json_report = approval / "source-provider-health-report.json"
    md_report = approval / "source-provider-health-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Source Provider Health: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Manifest: {payload['source_package_manifest']}",
        f"Assets: {payload['asset_count']}",
        f"Rights-compatible assets: {payload['rights_compatible_asset_count']}/{payload['asset_count']}",
        f"Selected providers: {payload['selected_provider_count']}",
        f"Single-source dependency: {payload['single_source_dependency']}",
        "Public YouTube mutation: not performed",
        "Network access: not used; local manifest only",
        "",
        "## Providers",
        "",
    ]
    for row in provider_rows:
        lines.append(
            f"- {row['provider']}: status={row['status']} selected={row['selected_count']} candidates={row.get('candidate_count', 0)} query={row.get('query', '')} detail={row.get('detail', '')}"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Pattern Lab source-provider health report from local source packet.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    payload, json_report, _md_report = build_source_provider_health_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(json_report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
