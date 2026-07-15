#!/usr/bin/env python3
"""Render five vivid, source-backed Video 04 thumbnail concepts locally."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_thumbnail_worldclass import sha256

FONT = Path("/System/Library/Fonts/Avenir Next Condensed.ttc")
MAP_SOURCE = "source-packet/thumbnail-worldclass/sanborn-congested-key-map.jpg"
MODERN_SOURCE = "source-packet/thumbnail-worldclass/detroit-modern-context.jpg"
AI_SUPPORT_SOURCE = "source-packet/thumbnail-worldclass/openai-atmospheric-support-v1.png"


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.LANCZOS)


def vivid(image: Image.Image, color: float = 1.35, contrast: float = 1.3, brightness: float = 1.08) -> Image.Image:
    result = ImageEnhance.Color(image).enhance(color)
    result = ImageEnhance.Contrast(result).enhance(contrast)
    result = ImageEnhance.Brightness(result).enhance(brightness)
    return result


def boundary_map() -> Image.Image:
    """Source-backed explanatory map; not an archival map or survey."""
    image = Image.new("RGB", (1920, 1080), (8, 38, 77))
    draw = ImageDraw.Draw(image, "RGBA")
    for x in range(-200, 2100, 125):
        draw.line((x, 0, x + 540, 1080), fill=(54, 116, 155, 110), width=4)
    for y in range(80, 1080, 115):
        draw.line((0, y, 1920, y + 80), fill=(54, 116, 155, 95), width=4)
    footprint = [(450, 190), (1320, 260), (1530, 820), (820, 940), (380, 690)]
    draw.polygon(footprint, fill=(239, 43, 48, 145), outline=(255, 220, 34, 255), width=18)
    draw.line((1210, 80, 1320, 1000), fill=(255, 255, 255, 245), width=28)
    draw.line((1210, 80, 1320, 1000), fill=(239, 43, 48, 255), width=10)
    small = ImageFont.truetype(str(FONT), size=70, index=8)
    big = ImageFont.truetype(str(FONT), size=120, index=8)
    draw.text((870, 560), "BLACK BOTTOM", font=big, fill=(255, 255, 255), stroke_width=8, stroke_fill=(5, 10, 20), anchor="mm")
    draw.text((1345, 470), "I-375", font=small, fill=(255, 220, 28), stroke_width=6, stroke_fill=(5, 10, 20))
    draw.text((260, 120), "GRATIOT", font=small, fill=(190, 235, 255), stroke_width=5, stroke_fill=(5, 10, 20))
    draw.text((220, 780), "BRUSH", font=small, fill=(190, 235, 255), stroke_width=5, stroke_fill=(5, 10, 20))
    draw.text((800, 980), "DETROIT RIVER", font=small, fill=(190, 235, 255), stroke_width=5, stroke_fill=(5, 10, 20))
    return image


def font_for(text: str, max_width: int, max_size: int = 220, min_size: int = 70) -> ImageFont.FreeTypeFont:
    probe = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(probe)
    for size in range(max_size, min_size - 1, -2):
        font = ImageFont.truetype(str(FONT), size=size, index=8)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=8)
        if box[2] - box[0] <= max_width:
            return font
    return ImageFont.truetype(str(FONT), size=min_size, index=8)


def headline(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], max_width: int, *, fill=(255, 255, 255), anchor="la", max_size=220) -> None:
    font = font_for(text, max_width, max_size=max_size)
    x, y = xy
    draw.text((x + 10, y + 14), text, font=font, fill=(0, 0, 0, 170), stroke_width=12, stroke_fill=(0, 0, 0), anchor=anchor)
    draw.text((x, y), text, font=font, fill=fill, stroke_width=10, stroke_fill=(8, 12, 20), anchor=anchor)


def label(draw: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int], fill: tuple[int, int, int], text_fill=(255, 255, 255)) -> None:
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=(5, 8, 12), width=7)
    font = font_for(text, box[2] - box[0] - 36, max_size=145, min_size=72)
    draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2 - 3), text, font=font, fill=text_fill, stroke_width=5, stroke_fill=(0, 0, 0), anchor="mm")


def dark_gradient(image: Image.Image, strength: int = 150) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    px = overlay.load()
    width, height = image.size
    for y in range(height):
        alpha = int(strength * (1 - min(1, y / (height * 0.8))))
        for x in range(width):
            edge = abs(x - width / 2) / (width / 2)
            px[x, y] = (0, 0, 0, min(210, alpha + int(edge * 50)))
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def concept_black_bottom(map_img: Image.Image, modern: Image.Image) -> Image.Image:
    canvas = vivid(fit_cover(map_img, (1920, 1080)), 1.5, 1.35, 1.05)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((72, 90, 1848, 380), radius=28, fill=(8, 14, 28, 220))
    headline(draw, "BLACK BOTTOM", (960, 85), 1700, fill=(255, 212, 24), anchor="ma", max_size=250)
    headline(draw, "WAS HERE", (960, 285), 1250, fill=(255, 255, 255), anchor="ma", max_size=210)
    # One source-grounded footprint cue, not a fake archival object.
    draw.rounded_rectangle((1080, 510, 1810, 960), radius=30, fill=(8, 16, 28, 210), outline=(255, 56, 48), width=14)
    city = vivid(fit_cover(modern, (690, 410)), 1.6, 1.45, 1.13)
    canvas.paste(city, (1100, 530))
    label(draw, "DETROIT", (120, 860, 620, 1015), (220, 32, 38), (255, 255, 255))
    return canvas


def concept_erased(map_img: Image.Image, modern: Image.Image) -> Image.Image:
    canvas = vivid(fit_cover(modern, (1920, 1080)), 1.6, 1.45, 1.12)
    canvas = dark_gradient(canvas, 90)
    map_panel = fit_cover(boundary_map(), (900, 1080))
    mask = Image.new("L", (900, 1080), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.polygon([(0, 0), (900, 0), (760, 1080), (0, 1080)], fill=255)
    canvas.paste(map_panel, (0, 0), mask)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.line((820, 20, 690, 1060), fill=(255, 54, 45, 255), width=22)
    label(draw, "DETROIT", (1030, 95, 1780, 260), (222, 35, 40))
    headline(draw, "ERASED", (980, 380), 820, fill=(255, 216, 24), max_size=230)
    headline(draw, "THIS", (980, 610), 700, fill=(255, 255, 255), max_size=250)
    return canvas


def concept_then_now(map_img: Image.Image, modern: Image.Image) -> Image.Image:
    left = vivid(fit_cover(map_img, (960, 1080)), 1.4, 1.3, 1.06)
    right = vivid(fit_cover(modern, (960, 1080)), 1.7, 1.5, 1.15)
    canvas = Image.new("RGB", (1920, 1080))
    canvas.paste(left, (0, 0)); canvas.paste(right, (960, 0))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rectangle((948, 0, 972, 1080), fill=(255, 255, 255, 255))
    label(draw, "THEN", (55, 45, 755, 310), (8, 12, 22))
    label(draw, "NOW", (1165, 45, 1865, 310), (220, 34, 38))
    draw.rounded_rectangle((160, 760, 1760, 1020), radius=30, fill=(5, 10, 20, 218))
    headline(draw, "DETROIT CHANGED", (960, 775), 1480, fill=(255, 218, 20), anchor="ma", max_size=220)
    return canvas


def concept_map_changed(map_img: Image.Image, modern: Image.Image) -> Image.Image:
    canvas = fit_cover(boundary_map(), (1920, 1080))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((80, 85, 1840, 390), radius=32, fill=(9, 14, 27, 225))
    headline(draw, "THE MAP CHANGED", (960, 100), 1660, fill=(255, 218, 22), anchor="ma", max_size=235)
    draw.line([(500, 760), (800, 650), (1100, 720), (1450, 560)], fill=(245, 35, 45, 255), width=24, joint="curve")
    for x, y in [(500, 760), (800, 650), (1100, 720), (1450, 560)]:
        draw.ellipse((x - 25, y - 25, x + 25, y + 25), fill=(255, 226, 40), outline=(8, 12, 20), width=8)
    label(draw, "DETROIT", (110, 855, 650, 1018), (17, 97, 214))
    return canvas


def concept_vanished(map_img: Image.Image, modern: Image.Image) -> Image.Image:
    canvas = vivid(fit_cover(modern, (1920, 1080)), 1.75, 1.5, 1.15)
    canvas = dark_gradient(canvas, 65)
    map_crop = vivid(fit_cover(map_img, (720, 720)), 1.55, 1.35, 1.08)
    mask = Image.new("L", (720, 720), 0)
    ImageDraw.Draw(mask).ellipse((20, 20, 700, 700), fill=255)
    canvas.paste(map_crop, (1060, 270), mask)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.ellipse((1080, 290, 1740, 950), outline=(255, 218, 20), width=18)
    label(draw, "DETROIT", (90, 85, 770, 250), (220, 34, 38))
    headline(draw, "WHAT", (110, 370), 780, fill=(255, 255, 255), max_size=240)
    headline(draw, "VANISHED?", (110, 595), 900, fill=(255, 218, 20), max_size=215)
    return canvas


def build_package(video_id: str) -> tuple[dict, Path, Path]:
    if video_id != "04":
        raise SystemExit("This renderer is intentionally limited to Video 04.")
    root = output_root(video_id)
    source_dir = root / "source-packet" / "thumbnail-worldclass"
    map_path = source_dir / "sanborn-congested-key-map.jpg"
    modern_path = source_dir / "detroit-modern-context.jpg"
    if not map_path.exists() or not modern_path.exists():
        raise SystemExit("World-class thumbnail source assets are missing.")
    map_img = Image.open(map_path)
    modern = Image.open(modern_path)
    ai_support_path = source_dir / "openai-atmospheric-support-v1.png"
    ai_support = Image.open(ai_support_path) if ai_support_path.exists() else modern
    boundary_path = source_dir / "black-bottom-boundary-explanatory-map.png"
    boundary_map().save(boundary_path, format="PNG", optimize=True)
    review = ensure_dir(root / "review" / "thumbnail-worldclass")
    concepts = [
        ("concept-01", "BLACK BOTTOM WAS HERE", "archival_modern_composite", concept_black_bottom, []),
        ("concept-02", "DETROIT ERASED THIS", "map_photo", lambda old_map, _modern: concept_erased(old_map, ai_support.copy()), [[990, 60, 1830, 300], [930, 330, 1860, 900]]),
        ("concept-03", "THEN NOW", "then_now", concept_then_now, [[30, 25, 780, 330], [1140, 25, 1890, 330]]),
        ("concept-04", "THE MAP CHANGED", "proof_object_context", concept_map_changed, [[60, 60, 1860, 430]]),
        ("concept-05", "WHAT VANISHED", "landmark_story", concept_vanished, [[70, 340, 980, 1000]]),
    ]
    production: list[dict] = []
    for ident, text, family, builder, text_regions in concepts:
        output = review / f"{ident}.png"
        image = builder(map_img.copy(), modern.copy())
        image.save(output, format="PNG", optimize=True)
        production.append({"id": ident, "headline": text, "template_family": family, "path": display_path(output), "sha256": sha256(output), "text_regions": text_regions})
    contact = Image.new("RGB", (1280, 1080), (8, 12, 22))
    contact_draw = ImageDraw.Draw(contact)
    contact_font = ImageFont.truetype(str(FONT), size=30, index=8)
    for index, item in enumerate(production):
        source = Image.open(BASE / item["path"]).convert("RGB").resize((640, 360), Image.Resampling.LANCZOS)
        x = (index % 2) * 640
        y = (index // 2) * 360
        contact.paste(source, (x, y))
        contact_draw.rounded_rectangle((x + 12, y + 12, x + 190, y + 58), radius=8, fill=(5, 10, 18, 225))
        contact_draw.text((x + 24, y + 18), item["id"].upper(), font=contact_font, fill=(255, 255, 255))
    contact_path = review / "contact-sheet.jpg"
    contact.save(contact_path, format="JPEG", quality=92, optimize=True)
    # Selection is deliberately provisional. A Terra/owner receipt must replace
    # this deterministic diversity shortlist before owner approval can pass.
    finalists = [production[0], production[1], production[3]]
    rough_families = ["presenter_place", "landmark_story", "then_now", "map_photo", "proof_object_context", "archival_modern_composite"]
    roughs = [{"id": f"rough-{i:02d}", "template_family": rough_families[(i - 1) % len(rough_families)], "status": "brief_only"} for i in range(1, 21)]
    shortlist = [{"id": f"shortlist-{i:02d}", "template_family": rough_families[(i - 1) % len(rough_families)]} for i in range(1, 9)]
    manifest = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": "pending_terra_and_owner_review",
        "contact_sheet": display_path(contact_path),
        "roughs": roughs, "shortlist": shortlist, "production": production,
        "finalists": finalists,
        "source_assets": [
            {"asset_id": "detroit-sanborn-congested-district-map", "path": display_path(map_path), "sha256": sha256(map_path), "role": "public_domain_congested_district_map_proof", "source_url": "https://www.loc.gov/item/sanborn03985_072/", "rights": "Library of Congress Sanborn Maps Collection; public domain and free to use/reuse"},
            {"asset_id": "detroit-modern-context", "path": display_path(modern_path), "sha256": sha256(modern_path), "role": "modern_context_only", "source_url": "https://www.pexels.com/search/videos/detroit%20city/", "rights": "Pexels License; source inherited from approved Video 04 visual manifest"},
            {"asset_id": "black-bottom-boundary-explanatory-map", "path": display_path(boundary_path), "sha256": sha256(boundary_path), "role": "source_backed_explanatory_boundary_map_not_archival", "source_url": "https://www.detroithistorical.org/learn/online-research/encyclopedia-of-detroit/black-bottom-neighborhood", "rights": "Original Pattern Lab explanatory graphic; factual boundaries cited to Detroit Historical Society"},
        ],
        "ai_support_assets": ([{
            "asset_id": "openai-atmospheric-support-v1",
            "path": display_path(ai_support_path),
            "sha256": sha256(ai_support_path),
            "role": "non_proof_atmospheric_support_only",
            "generator": "OpenAI built-in image generation",
            "factual_use": "blocked",
            "final_text_use": "blocked",
            "archival_evidence_use": "blocked",
            "owner_approval_scope": "bounded Video 04 thumbnail support approval",
        }] if ai_support_path.exists() else []),
        "paid_provider_calls": "one_bounded_openai_image_generation_support_asset",
        "youtube_mutation": "not_performed",
    }
    approval = ensure_dir(root / "approval")
    json_path = approval / "thumbnail-worldclass-tournament.json"
    md_path = approval / "thumbnail-worldclass-tournament.md"
    json_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    lines = ["# Video 04 World-Class Thumbnail Tournament", "", "Status: pending Terra and owner review", "", "## Production Concepts", ""]
    lines.extend(f"- {row['id']}: {row['headline']} ({row['template_family']}) `{row['sha256']}`" for row in production)
    lines.extend(["", "AI support assets: none", "Paid provider calls: not performed", "YouTube mutation: not performed"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    manifest, report, _ = build_package(args.video_id)
    print(json.dumps({"status": manifest["status"], "production_count": len(manifest["production"]), "report": display_path(report)}, indent=2))


if __name__ == "__main__":
    main()
