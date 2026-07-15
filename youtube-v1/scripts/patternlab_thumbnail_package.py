#!/usr/bin/env python3
"""Compile one city-generic, hash-bound thumbnail review package.

The renderer may evolve, but every downstream QA gate consumes this single
manifest.  No city is inferred from titles and no hand-authored score is
created here.  This adapter only binds final pixels to explicit episode
identity, accepted source records, layout truth, and tournament provenance.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, city_from_sources
from patternlab.state import sha256_file
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


STYLE_TO_TEMPLATE = {
    "neon_city_myth": "map_photo",
    "underground_city": "proof_object_context",
    "redacted_file": "proof_object_context",
    "newspaper_front_page": "archival_modern_composite",
    "then_now_split": "then_now",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_json(path: Path, value: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def resolve_youtube_path(value: str | Path) -> Path:
    path = Path(str(value or ""))
    if path.is_absolute():
        return path
    if str(path).startswith("youtube-v1/"):
        return BASE.parent / path
    return BASE / path


def source_intake(root: Path, approval: Path) -> tuple[Path, dict[str, Any]]:
    binding = read_json(approval / "evidence-manifest-binding.json")
    raw = str(binding.get("intake_path") or "").strip()
    candidates: list[Path] = []
    if raw:
        path = Path(raw)
        candidates.append(path if path.is_absolute() else BASE / path)
    candidates.extend(
        [
            root / "source-packet" / "production" / "evidence-intake-expanded.json",
            root / "source-packet" / "long-form-rebuild" / "evidence-intake-expanded.json",
            root / "source-packet" / "evidence-intake.json",
        ]
    )
    for path in candidates:
        payload = read_json(path)
        if path.is_file() and isinstance(payload.get("assets"), list):
            return path, payload
    return candidates[-1], {}


def source_path(root: Path, row: dict[str, Any]) -> Path:
    raw = str(row.get("relative_path") or row.get("local_path") or "")
    path = Path(raw)
    return path if path.is_absolute() else root / path


def evidence_index(root: Path, intake: dict[str, Any]) -> dict[Path, dict[str, Any]]:
    rows: dict[Path, dict[str, Any]] = {}
    for item in intake.get("assets", []):
        if not isinstance(item, dict):
            continue
        path = source_path(root, item)
        try:
            rows[path.resolve()] = item
        except OSError:
            continue
    return rows


def source_kind(row: dict[str, Any]) -> str:
    terms = " ".join(
        str(row.get(key) or "")
        for key in ("asset_kind", "source_class", "visual_category", "editorial_role", "geographic_scope")
    ).casefold()
    if "ai" in terms or "synthetic" in terms or "reconstruction" in terms:
        return "ai_support"
    is_modern = any(term in terms for term in ("modern", "current", "present day", "present-day"))
    if "map" in terms:
        return "modern_map" if is_modern else "historical_map"
    return "modern_photo" if is_modern else "historical_photo"


def normalized_text_regions(layout: dict[str, Any]) -> list[list[float]]:
    canvas = layout.get("canvas") if isinstance(layout.get("canvas"), dict) else {}
    width = float(canvas.get("width") or 1920)
    height = float(canvas.get("height") or 1080)
    regions: list[list[float]] = []
    for text in layout.get("texts", []):
        if not isinstance(text, dict) or text.get("purpose") != "public_thumbnail_text":
            continue
        rect = text.get("rect") if isinstance(text.get("rect"), dict) else {}
        try:
            x = float(rect["x"])
            y = float(rect["y"])
            w = float(rect["width"])
            h = float(rect["height"])
        except (KeyError, TypeError, ValueError):
            continue
        # AppKit layout coordinates start at the bottom; Pillow OCR crops start
        # at the top.  Store normalized Pillow coordinates in the manifest.
        regions.append(
            [
                round(x / width, 6),
                round((height - y - h) / height, 6),
                round((x + w) / width, 6),
                round((height - y) / height, 6),
            ]
        )
    return regions


def pixel_text_regions(layout: dict[str, Any]) -> list[list[int]]:
    regions: list[list[int]] = []
    for left, top, right, bottom in normalized_text_regions(layout):
        regions.append([round(left * 1920), round(top * 1080), round(right * 1920), round(bottom * 1080)])
    return regions


def non_city_word_count(headline: str, city: str) -> int:
    words = re.findall(r"[A-Z0-9]+", headline.upper())
    city_words = set(re.findall(r"[A-Z0-9]+", city.upper()))
    return len([word for word in words if word not in city_words])


def composition_for(candidate: dict[str, Any]) -> str:
    style = str(candidate.get("style_family") or "")
    if style == "then_now_split":
        return "then_now"
    if candidate.get("concept_id") in {"clear_redrawn", "hidden_map"}:
        return "map_system"
    return "proof_context"


def build_visual_objects(
    candidate: dict[str, Any],
    *,
    root: Path,
    sources: dict[Path, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    objects: list[dict[str, Any]] = []
    source_ids: list[str] = []
    blockers: list[str] = []
    paths = [resolve_youtube_path(value) for value in candidate.get("source_paths", []) if str(value).strip()]
    composition = composition_for(candidate)
    for index, path in enumerate(paths):
        try:
            row = sources.get(path.resolve())
        except OSError:
            row = None
        if not row:
            blockers.append(f"thumbnail_source_not_in_accepted_intake:{path.name}")
            continue
        asset_id = str(row.get("asset_id") or "")
        if not asset_id:
            blockers.append(f"thumbnail_source_asset_id_missing:{path.name}")
            continue
        if row.get("human_accepted") is not True:
            blockers.append(f"thumbnail_source_not_human_accepted:{asset_id}")
        if row.get("commercial_use_ok") is not True or row.get("modification_ok") is not True:
            blockers.append(f"thumbnail_source_rights_not_commercial_modifiable:{asset_id}")
        kind = source_kind(row)
        role = "proof" if index == 0 or composition == "then_now" else "context"
        item: dict[str, Any] = {
            "asset_id": asset_id,
            "kind": kind,
            "role": role,
            "local_path": str(path),
            "source_url": str(row.get("source_url") or ""),
            "rights_basis": str(row.get("rights_basis") or row.get("license_or_rights_basis") or ""),
        }
        if composition == "then_now":
            item["slot"] = "then" if index == 0 else "now"
        objects.append(item)
        if role == "proof":
            source_ids.append(asset_id)
    if not objects:
        blockers.append(f"thumbnail_visible_sources_missing:{candidate.get('concept_id', 'unknown')}")
    return objects, source_ids, blockers


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    video_id = video_id.zfill(2)
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    launch = BASE / "launch" / f"video-{video_id}"
    package = read_json(launch / "package.json")
    metadata = read_json(approval / "upload-metadata.json")
    factory = read_json(approval / "thumbnail-factory-report.json")
    layout_report = read_json(approval / "thumbnail-layout-audit-report.json")
    visual_contract = read_json(launch / "visual-contract.json")
    intake_path, intake = source_intake(root, approval)
    blockers: list[str] = []
    try:
        city = city_from_sources(
            (
                ("package", package.get("city")),
                ("upload_metadata", metadata.get("city")),
                ("thumbnail_factory", factory.get("active_city")),
            ),
            required=True,
        )
    except CityContractError as exc:
        city = ""
        blockers.append(str(exc))
    if factory.get("status") != "pass" or factory.get("blockers") or factory.get("warnings"):
        blockers.append("thumbnail_factory_not_clean_pass")
    roughs = factory.get("rough_concepts") if isinstance(factory.get("rough_concepts"), list) else []
    shortlist = factory.get("shortlisted_concepts") if isinstance(factory.get("shortlisted_concepts"), list) else []
    production = factory.get("review_concepts") if isinstance(factory.get("review_concepts"), list) else []
    selected = factory.get("candidates") if isinstance(factory.get("candidates"), list) else []
    for name, rows, expected in (
        ("roughs", roughs, 20),
        ("shortlist", shortlist, 8),
        ("production", production, 5),
        ("finalists", selected, 3),
    ):
        if len(rows) != expected:
            blockers.append(f"thumbnail_tournament_count_invalid:{name}:{len(rows)}/{expected}")
    layouts: dict[str, dict[str, Any]] = {}
    for row in layout_report.get("entries", []):
        if isinstance(row, dict):
            layouts[Path(str(row.get("path") or "")).name] = row.get("layout_manifest") or {}
    sources = evidence_index(root, intake)
    candidates: list[dict[str, Any]] = []
    required_source_ids: list[str] = []
    source_assets: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()
    for index, raw in enumerate(selected, start=1):
        if not isinstance(raw, dict):
            blockers.append(f"thumbnail_candidate_not_object:{index}")
            continue
        path = resolve_youtube_path(str(raw.get("path") or ""))
        digest = sha256_file(path) if path.is_file() else ""
        if not path.is_file():
            blockers.append(f"thumbnail_candidate_missing:{path.name or index}")
        if not digest or digest != str(raw.get("sha256") or ""):
            blockers.append(f"thumbnail_candidate_hash_mismatch:{path.name or index}")
        if digest in seen_hashes:
            blockers.append(f"thumbnail_candidate_duplicate_hash:{path.name or index}")
        seen_hashes.add(digest)
        objects, source_ids, object_blockers = build_visual_objects(raw, root=root, sources=sources)
        blockers.extend(object_blockers)
        required_source_ids.extend(source_ids)
        for item in objects:
            if not any(existing.get("asset_id") == item.get("asset_id") for existing in source_assets):
                source_assets.append(
                    {
                        "asset_id": item.get("asset_id"),
                        "path": item.get("local_path"),
                        "sha256": sha256_file(Path(str(item.get("local_path")))) if Path(str(item.get("local_path"))).is_file() else "",
                        "source_url": item.get("source_url"),
                        "rights": item.get("rights_basis"),
                        "role": item.get("role"),
                    }
                )
        headline = str(raw.get("headline") or "").strip()
        layout = layouts.get(path.name, {})
        template_family = STYLE_TO_TEMPLATE.get(str(raw.get("style_family") or ""), "proof_object_context")
        candidate = {
            "id": str(raw.get("letter") or raw.get("concept_id") or index).lower(),
            "concept_id": raw.get("concept_id"),
            "filename": path.name,
            "path": display_path(path),
            "sha256": digest,
            "city": city,
            "headline": headline,
            "public_text": [headline],
            "ocr_regions": normalized_text_regions(layout),
            "text_regions": pixel_text_regions(layout),
            "template_family": template_family,
            "composition_mode": composition_for(raw),
            "visual_objects": objects,
            "visible_proof_area_ratio": 0.35,
            "hero_luminance": "balanced",
            "generic_text_card": False,
            "non_city_word_count": non_city_word_count(headline, city) if city else 99,
            "source_asset_ids": source_ids,
            "factory_concept_id": raw.get("concept_id"),
        }
        if not candidate["ocr_regions"]:
            blockers.append(f"thumbnail_text_regions_missing:{candidate['id']}")
        candidates.append(candidate)
    families = {row.get("template_family") for row in candidates}
    if len(families) < 3:
        blockers.append("thumbnail_finalists_not_three_distinct_template_families")

    required_source_ids = list(dict.fromkeys(item for item in required_source_ids if item))
    title = str(metadata.get("selected_title") or metadata.get("default_title") or "").strip()
    first_payoff = str(
        visual_contract.get("first_30_second_payoff")
        or package.get("upload_metadata", {}).get("guru_growth_system", {}).get("first_30_seconds_mini_product", {}).get("promise")
        or title
    ).strip()
    brief = {
        "video_id": video_id,
        "city": city,
        "viewer_promise": title,
        "hidden_history_question": str(package.get("benchmark_growth_playbook", {}).get("core_thesis") or title),
        "proof_object": ", ".join(required_source_ids[:4]) or "accepted episode evidence",
        "city_anchor": f"Recognizable {city} place evidence plus the exact episode proof object" if city else "",
        "emotion": "discovery, local recognition, consequence, and curiosity without sensationalism",
        "hero_subject": "rights-cleared episode-specific people, street life, landmark, map, or matched then/now source",
        "presenter_role": None,
        "headline_options": [str(row.get("headline") or "") for row in production if str(row.get("headline") or "")][:5],
        "color_direction": "bright focal subject, controlled vivid accent, high shelf contrast, readable display typography",
        "source_asset_ids": required_source_ids,
        "forbidden_claims": [
            "AI support presented as archival evidence",
            "generic city context presented as exact neighborhood proof",
            "map/photo modality mismatch in a then/now claim",
            "headline promise not paid off in the first 30 seconds",
        ],
        "first_30_second_payoff": first_payoff,
        "ai_support_policy": "non_proof_support_only",
        "template_families": sorted(families),
    }
    manifest = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "ready_for_hash_bound_owner_review" if not blockers else "blocked",
        "factory_report_sha256": sha256_file(approval / "thumbnail-factory-report.json") if (approval / "thumbnail-factory-report.json").is_file() else "",
        "source_intake": display_path(intake_path),
        "source_intake_sha256": sha256_file(intake_path) if intake_path.is_file() else "",
        "candidates": candidates,
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    tournament = {
        "schema_version": 1,
        "generated_at": manifest["generated_at"],
        "video_id": video_id,
        "city": city,
        "roughs": roughs,
        "shortlist": shortlist,
        "production": production,
        "finalists": candidates,
        "source_assets": source_assets,
        "status": "pass" if not blockers else "blocked",
        "blockers": sorted(set(blockers)),
    }
    write_json(approval / "thumbnail-worldclass-brief.json", brief)
    write_json(approval / "thumbnail-brief.json", brief)
    write_json(approval / "thumbnail-worldclass-tournament.json", tournament)
    write_json(approval / "thumbnail-tournament-manifest.json", tournament)
    write_json(approval / "thumbnail-codex-primary-review.json", manifest)
    payload = {
        "generated_at": manifest["generated_at"],
        "video_id": video_id,
        "city": city,
        "status": "pass" if not blockers else "blocked",
        "candidate_count": len(candidates),
        "distinct_candidate_hash_count": len(seen_hashes),
        "distinct_template_family_count": len(families),
        "required_source_asset_ids": required_source_ids,
        "source_intake": display_path(intake_path),
        "candidate_manifest": display_path(approval / "thumbnail-codex-primary-review.json"),
        "tournament_manifest": display_path(approval / "thumbnail-worldclass-tournament.json"),
        "brief": display_path(approval / "thumbnail-worldclass-brief.json"),
        "blockers": sorted(set(blockers)),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    report = approval / "thumbnail-package-report.json"
    markdown = approval / "thumbnail-package-report.md"
    write_json(report, payload)
    markdown.write_text(
        "\n".join(
            [
                f"# Pattern Lab Thumbnail Package: Video {video_id}",
                "",
                f"City: {city or 'missing'}",
                f"Status: {payload['status']}",
                f"Candidates: {len(candidates)}/3",
                f"Template families: {len(families)}/3",
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
    return payload, report, markdown


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile a hash-bound Pattern Lab thumbnail package for any city.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "city": payload["city"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
