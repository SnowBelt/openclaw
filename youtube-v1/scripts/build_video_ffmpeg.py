#!/usr/bin/env python3
import argparse
import csv
import json
import math
import os
import re
import subprocess
from pathlib import Path

from patternlab_common import (
    BASE,
    append_ledger,
    display_path,
    ensure_dir,
    ffmpeg_cmd,
    load_dotenv,
    media_duration_seconds,
    output_root,
    read_text,
    strip_markdown_for_voiceover,
    utc_now,
)
from patternlab_visual_categories import classify_visual_category


IMAGE_ORDER = [
    "city_source_map.png",
    "archival_evidence_board.png",
    "then_now_structure.png",
    "subscribe_city_file_card.png",
    "thumbnail_candidate_a.png",
    "thumbnail_candidate_b.png",
    "thumbnail_candidate_c.png",
]

LEGACY_FULL_SCREEN_SUPPORT_NAMES = {
    "city_source_map.png",
    "archival_evidence_board.png",
    "then_now_structure.png",
    "subscribe_city_file_card.png",
}

PROOF_SECONDS = 18.0
MIN_VISUAL_BEAT_SECONDS = 5.0
MAX_VISUAL_BEAT_SECONDS = 12.0
FPS = 30
MIN_VISUAL_REBUILD_HISTORICAL = 20
MIN_VISUAL_REBUILD_MODERN = 10
SUPPORT_GRAPHIC_EVERY_N_PARAGRAPHS = 8
SOURCE_GROUNDED_OVERLAY_DIR = "source-grounded-overlays"
MAX_WEAK_MATCH_SHARE = 0.10
MAX_FALLBACK_SHARE = 0.10

VISUAL_RULES = [
    {
        "image": "city_source_map.png",
        "label": "city source map and system proof",
        "role": "map_system",
        "keywords": (
            "map",
            "route",
            "freeway",
            "street",
            "grid",
            "neighborhood",
            "place",
            "source",
            "system",
            "rewired",
            "industry",
            "policy",
            "changed",
            "detroit",
        ),
    },
    {
        "image": "archival_evidence_board.png",
        "label": "archival evidence board",
        "role": "archive_evidence",
        "keywords": (
            "archive",
            "archival",
            "photo",
            "photograph",
            "record",
            "document",
            "source",
            "evidence",
            "date",
            "visible clue",
            "old photos",
            "no source",
            "story",
        ),
    },
    {
        "image": "then_now_structure.png",
        "label": "then and now city structure",
        "role": "then_now",
        "keywords": (
            "then",
            "now",
            "before",
            "after",
            "vanished",
            "lost",
            "changed afterward",
            "building",
            "block",
            "neighborhood",
            "modern",
            "today",
        ),
    },
    {
        "image": "subscribe_city_file_card.png",
        "label": "city-file subscribe bridge",
        "role": "city_file_cta",
        "keywords": (
            "subscribe",
            "next city",
            "city file",
            "outro",
            "pattern",
            "city, source, system",
            "next",
            "ending",
        ),
    },
    {
        "image": "thumbnail_candidate_a.png",
        "label": "emotional mystery thumbnail promise",
        "role": "context_only",
        "keywords": (
            "thumbnail",
            "title",
            "vanished",
            "what vanished",
            "before",
            "changed",
            "mystery",
            "click",
            "promise",
        ),
    },
    {
        "image": "thumbnail_candidate_b.png",
        "label": "map/system thumbnail proof promise",
        "role": "map_system",
        "keywords": (
            "thumbnail",
            "title",
            "map",
            "route",
            "system",
            "proof",
            "the map changed",
            "promise",
        ),
    },
    {
        "image": "thumbnail_candidate_c.png",
        "label": "contrarian history thumbnail promise",
        "role": "context_only",
        "keywords": (
            "thumbnail",
            "title",
            "not the whole story",
            "myth",
            "familiar story",
            "source clue",
            "contrarian",
            "city file",
        ),
    },
]

def image_by_name(root):
    return {path.name: path for path in (root / "images").glob("*.png")}


def visual_rebuild_media(root):
    base = root / "source-packet" / "visual-rebuild"
    historical = sorted((base / "historical").glob("*.jpg")) + sorted((base / "historical").glob("*.jpeg")) + sorted((base / "historical").glob("*.png"))
    modern = sorted((base / "modern-context").glob("*.jpg")) + sorted((base / "modern-context").glob("*.jpeg")) + sorted((base / "modern-context").glob("*.png"))
    return historical, modern


PHOTO_COMPOSITE_SWIFT = r'''
import AppKit
import Foundation

struct CompositeSpec: Decodable {
    let mode: String
    let overlayType: String
    let left: String
    let right: String?
    let output: String
    let title: String
    let subtitle: String
    let tag: String
    let sourceLabel: String
}

let specURL = URL(fileURLWithPath: CommandLine.arguments[1])
let spec = try JSONDecoder().decode(CompositeSpec.self, from: Data(contentsOf: specURL))
let width = 1920
let height = 1080
let canvasSize = NSSize(width: width, height: height)

func fillImage(_ path: String, in rect: NSRect) throws {
    guard let image = NSImage(contentsOfFile: path) else {
        throw NSError(domain: "PatternLabComposite", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read image: \(path)"])
    }
    let imageSize = image.size
    let scale = max(rect.width / imageSize.width, rect.height / imageSize.height)
    let drawSize = NSSize(width: imageSize.width * scale, height: imageSize.height * scale)
    let drawRect = NSRect(
        x: rect.minX + (rect.width - drawSize.width) / 2,
        y: rect.minY + (rect.height - drawSize.height) / 2,
        width: drawSize.width,
        height: drawSize.height
    )
    image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0)
}

func color(_ hex: UInt32, alpha: CGFloat) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xff) / 255.0,
        green: CGFloat((hex >> 8) & 0xff) / 255.0,
        blue: CGFloat(hex & 0xff) / 255.0,
        alpha: alpha
    )
}

func fill(_ rect: NSRect, _ fillColor: NSColor) {
    fillColor.setFill()
    rect.fill()
}

func stroke(_ rect: NSRect, _ strokeColor: NSColor, width: CGFloat) {
    let path = NSBezierPath(rect: rect)
    path.lineWidth = width
    strokeColor.setStroke()
    path.stroke()
}

func drawText(_ text: String, x: CGFloat, yFromTop: CGFloat, size: CGFloat, weight: NSFont.Weight, color textColor: NSColor, maxWidth: CGFloat) {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph
    ]
    let rect = NSRect(x: x, y: CGFloat(height) - yFromTop - size * 1.35, width: maxWidth, height: size * 2.8)
    (text as NSString).draw(in: rect, withAttributes: attrs)
}

func drawLine(points: [NSPoint], _ strokeColor: NSColor, width: CGFloat) {
    guard let first = points.first else { return }
    let path = NSBezierPath()
    path.move(to: first)
    for point in points.dropFirst() {
        path.line(to: point)
    }
    path.lineWidth = width
    strokeColor.setStroke()
    path.stroke()
}

func drawLabel(_ text: String, x: CGFloat, y: CGFloat) {
    fill(NSRect(x: x - 14, y: y - 14, width: 280, height: 54), color(0x000000, alpha: 0.60))
    stroke(NSRect(x: x - 14, y: y - 14, width: 280, height: 54), color(0xF3D36B, alpha: 0.75), width: 2)
    drawText(text, x: x, yFromTop: CGFloat(height) - y - 18, size: 22, weight: .semibold, color: .white, maxWidth: 250)
}

func drawSourceCallout(_ text: String) {
    fill(NSRect(x: 72, y: 34, width: 1760, height: 70), color(0x000000, alpha: 0.58))
    stroke(NSRect(x: 72, y: 34, width: 1760, height: 70), color(0x5DA9E9, alpha: 0.75), width: 2)
    drawText(text, x: 106, yFromTop: 982, size: 26, weight: .medium, color: .white, maxWidth: 1680)
}

let image = NSImage(size: canvasSize)
image.lockFocus()
NSColor.black.setFill()
NSRect(origin: .zero, size: canvasSize).fill()

if spec.mode == "split", let right = spec.right {
    try fillImage(spec.left, in: NSRect(x: 0, y: 0, width: 960, height: height))
    try fillImage(right, in: NSRect(x: 960, y: 0, width: 960, height: height))
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0x000000, alpha: 0.12))
    fill(NSRect(x: 70, y: CGFloat(height - 288), width: 810, height: 218), color(0x000000, alpha: 0.62))
    stroke(NSRect(x: 70, y: CGFloat(height - 288), width: 810, height: 218), color(0xF3D36B, alpha: 0.85), width: 3)
    fill(NSRect(x: 0, y: 88, width: 960, height: 80), color(0x000000, alpha: 0.55))
    fill(NSRect(x: 960, y: 88, width: 960, height: 80), color(0x000000, alpha: 0.55))
    drawText("THEN / SOURCE", x: 90, yFromTop: 936, size: 32, weight: .semibold, color: .white, maxWidth: 760)
    drawText("NOW / CONTEXT", x: 1050, yFromTop: 936, size: 32, weight: .semibold, color: .white, maxWidth: 760)
    drawSourceCallout(spec.sourceLabel)
} else {
    try fillImage(spec.left, in: NSRect(x: 0, y: 0, width: width, height: height))
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0x000000, alpha: 0.16))
    fill(NSRect(x: 72, y: CGFloat(height - 320), width: 820, height: 250), color(0x000000, alpha: 0.62))
    stroke(NSRect(x: 72, y: CGFloat(height - 320), width: 820, height: 250), color(0xF3D36B, alpha: 0.85), width: 3)
    if spec.overlayType == "map" {
        drawLine(points: [
            NSPoint(x: 340, y: 760),
            NSPoint(x: 610, y: 610),
            NSPoint(x: 880, y: 690),
            NSPoint(x: 1230, y: 520),
            NSPoint(x: 1510, y: 610)
        ], color(0xF3D36B, alpha: 0.95), width: 8)
        drawLine(points: [
            NSPoint(x: 340, y: 760),
            NSPoint(x: 610, y: 610),
            NSPoint(x: 880, y: 690),
            NSPoint(x: 1230, y: 520),
            NSPoint(x: 1510, y: 610)
        ], color(0x000000, alpha: 0.50), width: 2)
        drawLabel("river route", x: 420, y: 790)
        drawLabel("industry corridor", x: 910, y: 720)
        drawLabel("neighborhood impact", x: 1320, y: 560)
    } else if spec.overlayType == "evidence" {
        stroke(NSRect(x: 1010, y: 360, width: 520, height: 320), color(0xF3D36B, alpha: 0.95), width: 6)
        fill(NSRect(x: 1010, y: 292, width: 520, height: 58), color(0x000000, alpha: 0.65))
        drawText("visible clue", x: 1032, yFromTop: 748, size: 26, weight: .semibold, color: .white, maxWidth: 480)
    } else if spec.overlayType == "proof" {
        drawLine(points: [NSPoint(x: 1450, y: 260), NSPoint(x: 1640, y: 390), NSPoint(x: 1510, y: 560)], color(0xF3D36B, alpha: 0.90), width: 6)
        drawLabel("source trail", x: 1370, y: 575)
    }
    drawSourceCallout(spec.sourceLabel)
}

drawText(spec.tag, x: 104, yFromTop: 98, size: 24, weight: .semibold, color: color(0xF3D36B, alpha: 1.0), maxWidth: 760)
drawText(spec.title, x: 104, yFromTop: 140, size: 54, weight: .bold, color: .white, maxWidth: 760)
drawText(spec.subtitle, x: 104, yFromTop: 214, size: 30, weight: .regular, color: color(0xF4E8CF, alpha: 1.0), maxWidth: 760)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.92]) else {
    throw NSError(domain: "PatternLabComposite", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not encode output image"])
}
try jpeg.write(to: URL(fileURLWithPath: spec.output), options: .atomic)
'''


def source_label_for(path):
    words = re.sub(r"^(loc|commons|pexels)[-_]?\d*[-_]?", "", path.stem.lower())
    words = re.sub(r"[-_]+", " ", words).strip()
    words = re.sub(r"\s+", " ", words)
    return words[:120] or path.name


def render_photo_composite(mode, left, right, target, title, subtitle, tag, overlay_type="proof", source_label=None):
    ensure_dir(target.parent)
    spec_path = target.with_suffix(".composite-spec.json")
    script_path = target.parent / "render_photo_composite.swift"
    spec_path.write_text(
        json.dumps(
            {
                "mode": mode,
                "overlayType": overlay_type,
                "left": str(left),
                "right": str(right) if right else None,
                "output": str(target),
                "title": title,
                "subtitle": subtitle,
                "tag": tag,
                "sourceLabel": source_label or f"Source media: {source_label_for(left)}",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    script_path.write_text(PHOTO_COMPOSITE_SWIFT, encoding="utf-8")
    swift_cache = ensure_dir(Path("/private/tmp/patternlab-swift-module-cache"))
    env = os.environ.copy()
    env["CLANG_MODULE_CACHE_PATH"] = str(swift_cache)
    env["SWIFT_MODULE_CACHE_PATH"] = str(swift_cache)
    subprocess.run(["swift", "-module-cache-path", str(swift_cache), str(script_path), str(spec_path)], check=True, env=env)


def support_role(path):
    name = path.name
    if "source-proof" in name:
        return "source_proof", "source-grounded source-proof collage"
    if "map-system" in name:
        return "map_system", "source-grounded map/system overlay"
    if "then-now" in name:
        return "then_now", "source-grounded then/now comparison"
    if "subscribe" in name:
        return "city_file_cta", "source-grounded city-file CTA"
    return "archive_evidence", "source-grounded archival evidence overlay"


def find_media_by_keywords(paths, keywords, fallback_index=0):
    if not paths:
        return None
    keyword_set = set(keywords)
    scored = []
    for path in paths:
        tokens = text_tokens(asset_text(path))
        scored.append((len(tokens & keyword_set), -len(scored), path))
    scored.sort(reverse=True)
    if scored and scored[0][0] > 0:
        return scored[0][2]
    return paths[fallback_index % len(paths)]


def single_photo_overlay(background, target, title, subtitle, tag, overlay_type="proof", source_label=None):
    render_photo_composite("single", background, None, target, title, subtitle, tag, overlay_type, source_label)


def split_photo_overlay(left, right, target, title, subtitle, tag, overlay_type="then_now", source_label=None):
    render_photo_composite("split", left, right, target, title, subtitle, tag, overlay_type, source_label)


def append_photo_backed_support_ledger(root, video_id, path, source_files, role):
    relative = str(path.relative_to(root))
    append_ledger(
        root,
        {
            "asset_id": f"video-{video_id}-{path.stem}",
            "asset_type": "image",
            "filename": relative,
            "local_path": relative,
            "tool": "Swift AppKit",
            "model_or_service": "local source-grounded documentary overlay",
            "source_prompt_or_source_file": "; ".join(str(source.relative_to(root)) for source in source_files if source),
            "source_title": f"Source-grounded Pattern Lab {role} visual",
            "source_url": "Pattern Lab local source-grounded overlay from rights-ledgered source media",
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_graphic",
            "license_or_rights_basis": "original Pattern Lab overlay derived from rights-ledgered source media",
            "license_status": "original Pattern Lab overlay derived from rights-ledgered source media",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab source-grounded overlay; source media attributions preserved in rights ledger.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "low: derived from reviewed Pattern Lab source media; owner review still required",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "source-grounded documentary overlay; not a full-screen non-picture slide",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )


def create_source_grounded_overlay_visuals(root, video_id, historical, modern):
    out_dir = ensure_dir(root / "source-packet" / "visual-rebuild" / SOURCE_GROUNDED_OVERLAY_DIR)
    source_proof_bg = find_media_by_keywords(historical, {"source", "river", "detroit", "building"}, 0)
    map_bg = find_media_by_keywords(historical, {"river", "tunnel", "dock", "rail", "line", "route"}, 1)
    evidence_bg = find_media_by_keywords(historical, {"building", "photo", "homes", "sojourner", "factory"}, 2)
    then_bg = find_media_by_keywords(historical, {"homes", "street", "building", "neighborhood"}, 3)
    now_bg = find_media_by_keywords(modern, {"skyline", "downtown", "context", "detroit"}, 0)
    cta_bg = find_media_by_keywords(modern, {"skyline", "river", "downtown", "detroit"}, 1)
    visuals = []
    specs = [
        (
            "source-proof-source-grounded-collage.jpg",
            source_proof_bg,
            None,
            "SOURCE PROOF",
            "Map. Photo. Record. Receipts.",
            "PATTERN LAB",
            "proof",
        ),
        (
            "map-system-source-grounded-overlay.jpg",
            map_bg,
            None,
            "THE MAP CHANGED",
            "Detroit's system is visible in the sources.",
            "MAP / SYSTEM",
            "map",
        ),
        (
            "archival-evidence-source-grounded-overlay.jpg",
            evidence_bg,
            None,
            "ARCHIVAL EVIDENCE",
            "Old photos are evidence, not decoration.",
            "SOURCE BOARD",
            "evidence",
        ),
        (
            "then-now-source-grounded-comparison.jpg",
            then_bg,
            now_bg,
            "THEN / NOW",
            "A real source beside modern context.",
            "COMPARISON",
            "then_now",
        ),
        (
            "subscribe-source-grounded-collage.jpg",
            cta_bg,
            None,
            "NEXT CITY FILE",
            "Subscribe for maps, archives, and evidence.",
            "PATTERN LAB",
            "cta",
        ),
    ]
    for filename, left, right, title, subtitle, tag, overlay_type in specs:
        if not left:
            continue
        target = out_dir / filename
        source_label = f"Source: {source_label_for(left)}"
        if right:
            source_label = f"Then: {source_label_for(left)}  |  Now/context: {source_label_for(right)}"
            split_photo_overlay(left, right, target, title, subtitle, tag, overlay_type, source_label)
            source_files = [left, right]
        else:
            single_photo_overlay(left, target, title, subtitle, tag, overlay_type, source_label)
            source_files = [left]
        role, _note = support_role(target)
        append_photo_backed_support_ledger(root, video_id, target, source_files, role)
        visuals.append(target)
    return visuals


def support_visuals(root, video_id, historical, modern):
    return [
        path
        for path in create_source_grounded_overlay_visuals(root, video_id, historical, modern)
        if "source-proof" not in path.name
    ]


def display_visual_path(root, path):
    try:
        return str(path.relative_to(root))
    except ValueError:
        return path.name


def split_script_paragraphs(video_id):
    script_path = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    if not script_path.exists():
        return []
    text = strip_markdown_for_voiceover(read_text(script_path))
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", text) if paragraph.strip()]
    return [paragraph for paragraph in paragraphs if len(paragraph.split()) >= 3]


def word_count(text):
    return len(re.findall(r"[A-Za-z0-9']+", text))


def visual_score(paragraph, rule):
    lower = paragraph.lower()
    score = 0
    for keyword in rule["keywords"]:
        if keyword in lower:
            score += 3 if " " in keyword else 1
    return score


def text_tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def asset_text(path):
    stem = path.stem.lower()
    stem = re.sub(r"^(loc|commons|pexels)[-_]?\d*[-_]?", "", stem)
    return stem.replace("-", " ").replace("_", " ")


def read_rights_ledger(root):
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return {}
    with ledger.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    lookup = {}
    for row in rows:
        for key in {row.get("filename", ""), row.get("local_path", "")}:
            if key:
                lookup[key] = row
                lookup[Path(key).name] = row
    return lookup


def source_role_for_path(root, path, ledger_lookup=None):
    relative = display_visual_path(root, path)
    row = (ledger_lookup or {}).get(relative) or (ledger_lookup or {}).get(path.name) or {}
    if row.get("source_class") in {"historical_evidence", "modern_context"}:
        return row["source_class"]
    if f"source-packet/visual-rebuild/{SOURCE_GROUNDED_OVERLAY_DIR}/" in relative:
        return "source_grounded_overlay"
    if "source-packet/visual-rebuild/historical/" in relative:
        return "historical_evidence"
    if "source-packet/visual-rebuild/modern-context/" in relative:
        return "modern_context"
    return row.get("source_class") or "original_graphic"


def asset_match_text(root, path, ledger_lookup=None):
    relative = display_visual_path(root, path)
    row = (ledger_lookup or {}).get(relative) or (ledger_lookup or {}).get(path.name) or {}
    parts = [
        asset_text(path),
        row.get("source_title", ""),
        row.get("source_url", ""),
        row.get("creator", ""),
        row.get("archive_or_platform", ""),
        row.get("source_class", ""),
        row.get("notes", ""),
    ]
    return " ".join(part for part in parts if part)


MATCH_DIMENSIONS = {
    "place": {
        "detroit", "michigan", "river", "downtown", "belle", "isle", "palmer", "park", "wayne", "state",
        "sojourner", "truth", "neighborhood", "neighborhoods", "street", "streets", "dock", "tunnel",
        "skyline", "homes", "church",
    },
    "person": {
        "people", "person", "human", "worker", "workers", "mother", "children", "family", "families",
        "residents", "organizers", "musicians", "entrepreneurs", "planners", "community", "crowd", "girls",
    },
    "object": {
        "building", "buildings", "church", "station", "factory", "factories", "plant", "furnace",
        "furnaces", "dock", "tunnel", "homes", "housing", "fountain", "casino", "mural", "doorway",
        "rail", "line", "photo", "photograph", "map", "record", "source", "skyline", "car", "cars",
    },
    "system": {
        "industry", "industrial", "route", "routes", "freeway", "freeways", "policy", "population",
        "movement", "rewired", "system", "systems", "trade", "rail", "automotive", "manufacturing",
        "infrastructure", "geography", "corridor", "access", "city", "cities", "pattern",
    },
    "date": {
        "1896", "1929", "1942", "2014", "2019", "2021", "today", "modern", "current", "old",
        "historical", "archive", "archival", "then", "now", "before", "after",
    },
}


SOURCE_ROLE_CUES = {
    "historical_evidence": {"history", "historical", "archive", "archival", "old", "source", "evidence", "photo", "photograph", "record", "document", "then", "before"},
    "modern_context": {"today", "modern", "current", "now", "present", "comeback", "skyline", "context", "youtube", "publish", "review"},
    "source_grounded_overlay": {"map", "source", "evidence", "proof", "pattern", "system", "then", "now", "subscribe", "city", "file"},
}


def strength_from_score(score):
    if score >= 12:
        return "strong"
    if score >= 7:
        return "acceptable"
    return "weak"


def visual_match_metadata(root, paragraph, path, source_role, recent_names, used_counts, fallback_used, ledger_lookup=None):
    paragraph_tokens = text_tokens(paragraph)
    asset_tokens = text_tokens(asset_match_text(root, path, ledger_lookup))
    dimensions = []
    score = 0
    dimension_weights = {
        "place": 8,
        "person": 8,
        "object": 7,
        "system": 7,
        "date": 5,
    }
    for dimension, terms in MATCH_DIMENSIONS.items():
        if paragraph_tokens & terms and asset_tokens & terms:
            dimensions.append(dimension)
            score += dimension_weights[dimension]
    if "place" not in dimensions and paragraph_tokens & {"city", "cities", "detroit"} and asset_tokens & {"detroit", "michigan"}:
        dimensions.append("place")
        score += dimension_weights["place"]
    source_role_terms = SOURCE_ROLE_CUES.get(source_role, set())
    if paragraph_tokens & source_role_terms:
        dimensions.append("source_role")
        score += 5
    if source_role == "source_grounded_overlay" and paragraph_tokens & SOURCE_ROLE_CUES["source_grounded_overlay"]:
        if "source_role" not in dimensions:
            dimensions.append("source_role")
            score += 5
        if "system" not in dimensions and paragraph_tokens & MATCH_DIMENSIONS["system"]:
            dimensions.append("system")
            score += 7
    if fallback_used:
        score = max(0, score - 4)
    if path.name in recent_names:
        score -= 6
    score -= used_counts.get(path.name, 0) * 10
    dimensions = sorted(set(dimensions), key=dimensions.index)
    category = classify_visual_category(root, path, paragraph, source_role, ledger_lookup)
    return {
        "match_score": score,
        "match_strength": strength_from_score(score),
        "match_dimensions": dimensions,
        "source_role": source_role,
        "fallback_used": bool(fallback_used),
        **category,
    }


SEMANTIC_VISUAL_CLUSTERS = [
    {
        "paragraph": {"factory", "factories", "industry", "industrial", "plant", "worker", "workers", "steel", "coke", "furnace", "furnaces", "bomber", "manufacturing", "car", "cars", "automotive"},
        "asset": {"plant", "factory", "furnace", "furnaces", "steel", "coke", "bomber", "drilling", "stove", "belting", "works"},
        "label": "industry/factory evidence",
    },
    {
        "paragraph": {"river", "border", "dock", "trade", "route", "routes", "water", "tunnel", "rail", "line", "access", "geography"},
        "asset": {"river", "dock", "tunnel", "belle", "isle", "line", "rail", "q", "waterfront"},
        "label": "river/route geography",
    },
    {
        "paragraph": {"housing", "home", "homes", "neighborhood", "neighborhoods", "resident", "residents", "people", "human", "family", "families", "children", "moved", "divided", "lost"},
        "asset": {"homes", "housing", "sojourner", "truth", "mother", "children", "riot", "neighborhood", "girls"},
        "label": "human/neighborhood consequence",
    },
    {
        "paragraph": {"building", "buildings", "built", "church", "station", "street", "streets", "theater", "environment", "institution", "downtown", "visible", "clue"},
        "asset": {"building", "church", "fountain", "institute", "arts", "main", "doorway", "medical", "center", "downtown"},
        "label": "built-environment evidence",
    },
    {
        "paragraph": {"today", "modern", "current", "comeback", "skyline", "context", "now", "present", "review", "youtube", "publish"},
        "asset": {"skyline", "modern", "context", "q", "line", "downtown", "detroit"},
        "label": "modern context",
    },
]


def semantic_asset_score(root, paragraph, path, role, recent_names, used_counts, recent_categories=None, category_counts=None, ledger_lookup=None):
    source_role = "modern_context" if role == "modern" else "historical_evidence"
    metadata = visual_match_metadata(root, paragraph, path, source_role, recent_names, used_counts, False, ledger_lookup)
    paragraph_tokens = text_tokens(paragraph)
    asset_tokens = text_tokens(asset_match_text(root, path, ledger_lookup))
    category = metadata.get("visual_category", "unknown_context")
    score = metadata["match_score"] + len(paragraph_tokens & asset_tokens) + metadata.get("visual_category_score", 0)
    matched_labels = []
    for cluster in SEMANTIC_VISUAL_CLUSTERS:
        if paragraph_tokens & cluster["paragraph"] and asset_tokens & cluster["asset"]:
            score += 9
            matched_labels.append(cluster["label"])
    if role == "modern" and paragraph_tokens & {"today", "modern", "current", "comeback", "now", "present"}:
        score += 5
    if role == "historical" and paragraph_tokens & {"history", "historical", "archive", "archival", "old", "source", "evidence", "photo", "photograph"}:
        score += 5
    if category in (recent_categories or []):
        score -= 5
    score -= (category_counts or {}).get(category, 0) * 2
    if role == "modern" and category == "skyline_cityscape_context":
        score -= 2
    metadata = {**metadata, "match_score": score, "match_strength": strength_from_score(score)}
    return score, matched_labels, metadata


def choose_source_pack_asset(root, paragraph, pool, role, recent_names, used_counts, fallback_index, ledger_lookup=None, recent_categories=None, category_counts=None):
    if not pool:
        return None, fallback_index, [], {
            "match_score": 0,
            "match_strength": "weak",
            "match_dimensions": [],
            "source_role": "modern_context" if role == "modern" else "historical_evidence",
            "fallback_used": True,
        }
    scored = []
    for offset, path in enumerate(pool):
        score, labels, metadata = semantic_asset_score(
            root,
            paragraph,
            path,
            role,
            recent_names,
            used_counts,
            recent_categories,
            category_counts,
            ledger_lookup,
        )
        scored.append((score, -offset, path, labels, metadata))
    scored.sort(reverse=True)
    best_score, _negative_offset, path, labels, metadata = scored[0]
    if best_score < 7:
        path = sorted(pool, key=lambda candidate: (used_counts.get(candidate.name, 0), candidate.name))[fallback_index % len(pool)]
        source_role = "modern_context" if role == "modern" else "historical_evidence"
        metadata = visual_match_metadata(root, paragraph, path, source_role, recent_names, used_counts, True, ledger_lookup)
        return path, fallback_index + 1, ["rotation fallback"], metadata
    return path, fallback_index, labels or ["dimension match"], metadata


def select_visual(paragraph, available, previous_name=None):
    candidates = []
    for rule in VISUAL_RULES:
        image_name = rule["image"]
        if image_name not in available:
            continue
        score = visual_score(paragraph, rule)
        if image_name == previous_name and score > 0:
            score += 1
        candidates.append((score, rule))
    if not candidates:
        image = sorted(available.values())[0]
        return image, "context_only", "fallback available image", "No semantic rule matched because only fallback media is available."
    candidates.sort(key=lambda item: item[0], reverse=True)
    score, rule = candidates[0]
    if score <= 0:
        fallback_name = "subscribe_city_file_card.png"
        if fallback_name in available:
            return (
                available[fallback_name],
                "city_file_cta",
                "city-file fallback",
                "No strong keyword match; using the city-file bridge visual.",
            )
        fallback = sorted(available.values())[0]
        return fallback, "context_only", "fallback available image", "No strong keyword match and no city-file bridge visual exists."
    reason = f"Matched narration to {rule['label']}."
    return available[rule["image"]], rule["role"], rule["label"], reason


def clamp_duration(seconds):
    return max(MIN_VISUAL_BEAT_SECONDS, min(MAX_VISUAL_BEAT_SECONDS, seconds))


def alternate_split_beat(root, beat, historical, modern, segment_index, ledger_lookup):
    source_role = beat.get("source_role", "")
    if source_role == "modern_context":
        pool = [path for path in modern if path.name != beat["image"].name]
        role = "modern"
    elif source_role == "historical_evidence":
        pool = [path for path in historical if path.name != beat["image"].name]
        role = "historical"
    else:
        return beat
    if not pool:
        return beat
    used_counts = {beat["image"].name: 1000}
    image, _fallback_index, labels, match = choose_source_pack_asset(
        root,
        beat.get("excerpt", ""),
        pool,
        role,
        [],
        used_counts,
        segment_index,
        ledger_lookup,
        [],
        {},
    )
    if not image or image.name == beat["image"].name:
        return beat
    if role == "modern":
        role_label = "modern Detroit context"
        note = "rights-cleared modern city context"
        reason = f"Matched narration by rotating the split segment to another relevant modern visual ({', '.join(labels)})."
    else:
        role_label = "historical Detroit source media"
        note = "rights-cleared historical Detroit image"
        reason = f"Matched narration by rotating the split segment to another relevant historical visual ({', '.join(labels)})."
    return {
        **beat,
        "image": image,
        "note": note,
        "reason": reason.replace("visual (", f"{role_label} ("),
        **match,
    }


def planned_visual_beats(root, video_id, seconds_after_proof):
    historical, modern = visual_rebuild_media(root)
    support = support_visuals(root, video_id, historical, modern)
    ledger_lookup = read_rights_ledger(root)
    paragraphs = split_script_paragraphs(video_id)
    if len(historical) >= 20 and len(modern) >= 10 and paragraphs:
        total_words = max(1, sum(word_count(paragraph) for paragraph in paragraphs))
        raw_beats = []
        historical_index = 0
        modern_index = 0
        support_index = 0
        recent_names = []
        recent_categories = []
        used_counts = {}
        category_counts = {}
        for paragraph_index, paragraph in enumerate(paragraphs):
            paragraph_terms = text_tokens(paragraph)
            estimated_duration = seconds_after_proof * (word_count(paragraph) / total_words)
            if support and paragraph_index > 0 and paragraph_index % SUPPORT_GRAPHIC_EVERY_N_PARAGRAPHS == SUPPORT_GRAPHIC_EVERY_N_PARAGRAPHS - 1:
                image = support[support_index % len(support)]
                support_index += 1
                role, note = support_role(image)
                reason = "Matched narration to a source-grounded documentary overlay; real media remains the default."
                match = visual_match_metadata(root, paragraph, image, "source_grounded_overlay", recent_names, used_counts, False, ledger_lookup)
            elif paragraph_index % 4 == 3 or paragraph_terms & {"today", "modern", "current", "comeback", "now", "present"}:
                image, modern_index, labels, match = choose_source_pack_asset(
                    root,
                    paragraph,
                    modern,
                    "modern",
                    recent_names,
                    used_counts,
                    modern_index,
                    ledger_lookup,
                    recent_categories,
                    category_counts,
                )
                role = "context_only"
                note = "rights-cleared modern city context"
                reason = f"Matched narration to real modern Detroit context ({', '.join(labels)}); context only, not source proof."
            else:
                image, historical_index, labels, match = choose_source_pack_asset(
                    root,
                    paragraph,
                    historical,
                    "historical",
                    recent_names,
                    used_counts,
                    historical_index,
                    ledger_lookup,
                    recent_categories,
                    category_counts,
                )
                role = "archive_evidence"
                note = "rights-cleared historical Detroit image"
                reason = f"Matched narration to real historical Detroit source media ({', '.join(labels)})."
            recent_names.append(image.name)
            recent_names = recent_names[-5:]
            visual_category = match.get("visual_category", "unknown_context")
            recent_categories.append(visual_category)
            recent_categories = recent_categories[-4:]
            used_counts[image.name] = used_counts.get(image.name, 0) + 1
            category_counts[visual_category] = category_counts.get(visual_category, 0) + 1
            raw_beats.append(
                {
                    "image": image,
                    "role": role,
                    "duration": estimated_duration,
                    "note": note,
                    "reason": reason,
                    "excerpt": paragraph[:190].replace("\n", " "),
                    **match,
                }
            )
    else:
        available = image_by_name(root)
        if not available:
            return []
        if not paragraphs:
            fallback = sorted(available.values())
            beat_count = max(1, math.ceil(seconds_after_proof / MAX_VISUAL_BEAT_SECONDS))
            duration = seconds_after_proof / beat_count
            fallback_beats = []
            for index in range(beat_count):
                image = fallback[index % len(fallback)]
                category = classify_visual_category(root, image, "", "original_graphic", ledger_lookup)
                fallback_beats.append({
                    "image": fallback[index % len(fallback)],
                    "role": "context_only",
                    "duration": duration,
                    "note": "fallback visual sequence",
                    "reason": "No script paragraphs were available, so the builder used deterministic fallback media.",
                    "excerpt": "",
                    "match_score": 0,
                    "match_strength": "weak",
                    "match_dimensions": [],
                    "source_role": "original_graphic",
                    "fallback_used": True,
                    **category,
                })
            return fallback_beats

        total_words = max(1, sum(word_count(paragraph) for paragraph in paragraphs))
        raw_beats = []
        previous_name = None
        for paragraph in paragraphs:
            estimated_duration = seconds_after_proof * (word_count(paragraph) / total_words)
            image, role, note, reason = select_visual(paragraph, available, previous_name)
            previous_name = image.name
            match = visual_match_metadata(root, paragraph, image, "original_graphic", [], {}, True, ledger_lookup)
            raw_beats.append(
                {
                    "image": image,
                    "role": role,
                    "duration": estimated_duration,
                    "note": note,
                    "reason": reason,
                    "excerpt": paragraph[:190].replace("\n", " "),
                    **match,
                }
            )

    beats = []
    for beat in raw_beats:
        remaining = max(0.01, beat["duration"])
        while remaining > MAX_VISUAL_BEAT_SECONDS:
            beats.append({**beat, "duration": MAX_VISUAL_BEAT_SECONDS})
            remaining -= MAX_VISUAL_BEAT_SECONDS
        if remaining < MIN_VISUAL_BEAT_SECONDS and beats and beats[-1]["image"] == beat["image"]:
            beats[-1]["duration"] += remaining
        else:
            beats.append({**beat, "duration": clamp_duration(remaining)})

    total = sum(beat["duration"] for beat in beats)
    if total <= 0:
        return beats
    scale = seconds_after_proof / total
    scaled_beats = []
    for beat in beats:
        remaining = max(0.1, beat["duration"] * scale)
        if remaining <= MAX_VISUAL_BEAT_SECONDS:
            scaled_beats.append({**beat, "duration": remaining})
            continue
        parts = math.ceil(remaining / MAX_VISUAL_BEAT_SECONDS)
        segment_duration = remaining / parts
        for segment_index in range(parts):
            segment = {**beat, "duration": segment_duration}
            if segment_index:
                segment = alternate_split_beat(root, segment, historical, modern, segment_index, ledger_lookup)
            scaled_beats.append(segment)
    return add_motion_metadata(scaled_beats)


def write_visual_match_report(root, video_id, beats):
    approval = ensure_dir(root / "approval")
    non_proof = [beat for beat in beats if beat.get("role") != "source_proof"]
    total = len(non_proof)
    with_metadata = [
        beat
        for beat in non_proof
        if all(key in beat for key in ["match_score", "match_strength", "match_dimensions", "source_role", "fallback_used", "visual_category"])
    ]
    strong = [beat for beat in non_proof if beat.get("match_strength") == "strong"]
    acceptable = [beat for beat in non_proof if beat.get("match_strength") == "acceptable"]
    weak = [beat for beat in non_proof if beat.get("match_strength") == "weak"]
    fallback = [beat for beat in non_proof if beat.get("fallback_used")]
    weak_share = len(weak) / total if total else 1
    fallback_share = len(fallback) / total if total else 1
    blockers = []
    if len(with_metadata) != total:
        blockers.append("Every non-proof beat must include visual match and visual category metadata.")
    if weak_share > MAX_WEAK_MATCH_SHARE:
        blockers.append("Visual source pack has too many weak narration matches; source more rights-safe media before assembly.")
    if fallback_share > MAX_FALLBACK_SHARE:
        blockers.append("Visual source pack has too many fallback narration matches; source more rights-safe media before assembly.")
    weak_examples = [
        {
            "path": display_visual_path(root, beat["image"]),
            "match_score": beat.get("match_score", 0),
            "match_dimensions": beat.get("match_dimensions", []),
            "source_role": beat.get("source_role", ""),
            "visual_category": beat.get("visual_category", ""),
            "excerpt": beat.get("excerpt", ""),
        }
        for beat in weak[:8]
    ]
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "total_non_proof_beats": total,
        "beats_with_match_metadata": len(with_metadata),
        "strong_count": len(strong),
        "acceptable_count": len(acceptable),
        "weak_count": len(weak),
        "weak_share": round(weak_share, 4),
        "fallback_count": len(fallback),
        "fallback_share": round(fallback_share, 4),
        "visual_categories": sorted({beat.get("visual_category", "unknown_context") for beat in non_proof}),
        "weak_examples": weak_examples,
        "source_shortfall_recommendation": (
            "none"
            if not blockers
            else "Source more rights-safe Detroit media for the weak narration beats before assembly."
        ),
        "blockers": blockers,
    }
    json_path = approval / "visual-match-report.json"
    md_path = approval / "visual-match-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Visual Match Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Total non-proof beats: {total}",
        f"Strong: {len(strong)}",
        f"Acceptable: {len(acceptable)}",
        f"Weak: {len(weak)} ({weak_share:.1%})",
        f"Fallback: {len(fallback)} ({fallback_share:.1%})",
        f"Beats with match metadata: {len(with_metadata)}/{total}",
        f"Visual categories: {', '.join(payload['visual_categories']) or 'none'}",
        "",
        "## Weak Beat Examples",
        "",
    ]
    if weak_examples:
        for item in weak_examples:
            lines.append(f"- {item['path']} | category={item.get('visual_category', 'missing')} | score={item['match_score']} | dimensions={','.join(item['match_dimensions']) or 'none'} | {item['excerpt']}")
    else:
        lines.append("- none")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


DOCUMENTARY_MOTION_STYLES = {
    "ken_burns_push",
    "ken_burns_pan_right",
    "ken_burns_pan_left",
    "slow_context_pan",
    "map_zoom_trace",
    "document_closeup",
    "source_highlight",
    "source_closeup",
    "then_now_reveal",
    "then_now_split",
    "subtle_parallax",
    "cta_push",
}


def motion_metadata(beat, index):
    role = beat.get("role", "")
    path = str(beat["image"]).lower()
    source_role = beat.get("source_role", "")
    visual_category = str(beat.get("visual_category", "")).lower()
    visual_reason = str(beat.get("visual_category_reason", "")).lower()
    searchable = " ".join([role, path, source_role, visual_category, visual_reason]).lower()
    if role == "source_proof":
        return "source_highlight", "opening source proof uses a restrained source highlight to keep the proof object readable"
    if role == "city_file_cta":
        return "cta_push", "slow city-file push preserves the CTA without slide-deck motion"
    if role == "then_now" or "then-now" in path or "then_now" in searchable:
        return "then_now_reveal", "subtle then/now reveal compares source evidence with modern context"
    if role == "context_only" or source_role == "modern_context" or "modern-context" in path:
        if index % 2 == 0:
            return "subtle_parallax", "modern context uses subtle parallax as atmosphere, not historical proof"
        return "slow_context_pan", "modern context uses slow environmental pan and cannot carry historical proof"
    if role == "map_system" or "map-system" in path:
        return "map_zoom_trace", "restrained map zoom emphasizes source-grounded system geography"
    if source_role == "source_grounded_overlay" or "source-grounded-overlays" in path:
        return "document_closeup", "source-grounded overlay uses a document closeup instead of decorative slide motion"
    if "document" in searchable or "source-board" in searchable or "record" in searchable:
        return "document_closeup", "source/document evidence uses a closeup to make the proof object legible"
    if "map" in searchable or "route" in searchable or "geography" in searchable:
        return "map_zoom_trace", "restrained map zoom emphasizes source-grounded system geography"
    if index % 4 == 0:
        return "ken_burns_pan_right", "historical still uses slow documentary pan right"
    if index % 4 == 1:
        return "ken_burns_pan_left", "historical still uses slow documentary pan left"
    return "ken_burns_push", "historical still uses restrained documentary push-in"


def add_motion_metadata(beats):
    polished = []
    for index, beat in enumerate(beats, start=1):
        style, reason = motion_metadata(beat, index)
        polished.append({**beat, "motion_style": style, "motion_reason": reason})
    return polished


def still_filter(frame_count, variant, motion_style="ken_burns_push"):
    frames = max(frame_count, 1)
    if motion_style == "map_zoom_trace":
        zoom = f"1+0.075*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "source_highlight":
        zoom = f"1.01+0.05*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "document_closeup":
        zoom = f"1.02+0.065*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "source_closeup":
        zoom = f"1.015+0.06*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "then_now_reveal":
        zoom = f"1.015+0.04*on/{frames}"
        x = f"(iw-iw/zoom)*on/{frames}"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "then_now_split":
        zoom = f"1.02+0.035*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style in {"ken_burns_pan_right", "slow_context_pan"}:
        zoom = f"1.025+0.03*on/{frames}"
        x = f"(iw-iw/zoom)*on/{frames}"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "subtle_parallax":
        zoom = f"1.018+0.025*on/{frames}"
        x = f"(iw-iw/zoom)*on/{frames}"
        y = f"(ih-ih/zoom)*on/{frames}"
    elif motion_style == "ken_burns_pan_left":
        zoom = f"1.025+0.03*on/{frames}"
        x = f"(iw-iw/zoom)*(1-on/{frames})"
        y = "ih/2-(ih/zoom/2)"
    elif motion_style == "cta_push":
        zoom = f"1+0.045*on/{frames}"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    else:
        zoom = f"1+0.055*on/{frames}"
        if variant % 4 == 0:
            x = "iw/2-(iw/zoom/2)"
            y = "ih/2-(ih/zoom/2)"
        elif variant % 4 == 1:
            x = f"(iw-iw/zoom)*on/{frames}"
            y = "ih/2-(ih/zoom/2)"
        elif variant % 4 == 2:
            x = f"(iw-iw/zoom)*(1-on/{frames})"
            y = "ih/2-(ih/zoom/2)"
        else:
            x = "iw/2-(iw/zoom/2)"
            y = f"(ih-ih/zoom)*on/{frames}"
    return (
        "scale=1920:1080:force_original_aspect_ratio=increase,"
        "crop=1920:1080,"
        f"zoompan=z='{zoom}':x='{x}':y='{y}':d={frame_count}:s=1920x1080:fps={FPS},"
        "format=yuv420p"
    )


def write_visual_plan(root, video_id, beats, output):
    plan = output.parent / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    lines = [
        f"# Pattern Lab Video {video_id} Visual Beat Plan",
        "",
        f"Opening proof clip: first {PROOF_SECONDS:g}s",
        "Opening source role: source_proof",
        f"Visual beat range: {MIN_VISUAL_BEAT_SECONDS:g}s-{MAX_VISUAL_BEAT_SECONDS:g}s",
        "Voiceover/script: script-aware timeline",
        "Strategy: proof first, then change visuals only when the narration changes topic or decision state.",
        "Source/context rule: maps, archives, city clues, and then/now evidence are preferred; stock/context B-roll is context only and cannot carry historical claims.",
        "Source/context roles: source_proof, map_system, archive_evidence, then_now, context_only, city_file_cta.",
        "",
        "## Best-Practice Rules Applied",
        "",
        "- The opening shows source proof before branding-heavy explanation.",
        "- Source proof stays before stills, generated graphics, and context-only B-roll in the first 20 seconds.",
        "- The Pattern Lab intro is short and appears after the hook.",
        "- Every visual beat carries dimension-aware match metadata tied to nearby narration.",
        "- Every visual beat uses restrained documentary motion instead of static slide-deck movement.",
        "- The ending reserves a consistent Pattern Lab outro and next-video bridge.",
        "",
        "## Opening Source Proof",
        "",
        f"- 00: 000.0s-{PROOF_SECONDS:05.1f}s | source-packet/visual-rebuild/{SOURCE_GROUNDED_OVERLAY_DIR}/source-proof-source-grounded-collage.jpg | role=source_proof | visual_category=maps_documents_source_proof | visual_category_reason=opening proof uses a source/photo/map collage | motion_style=source_highlight | motion_reason=opening source proof uses a restrained source highlight to keep the proof object readable | source-grounded proof first | No source, no story. This clip shows a rights-ledgered source/photo/map collage before narration visuals.",
        "",
        "## Beats",
        "",
    ]
    cursor = PROOF_SECONDS
    for index, beat in enumerate(beats, start=1):
        image = beat["image"]
        end = cursor + beat["duration"]
        dimensions = ",".join(beat.get("match_dimensions", [])) or "none"
        fallback = "yes" if beat.get("fallback_used") else "no"
        motion_style = beat.get("motion_style", "static_only")
        motion_reason = beat.get("motion_reason", "missing motion reason")
        visual_category = beat.get("visual_category", "unknown_context")
        visual_category_reason = str(beat.get("visual_category_reason", "missing category reason")).replace("|", "/")
        lines.append(
            f"- {index:02d}: {cursor:05.1f}s-{end:05.1f}s | {display_visual_path(root, image)} | role={beat['role']} | match_score={beat.get('match_score', 0)} | match_strength={beat.get('match_strength', 'weak')} | match_dimensions={dimensions} | source_role={beat.get('source_role', 'unknown')} | fallback_used={fallback} | visual_category={visual_category} | visual_category_reason={visual_category_reason} | motion_style={motion_style} | motion_reason={motion_reason} | {beat['note']} | {beat['reason']} Excerpt: {beat['excerpt']}"
        )
        cursor = end
    plan.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return plan


def main():
    parser = argparse.ArgumentParser(description="Assemble a Pattern Lab long-form review draft with FFmpeg.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    script_path = BASE / "launch" / f"video-{args.video_id}" / "final-script.md"
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    if not audio.exists():
        audio = root / "audio" / "voiceover_full.mp3"
    proof = root / "proof-footage" / "artifact-proof-clip.mp4"
    images = [root / "images" / name for name in IMAGE_ORDER if (root / "images" / name).exists()]
    historical_rebuild, modern_rebuild = visual_rebuild_media(root)
    output = root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    print(f"Audio: {display_path(audio)} {'present' if audio.exists() else 'missing'}")
    print(f"Proof footage: {display_path(proof)} {'present' if proof.exists() else 'missing'}")
    print(f"Generated support images: {len(images)}")
    print(f"Visual rebuild historical images: {len(historical_rebuild)}")
    print(f"Visual rebuild modern context images: {len(modern_rebuild)}")
    print(f"Output: {display_path(output)}")
    if args.dry_run:
        print("Dry run only. No video rendered.")
        return
    if not audio.exists():
        raise SystemExit("Missing voiceover audio.")
    if script_path.exists() and script_path.stat().st_mtime > audio.stat().st_mtime:
        raise SystemExit("Voiceover audio is older than final-script.md; regenerate narration before assembly.")
    if not proof.exists():
        raise SystemExit("Missing proof footage; upload-ready drafts require proof in the first 20 seconds.")
    if len(historical_rebuild) < MIN_VISUAL_REBUILD_HISTORICAL or len(modern_rebuild) < MIN_VISUAL_REBUILD_MODERN:
        raise SystemExit(
            "Visual source pack is below the production floor. "
            f"Need at least {MIN_VISUAL_REBUILD_HISTORICAL} historical and {MIN_VISUAL_REBUILD_MODERN} modern context assets; "
            "run source_visual_rebuild_assets.py or add more rights-safe media before assembly."
        )
    photo_backed_support = create_source_grounded_overlay_visuals(root, args.video_id, historical_rebuild, modern_rebuild)
    source_proof_visual = next((path for path in photo_backed_support if "source-proof" in path.name), None)
    if not source_proof_visual:
        raise SystemExit("Missing source-grounded source proof collage.")
    print(f"Source-grounded overlay composites: {len(photo_backed_support)}")
    ensure_dir(output.parent)
    clips_dir = ensure_dir(output.parent / "clips")
    clip_paths = []
    proof_clip = clips_dir / "clip_001.mp4"
    proof_frame_count = max(1, round(PROOF_SECONDS * FPS))
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-loop",
            "1",
            "-i",
            str(source_proof_visual),
            "-vf",
            still_filter(proof_frame_count, 1, "source_highlight"),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-r",
            str(FPS),
            "-frames:v",
            str(proof_frame_count),
            str(proof_clip),
        ],
        check=True,
    )
    clip_paths.append(proof_clip)
    audio_seconds = max(media_duration_seconds(audio), 60.0)
    seconds_after_proof = max(0.0, audio_seconds - PROOF_SECONDS)
    beats = planned_visual_beats(root, args.video_id, seconds_after_proof)
    if not beats:
        raise SystemExit("Missing generated images.")
    match_payload, _match_json, match_md = write_visual_match_report(root, args.video_id, beats)
    print(f"Visual match report: {display_path(match_md)}")
    if match_payload["status"] != "pass":
        for blocker in match_payload["blockers"]:
            print(f"- {blocker}")
        raise SystemExit("Visual source pack has too many weak narration matches; source more rights-safe media before assembly.")
    visual_plan = write_visual_plan(root, args.video_id, beats, output)
    print(f"Visual beat plan: {display_path(visual_plan)}")
    for index, beat in enumerate(beats, 2):
        image = beat["image"]
        clip = clips_dir / f"clip_{index:03d}.mp4"
        frame_count = max(1, round(beat["duration"] * FPS))
        subprocess.run(
            [
                ffmpeg_cmd(),
                "-y",
                "-loop",
                "1",
                "-i",
                str(image),
                "-vf",
                still_filter(frame_count, index, beat.get("motion_style", "ken_burns_push")),
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-r",
                str(FPS),
                "-frames:v",
                str(frame_count),
                str(clip),
            ],
            check=True,
        )
        clip_paths.append(clip)
    concat = output.parent / "concat-list.txt"
    concat.write_text("".join(f"file '{clip}'\n" for clip in clip_paths), encoding="utf-8")
    temp_video = output.parent / "video_no_audio.mp4"
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat),
            "-vf",
            "fps=30,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            str(temp_video),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-i",
            str(temp_video),
            "-i",
            str(audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            str(output),
        ],
        check=True,
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-draft-long-form",
            "asset_type": "video",
            "filename": str(output.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "local assembly",
            "source_prompt_or_source_file": "visual rebuild source media, generated support graphics, voiceover, proof footage",
            "local_path": str(output.relative_to(root)),
            "source_title": "Long-form assembly draft",
            "source_url": "visual rebuild source media, generated support graphics, voiceover, proof footage",
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_video",
            "license_or_rights_basis": "derived from original project assets and rights-ledgered source proof",
            "license_status": "derived from original project assets and rights-ledgered source proof",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab local assembly draft; no external attribution required.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "none logged",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "Private review draft rebuilt with real visual source pack first; public publishing blocked",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    print(f"Generated {display_path(output)}")


if __name__ == "__main__":
    main()
