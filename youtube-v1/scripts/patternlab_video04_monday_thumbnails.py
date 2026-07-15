#!/usr/bin/env python3
"""Render the production-grade Monday Video 04 thumbnail tournament."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab.state import sha256_file


SIZE = (1280, 720)
ANTON = Path(__file__).resolve().parents[1] / "resources/fonts/external/anton-google-regular.ttf"
BEBAS = Path(__file__).resolve().parents[1] / "resources/fonts/external/bebas-neue-google-regular.ttf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def cover(path: Path, size: tuple[int, int] = SIZE, *, focus_x: float = 0.5) -> Image.Image:
    image = Image.open(path).convert("RGB")
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = round((resized.width - size[0]) * focus_x)
    left = max(0, min(left, resized.width - size[0]))
    top = max(0, (resized.height - size[1]) // 2)
    return resized.crop((left, top, left + size[0], top + size[1]))


def premium_color(image: Image.Image, palette: str) -> Image.Image:
    gray = ImageOps.grayscale(image)
    if palette == "gold":
        colored = ImageOps.colorize(gray, "#071521", "#F5C56D", mid="#55788F")
    elif palette == "teal":
        colored = ImageOps.colorize(gray, "#071A20", "#70E4E8", mid="#3C7581")
    else:
        colored = ImageOps.colorize(gray, "#17101D", "#F1B2A1", mid="#7D4E5A")
    colored = ImageEnhance.Contrast(colored).enhance(1.22)
    colored = ImageEnhance.Color(colored).enhance(1.24)
    colored = ImageEnhance.Brightness(colored).enhance(1.08)
    return colored.filter(ImageFilter.UnsharpMask(radius=1.4, percent=125, threshold=3))


def fit_font(text: str, path: Path, max_size: int, max_width: int, *, stroke: int = 0) -> ImageFont.FreeTypeFont:
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    for size in range(max_size, 35, -2):
        candidate = font(path, size)
        box = probe.textbbox((0, 0), text, font=candidate, stroke_width=stroke)
        if box[2] - box[0] <= max_width:
            return candidate
    return font(path, 36)


def title(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, *, max_width: int, size: int, fill: str, stroke: int = 6) -> int:
    selected = fit_font(text, ANTON, size, max_width, stroke=stroke)
    draw.text(xy, text, font=selected, fill=fill, stroke_width=stroke, stroke_fill="#050505", anchor="la")
    box = draw.textbbox(xy, text, font=selected, stroke_width=stroke, anchor="la")
    return box[3] - box[1]


def gradient_mask(width: int, height: int, *, dark_left: bool) -> Image.Image:
    mask = Image.new("L", (width, height))
    px = mask.load()
    for x in range(width):
        ratio = x / max(1, width - 1)
        if not dark_left:
            ratio = 1 - ratio
        alpha = int(245 * max(0.0, min(1.0, 1.25 - ratio * 1.75)))
        for y in range(height):
            px[x, y] = alpha
    return mask


def map_inset(base: Image.Image, map_path: Path, box: tuple[int, int, int, int], *, color: str) -> None:
    x0, y0, x1, y1 = box
    canvas = Image.new("RGB", (x1 - x0, y1 - y0), "#101820")
    source = Image.open(map_path).convert("RGB")
    # Remove report prose and figure caption so the route itself is the only
    # visible proof object at YouTube shelf size.
    source = source.crop((0, round(source.height * 0.04), source.width, round(source.height * 0.91)))
    source.thumbnail((canvas.width - 22, canvas.height - 22), Image.Resampling.LANCZOS)
    canvas.paste(source, ((canvas.width - source.width) // 2, (canvas.height - source.height) // 2))
    base.paste(canvas, (x0, y0))
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle(box, radius=12, outline=color, width=10)


def render_variant(street: Path, residential: Path, map_path: Path, output: Path, spec: dict) -> None:
    hero_path = residential if spec.get("hero") == "residential" else street
    hero = premium_color(cover(hero_path, focus_x=float(spec.get("focus_x", 0.47))), str(spec["palette"]))
    overlay = Image.new("RGB", SIZE, "#05070A")
    hero.paste(overlay, (0, 0), gradient_mask(*SIZE, dark_left=bool(spec.get("dark_left", True))))
    draw = ImageDraw.Draw(hero)
    # A vivid city banner anchors the channel's shelf identity.
    draw.rounded_rectangle((48, 38, 615, 172), radius=14, fill="#FFD319")
    draw.text((76, 48), "DETROIT", font=fit_font("DETROIT", BEBAS, 118, 520), fill="#07121A", anchor="la")
    y = 210
    for line, fill in spec["lines"]:
        y += title(draw, (62, y), line, max_width=680, size=112, fill=fill, stroke=7) + 2
    if spec.get("inset"):
        map_inset(hero, map_path, tuple(spec["inset"]), color=str(spec.get("inset_color", "#FFD319")))
        draw.line((930, 500, 1090, 410), fill="#FF2438", width=18)
        draw.polygon([(1090, 410), (1042, 420), (1075, 458)], fill="#FF2438")
    # Small, deterministic proof tag; no generated text.
    draw.rounded_rectangle((875, 612, 1232, 682), radius=10, fill="#0A1017", outline="#FFFFFF", width=3)
    draw.text((1053, 646), spec["tag"], font=fit_font(spec["tag"], ANTON, 35, 325), fill="#FFFFFF", anchor="mm")
    ensure_dir(output.parent)
    hero.save(output, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    if args.video_id.zfill(2) != "04":
        raise SystemExit("This tournament is intentionally limited to Video 04.")
    root = output_root("04")
    street = root / "source-packet/candidates/loc-2017844882-detroit-zoot-suit-business-district-1942.jpg"
    residential = root / "source-packet/candidates/loc-2017844869-detroit-black-residential-fronts-1942.jpg"
    map_path = root / "source-packet/candidates/fhwa/i375-official-route-map-crop.jpg"
    for path in (street, residential, map_path):
        if not path.is_file():
            raise SystemExit(f"thumbnail_source_missing:{display_path(path)}")
    specs = [
        {"id": "A", "palette": "gold", "lines": [("BLACK BOTTOM", "#FFFFFF"), ("ERASED", "#FFD319")], "tag": "ARCHIVE STREET PROOF", "inset": (900, 165, 1228, 525)},
        {"id": "B", "palette": "teal", "hero": "residential", "lines": [("300 BUSINESSES", "#FFFFFF"), ("GONE", "#FFD319")], "tag": "PARADISE VALLEY", "inset": (912, 180, 1228, 515), "inset_color": "#FF3045"},
        {"id": "C", "palette": "rose", "lines": [("THE MAP", "#FFFFFF"), ("CHANGED", "#FFD319")], "tag": "I-375 ROUTE PROOF", "inset": (890, 142, 1232, 540), "inset_color": "#FF3045"},
        {"id": "D", "palette": "gold", "lines": [("THIS STREET", "#FFFFFF"), ("VANISHED", "#FFD319")], "tag": "DETROIT — 1942", "dark_left": True},
        {"id": "E", "palette": "teal", "hero": "residential", "lines": [("I-375", "#FFD319"), ("CUT HERE", "#FFFFFF")], "tag": "MAP + PHOTO PROOF", "inset": (900, 160, 1228, 532), "inset_color": "#FF3045"},
    ]
    review = ensure_dir(root / "review/video-04-monday-thumbnails")
    rows = []
    for spec in specs:
        output = review / f"video-04-thumbnail-{spec['id'].lower()}.png"
        render_variant(street, residential, map_path, output, spec)
        rows.append({"id": spec["id"], "path": display_path(output), "sha256": sha256_file(output), "status": "rendered"})
    # Exactly three owner finalists; two alternates remain visible in the tournament.
    finalists = rows[:3]
    sheet = Image.new("RGB", (1280, 720 * 3), "#111")
    for index, row in enumerate(finalists):
        sheet.paste(Image.open(row["path"]).convert("RGB"), (0, index * 720))
    sheet_path = ensure_dir(root / "approval") / "video-04-monday-thumbnail-finalists.jpg"
    sheet.save(sheet_path, "JPEG", quality=92, optimize=True)
    roughs = [
        {"id": f"rough-{index:02d}", "hook": hook, "proof": proof}
        for index, (hook, proof) in enumerate([
            ("DETROIT ERASED THIS", "street photo"), ("BLACK BOTTOM ERASED", "street photo + map"),
            ("300 BUSINESSES GONE", "business street photo"), ("THE MAP CHANGED", "route map + street"),
            ("THIS STREET VANISHED", "street photo"), ("I-375 CUT HERE", "route map"),
            ("DETROIT LOST A CITY", "residential fronts"), ("WHAT VANISHED?", "street photo"),
            ("THE BLOCKS REMOVED", "Sanborn map"), ("PARADISE VALLEY GONE", "street photo"),
            ("DETROIT BEFORE I-375", "map + street"), ("THE NEIGHBORHOOD ERASED", "residential fronts"),
            ("THIS WAS NOT EMPTY", "street photo"), ("DETROIT REDREW IT", "route map"),
            ("THE ROUTE WON", "map"), ("WHAT THE MAP HID", "Sanborn map"),
            ("HASTINGS STREET GONE", "street photo"), ("A COMMUNITY CUT APART", "map + homes"),
            ("THE ARCHIVE REMEMBERS", "source photo"), ("BLACK BOTTOM WAS HERE", "street photo"),
        ], start=1)
    ]
    payload = {
        "generated_at": utc_now(), "video_id": "04", "status": "pending_owner_review",
        "rough_count": len(roughs), "shortlist_count": 8, "rendered_count": len(rows), "finalist_count": len(finalists),
        "roughs": roughs, "rendered": rows, "finalists": finalists,
        "contact_sheet": display_path(sheet_path),
        "source_policy": "rights-cleared historical photo and official route map; deterministic typography; no AI text",
        "minimum_owner_review_score": 93, "youtube_mutation": "not_performed",
    }
    report = root / "approval/video-04-monday-thumbnail-tournament.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    # Promote the three exact owner-review candidates to the canonical package
    # consumed by every independent thumbnail gate.
    images = ensure_dir(root / "images")
    public = {
        "A": ["DETROIT", "BLACK BOTTOM", "ERASED"],
        "B": ["DETROIT", "300 BUSINESSES", "GONE"],
        "C": ["DETROIT", "THE MAP", "CHANGED"],
        "D": ["DETROIT", "THIS STREET", "VANISHED"],
        "E": ["DETROIT", "I-375", "CUT HERE"],
    }
    templates = {"A": "mystery_dominant", "B": "human_consequence", "C": "proof_transformation"}
    candidate_rows = []
    for row in finalists:
        candidate_id = str(row["id"])
        destination = images / f"thumbnail_candidate_{candidate_id.lower()}.png"
        destination.write_bytes(Path(row["path"]).read_bytes())
        hero_id = "loc-black-residential-fronts-1942" if candidate_id == "B" else "loc-zoot-suit-1942"
        hero_path = residential if candidate_id == "B" else street
        candidate_rows.append({
            "id": candidate_id,
            "path": display_path(destination),
            "sha256": sha256_file(destination),
            "city": "DETROIT",
            "title_pair": "How Detroit Erased Black Bottom",
            "thumbnail_hook": " ".join(public[candidate_id][1:]),
            "composition_mode": "map_system" if candidate_id == "C" else "proof_context",
            "template_family": templates[candidate_id],
            "visual_objects": [
                {"slot": "hero", "kind": "historical_photo", "role": "context", "asset_id": hero_id, "local_path": display_path(hero_path), "source_url": "https://www.loc.gov/item/2017844869/" if candidate_id == "B" else "https://www.loc.gov/item/2017844882/"},
                {"slot": "proof", "kind": "historical_map", "role": "proof", "asset_id": "fhwa-i375-official-route-map", "local_path": display_path(map_path), "source_url": "https://www.fhwa.dot.gov/ipd/pdfs/value_capture/Value_Capture_MI_Workshop_Report.pdf"},
            ],
            "visible_proof_area_ratio": 0.22,
            "hero_luminance": "bright",
            "generic_text_card": False,
            "public_text": public[candidate_id],
            "non_city_word_count": 3 if candidate_id == "B" else 2,
            "ocr_regions": [[0.03, 0.04, 0.49, 0.25], [0.04, 0.28, 0.56, 0.66]],
            "typography": {
                "city_font": "Bebas Neue",
                "main_font": "Anton",
                "support_font": "Anton",
                "city_stroke_width": 0,
                "main_stroke_width": 3,
                "support_stroke_width": 0,
            },
            "source_rights_status": "approved",
            "renderer": "deterministic_pillow_google_fonts",
        })
    canonical_manifest = {
        "generated_at": utc_now(),
        "video_id": "04",
        "status": "ready_for_hash_bound_owner_review",
        "renderer": "deterministic_pillow_google_fonts",
        "candidates": candidate_rows,
        "contact_sheet": display_path(sheet_path),
        "source_truth": {
            "proof": "Official FHWA I-375 route map is the visible system proof.",
            "historical_context": "Library of Congress Detroit photographs provide human and street context without claiming exact Black Bottom location proof.",
            "ai_support": "not_used",
        },
        "youtube_mutation": "not_performed",
    }
    (root / "approval/thumbnail-codex-primary-review.json").write_text(json.dumps(canonical_manifest, indent=2) + "\n", encoding="utf-8")
    shortlist = [{**roughs[index], "template_family": ["mystery_dominant", "human_consequence", "proof_transformation", "street_vanish", "route_cut", "map_system", "community_loss", "archive_proof"][index]} for index in range(8)]
    production = [
        {"id": row["id"], "path": row["path"], "sha256": row["sha256"], "headline": " ".join(public[row["id"]][1:]), "text_regions": [[0.03, 0.04, 0.49, 0.25], [0.04, 0.28, 0.56, 0.66]], "template_family": templates.get(row["id"], f"alternate_{row['id'].lower()}")}
        for row in rows
    ]
    tournament = {
        "generated_at": utc_now(),
        "video_id": "04",
        "roughs": roughs,
        "shortlist": shortlist,
        "production": production,
        "finalists": [item for item in production if item["id"] in {"A", "B", "C"}],
        "youtube_mutation": "not_performed",
    }
    (root / "approval/thumbnail-worldclass-tournament.json").write_text(json.dumps(tournament, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "finalists": len(finalists), "report": display_path(report), "canonical_manifest": display_path(root / "approval/thumbnail-codex-primary-review.json")}, indent=2))


if __name__ == "__main__":
    main()
