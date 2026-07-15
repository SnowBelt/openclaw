#!/usr/bin/env python3
"""Pattern Lab thumbnail font-quality and shelf-readability gate."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import load_policy as load_media_qa_policy
from patternlab_thumbnail_pixel_quality import ocr_measurement
import patternlab_script_bootstrap  # noqa: F401

from patternlab.thumbnail import load_thumbnail_candidate_manifest


POLICY_PATH = BASE / "resources" / "thumbnail-typography-policy.json"
FONT_PACK_PATH = BASE / "resources" / "thumbnail-font-pack.json"
SHELF_SIZES = [(320, 180), (160, 90)]


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


def load_policy() -> dict[str, Any]:
    return read_json(POLICY_PATH)


def load_font_pack() -> dict[str, Any]:
    return read_json(FONT_PACK_PATH)



def iter_chrome_fontsource_entries(root: Path) -> list[dict[str, Any]]:
    # The Codex-primary package is rendered by the same local Chrome helper but
    # intentionally keeps a review-only source/rights status.  It still needs
    # the exact same font and 160x90 shelf checks as the legacy HTML package.
    codex_entries: list[dict[str, Any]] = []
    for candidate in load_thumbnail_candidate_manifest(root).candidates:
        file_path = str(candidate.get("path", ""))
        typography = candidate.get("typography", {})
        if not file_path or not isinstance(typography, dict):
            continue
        city_family = str(typography.get("city_font", "")).strip()
        main_family = str(typography.get("main_font", "")).strip()
        support_family = str(typography.get("support_font", main_family)).strip()
        codex_entries.append({
            "file": Path(file_path).name,
            "path": file_path,
            # Chrome thumbnail packages are city-agnostic.  Hard-coding
            # Detroit here turns every otherwise-valid future city package
            # into a false city-name failure.
            "city_name_present": str(candidate.get("city", "")).upper() in {
                str(value).upper() for value in candidate.get("public_text", [])
            },
            "thumbnail_text": " ".join(str(value) for value in candidate.get("public_text", [])),
            "ocr_regions": candidate.get("ocr_regions", []),
            "font": {
                "policy_file": "resources/thumbnail-typography-policy.json",
                "font_pack_file": "resources/thumbnail-font-pack.json",
                "impact_fallback_used": False,
                "document_prop_is_inside_document_visual": False,
                "city_anchor": {"role": "city_anchor", "family": city_family, "stroke_width": typography.get("city_stroke_width", 3), "tracking": -2, "max_size": 212, "min_size": 88},
                "main_hook": {"role": "main_hook", "family": main_family, "stroke_width": typography.get("main_stroke_width", 2), "tracking": -2, "max_size": 244, "min_size": 78},
                "supporting_line": {"role": "supporting_line", "family": support_family, "stroke_width": typography.get("support_stroke_width", 0), "tracking": 0, "max_size": 78, "min_size": 34},
            },
        })
    if codex_entries:
        return codex_entries
    report = read_json(root / "approval" / "html-thumbnail-renderer-report.json")
    entries: list[dict[str, Any]] = []
    if report.get("chrome_fontsource_renderer_status") != "pass":
        return entries
    for entry in report.get("entries", []):
        if not isinstance(entry, dict):
            continue
        file_path = str(entry.get("path", ""))
        if not file_path:
            continue
        city_family = str(entry.get("city_font", "")).strip()
        main_family = str(entry.get("main_font", "")).strip()
        support_family = str(entry.get("support_font", main_family)).strip()
        entries.append({
            "file": entry.get("file") or Path(file_path).name,
            "path": file_path,
            "city_name_present": True,
            "thumbnail_text": " ".join([str(entry.get("city", "")), str(entry.get("main_text", "")), str(entry.get("support_text", ""))]),
            "font": {
                "policy_file": "resources/thumbnail-typography-policy.json",
                "font_pack_file": "resources/thumbnail-font-pack.json",
                "impact_fallback_used": False,
                "document_prop_is_inside_document_visual": False,
                "city_anchor": {"role": "city_anchor", "family": city_family, "stroke_width": 4, "tracking": -2, "max_size": 132, "min_size": 88},
                "main_hook": {"role": "main_hook", "family": main_family, "stroke_width": 4, "tracking": -2, "max_size": 190, "min_size": 78},
                "supporting_line": {"role": "supporting_line", "family": support_family, "stroke_width": 0, "tracking": 0, "max_size": 58, "min_size": 34},
            },
        })
    return entries

def iter_photo_backed_entries(root: Path) -> list[dict[str, Any]]:
    report = read_json(root / "approval" / "miami-photo-backed-thumbnail-report.json")
    entries: list[dict[str, Any]] = []
    for topic in report.get("reports", []):
        for entry in topic.get("entries", []):
            if isinstance(entry, dict):
                entries.append(entry)
    return entries


def iter_factory_entries(root: Path) -> list[dict[str, Any]]:
    factory = read_json(root / "approval" / "thumbnail-factory-report.json")
    entries: list[dict[str, Any]] = []
    for concept in factory.get("review_concepts", []):
        filename = concept.get("concept_filename", "")
        if filename:
            entries.append(
                {
                    "file": filename,
                    "path": str(root / "review" / "thumbnail-concepts" / filename),
                    "city_name_present": bool(concept.get("city_text") or concept.get("headline")),
                    "font": concept.get("font", {}),
                    "thumbnail_text": concept.get("headline", ""),
                }
            )
    for candidate in factory.get("candidates", []):
        filename = candidate.get("filename", "")
        if filename:
            entries.append(
                {
                    "file": filename,
                    "path": str(root / "images" / filename),
                    "city_name_present": bool(candidate.get("headline")),
                    "font": candidate.get("font", {}),
                    "thumbnail_text": candidate.get("headline", ""),
                }
            )
    return entries


def collect_entries(root: Path) -> tuple[str, list[dict[str, Any]]]:
    chrome_entries = iter_chrome_fontsource_entries(root)
    if chrome_entries:
        return "chrome_fontsource_thumbnail_package", chrome_entries
    photo_backed = iter_photo_backed_entries(root)
    if photo_backed:
        return "photo_backed_thumbnail_package", photo_backed
    return "factory_thumbnail_package", iter_factory_entries(root)


def font_role(font: dict[str, Any], role: str) -> dict[str, Any]:
    value = font.get(role, {})
    return value if isinstance(value, dict) else {}


def unique_public_text_families(font: dict[str, Any]) -> set[str]:
    families = set()
    for role in ("city_anchor", "main_hook", "supporting_line"):
        family = str(font_role(font, role).get("family", "")).strip()
        if family:
            families.add(family)
    return families


def resize_preview(source: Path, output: Path, width: int, height: int) -> bool:
    if not source.exists():
        return False
    ensure_dir(output.parent)
    result = subprocess.run(
        ["sips", "-z", str(height), str(width), str(source), "--out", str(output)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and output.exists() and output.stat().st_size > 0


def validate_entry(
    entry: dict[str, Any],
    policy: dict[str, Any],
    preview_dir: Path,
) -> dict[str, Any]:
    blockers: list[str] = []
    warnings: list[str] = []
    font = entry.get("font", {}) if isinstance(entry.get("font"), dict) else {}
    source = Path(str(entry.get("path", "")))
    # Reports intentionally use repo-relative display paths.  Resolve them
    # against youtube-v1 rather than the caller's shell cwd so cron/LaunchAgent
    # execution cannot turn valid review PNGs into false missing-preview gates.
    if not source.is_absolute():
        source = BASE / source
    file_name = str(entry.get("file") or source.name)
    roles = policy.get("font_roles", {})
    font_pack = load_font_pack()
    preferred_stack = set(font_pack.get("approved_premium_title_fonts", [])) or set(policy.get("preferred_title_stack_available_on_current_mac", []))
    blocked_generic = set(font_pack.get("blocked_generic_title_fonts", [])) | set(
        policy.get("generic_font_blocker", {}).get("blocked_families_for_city_or_main_hook", [])
    )
    city = font_role(font, "city_anchor")
    main = font_role(font, "main_hook")
    support = font_role(font, "supporting_line")
    document = font_role(font, "document_prop")
    city_family = str(city.get("family", "")).strip()
    main_family = str(main.get("family", "")).strip()
    support_family = str(support.get("family", "")).strip()
    document_family = str(document.get("family", "")).strip()
    impact_fallback_used = bool(font.get("impact_fallback_used")) or main_family == "Impact" or city_family == "Impact"

    if not font:
        blockers.append("font_metadata_missing")
    if not city:
        blockers.append("missing_city_anchor_font_role")
    if not main:
        blockers.append("missing_main_hook_font_role")
    if city_family == "Impact":
        blockers.append("impact_used_for_city_anchor_while_better_fonts_available")
    if main_family == "Impact":
        blockers.append("impact_used_for_main_hook_while_better_fonts_available")
    if main_family and main_family not in preferred_stack:
        blockers.append(f"main_hook_font_not_in_preferred_stack:{main_family}")
    if city_family and city_family not in preferred_stack:
        blockers.append(f"city_anchor_font_not_in_preferred_stack:{city_family}")
    if main_family in blocked_generic:
        blockers.append(f"generic_main_hook_font_blocked:{main_family}")
    if city_family in blocked_generic:
        blockers.append(f"generic_city_anchor_font_blocked:{city_family}")
    if main_family and city_family and main_family == city_family and not bool(font.get("same_family_hierarchy_human_approved", False)):
        blockers.append("city_and_hook_use_same_font_without_exact_hierarchy_approval")

    main_max_stroke = int(roles.get("main_hook", {}).get("max_stroke_width", 4))
    city_max_stroke = int(roles.get("city_anchor", {}).get("max_stroke_width", 4))
    main_stroke = int(main.get("stroke_width", 999) if main else 999)
    city_stroke = int(city.get("stroke_width", 999) if city else 999)
    if main_stroke > main_max_stroke:
        blockers.append(f"main_hook_stroke_too_large:{main_stroke}>{main_max_stroke}")
    if city_stroke > city_max_stroke:
        blockers.append(f"city_anchor_stroke_too_large:{city_stroke}>{city_max_stroke}")
    if support and int(support.get("stroke_width", 0)) > int(roles.get("supporting_line", {}).get("max_stroke_width", 0)):
        blockers.append("supporting_line_should_not_use_outline_stroke")

    public_families = unique_public_text_families(font)
    if len(public_families) > 2:
        blockers.append(f"too_many_public_text_font_families:{len(public_families)}")
    if document_family and not bool(font.get("document_prop_is_inside_document_visual", False)):
        blockers.append("document_prop_font_used_outside_document_visual")
    if not bool(entry.get("city_name_present", False)):
        blockers.append("city_name_missing")

    previews = []
    media_thumbnail_policy = load_media_qa_policy().get("thumbnail", {})
    expected_text = str(entry.get("thumbnail_text") or "").strip()
    for width, height in SHELF_SIZES:
        preview = preview_dir / f"{Path(file_name).stem}-{width}x{height}{source.suffix or '.jpg'}"
        ok = resize_preview(source, preview, width, height)
        preview_row: dict[str, Any] = {"width": width, "height": height, "path": display_path(preview), "exists": ok}
        if ok:
            try:
                from PIL import Image

                with Image.open(preview) as image:
                    ocr = ocr_measurement(
                        image.convert("RGB"),
                        [expected_text],
                        media_thumbnail_policy,
                        entry.get("ocr_regions") if isinstance(entry.get("ocr_regions"), list) else None,
                    )
                preview_row["ocr"] = ocr
                if float(ocr.get("word_recall", 0)) < float(media_thumbnail_policy.get("minimum_ocr_word_recall", 1)):
                    blockers.append(f"shelf_ocr_text_recall_failure:{width}x{height}")
                if ocr.get("unsafe_large_text_boxes"):
                    blockers.append(f"shelf_text_safe_margin_failure:{width}x{height}")
                if ocr.get("unknown_large_tokens"):
                    blockers.append(f"shelf_unexpected_large_text_failure:{width}x{height}")
            except Exception as exc:
                preview_row["ocr"] = {"status": "blocked", "error": type(exc).__name__}
                blockers.append(f"shelf_ocr_unavailable_or_failed:{width}x{height}:{type(exc).__name__}")
        previews.append(preview_row)
        if not ok:
            blockers.append(f"shelf_preview_missing:{width}x{height}")

    if int(main.get("min_size", 0)) < 54:
        blockers.append("main_hook_min_size_below_readability_floor")
    if int(city.get("min_size", 0)) < 72:
        blockers.append("city_anchor_min_size_below_readability_floor")

    return {
        "file": file_name,
        "path": str(source),
        "status": "pass" if not blockers and not warnings else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "font": font,
        "city_font_family": city_family,
        "main_title_font_family": main_family,
        "supporting_line_font_family": support_family,
        "document_prop_font_family": document_family,
        "impact_fallback_used": impact_fallback_used,
        "public_text_font_family_count": len(public_families),
        "shelf_previews": previews,
    }


def build_font_quality_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    preview_dir = ensure_dir(approval / "thumbnail-font-shelf-previews")
    policy = load_policy()
    mode, entries = collect_entries(root)
    validations = [validate_entry(entry, policy, preview_dir) for entry in entries]
    blockers = [
        f"{item['file']}: {blocker}"
        for item in validations
        for blocker in item["blockers"]
    ]
    warnings = [
        f"{item['file']}: {warning}"
        for item in validations
        for warning in item["warnings"]
    ]
    main_families = sorted({item["main_title_font_family"] for item in validations if item["main_title_font_family"]})
    city_families = sorted({item["city_font_family"] for item in validations if item["city_font_family"]})
    impact_count = sum(1 for item in validations if item["impact_fallback_used"])
    preview_count = sum(1 for item in validations for preview in item["shelf_previews"] if preview["exists"])
    required_preview_count = len(validations) * len(SHELF_SIZES)
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if validations and not blockers and not warnings and preview_count == required_preview_count else "blocked",
        "mode": mode,
        "policy_file": display_path(POLICY_PATH),
        "font_pack_file": display_path(FONT_PACK_PATH),
        "thumbnail_count": len(validations),
        "font_role_count": sum(len(item.get("font", {})) for item in validations),
        "main_title_font_family": main_families[0] if len(main_families) == 1 else "mixed",
        "main_title_font_families": main_families,
        "city_font_families": city_families,
        "impact_fallback_used": impact_count > 0,
        "impact_fallback_count": impact_count,
        "oversized_stroke_count": sum(
            1
            for item in validations
            for blocker in item["blockers"]
            if "stroke_too_large" in blocker
        ),
        "shelf_readability_status": "pass" if preview_count == required_preview_count and validations and not blockers and not warnings else "blocked",
        "minimum_required_score": 93,
        "font_quality_score": 100 if validations and not blockers and not warnings else min(92, max(0, 100 - 8 * len(set(blockers)) - 2 * len(set(warnings)))),
        "shelf_preview_count": preview_count,
        "required_shelf_preview_count": required_preview_count,
        "font_reject_reasons": sorted(set(blockers)),
        "blockers": sorted(set(blockers)),
        "warnings": warnings,
        "entries": validations,
    }
    json_report = approval / "thumbnail-font-quality-report.json"
    md_report = approval / "thumbnail-font-quality-report.md"
    write_json(json_report, payload)
    lines = [
        f"# Pattern Lab Thumbnail Font Quality: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Mode: {payload['mode']}",
        f"Main title fonts: {', '.join(main_families) if main_families else 'missing'}",
        f"City fonts: {', '.join(city_families) if city_families else 'missing'}",
        f"Impact fallback used: {payload['impact_fallback_used']}",
        f"Shelf previews: {preview_count}/{required_preview_count}",
        "",
        "## Blockers",
        "",
    ]
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    lines.extend(["", "## Entries", ""])
    for item in validations:
        lines.append(f"- {item['file']}: {item['status']} — city `{item['city_font_family']}`, hook `{item['main_title_font_family']}`")
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def build_impact_block_self_test(video_id: str) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = load_policy()
    mode, entries = collect_entries(root)
    if not entries:
        raise SystemExit("Impact self-test requires at least one existing thumbnail entry.")
    source_entry = dict(entries[0])
    source_entry["file"] = f"impact-negative-fixture-{Path(str(source_entry.get('file', 'thumbnail.jpg'))).name}"
    source_entry["font"] = {
        "policy_file": "resources/thumbnail-typography-policy.json",
        "impact_fallback_used": True,
        "document_prop_is_inside_document_visual": False,
        "city_anchor": {
            "role": "city_anchor",
            "family": "Impact",
            "stroke_width": 7,
            "tracking": -2,
            "max_size": 154,
            "min_size": 94,
        },
        "main_hook": {
            "role": "main_hook",
            "family": "Impact",
            "stroke_width": 7,
            "tracking": -2,
            "max_size": 138,
            "min_size": 58,
        },
        "supporting_line": {
            "role": "supporting_line",
            "family": "Avenir Next Heavy",
            "stroke_width": 0,
            "tracking": 0,
            "max_size": 56,
            "min_size": 34,
        },
    }
    preview_dir = ensure_dir(approval / "thumbnail-font-negative-fixture-previews")
    validation = validate_entry(source_entry, policy, preview_dir)
    expected_blockers = {
        "impact_used_for_city_anchor_while_better_fonts_available",
        "impact_used_for_main_hook_while_better_fonts_available",
        "main_hook_stroke_too_large:7>4",
        "city_anchor_stroke_too_large:7>4",
    }
    actual_blockers = set(validation["blockers"])
    expected_failure_proven = validation["status"] == "blocked" and expected_blockers.issubset(actual_blockers)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "source_mode": mode,
        "status": "pass" if expected_failure_proven else "blocked",
        "purpose": "Negative regression fixture proving Impact default and oversized outlines fail when preferred local fonts exist.",
        "expected_blockers": sorted(expected_blockers),
        "actual_blockers": sorted(actual_blockers),
        "validation_status": validation["status"],
        "impact_default_blocked": "impact_used_for_main_hook_while_better_fonts_available" in actual_blockers,
        "oversized_outline_blocked": any("stroke_too_large" in blocker for blocker in actual_blockers),
        "entry": validation,
    }
    report = approval / "thumbnail-font-negative-fixture-report.json"
    write_json(report, payload)
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab thumbnail typography and shelf previews.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--self-test-impact-block", action="store_true")
    args = parser.parse_args()
    if args.self_test_impact_block:
        payload, report = build_impact_block_self_test(args.video_id)
        print(f"Status: {payload['status']}")
        print(f"Impact negative fixture report: {display_path(report)}")
        for blocker in payload["actual_blockers"]:
            print(f"- {blocker}")
        if payload["status"] != "pass":
            raise SystemExit(1)
        return
    payload, _json_report, md_report = build_font_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Font quality report: {display_path(md_report)}")
    for blocker in payload["font_reject_reasons"]:
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
