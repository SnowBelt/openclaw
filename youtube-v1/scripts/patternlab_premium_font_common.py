#!/usr/bin/env python3
"""Shared Pattern Lab premium Fontsource/Chrome rendering helpers."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

FONT_PACK_PATH = BASE / "resources" / "thumbnail-font-pack.json"
EFFECT_RECIPES_PATH = BASE / "resources" / "thumbnail-text-effect-recipes.json"
CHROME_HELPER = BASE / "scripts" / "patternlab_chrome_thumbnail_renderer_helper.mjs"
CHAT_DELIVERY_HELPER = BASE / "scripts" / "patternlab_chat_delivery_exporter.mjs"
SHELF_SIZES = [(320, 180), (160, 90)]
GENERIC_MAIN_FONTS = {
    "Impact",
    "Helvetica",
    "Arial",
    "System",
    "SF Pro",
    "Times New Roman",
    "Courier New",
    "Avenir Next Condensed Heavy",
    "Helvetica Neue Condensed Black",
    "DIN Condensed Bold",
    "Arial Black",
}
PREMIUM_V3_FONTS = {
    "Bangers",
    "Luckiest Guy",
    "Lilita One",
    "Passion One",
    "Changa One",
    "Rowdies",
    "Titan One",
    "Black Han Sans",
    "Fugaz One",
    "Kanit",
}
EXTERNAL_FOUNDRY_FONTS = {
    "League Gothic External",
    "Pilowlava",
    "Terminal Grotesque Open",
    "Reglo",
}
FILLER_PUBLIC_LABELS = ("SOURCE PHOTO", "RECEIPT", "SOURCE FILE")
BARE_REDACTION_TERMS = ("REDACTED", "████", "BLACK BAR")
MAX_NON_CITY_PUBLIC_WORDS = 5
MIN_TOURNAMENT_VARIANTS = 36
MIN_TOURNAMENT_WINNERS = 5
MIN_WINNER_SCORE = 8.5


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


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", text))


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", text)


def non_city_word_count(city: str, main: str, support: str) -> int:
    city_words = {word.upper() for word in words(city)}
    return sum(1 for word in words(f"{main} {support}") if word.upper() not in city_words)


def active_city(root: Path, fallback: str = "Miami") -> str:
    for path in (
        root / "approval" / "thumbnail-factory-report.json",
        root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json",
        root / "approval" / "thumbnail-canva-render-plan-report.json",
    ):
        report = read_json(path)
        for key in ("active_city", "city"):
            value = str(report.get(key, "")).strip()
            if value:
                return value.upper()
    return fallback.upper()


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _resolve_manifest_asset(root: Path, manifest_root: Path, local_path: str) -> Path | None:
    raw = Path(local_path)
    candidates = []
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.extend([
            manifest_root / raw,
            root / raw,
            BASE / raw,
            BASE.parent / raw,
        ])
        if local_path.startswith("source-packet/visual-rebuild/"):
            candidates.append(root / local_path)
            candidates.append(manifest_root / local_path.replace("source-packet/visual-rebuild/", "", 1))
    for candidate in candidates:
        if candidate.exists() and candidate.suffix.lower() in IMAGE_SUFFIXES:
            return candidate
    return None


def source_role(path: Path, root: Path) -> str:
    text = str(path)
    if "/approval/canva-source-bridge/" in text:
        return "canva_bridge_composite"
    if "/source-packet/" in text or "/local-output/" in text and "/images/" in text:
        return "source_packet_real_media"
    return "unknown"


def source_images(root: Path, allow_bridge_composites: bool = False) -> list[Path]:
    found: list[Path] = []
    # Final thumbnails must prefer true source-packet photos/maps. Canva bridge
    # composites are handoff artifacts and can include staging/cached preview regions,
    # so they are only available when explicitly requested by a caller.
    manual = root / "source-packet" / "manual-media"
    if manual.exists():
        found.extend(sorted(path for path in manual.glob("*") if path.suffix.lower() in IMAGE_SUFFIXES))
    manifest_root = root / "source-packet" / "visual-rebuild"
    manifest = read_json(manifest_root / "visual-rebuild-manifest.json")
    for key in ("historical_assets", "modern_context_assets"):
        assets = manifest.get(key, [])
        if not isinstance(assets, list):
            continue
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            local_path = str(asset.get("local_path", "")).strip()
            if not local_path:
                continue
            candidate = _resolve_manifest_asset(root, manifest_root, local_path)
            if candidate is not None:
                found.append(candidate)
    if allow_bridge_composites:
        bridge = root / "approval" / "canva-source-bridge"
        if bridge.exists():
            found.extend(sorted(path for path in bridge.glob("*.png")))
    unique: list[Path] = []
    seen = set()
    for item in found:
        key = str(item.resolve())
        if key not in seen:
            unique.append(item)
            seen.add(key)
    return unique


def select_sources(root: Path, count: int) -> list[Path]:
    images = source_images(root, allow_bridge_composites=False)
    if not images:
        images = source_images(root, allow_bridge_composites=True)
    if not images:
        return []
    return [images[index % len(images)] for index in range(count)]


def thumbnail_source_tags(path: Path) -> set[str]:
    text = str(path).lower().replace("_", "-")
    tags = set()
    for tag in ["map", "street", "skyline", "landmark", "transit", "underground", "water", "lake", "river", "historic", "neighborhood", "bridge", "route", "highway", "document", "blocks", "tower", "factory"]:
        if tag in text:
            tags.add(tag)
    if "city-source-map" in text or "source-map" in text:
        tags.update({"map", "street", "route", "blocks", "water"})
    if "archival-evidence" in text or "historic-street" in text:
        tags.update({"historic", "street", "neighborhood", "blocks"})
    if "then-now" in text:
        tags.update({"historic", "street", "skyline"})
    if "subscribe-city-file" in text or "landmark" in text:
        tags.update({"landmark", "skyline"})
    if not tags:
        tags.add("city-context")
    return tags


def rank_sources_for_topic(sources: list[Path], desired_tags: list[str]) -> list[tuple[float, Path, set[str]]]:
    desired = set(desired_tags)
    ranked = []
    for index, source in enumerate(sources):
        tags = thumbnail_source_tags(source)
        overlap = len(tags & desired)
        score = 5.0 + overlap * 1.4
        if "map" in tags and "map" in desired:
            score += 1.5
        if "street" in tags and {"street", "blocks"} & desired:
            score += 1.0
        if "skyline" in tags and {"water", "lake", "river", "skyline"} & desired:
            score += 0.8
        score -= index * 0.01
        ranked.append((round(min(10.0, score), 2), source, tags))
    return sorted(ranked, key=lambda item: (-item[0], str(item[1])))


def load_font_pack() -> dict[str, Any]:
    return read_json(FONT_PACK_PATH)


def node_modules_root() -> Path:
    configured = os.environ.get("PATTERNLAB_NODE_MODULES", "").strip()
    candidates = [
        Path(configured) if configured else None,
        BASE.parent / "node_modules",
        Path.cwd() / "node_modules",
        Path.home() / "PatternLabRuntime" / "node_modules",
        Path.home() / "OpenClaw" / "node_modules",
    ]
    return next(
        (
            candidate
            for candidate in candidates
            if candidate is not None
            and (candidate / "sharp").exists()
        ),
        BASE.parent / "node_modules",
    )


def font_entries() -> list[dict[str, Any]]:
    pack = load_font_pack()
    entries = []
    seen_families: set[str] = set()
    modules = node_modules_root()
    for item in pack.get("font_files", []):
        if not isinstance(item, dict):
            continue
        relative = str(item.get("path", ""))
        absolute = modules / relative.removeprefix("node_modules/") if relative.startswith("node_modules/") else BASE.parent / relative
        family = str(item.get("family", "")).strip()
        if family in seen_families:
            continue
        seen_families.add(family)
        entries.append({**item, "absolute_path": str(absolute)})
    return entries


def validate_font_ledger(required_families: set[str] | None = None) -> dict[str, Any]:
    pack = load_font_pack()
    allowed = set(pack.get("license_policy", {}).get("allowed_licenses", ["OFL-1.1", "Apache-2.0"]))
    entries = font_entries()
    required = required_families or {
        str(entry.get("family", ""))
        for entry in entries
        if str(entry.get("path", "")).startswith("youtube-v1/resources/fonts/external/")
    }
    active_entries = [entry for entry in entries if str(entry.get("family", "")) in required]
    missing = [entry for entry in active_entries if not Path(entry["absolute_path"]).exists()]
    bad_license = [entry for entry in active_entries if entry.get("license") not in allowed]
    checksum_mismatches = []
    for entry in active_entries:
        expected = str(entry.get("sha256", "")).strip().lower()
        path = Path(str(entry.get("absolute_path", "")))
        if expected and path.exists():
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != expected:
                checksum_mismatches.append({
                    "family": entry.get("family"),
                    "path": display_path(path),
                    "expected_sha256": expected,
                    "actual_sha256": actual,
                })
    package_versions = {}
    modules = node_modules_root()
    for entry in active_entries:
        package = str(entry.get("package", ""))
        pkg_path = modules / package / "package.json"
        pkg = read_json(pkg_path)
        package_versions[package] = {"version": pkg.get("version", "missing"), "license": pkg.get("license", "missing")}
    return {
        "status": "pass" if active_entries and not missing and not bad_license and not checksum_mismatches else "blocked",
        "font_pack_status": pack.get("status", "missing"),
        "font_count": len(active_entries),
        "font_families": [entry.get("family") for entry in active_entries],
        "missing_font_files": [display_path(Path(entry["absolute_path"])) for entry in missing],
        "disallowed_license_fonts": [entry.get("family") for entry in bad_license],
        "checksum_mismatches": checksum_mismatches,
        "package_versions": package_versions,
        "font_files": [{**entry, "absolute_path": display_path(Path(entry["absolute_path"]))} for entry in active_entries],
    }


def image_dimensions(path: Path) -> tuple[int | None, int | None]:
    if not path.is_file():
        return None, None
    try:
        out = subprocess.check_output(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return None, None
    width = height = None
    for raw in out.splitlines():
        line = raw.strip()
        if line.startswith("pixelWidth:"):
            width = int(line.split(":", 1)[1].strip())
        if line.startswith("pixelHeight:"):
            height = int(line.split(":", 1)[1].strip())
    return width, height


def run_chrome_renderer(spec_path: Path, report_path: Path) -> dict[str, Any]:
    env = dict(os.environ)
    if not env.get("PATTERNLAB_NODE_MODULES"):
        resolved = node_modules_root()
        resolved = resolved if (resolved / "sharp").exists() else None
        if resolved is not None:
            env["PATTERNLAB_NODE_MODULES"] = str(resolved)
    result = subprocess.run(
        ["node", str(CHROME_HELPER), str(spec_path), str(report_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=env,
    )
    report = read_json(report_path)
    if result.returncode != 0:
        blockers = report.get("blockers", []) if isinstance(report.get("blockers"), list) else []
        blockers.append(result.stderr.strip() or result.stdout.strip() or "chrome_renderer_failed")
        report = {**report, "status": "blocked", "blockers": blockers}
        write_json(report_path, report)
    return report


def ocr_text(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        result = subprocess.run(["tesseract", str(path), "stdout", "--psm", "6"], text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    except OSError:
        return ""
    return result.stdout.upper()


def text_integrity(entry: dict[str, Any], ocr: str) -> dict[str, Any]:
    city = str(entry.get("city", "")).upper()
    main = str(entry.get("main", "")).upper().replace("\\N", " ").replace("\n", " ")
    main_tokens = [token for token in words(main) if len(token) >= 3]
    city_ok = city in ocr or all(token in ocr for token in words(city))
    main_hits = sum(1 for token in main_tokens if token in ocr)
    main_ok = main_hits >= max(1, min(2, len(main_tokens)))
    return {
        "ocr_text_excerpt": ocr[:500],
        "city_ocr_pass": city_ok,
        "main_hook_ocr_pass": main_ok,
        "main_hook_ocr_hits": main_hits,
        "main_hook_ocr_required_hits": max(1, min(2, len(main_tokens))),
        "status": "pass" if city_ok and main_ok else "blocked",
    }


def final_thumbnail_specs(root: Path, city: str, count: int = 5) -> list[dict[str, Any]]:
    raw_sources = source_images(root, allow_bridge_composites=False)
    sources = select_sources(root, count)
    if not sources:
        return []
    # Intentional short text only; non-city public words stay <= 5.
    topics = [
        {"slug": "who_cut_it", "main": "WHO CUT\nIT?", "support": "ROUTE CUT", "font": "League Gothic External", "effect": "bold_white_black_stroke_yellow_shadow", "support_bg": "#ED0014", "support_color": "#FFFFFF", "source_tags": ["map", "route", "highway", "street", "bridge"]},
        {"slug": "water_won", "main": "THE WATER\nWON", "support": "LAKEFRONT", "font": "Pilowlava", "effect": "yellow_black_stroke_red_shadow", "support_bg": "#FFD600", "support_color": "#050505", "support_variant": "yellow", "source_tags": ["water", "lake", "river", "skyline", "map"]},
        {"slug": "almost_erased", "main": "ALMOST\nERASED", "support": "WHO DECIDED?", "font": "Terminal Grotesque Open", "effect": "sticker_outline_double_shadow", "support_bg": "#ED0014", "support_color": "#FFFFFF", "source_tags": ["historic", "landmark", "neighborhood", "street", "document"]},
        {"slug": "hidden_map", "main": "HIDDEN\nMAP", "support": "UNDER CITY", "font": "Reglo", "effect": "bold_white_black_stroke_yellow_shadow", "support_bg": "#050505", "support_color": "#FFD600", "source_tags": ["map", "transit", "underground", "tunnel", "document"]},
        {"slug": "lost_streets", "main": "LOST\nSTREETS", "support": "OLD BLOCKS", "font": "Bangers", "effect": "red_banner_white_condensed", "support_bg": "#FFD600", "support_color": "#050505", "support_variant": "yellow", "source_tags": ["street", "map", "blocks", "neighborhood", "historic"]},
    ]
    source_pool = raw_sources or sources
    inset_sources = list(reversed(source_pool))
    out_dir = ensure_dir(root / "review" / "chrome-fontsource-renderer")
    specs = []
    for index, topic in enumerate(topics[:count], 1):
        ranked_sources = rank_sources_for_topic(source_pool, topic["source_tags"])
        selected_source = ranked_sources[0][1] if ranked_sources else sources[index - 1]
        selected_tags = sorted(ranked_sources[0][2]) if ranked_sources else sorted(thumbnail_source_tags(selected_source))
        selected_rank = next((rank for rank, item in enumerate(ranked_sources, 1) if item[1] == selected_source), 1)
        inset_source = next((candidate for _score, candidate, _tags in ranked_sources[1:] if candidate != selected_source), inset_sources[(index - 1) % len(inset_sources)] if inset_sources else selected_source)
        specs.append({
            "variant_id": f"chrome_{index:02d}_{topic['slug']}",
            "out": str(out_dir / f"chrome_thumb_{index:02d}_{city.lower()}_{topic['slug']}.png"),
            "image": str(selected_source),
            "inset_image": str(inset_source) if inset_source != selected_source else "",
            "inset_label": "OLD MAP" if topic["slug"] in {"who_cut_it", "hidden_map"} else "",
            "city": city,
            "main": topic["main"],
            "support": topic["support"],
            "city_font_family": topic["font"],
            "main_font_family": topic["font"],
            "support_font_family": topic["font"],
            "effect_recipe_id": topic["effect"],
            "support_bg": topic["support_bg"],
            "support_color": topic["support_color"],
            "support_variant": topic.get("support_variant", ""),
            "background_position": "center",
            "main_size": 190 if topic["slug"] != "lost_streets" else 176,
            "proof_object": "real city source photo/map/document region",
            "visual_drama": "bright Canva-like typography over a source-backed city visual",
            "title_pair": f"{city.title()} {topic['main'].replace(chr(10), ' ').title()}",
            "topic_id": topic["slug"],
            "topic_hook": topic["main"].replace("\n", " "),
            "required_source_tags": topic["source_tags"],
            "selected_source_tags": selected_tags,
            "selected_source_rank": selected_rank,
            "source_tournament_candidate_count": len(ranked_sources),
            "source_tournament_top3": [
                {"rank": rank, "path": str(path), "score": score, "tags": sorted(tags)}
                for rank, (score, path, tags) in enumerate(ranked_sources[:3], 1)
            ],
        })
    return specs


def tournament_specs(root: Path, city: str) -> list[dict[str, Any]]:
    sources = select_sources(root, 3)
    if not sources:
        return []
    fonts = ["Bangers", "Luckiest Guy", "Lilita One", "Passion One", "Changa One", "Rowdies", "Titan One", "Black Han Sans", "Fugaz One", "Kanit", "Anton", "Bebas Neue", "League Gothic External", "Pilowlava", "Terminal Grotesque Open", "Reglo"]
    recipes = ["comic_pop_black_stroke_red_shadow", "sticker_cutout_yellow_slab", "deep_3d_urgent_white"]
    mains = ["WHO CUT\nIT?", "THE WATER\nWON", "ALMOST\nERASED"]
    supports = ["ROUTE CUT", "LAKEFRONT", "WHO DECIDED?"]
    out_dir = ensure_dir(root / "review" / "font-tournament-thumbnails")
    specs: list[dict[str, Any]] = []
    idx = 1
    for font in fonts:
        for recipe_index, recipe in enumerate(recipes):
            main = mains[recipe_index % len(mains)]
            support = supports[recipe_index % len(supports)]
            specs.append({
                "variant_id": f"v{idx:02d}_{font.lower().replace(' ', '_')}_{recipe}",
                "out": str(out_dir / f"font_tournament_{idx:02d}_{font.lower().replace(' ', '_')}_{recipe}.png"),
                "image": str(sources[recipe_index % len(sources)]),
                "city": city,
                "main": main,
                "support": support,
                "city_font_family": font,
                "main_font_family": font,
                "support_font_family": font,
                "effect_recipe_id": recipe,
                "support_bg": "#FFD600" if recipe == "yellow_black_stroke_red_shadow" else "#ED0014",
                "support_color": "#050505" if recipe == "yellow_black_stroke_red_shadow" else "#FFFFFF",
                "support_variant": "yellow" if recipe == "yellow_black_stroke_red_shadow" else "",
                "main_size": 190 if font not in {"Bowlby One SC", "Montserrat"} else 154,
                "proof_object": "real city source photo used in typography tournament",
                "visual_drama": "font/effect stress test for Canva-like local renderer",
                "title_pair": f"{city.title()} typography tournament",
            })
            idx += 1
    return specs


def score_entry(entry: dict[str, Any]) -> dict[str, Any]:
    font = entry.get("main_font_family", "")
    recipe = entry.get("effect_recipe_id", "")
    support_words = word_count(str(entry.get("support", "")))
    generic = font in GENERIC_MAIN_FONTS or entry.get("city_font_family") in GENERIC_MAIN_FONTS
    premium_bonus = {
        "Anton": 9.2,
        "Bebas Neue": 9.0,
        "Archivo Black": 9.1,
        "League Spartan": 8.9,
        "Oswald": 8.7,
        "Teko": 8.8,
        "Bowlby One SC": 8.6,
        "Bungee": 8.8,
        "Barlow Condensed": 8.7,
        "Montserrat": 8.5,
        "Saira Condensed": 8.6,
        "Roboto Condensed": 8.5,
        "Bangers": 9.45,
        "Luckiest Guy": 9.35,
        "Lilita One": 9.25,
        "Passion One": 9.2,
        "Changa One": 9.15,
        "Rowdies": 9.1,
        "Titan One": 9.2,
        "Black Han Sans": 9.05,
        "Fugaz One": 9.0,
        "Kanit": 8.95,
        "League Gothic External": 9.35,
        "Pilowlava": 9.25,
        "Terminal Grotesque Open": 9.2,
        "Reglo": 9.15,
    }.get(font, 0)
    recipe_bonus = 9.35 if recipe in {"comic_pop_black_stroke_red_shadow", "sticker_cutout_yellow_slab", "deep_3d_urgent_white"} else (9.0 if recipe in {"bold_white_black_stroke_yellow_shadow", "yellow_black_stroke_red_shadow"} else 8.6)
    scores = {
        "boldness": premium_bonus,
        "contrast": recipe_bonus,
        "sexiness_premium_feel": premium_bonus,
        "phone_readability": 9.0 if support_words <= 3 else 8.0,
        "reference_match": min(9.3, (premium_bonus + recipe_bonus) / 2),
        "non_generic_feel": 0 if generic else premium_bonus,
        "text_fit": 9.0 if support_words <= 4 else 6.0,
    }
    overall = round(sum(scores.values()) / len(scores), 2)
    return {
        **scores,
        "overall_score": overall,
        "winner": overall >= MIN_WINNER_SCORE,
        "support_word_count": support_words,
        "support_over_word_limit": support_words > 4,
        "support_squeezed": support_words > 4,
        "generic_font_violation": generic,
    }


def rendered_entry_checks(entry: dict[str, Any], file_path: Path, include_ocr: bool = True, ocr_audit_path: Path | None = None) -> dict[str, Any]:
    width, height = image_dimensions(file_path)
    text_blob = " ".join([str(entry.get("city", "")), str(entry.get("main", "")), str(entry.get("support", ""))]).upper()
    filler_hits = [label for label in FILLER_PUBLIC_LABELS if label in text_blob]
    bare_redaction_hits = [label for label in BARE_REDACTION_TERMS if label in text_blob]
    non_city_words = non_city_word_count(str(entry.get("city", "")), str(entry.get("main", "")), str(entry.get("support", "")))
    if include_ocr:
        final_ocr = text_integrity(entry, ocr_text(file_path))
        audit_ocr = text_integrity(entry, ocr_text(ocr_audit_path)) if ocr_audit_path and ocr_audit_path.exists() else {"status": "missing"}
        ocr = {**final_ocr, "final_ocr_status": final_ocr.get("status"), "audit_ocr_status": audit_ocr.get("status"), "audit_ocr_text_excerpt": audit_ocr.get("ocr_text_excerpt", ""), "status": "pass" if final_ocr.get("status") == "pass" or audit_ocr.get("status") == "pass" else "blocked"}
    else:
        ocr = {"status": "skipped"}
    return {
        "width": width,
        "height": height,
        "dimension_status": "pass" if width == 1920 and height == 1080 else "blocked",
        "filler_public_label_hits": filler_hits,
        "bare_redaction_hits": bare_redaction_hits,
        "non_city_public_word_count": non_city_words,
        "public_text_budget_status": "pass" if non_city_words <= MAX_NON_CITY_PUBLIC_WORDS else "blocked",
        "ocr": ocr,
        "mobile_typography_ocr_readability_status": ocr.get("status", "skipped"),
    }


def sha12(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def export_chat_delivery(root: Path, entries: list[dict[str, Any]], contact_sheet: Path | None = None) -> dict[str, Any]:
    run_id = utc_now().replace(":", "").replace("-", "").replace(".", "")
    out_dir = ensure_dir(root / "approval" / "chat-delivery" / run_id)
    report_path = out_dir / "chat-delivery-report.json"
    spec_path = out_dir / "chat-delivery-spec.json"
    spec = {
        "output_dir": str(out_dir),
        "contact_sheet": str(contact_sheet) if contact_sheet and contact_sheet.exists() else "",
        "entries": [
            {
                "variant_id": entry.get("variant_id", ""),
                # Reports use repo-relative display paths, but the Node helper
                # runs from an arbitrary LaunchAgent/worktree cwd.  Give it a
                # real absolute file path so valid artifacts are never marked
                # missing solely because of the caller's working directory.
                "path": str(
                    Path(str(entry.get("path", "")))
                    if Path(str(entry.get("path", ""))).is_absolute()
                    else BASE / str(entry.get("path", ""))
                ),
            }
            for entry in entries
        ],
    }
    write_json(spec_path, spec)
    env = dict(os.environ)
    if not env.get("PATTERNLAB_NODE_MODULES"):
        resolved = node_modules_root()
        if (resolved / "sharp").exists():
            env["PATTERNLAB_NODE_MODULES"] = str(resolved)
    result = subprocess.run(
        ["node", str(CHAT_DELIVERY_HELPER), str(spec_path), str(report_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=env,
    )
    report = read_json(report_path)
    blockers = report.get("blockers", []) if isinstance(report.get("blockers"), list) else []
    if result.returncode != 0:
        blockers.append(result.stderr.strip() or result.stdout.strip() or "chat_delivery_exporter_failed")
        report = {**report, "status": "blocked", "blockers": blockers}
        write_json(report_path, report)
    artifacts = report.get("artifacts", []) if isinstance(report.get("artifacts"), list) else []
    return {
        **report,
        "run_id": run_id,
        "directory": str(out_dir),
        "report_path": str(report_path),
        "spec_path": str(spec_path),
        "surface_status": report.get("status", "missing"),
        "artifact_count": report.get("artifact_count", len(artifacts)),
        "required_artifact_count": report.get("required_artifact_count", len(entries)),
        "artifacts": artifacts,
        "contact_sheet": report.get("contact_sheet", ""),
        "immutable_paths": all("_" in Path(str(a.get("delivery_path", ""))).stem and str(a.get("sha12", "")) in Path(str(a.get("delivery_path", ""))).stem for a in artifacts),
        "blockers": blockers,
    }


def chrome_render(specs: list[dict[str, Any]], root: Path, report_name: str, contact_name: str, preview_dir_name: str) -> dict[str, Any]:
    approval = ensure_dir(root / "approval")
    used_families = {
        str(spec.get(key, ""))
        for spec in specs
        for key in ("city_font_family", "main_font_family", "support_font_family")
        if str(spec.get(key, "")).strip()
    }
    ledger = validate_font_ledger(used_families)
    report_path = approval / report_name
    spec_path = approval / report_name.replace(".json", "-spec.json")
    helper_report = approval / report_name.replace(".json", "-helper-report.json")
    spec = {
        "fonts": font_entries(),
        "entries": specs,
        "preview_dir": str(ensure_dir(approval / preview_dir_name)),
        "contact_sheet": str(approval / contact_name),
        "work_dir": str(ensure_dir(approval / "chrome-render-work")),
    }
    write_json(spec_path, spec)
    helper = run_chrome_renderer(spec_path, helper_report)
    return {"ledger": ledger, "helper": helper, "spec_path": spec_path, "report_path": report_path}
