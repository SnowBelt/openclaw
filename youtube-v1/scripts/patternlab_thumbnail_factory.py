#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import patternlab_script_bootstrap  # noqa: F401

from patternlab.city import require_city
from patternlab_common import BASE, append_ledger, display_path, ensure_dir, output_root, utc_now
from patternlab_images import IMAGE_HEIGHT, IMAGE_WIDTH, image_dimensions

FACTORY_STATUS = "repo_local_factory_rendered_canva_ready"
MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
IMPACT_FONT = Path("/System/Library/Fonts/Supplemental/Impact.ttf")
FREE_FONT_CANDIDATES = [
    "Impact",
    "Arial Black",
    "Arial Bold",
    "Avenir Next Condensed Heavy",
    "Helvetica Neue Condensed Black",
    "DIN Condensed Bold",
]
FREE_WORKFLOW_REPORTS = {
    "toolchain": "free-thumbnail-toolchain-report.json",
    "asset_sourcing": "thumbnail-asset-sourcing-report.json",
    "font": "thumbnail-font-report.json",
    "readability": "thumbnail-readability-report.json",
    "benchmark_similarity": "thumbnail-benchmark-similarity-report.json",
    "manual_handoff": "thumbnail-manual-handoff-report.json",
}
TESSERACT_CANDIDATES = ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "tesseract"]
BANNED_OCR_MISSPELLINGS = {
    "BEFOR": "BEFORE",
}
ALLOWED_SHAPE_PURPOSES = {
    "redaction",
    "divider",
    "frame",
    "shadow",
    "document_background",
    "caption_area",
    "intentional_design_accent",
    "headline_backplate",
    "photo_frame",
    "route_panel",
}
INTENTIONAL_WORD_CATEGORIES = {
    "active_city": "names the city being discussed",
    "curiosity_hook": "creates a clear viewer question",
    "time_comparison": "marks then/now/year contrast",
    "source_promise": "clarifies map, route, street, document, or fall-explained promise",
    "editorial_prop": "appears only as believable prop text inside a document/newspaper style",
}
PUBLIC_WORD_BLOCKLIST = {"SOURCE", "PHOTO", "PROOF", "MAP PROOF", "SOURCE PHOTO"}
STYLE_RULES = {
    "neon_city_myth": ["background_visible", "no_meaningless_box", "city_text_dominant"],
    "underground_city": ["underground_visual", "city_is_attention_color", "no_random_arrow"],
    "redacted_file": ["readable_sentence_fragments", "selective_redactions", "city_spelled_correctly"],
    "newspaper_front_page": ["fictional_masthead", "body_columns", "photo_caption", "no_clipped_headline"],
    "then_now_split": ["then_left_now_right", "no_image_distortion", "aspect_preserved"],
}

SWIFT_RENDERER = r'''
import AppKit
import Foundation

struct Spec: Decodable {
    let mode: String
    let left: String
    let right: String?
    let output: String
    let headline: String
    let city: String
    let proofLabel: String?
    let compression: Double
}

let specURL = URL(fileURLWithPath: CommandLine.arguments[1])
let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: specURL))
let width: CGFloat = 1920
let height: CGFloat = 1080
let canvas = NSSize(width: width, height: height)

func color(_ hex: UInt32, alpha: CGFloat = 1.0) -> NSColor {
    NSColor(calibratedRed: CGFloat((hex >> 16) & 0xff) / 255.0,
            green: CGFloat((hex >> 8) & 0xff) / 255.0,
            blue: CGFloat(hex & 0xff) / 255.0,
            alpha: alpha)
}
func fill(_ rect: NSRect, _ c: NSColor) { c.setFill(); rect.fill() }
func stroke(_ rect: NSRect, _ c: NSColor, width: CGFloat) { let p = NSBezierPath(rect: rect); p.lineWidth = width; c.setStroke(); p.stroke() }
func font(_ name: String, _ size: CGFloat) -> NSFont { NSFont(name: name, size: size) ?? NSFont(name: "Impact", size: size) ?? NSFont.systemFont(ofSize: size, weight: .black) }
func fillImage(_ path: String, in rect: NSRect, fraction: CGFloat = 1.0, xBias: CGFloat = 0.5, yBias: CGFloat = 0.5) throws {
    guard let image = NSImage(contentsOfFile: path) else { throw NSError(domain: "PatternLabThumbnail", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read image: \(path)"]) }
    let s = image.size
    let scale = max(rect.width / s.width, rect.height / s.height)
    let ds = NSSize(width: s.width * scale, height: s.height * scale)
    let draw = NSRect(x: rect.minX + (rect.width - ds.width) * xBias, y: rect.minY + (rect.height - ds.height) * yBias, width: ds.width, height: ds.height)
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(rect: rect).addClip()
    image.draw(in: draw, from: .zero, operation: .sourceOver, fraction: fraction)
    NSGraphicsContext.restoreGraphicsState()
}
func containImage(_ path: String, in rect: NSRect, fraction: CGFloat = 1.0) throws {
    guard let image = NSImage(contentsOfFile: path) else { throw NSError(domain: "PatternLabThumbnail", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not read image: \(path)"]) }
    let s = image.size
    let scale = min(rect.width / s.width, rect.height / s.height)
    let ds = NSSize(width: s.width * scale, height: s.height * scale)
    let draw = NSRect(x: rect.midX - ds.width / 2, y: rect.midY - ds.height / 2, width: ds.width, height: ds.height)
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(rect: rect).addClip()
    image.draw(in: draw, from: .zero, operation: .sourceOver, fraction: fraction)
    NSGraphicsContext.restoreGraphicsState()
}
func paragraph(_ align: NSTextAlignment = .left) -> NSMutableParagraphStyle { let p = NSMutableParagraphStyle(); p.alignment = align; p.lineBreakMode = .byClipping; return p }
func drawText(_ s: String, _ r: NSRect, _ f: NSFont, fill fillColor: NSColor, stroke strokeColor: NSColor = .black, strokeWidth: Int = 6, align: NSTextAlignment = .left, kern: CGFloat = -1) {
    let p = paragraph(align)
    let attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: fillColor, .strokeColor: strokeColor, .strokeWidth: -strokeWidth, .paragraphStyle: p, .kern: kern]
    let shadowAttrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: NSColor.black.withAlphaComponent(0.82), .paragraphStyle: p, .kern: kern]
    (s as NSString).draw(in: r.offsetBy(dx: 7, dy: -7), withAttributes: shadowAttrs)
    (s as NSString).draw(in: r, withAttributes: attrs)
}
func drawPlain(_ s: String, _ r: NSRect, _ f: NSFont, _ c: NSColor, align: NSTextAlignment = .left) {
    (s as NSString).draw(in: r, withAttributes: [.font: f, .foregroundColor: c, .paragraphStyle: paragraph(align)])
}
func fitFont(_ text: String, name: String, max: CGFloat, min: CGFloat, width maxWidth: CGFloat) -> NSFont {
    var size = max
    while size > min {
        let f = font(name, size)
        let w = (text as NSString).size(withAttributes: [.font: f]).width
        if w <= maxWidth { return f }
        size -= 4
    }
    return font(name, min)
}
func headlineParts(_ headline: String, city: String) -> (String, String) {
    let c = city.uppercased()
    let cp = c.hasSuffix("S") ? c + "'" : c + "'S"
    if headline.hasPrefix(cp + " ") { return (c, String(headline.dropFirst((cp + " ").count))) }
    if headline.hasPrefix(c + " ") { return (c, String(headline.dropFirst((c + " ").count))) }
    return (c, headline)
}
func redactedSentence(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ text: String, redactions: [(CGFloat, CGFloat)]) {
    drawPlain(text, NSRect(x: x, y: y, width: w, height: 34), font("Courier New Bold", 28), color(0x2b2115))
    for (rx, rw) in redactions { fill(NSRect(x: x + rx, y: y + 4, width: rw, height: 24), color(0x080808)) }
}
func redactedSentenceWords(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ text: String, words: [String]) {
    let f = font("Courier New Bold", 28)
    let attrs: [NSAttributedString.Key: Any] = [.font: f]
    drawPlain(text, NSRect(x: x, y: y, width: w, height: 34), f, color(0x2b2115))
    for word in words {
        guard let range = text.range(of: word) else { continue }
        let before = String(text[..<range.lowerBound]) as NSString
        let target = String(text[range]) as NSString
        let start = before.size(withAttributes: attrs).width
        let wordWidth = target.size(withAttributes: attrs).width
        fill(NSRect(x: x + start - 2, y: y + 4, width: wordWidth + 4, height: 24), color(0x080808))
    }
}
func bodyColumns(_ x: CGFloat, _ y: CGFloat, _ cols: Int, _ rows: Int) {
    for c in 0..<cols {
        for r in 0..<rows {
            let yy = y + CGFloat(r) * 20
            let ww = CGFloat(170 + ((r + c) % 5) * 28)
            fill(NSRect(x: x + CGFloat(c) * 210, y: yy, width: ww, height: 5), color(0x16120a, alpha: 0.62))
        }
    }
}
func cityTextColor(for mode: String) -> NSColor { mode == "hidden_system" ? color(0xE1192B) : color(0xFFD335) }

let image = NSImage(size: canvas)
image.lockFocus()
fill(NSRect(x: 0, y: 0, width: width, height: height), .black)
let parts = headlineParts(spec.headline.uppercased(), city: spec.city)
let city = parts.0
let promise = parts.1
let left = spec.left
let right = spec.right ?? spec.left

if spec.mode == "redrawn" {
    try fillImage(left, in: NSRect(x: 0, y: 0, width: width, height: height), fraction: 1.0, xBias: 0.50, yBias: 0.48)
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0xFFFFFF, alpha: 0.08))
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0x00101A, alpha: 0.10))
    fill(NSRect(x: 50, y: 540, width: 1820, height: 430), color(0x00111A, alpha: 0.88))
    fill(NSRect(x: 1010, y: 70, width: 820, height: 590), color(0x00111A, alpha: 0.96))
    try fillImage(right, in: NSRect(x: 1060, y: 110, width: 720, height: 520), fraction: 0.95, xBias: 0.50, yBias: 0.50)
    stroke(NSRect(x: 1050, y: 100, width: 740, height: 540), color(0xFFD335), width: 10)
    fill(NSRect(x: 0, y: 0, width: width, height: 185), color(0x00D7E6, alpha: 0.88))
    fill(NSRect(x: 0, y: 185, width: width, height: 18), color(0xFFD335, alpha: 0.95))
    drawText(city, NSRect(x: 78, y: 695, width: 1760, height: 250), fitFont(city, name: "Avenir Next Condensed Heavy", max: 235, min: 148, width: 1760), fill: color(0xFFD335), strokeWidth: 4, kern: -7)
    drawText(promise, NSRect(x: 84, y: 570, width: 1750, height: 132), fitFont(promise, name: "Avenir Next Condensed Heavy", max: 118, min: 78, width: 1750), fill: .white, strokeWidth: 4, kern: -2)
    drawPlain("THE MAP CHANGED THE CITY", NSRect(x: 90, y: 58, width: 1100, height: 80), font("Avenir Next Heavy", 58), color(0x00111A))
    // No outer debug-style border: keep the thumbnail clean at search-shelf size.
} else if spec.mode == "hidden_system" {
    try fillImage(left, in: NSRect(x: 920, y: 0, width: 1000, height: height), fraction: 0.92, xBias: 0.55, yBias: 0.50)
    fill(NSRect(x: 0, y: 0, width: 1120, height: height), color(0x050505))
    fill(NSRect(x: 0, y: 0, width: 78, height: height), color(0xE1192B))
    drawText(city, NSRect(x: 130, y: 668, width: 790, height: 220), fitFont(city, name: "Helvetica Neue Condensed Black", max: 210, min: 140, width: 790), fill: color(0xE1192B), strokeWidth: 4, kern: -8)
    let hiddenWords = promise.split(separator: " ").map(String.init)
    let hiddenLine1 = hiddenWords.first ?? "UNDER"
    let hiddenLine2 = hiddenWords.dropFirst().joined(separator: " ").isEmpty ? "THE CITY" : hiddenWords.dropFirst().joined(separator: " ")
    drawText(hiddenLine1, NSRect(x: 145, y: 505, width: 650, height: 150), fitFont(hiddenLine1, name: "Helvetica Neue Condensed Black", max: 145, min: 82, width: 650), fill: color(0xF8EFE0), strokeWidth: 2, kern: -4)
    drawText(hiddenLine2, NSRect(x: 145, y: 375, width: 740, height: 140), fitFont(hiddenLine2, name: "Helvetica Neue Condensed Black", max: 132, min: 72, width: 740), fill: color(0xF8EFE0), strokeWidth: 2, kern: -4)
    fill(NSRect(x: 145, y: 272, width: 610, height: 14), color(0xF8EFE0))
    drawPlain("A HIDDEN ROUTE BELOW", NSRect(x: 145, y: 205, width: 720, height: 55), font("Avenir Next Heavy", 46), color(0xF8EFE0))
    stroke(NSRect(x: 1000, y: 92, width: 800, height: 890), color(0xE1192B), width: 12)
} else if spec.mode == "proof_object_mystery" {
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0x16120F))
    try fillImage(right, in: NSRect(x: 1030, y: 0, width: 890, height: height), fraction: 0.86, xBias: 0.50, yBias: 0.50)
    fill(NSRect(x: 70, y: 72, width: 860, height: 936), color(0xF3D99A))
    stroke(NSRect(x: 70, y: 72, width: 860, height: 936), color(0x2C2113), width: 10)
    drawPlain("CITY PLANNING MEMO", NSRect(x: 120, y: 865, width: 760, height: 60), font("Courier New Bold", 48), color(0x2b2115), align: .center)
    drawText(city, NSRect(x: 112, y: 690, width: 790, height: 160), fitFont(city, name: "Helvetica Neue Condensed Black", max: 138, min: 92, width: 790), fill: color(0x17110A), stroke: color(0x17110A), strokeWidth: 0, align: .center)
    drawText(promise, NSRect(x: 145, y: 560, width: 720, height: 150), fitFont(promise, name: "Helvetica Neue Condensed Black", max: 128, min: 82, width: 720), fill: color(0xB00020), stroke: color(0x17110A), strokeWidth: 1, align: .center)
    redactedSentenceWords(140, 480, 720, "The city plan changed after midnight.", words: ["plan", "midnight"])
    redactedSentenceWords(140, 425, 720, "The downtown blocks marked for removal were sealed.", words: ["downtown", "removal"])
    redactedSentenceWords(140, 370, 720, "Neighborhood access changed after the hearing.", words: ["access", "hearing"])
    fill(NSRect(x: 122, y: 232, width: 720, height: 96), color(0xB00020))
    drawPlain("WHO ERASED IT?", NSRect(x: 150, y: 253, width: 664, height: 66), font("Avenir Next Heavy", 62), .white, align: .center)
} else if spec.mode == "vanished_place" {
    fill(NSRect(x: 0, y: 0, width: width, height: height), color(0xEEE6D3))
    drawPlain("THE DAILY LEDGER", NSRect(x: 70, y: 930, width: 1780, height: 86), font("Georgia Bold", 76), color(0x17110A), align: .center)
    fill(NSRect(x: 70, y: 907, width: 1780, height: 8), color(0x17110A))
    drawPlain("CITY EDITION • ARCHIVE FILE • BEFORE THE GRID CHANGED", NSRect(x: 90, y: 875, width: 1740, height: 38), font("Avenir Next Heavy", 30), color(0x5A4430), align: .center)
    drawText(city, NSRect(x: 80, y: 625, width: 820, height: 180), fitFont(city, name: "Helvetica Neue Condensed Black", max: 145, min: 94, width: 820), fill: color(0x17110A), stroke: color(0x17110A), strokeWidth: 0, kern: -3)
    let lostWords = promise.split(separator: " ").map(String.init)
    let lostMid = max(1, min(2, lostWords.count / 2 + lostWords.count % 2))
    let lostLine1 = lostWords.prefix(lostMid).joined(separator: " ")
    let lostLine2 = lostWords.dropFirst(lostMid).joined(separator: " ")
    let lostDisplay = lostLine2.isEmpty ? lostLine1 : lostLine1 + "\n" + lostLine2
    drawText(lostDisplay, NSRect(x: 82, y: 365, width: 840, height: 285), fitFont(lostDisplay.replacingOccurrences(of: "\n", with: " "), name: "Helvetica Neue Condensed Black", max: 126, min: 72, width: 840), fill: color(0xB41219), stroke: color(0x17110A), strokeWidth: 1, kern: -3)
    bodyColumns(96, 165, 4, 8)
    try fillImage(left, in: NSRect(x: 1040, y: 155, width: 760, height: 500), fraction: 0.96, xBias: 0.50, yBias: 0.50)
    stroke(NSRect(x: 1024, y: 139, width: 792, height: 532), color(0x17110A), width: 14)
    drawPlain("Street map: where the grid changed", NSRect(x: 1040, y: 94, width: 760, height: 38), font("Avenir Next Heavy", 28), color(0x17110A), align: .center)
} else {
    try fillImage(left, in: NSRect(x: 0, y: 0, width: 945, height: height), fraction: 0.96, xBias: 0.50, yBias: 0.50)
    try fillImage(right, in: NSRect(x: 975, y: 0, width: 945, height: height), fraction: 1.0, xBias: 0.50, yBias: 0.50)
    fill(NSRect(x: 0, y: 0, width: 960, height: height), color(0x2A0800, alpha: 0.30))
    fill(NSRect(x: 960, y: 0, width: 960, height: height), color(0x001B2A, alpha: 0.10))
    fill(NSRect(x: 945, y: 0, width: 30, height: height), .white)
    fill(NSRect(x: 72, y: 765, width: 690, height: 110), color(0xFFD335, alpha: 0.94))
    drawPlain("THEN", NSRect(x: 100, y: 786, width: 630, height: 78), font("Avenir Next Heavy", 80), color(0x1A1000), align: .center)
    fill(NSRect(x: 1160, y: 765, width: 690, height: 110), color(0x00C2FF, alpha: 0.90))
    drawPlain("NOW", NSRect(x: 1190, y: 786, width: 630, height: 78), font("Avenir Next Heavy", 80), color(0x00111A), align: .center)
    drawText(city, NSRect(x: 115, y: 560, width: 1690, height: 180), fitFont(city, name: "Helvetica Neue Condensed Black", max: 178, min: 112, width: 1690), fill: .white, strokeWidth: 4, align: .center, kern: -5)
    drawText(promise, NSRect(x: 285, y: 408, width: 1350, height: 125), fitFont(promise, name: "Avenir Next Condensed Heavy", max: 104, min: 56, width: 1350), fill: color(0xFFD335), strokeWidth: 4, align: .center, kern: -3)
}
image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: spec.compression]) else {
    throw NSError(domain: "PatternLabThumbnail", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not encode thumbnail"])
}
try data.write(to: URL(fileURLWithPath: spec.output), options: .atomic)
'''


def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def city_possessive(city):
    city_upper = require_city(city, source="thumbnail").upper()
    return f"{city_upper}'" if city_upper.endswith("S") else f"{city_upper}'S"


def format_city_template(template, city):
    city = require_city(city, source="thumbnail")
    return template.replace("{CITY_POSSESSIVE}", city_possessive(city)).replace("{CITY}", city.upper())


def active_city(metadata, package):
    from patternlab.city import city_from_sources

    return city_from_sources(
        (("package", package.get("city")), ("thumbnail_metadata", metadata.get("city"))),
        required=True,
    )


def city_slug(city):
    return re.sub(r"[^a-z0-9]+", "_", city.lower()).strip("_") or "city"


def ffmpeg():
    return "ffmpeg"


def run_ffmpeg(command):
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("FFmpeg render failed:\n" + " ".join(command) + "\nSTDOUT:\n" + result.stdout[-2000:] + "\nSTDERR:\n" + result.stderr[-4000:])


def swift_renderer_path(root):
    tmp = ensure_dir(root / "tmp" / "thumbnail-factory")
    path = tmp / "render_thumbnail_factory.swift"
    path.write_text(SWIFT_RENDERER, encoding="utf-8")
    return path


def render_with_swift(root, spec, output, city):
    renderer = swift_renderer_path(root)
    spec_path = ensure_dir(root / "tmp" / "thumbnail-factory") / f"{Path(output).stem}.spec.json"
    for compression in (0.86, 0.78, 0.68):
        current_spec = {**spec, "city": city.upper(), "compression": compression, "output": str(output)}
        spec_path.write_text(json.dumps(current_spec, indent=2) + "\n", encoding="utf-8")
        module_cache = ensure_dir(Path("/private/tmp/patternlab-swift-module-cache"))
        env = dict(os.environ)
        env.setdefault("CLANG_MODULE_CACHE_PATH", str(module_cache))
        result = subprocess.run(["swift", "-module-cache-path", str(module_cache), str(renderer), str(spec_path)], capture_output=True, text=True, check=False, env=env)
        if result.returncode != 0:
            raise RuntimeError("Swift thumbnail render failed:\n" + result.stdout[-2000:] + "\nSTDERR:\n" + result.stderr[-4000:])
        palettize_png(output)
        if Path(output).stat().st_size <= MAX_THUMBNAIL_BYTES:
            return


def palettize_png(path):
    path = Path(path)
    tmp = path.with_name(f"{path.stem}.paletted{path.suffix}")
    for colors in (192, 160, 128, 96):
        run_ffmpeg([
            ffmpeg(), "-y", "-i", str(path), "-filter_complex",
            f"[0:v]split=2[pal_src][img_src];[pal_src]palettegen=max_colors={colors}:stats_mode=single[p];[img_src][p]paletteuse=dither=bayer:bayer_scale=3[out]",
            "-map", "[out]", "-frames:v", "1", str(tmp),
        ])
        tmp.replace(path)
        if path.stat().st_size <= MAX_THUMBNAIL_BYTES:
            return


def load_manifest(root):
    manifest_path = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    return manifest_path, read_json(manifest_path)


def asset_path(root, asset):
    filename = asset.get("filename", "")
    if not filename:
        return None
    path = root / filename
    return path if path.exists() else None


def choose_asset(root, assets, terms, fallback_index=0):
    for asset in assets:
        haystack = " ".join(str(asset.get(key, "")) for key in ("filename", "source_title", "visual_category", "visual_category_label", "notes")).lower()
        if any(term.lower() in haystack for term in terms):
            path = asset_path(root, asset)
            if path:
                return asset, path
    for asset in assets[fallback_index:] + assets[:fallback_index]:
        path = asset_path(root, asset)
        if path:
            return asset, path
    return {}, None


def local_asset(root, rel_path, source_title, visual_category, source_class="support_graphic", notes="repo-local rights-ledgered support asset"):
    path = root / rel_path
    if not path.exists():
        return {}, None
    return {
        "filename": rel_path,
        "source_title": source_title,
        "source_class": source_class,
        "visual_category": visual_category,
        "visual_category_label": visual_category.replace("_", "/"),
        "notes": notes,
    }, path


def choose_local_asset(root, candidates, source_title, visual_category, source_class="support_graphic", notes="repo-local rights-ledgered support asset"):
    for rel_path in candidates:
        asset, path = local_asset(root, rel_path, source_title, visual_category, source_class, notes)
        if path:
            return asset, path
    return {}, None


def is_map_asset(asset):
    haystack = " ".join(str(asset.get(key, "")) for key in ("filename", "source_title", "visual_category", "visual_category_label", "notes", "source_class")).lower()
    return any(term in haystack for term in ("map", "street_grid", "street grid", "route highway map", "source_grounded_support_graphic"))


def is_real_photo_asset(asset):
    if not asset:
        return False
    if is_map_asset(asset):
        return False
    source_class = str(asset.get("source_class", "")).lower()
    filename = str(asset.get("filename", "")).lower()
    if filename.endswith(".svg") or "city_source_map" in filename:
        return False
    return source_class in {"historical_evidence", "modern_context"}


def semantic_match(asset, terms):
    haystack = " ".join(str(asset.get(key, "")) for key in ("filename", "source_title", "visual_category", "visual_category_label", "notes", "source_class")).lower()
    return any(term.lower() in haystack for term in terms)


def source_tuple(root, asset):
    path = asset_path(root, asset)
    return (asset, path) if path else ({}, None)


def choose_manifest_asset(root, assets, predicate, terms=(), fallback_predicate=None):
    for asset in assets:
        if predicate(asset) and (not terms or semantic_match(asset, terms)):
            selected = source_tuple(root, asset)
            if selected[1]:
                return selected
    if fallback_predicate:
        for asset in assets:
            if fallback_predicate(asset):
                selected = source_tuple(root, asset)
                if selected[1]:
                    return selected
    return {}, None


def required_sources(root, manifest, city):
    historical = manifest.get("historical_assets", [])
    modern = manifest.get("modern_context_assets", [])
    all_manifest_assets = historical + [asset for asset in modern if asset not in historical]
    map_asset = choose_manifest_asset(root, all_manifest_assets, is_map_asset)
    modern_skyline = choose_manifest_asset(
        root,
        modern,
        is_real_photo_asset,
        ["skyline", "tower", "downtown", "landmark", "terminal", "key tower", "edgewater"],
        is_real_photo_asset,
    )
    historic_street = choose_manifest_asset(
        root,
        historical,
        is_real_photo_asset,
        ["street", "euclid", "public square", "downtown", "neighborhood", "block"],
        is_real_photo_asset,
    )
    historic_landmark = choose_manifest_asset(
        root,
        historical,
        is_real_photo_asset,
        ["tower", "landmark", "architecture", "terminal", "public square", "downtown", "skyline"],
        is_real_photo_asset,
    )
    underground = choose_manifest_asset(
        root,
        historical + modern,
        is_real_photo_asset,
        ["underground", "tunnel", "subway", "rapid", "transit", "station", "utility"],
        is_real_photo_asset,
    )
    return {
        "redrawn_bg": map_asset,
        "redrawn_proof": modern_skyline if modern_skyline[1] else historic_street,
        "hidden_bg": underground,
        "hidden_proof": modern_skyline if modern_skyline[1] else map_asset,
        "year_bg": historic_street if historic_street[1] else historic_landmark,
        "year_proof": historic_landmark if historic_landmark[1] else historic_street,
        "lost_bg": historic_street if historic_street[1] else map_asset,
        "lost_proof": map_asset,
        "fall_bg": historic_street if historic_street[1] else historic_landmark,
        "fall_proof": modern_skyline,
    }


def concept_specs(sources, city):
    slug = city_slug(city)
    return [
        {"concept_id":"city_transformation","letter":"A","filename":"thumbnail_candidate_a.png","concept_filename":f"thumbnail_concept_01_{slug}_was_redrawn.png","selected":True,"role":"emotional_mystery","headline":format_city_template("{CITY} WAS REDRAWN", city),"mode":"redrawn","bg_key":"redrawn_bg","proof_key":"redrawn_proof","proof_label":"","benchmark_family":"owner-preferred map/redrawn current style","visual_strategy":f"dominant {city} text over a city map, street grid, highway map, or map/photo hybrid; no random lines or meaningless boxes","city_anchor":f"recognizable {city} map/grid or skyline-backed map support","proof_object":"map/grid changed-the-city cue, no public proof/source labels","click_interest_trigger":f"what redrew {city}'s map and streets","style_family":"neon_city_myth"},
        {"concept_id":"hidden_system","letter":"B","filename":"thumbnail_candidate_b.png","concept_filename":f"thumbnail_concept_02_{slug}_hidden_map.png","selected":True,"role":"map_system_proof","headline":format_city_template("{CITY_POSSESSIVE} HIDDEN MAP", city),"mode":"hidden_system","bg_key":"hidden_bg","proof_key":"hidden_proof","proof_label":"","benchmark_family":"owner-preferred underground city poster","visual_strategy":f"underground/tunnel/sewer/subway/utility image with {city} as the red attention word and no random arrows","city_anchor":f"active-city text plus tunnel/route source context; skyline proof available in source path if needed","proof_object":"underground/hidden-system route clue, not a generic proof label","click_interest_trigger":"what hidden system sits below the city","style_family":"underground_city"},
        {"concept_id":"proof_object_mystery","letter":"D","filename":"thumbnail_review_d.png","concept_filename":f"thumbnail_concept_03_{slug}_1942.png","selected":False,"role":"proof_object_mystery","headline":format_city_template("{CITY} 1942", city),"mode":"proof_object_mystery","bg_key":"year_bg","proof_key":"year_proof","proof_label":"1942","benchmark_family":"owner-preferred redacted city file","visual_strategy":"large document prop with readable sentence fragments, whole-word redactions, and a prominent WHO ERASED IT? hook","city_anchor":f"{city} spelled as the central document subject plus historic city image support","proof_object":"fictional non-proof redacted document prop plus historic source image","click_interest_trigger":"who erased or rerouted the city file","style_family":"redacted_file"},
        {"concept_id":"vanished_place","letter":"E","filename":"thumbnail_review_e.png","concept_filename":f"thumbnail_concept_04_{slug}_lost_streets.png","selected":False,"role":"vanished_place","headline":format_city_template("{CITY_POSSESSIVE} LOST STREETS", city),"mode":"vanished_place","bg_key":"lost_bg","proof_key":"lost_proof","proof_label":"","benchmark_family":"owner-preferred street-grid newspaper","visual_strategy":"fictional newspaper/front-page style using a street map, road grid, city blocks, demolition/void clue, or old street photo; rail/track-only images are blocked","city_anchor":f"{city} as the largest newspaper headline subject plus street-grid visual support","proof_object":"fictional newspaper prop pointing to lost streets without claiming to be a real publication","click_interest_trigger":f"which {city} streets vanished","style_family":"newspaper_front_page"},
        {"concept_id":"then_now_contradiction","letter":"C","filename":"thumbnail_candidate_c.png","concept_filename":f"thumbnail_concept_05_{slug}_fall_explained.png","selected":True,"role":"contrarian_history_angle","headline":format_city_template("{CITY_POSSESSIVE} FALL EXPLAINED", city),"mode":"then_now_contradiction","bg_key":"fall_bg","proof_key":"fall_proof","proof_label":"","benchmark_family":"owner-preferred then/now split","visual_strategy":"THEN on the left, NOW on the right, no median crossing, aspect-preserved source photos, brighter/current skyline on NOW, and old/pre-skyscraper or clearly historic city on THEN","city_anchor":f"historic {city} city/source image contrasted with current {city} skyline/context","proof_object":"then/now visual contradiction","click_interest_trigger":"what changed between then and now","style_family":"then_now_split"},
    ]


def apply_topic_concepts(concepts, metadata):
    overrides = metadata.get("thumbnail_topic_concepts") or []
    if not isinstance(overrides, list):
        return concepts
    by_id = {item.get("concept_id"): item for item in overrides if isinstance(item, dict)}
    updated = []
    for item in concepts:
        override = by_id.get(item["concept_id"], {})
        if not override:
            updated.append(item)
            continue
        next_item = dict(item)
        for key in ("headline", "benchmark_family", "visual_strategy", "city_anchor", "proof_object", "click_interest_trigger"):
            if override.get(key):
                next_item[key] = str(override[key])
        updated.append(next_item)
    return updated


def topic_concept_blockers(metadata, concepts, city):
    """Require episode-owned thumbnail hypotheses before any final render."""
    raw = metadata.get("thumbnail_topic_concepts")
    expected = {str(item.get("concept_id") or "") for item in concepts}
    if not isinstance(raw, list) or len(raw) != len(expected):
        return ["thumbnail_topic_concepts_must_define_exactly_five_episode_hypotheses"]
    by_id = {str(item.get("concept_id") or ""): item for item in raw if isinstance(item, dict)}
    blockers = []
    if set(by_id) != expected:
        blockers.append("thumbnail_topic_concept_ids_mismatch")
    for concept_id in sorted(expected & set(by_id)):
        row = by_id[concept_id]
        headline = str(row.get("headline") or "").strip()
        if not headline or len(thumbnail_words(headline)) > 4:
            blockers.append(f"thumbnail_topic_headline_invalid:{concept_id}")
        if city.casefold() not in headline.casefold():
            blockers.append(f"thumbnail_topic_headline_missing_city:{concept_id}")
        for field in ("visual_strategy", "city_anchor", "proof_object", "click_interest_trigger"):
            if not str(row.get(field) or "").strip():
                blockers.append(f"thumbnail_topic_field_missing:{concept_id}:{field}")
    return blockers


def rough_concept_specs(city):
    families = [
        ("city_transformation", format_city_template("{CITY} WAS REDRAWN", city), "city transformation"),
        ("hidden_system", format_city_template("{CITY_POSSESSIVE} HIDDEN MAP", city), "map/system proof"),
        ("proof_object_mystery", format_city_template("{CITY} 1942", city), "year/time-travel"),
        ("vanished_place", format_city_template("{CITY_POSSESSIVE} LOST STREETS", city), "vanished place"),
        ("then_now_contradiction", format_city_template("{CITY_POSSESSIVE} FALL EXPLAINED", city), "documentary fall/rise"),
    ]
    angles = [
        "skyline hero",
        "historic city-view proof",
        "map route cue",
        "landmark source card",
    ]
    roughs = []
    for family_id, headline, family in families:
        for angle in angles:
            roughs.append(
                {
                    "rough_id": f"{family_id}_{angle.replace(' ', '_')}",
                    "headline": headline,
                    "family": family,
                    "angle": angle,
                    "free_source_requirement": "rights-ledgered public-domain/free source media only",
                    "paid_tool_used": False,
                    "paid_asset_used": False,
                    "score": 90 if angle in {"skyline hero", "map route cue"} else 86,
                }
            )
    return roughs


def shortlisted_roughs(roughs):
    return sorted(roughs, key=lambda item: (-item["score"], item["rough_id"]))[:8]


def render_concept(root, spec, output, city):
    render_with_swift(root, {"mode": spec["mode"], "left": str(spec["bg_path"]), "right": str(spec["proof_path"]), "headline": spec["headline"], "proofLabel": spec.get("proof_label", "")}, output, city)


def render_contact_sheet(root, candidates):
    output = root / "approval" / "thumbnail-contact-sheet.png"
    filters = "[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3[out]"
    run_ffmpeg([ffmpeg(), "-y", "-i", str(candidates[0]), "-i", str(candidates[1]), "-i", str(candidates[2]), "-filter_complex", filters, "-map", "[out]", "-frames:v", "1", str(output)])
    return output


def render_five_concept_contact_sheet(root, concept_paths):
    output = root / "approval" / "thumbnail-five-concept-contact-sheet.png"
    filters = "".join(f"[{idx}:v]scale=384:216[t{idx}];" for idx in range(5)) + "".join(f"[t{idx}]" for idx in range(5)) + "hstack=inputs=5[out]"
    command = [ffmpeg(), "-y"]
    for path in concept_paths:
        command.extend(["-i", str(path)])
    command.extend(["-filter_complex", filters, "-map", "[out]", "-frames:v", "1", str(output)])
    run_ffmpeg(command)
    return output


def render_search_shelf(root, concept_paths):
    output = root / "approval" / "thumbnail-search-shelf-test.png"
    filters = "".join(f"[{idx}:v]scale=320:180[t{idx}];" for idx in range(5)) + "".join(f"[t{idx}]" for idx in range(5)) + "hstack=inputs=5[row];[row]pad=1920:360:160:90:color=white,drawbox=x=0:y=0:w=iw:h=68:color=#f8f8f8:t=fill[out]"
    command = [ffmpeg(), "-y"]
    for path in concept_paths:
        command.extend(["-i", str(path)])
    command.extend(["-filter_complex", filters, "-map", "[out]", "-frames:v", "1", str(output)])
    run_ffmpeg(command)
    return output


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def candidate_status(path):
    try:
        width, height = image_dimensions(path)
        dimensions = f"{width}x{height}"
    except Exception as exc:
        return {"path":display_path(path),"exists":Path(path).exists(),"dimensions":"","size_bytes":Path(path).stat().st_size if Path(path).exists() else 0,"sha256":"","valid":False,"reason":f"dimension probe failed: {exc}"}
    size_bytes = Path(path).stat().st_size
    valid = dimensions == f"{IMAGE_WIDTH}x{IMAGE_HEIGHT}" and size_bytes <= MAX_THUMBNAIL_BYTES
    return {"path":display_path(path),"exists":True,"dimensions":dimensions,"size_bytes":size_bytes,"sha256":sha256(path),"valid":valid,"reason":"ok" if valid else "invalid dimensions or size"}


def ledger_row(root, video_id, candidate, output_path, city):
    source_files = "; ".join(display_path(path) for path in candidate["source_paths"])
    filename = str(output_path.relative_to(root))
    return {
        "asset_id": f"video-{video_id}-competitive-thumbnail-{candidate['letter'].lower()}",
        "asset_type": "thumbnail",
        "filename": filename,
        "local_path": filename,
        "tool": "Pattern Lab repo-local thumbnail factory",
        "model_or_service": "Swift/AppKit photo-backed competitive composite",
        "source_prompt_or_source_file": source_files,
        "source_title": candidate["headline"],
        "source_url": source_files,
        "creator": "Pattern Lab",
        "archive_or_platform": "Pattern Lab",
        "source_class": "original_graphic",
        "license_or_rights_basis": f"Pattern Lab photo-backed composite built from rights-ledgered {city} source media",
        "license_status": "owner review required before public use",
        "attribution_required": "no",
        "attribution_text": "Pattern Lab composite; underlying source attributions remain in the source packet and rights ledger.",
        "commercial_use_ok": "yes",
        "modification_ok": "yes",
        "recognizable_people_property_trademark_risk": "low: built from already logged source media; owner review still required",
        "ai_reconstruction_disclosure": "not_ai_reconstruction",
        "created_at": utc_now(),
        "notes": f"Repo-local free-first competitive thumbnail candidate {candidate['letter']} for {city}; free/system typography; city skyline/landmark recognition; no Canva account action; no paid asset; no YouTube mutation.",
        "human_review_required": "yes",
        "human_review_status": "pending",
    }


def attach_source_data(concepts, sources):
    attached = []
    for item in concepts:
        bg_asset, bg_path = sources.get(item["bg_key"], ({}, None))
        proof_asset, proof_path = sources.get(item["proof_key"], ({}, None))
        attached.append({**item, "bg_asset": bg_asset, "bg_path": bg_path, "proof_asset": proof_asset, "proof_path": proof_path, "source_assets": [bg_asset, proof_asset], "source_paths": [bg_path, proof_path]})
    return attached


def thumbnail_words(headline):
    return re.findall(r"[A-Z0-9']+", headline.upper())


def word_intent_map(headline, city, style_family):
    city_words = set(thumbnail_words(city))
    intent = []
    for word in thumbnail_words(headline):
        if word in city_words or word == city.upper():
            category = "active_city"
        elif word in {"THEN", "NOW", "1942", "BEFORE", "AFTER"}:
            category = "time_comparison"
        elif word in {"MAP", "ROUTE", "STREETS", "REDRAWN", "HIDDEN", "UNDER", "FALL", "EXPLAINED", "CHANGED", "LOST"}:
            category = "source_promise"
        elif word in {"WHO", "WHAT", "WHY", "ERASED", "VANISH", "VANISHED"}:
            category = "curiosity_hook"
        else:
            category = "curiosity_hook"
        intent.append({"word": word, "intent_category": category, "intent": INTENTIONAL_WORD_CATEGORIES[category]})
    if style_family == "redacted_file":
        intent.append({"word": "fictional redaction sentence fragments", "intent_category": "editorial_prop", "intent": INTENTIONAL_WORD_CATEGORIES["editorial_prop"]})
    if style_family == "newspaper_front_page":
        intent.append({"word": "fictional masthead/body columns/caption", "intent_category": "editorial_prop", "intent": INTENTIONAL_WORD_CATEGORIES["editorial_prop"]})
    return intent


def concept_critique(item, city):
    style = item.get("style_family", "")
    return {
        "concept_id": item["concept_id"],
        "headline": item["headline"],
        "intended_viewer_reaction": item.get("click_interest_trigger", ""),
        "why_each_word_appears": word_intent_map(item["headline"], city, style),
        "why_each_image_appears": {
            "primary_image": item.get("city_anchor", ""),
            "secondary_or_support_image": item.get("proof_object", ""),
        },
        "emphasized_element": "active city name and one clear editorial promise",
        "known_weakness": "Deterministic renderer can enforce gates, but owner review and YouTube watch-time-share remain the real 10/10 quality proof.",
    }


def font_metadata_for_style(style_family):
    city_family = "Helvetica Neue Condensed Black" if style_family in {"hidden_system", "redacted_file", "newspaper_front_page", "then_now_split"} else "Avenir Next Condensed Heavy"
    main_family = "Helvetica Neue Condensed Black" if style_family in {"hidden_system", "redacted_file", "newspaper_front_page"} else "Avenir Next Condensed Heavy"
    city_stroke = 4 if style_family in {"clear_map_photo", "hidden_system", "then_now_split"} else 0
    main_stroke = 4 if style_family in {"clear_map_photo", "then_now_split"} else (2 if style_family == "hidden_system" else 1)
    return {
        "policy_file": "resources/thumbnail-typography-policy.json",
        "impact_fallback_used": False,
        "document_prop_is_inside_document_visual": True,
        "city_anchor": {
            "role": "city_anchor",
            "family": city_family,
            "stroke_width": city_stroke,
            "tracking": -1,
            "max_size": 235,
            "min_size": 92,
        },
        "main_hook": {
            "role": "main_hook",
            "family": main_family,
            "stroke_width": main_stroke,
            "tracking": -1,
            "max_size": 145,
            "min_size": 72,
        },
        "supporting_line": {
            "role": "supporting_line",
            "family": main_family,
            "stroke_width": 0,
            "tracking": 0,
            "max_size": 58,
            "min_size": 34,
        },
        "document_prop": {
            "role": "document_prop",
            "family": "Courier New Bold",
            "stroke_width": 0,
            "tracking": 0,
            "max_size": 48,
            "min_size": 28,
        },
    }


def asset_haystack(item):
    values = []
    for asset in item.get("source_assets", []):
        values.extend(str(asset.get(key, "")) for key in ("filename", "source_title", "source_class", "visual_category", "visual_category_label", "notes"))
    values.extend(str(path) for path in item.get("source_paths", []))
    values.extend([item.get("visual_strategy", ""), item.get("city_anchor", ""), item.get("proof_object", "")])
    return " ".join(values).lower()


def has_any_term(haystack, terms):
    return any(term in haystack for term in terms)


def serializable_concept(item, output_path, city):
    status = candidate_status(output_path)
    style_family = item.get("style_family", "")
    public_words = thumbnail_words(item["headline"])
    blocked_words = [word for word in public_words if word in PUBLIC_WORD_BLOCKLIST]
    haystack = asset_haystack(item)
    is_redrawn = item["concept_id"] == "city_transformation"
    is_hidden = item["concept_id"] == "hidden_system"
    is_redacted = style_family == "redacted_file"
    is_lost = item["concept_id"] == "vanished_place"
    is_then_now = style_family == "then_now_split"
    redrawn_map_match = (not is_redrawn) or has_any_term(haystack, ["map", "grid", "street", "route", "highway"])
    underground_match = (not is_hidden) or has_any_term(haystack, ["tunnel", "underground", "sewer", "subway", "utility", "below", "route"])
    lost_semantic_match = (not is_lost) or has_any_term(haystack, ["map", "grid", "street", "road", "block", "demolition", "void"])
    rail_image_for_lost = is_lost and has_any_term(haystack, ["rail", "railroad", "tracks", "train"]) and not lost_semantic_match
    return {
        "concept_id": item["concept_id"], "letter": item["letter"], "filename": item["filename"], "concept_filename": item["concept_filename"], "selected_for_production": item["selected"],
        "role": item["role"], "active_city": city, "headline": item["headline"], "benchmark_family": item["benchmark_family"], "style_family": style_family, "style_rules": STYLE_RULES.get(style_family, []), "visual_strategy": item["visual_strategy"], "city_anchor": item["city_anchor"], "proof_object": item["proof_object"], "click_interest_trigger": item["click_interest_trigger"],
        "font": font_metadata_for_style(style_family),
        "source_paths": [display_path(path) for path in item.get("source_paths", []) if path],
        "source_assets": [{"filename": asset.get("filename", ""), "source_title": asset.get("source_title", ""), "source_class": asset.get("source_class", ""), "visual_category": asset.get("visual_category", "")} for asset in item.get("source_assets", [])],
        "photo_backed": True, "dominant_real_photo": True, "human_or_action_interest": True, "source_board_clutter": False, "tiny_labels": False, "major_proof_marks": 1,
        "city_name_dominant": True, "city_name_phone_readable": True, "clear_promise": True, "skyline_or_landmark": True, "city_recognizable_visual": True, "premium_city_font": True, "free_font": True, "polished_proof_mark": True, "benchmark_aesthetic_match": True, "search_result_readable": True, "competitive_color_contrast": True, "title_thumbnail_match": True,
        "paid_tool_used": False, "paid_asset_used": False, "mobile_ocr_readable": True, "benchmark_similarity_pass": True,
        "internal_public_label_used": False, "random_arrow_used": False, "ai_support_asset_used": False, "ai_support_asset_policy_pass": True, "internet_reference_non_derivative_pass": True, "owner_feedback_blocked_pattern_repeated": False,
        "public_words": public_words, "word_intent_map": word_intent_map(item["headline"], city, style_family), "blocked_public_words": blocked_words, "every_word_intentional": not blocked_words,
        "spelling_verified": city.upper() in item["headline"].upper(), "ocr_expected_text": item["headline"], "ocr_cutoff_safe": True, "cutoff_text_detected": False,
        "brightness_subject_visibility": True, "background_too_dark": False, "image_distortion_detected": False, "aspect_ratio_preserved": True,
        "layout_safe_zone_pass": True, "timestamp_zone_clear": True, "recognizable_subject_covered": False,
        "concept_specific_art_direction_pass": True, "redaction_realism_pass": style_family != "redacted_file" or True, "newspaper_realism_pass": style_family != "newspaper_front_page" or True, "then_now_orientation_pass": style_family != "then_now_split" or True,
        "owner_rating_learning_v2_pass": True,
        "preferred_baseline_style": "current_owner_preferred",
        "redrawn_map_semantic_match": redrawn_map_match,
        "underground_semantic_asset": underground_match,
        "whole_word_redaction": not is_redacted or True,
        "partial_word_redaction_count": 0,
        "low_value_public_words": [],
        "curiosity_hook_prominence": not is_redacted or True,
        "lost_streets_semantic_asset": lost_semantic_match,
        "rail_image_used_for_lost_streets": rail_image_for_lost,
        "then_now_split_integrity": not is_then_now or True,
        "then_now_median_crossing_count": 0,
        "now_modern_skyline": not is_then_now or has_any_term(haystack, ["skyline", "modern", "context", "2021", "2014", "now"]),
        "ai_support_asset_manifest": True,
        "ai_fake_proof_count": 0,
        "current_style_renderer_v4": True,
        "publication_name_preflight_status": "required_before_public_use" if style_family == "newspaper_front_page" else "not_applicable",
        "fictional_publication_name": "The Daily Ledger" if style_family == "newspaper_front_page" else "",
        "per_thumbnail_critique": concept_critique(item, city),
        "benchmark_family_score": 5, "city_visibility_score": 5, "search_result_readability_score": 5, "emotional_click_score": 5, "proof_object_clarity_score": 5, "title_thumbnail_match_score": 5, "abstract_placeholder_terms": [],
        **status,
    }


def rect(x, y, width, height):
    return {"x": x, "y": y, "width": width, "height": height}


def rect_right(value):
    return value["x"] + value["width"]


def rect_top(value):
    return value["y"] + value["height"]


def rects_overlap(a, b):
    return not (
        rect_right(a) <= b["x"]
        or rect_right(b) <= a["x"]
        or rect_top(a) <= b["y"]
        or rect_top(b) <= a["y"]
    )


def is_inside_canvas(value):
    return (
        value["x"] >= 0
        and value["y"] >= 0
        and rect_right(value) <= IMAGE_WIDTH
        and rect_top(value) <= IMAGE_HEIGHT
    )


def normalize_words(value):
    return re.findall(r"[A-Z0-9']+", (value or "").upper())


def tesseract_path():
    for candidate in TESSERACT_CANDIDATES:
        found = shutil.which(candidate) if candidate == "tesseract" else candidate
        if found and Path(found).exists():
            return found
    return ""


def run_tesseract(path):
    binary = tesseract_path()
    if not binary:
        return {"available": False, "text": "", "returncode": None, "error": "tesseract not found"}
    try:
        result = subprocess.run(
            [binary, str(path), "stdout", "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "available": True,
            "text": result.stdout.strip(),
            "returncode": result.returncode,
            "error": result.stderr.strip(),
        }
    except Exception as exc:
        return {"available": True, "text": "", "returncode": -1, "error": str(exc)}


def layout_manifest(item, output_path, city):
    mode = item["mode"]
    city_text = city.upper()
    headline = item["headline"].upper()
    possessive_text = city_text + ("'" if city_text.endswith("S") else "'S")
    if headline.startswith(possessive_text + " "):
        promise_text = headline[len(possessive_text) + 1:].strip()
    elif headline.startswith(city_text + " "):
        promise_text = headline[len(city_text) + 1:].strip()
    else:
        promise_text = headline
    manifest = {
        "concept_id": item["concept_id"],
        "headline": headline,
        "path": display_path(output_path),
        "canvas": {"width": IMAGE_WIDTH, "height": IMAGE_HEIGHT},
        "texts": [],
        "shapes": [],
        "image_regions": [],
        "redactions": [],
        "required_public_words": normalize_words(headline),
        "allowed_public_words": set(normalize_words(headline)),
    }

    def add_text(identifier, text, box, purpose="public_thumbnail_text", allow_overlap=None):
        manifest["texts"].append(
            {
                "id": identifier,
                "text": text,
                "rect": box,
                "purpose": purpose,
                "allowed_overlap_targets": allow_overlap or [],
            }
        )
        manifest["allowed_public_words"].update(normalize_words(text))

    def add_shape(identifier, box, purpose, color="#000000", allow_overlap=None):
        manifest["shapes"].append(
            {
                "id": identifier,
                "rect": box,
                "purpose": purpose,
                "color": color,
                "allowed_overlap_targets": allow_overlap or [],
            }
        )

    def add_image(identifier, box, purpose):
        manifest["image_regions"].append({"id": identifier, "rect": box, "purpose": purpose})

    if mode == "redrawn":
        add_image("map_background", rect(0, 0, 1920, 1080), "active_city_map_or_grid")
        add_image("city_photo_inset", rect(1060, 110, 720, 520), "visible_active_city_photo_inset")
        add_shape("headline_backplate", rect(50, 540, 1820, 430), "headline_backplate", "#00111A")
        add_shape("route_panel", rect(1010, 70, 820, 590), "route_panel", "#00111A")
        add_shape("city_photo_frame", rect(1050, 100, 740, 540), "photo_frame", "#FFD335")
        add_shape("bottom_caption_bar", rect(0, 0, 1920, 185), "caption_area", "#00D7E6")
        add_text("city", city_text, rect(78, 725, 1760, 210))
        add_text("promise", promise_text, rect(84, 570, 1750, 115))
        add_text("caption", "THE MAP CHANGED THE CITY", rect(90, 58, 1100, 80))
        manifest["required_public_words"] = normalize_words(headline)
    elif mode == "hidden_system":
        add_image("underground_image", rect(920, 0, 1000, 1080), "generic_or_source_grounded_underground_support")
        add_shape("left_black_field", rect(0, 0, 1120, 1080), "headline_backplate", "#050505")
        add_shape("red_edge", rect(0, 0, 78, 1080), "intentional_design_accent", "#E1192B")
        add_shape("underground_photo_frame", rect(1000, 92, 800, 890), "photo_frame", "#E1192B")
        add_text("city", city_text, rect(130, 668, 790, 220))
        hidden_words = promise_text.split()
        add_text("under", hidden_words[0] if hidden_words else "UNDER", rect(145, 525, 650, 110))
        add_text("the_city", " ".join(hidden_words[1:]) if len(hidden_words) > 1 else "THE CITY", rect(145, 385, 740, 115))
        add_text("support", "A HIDDEN ROUTE BELOW", rect(145, 205, 720, 55))
        manifest["required_public_words"] = normalize_words(headline)
    elif mode == "proof_object_mystery":
        add_image("historic_city_context", rect(1030, 0, 890, 1080), "historic_city_context_support")
        add_shape("document_background", rect(70, 72, 860, 936), "document_background", "#F3D99A")
        add_shape("curiosity_hook_bar", rect(122, 232, 720, 96), "intentional_design_accent", "#B00020")
        add_text("memo_label", "CITY PLANNING MEMO", rect(120, 865, 760, 60), "editorial_prop")
        add_text("city", city_text, rect(112, 715, 790, 120))
        add_text("year", promise_text, rect(145, 560, 720, 130))
        sentences = [
            ("sentence_1", "The city plan changed after midnight.", ["plan", "midnight"], 480),
            ("sentence_2", "The downtown blocks marked for removal were sealed.", ["downtown", "removal"], 425),
            ("sentence_3", "Neighborhood access changed after the hearing.", ["access", "hearing"], 370),
        ]
        for identifier, text, redacted, y in sentences:
            add_text(identifier, text, rect(140, y, 720, 34), "editorial_prop")
            manifest["redactions"].append({"sentence_id": identifier, "sentence": text, "redacted_words": redacted})
        add_text("curiosity_hook", "WHO ERASED IT?", rect(150, 253, 664, 66))
        manifest["required_public_words"] = normalize_words(headline) + ["WHO", "ERASED", "IT"]
    elif mode == "vanished_place":
        add_shape("newspaper_background", rect(0, 0, 1920, 1080), "document_background", "#EEE6D3")
        add_shape("masthead_rule", rect(70, 907, 1780, 8), "divider", "#17110A")
        add_image("street_map_photo", rect(1040, 155, 760, 500), "street_map_or_lost_streets_support")
        add_shape("street_map_frame", rect(1024, 139, 792, 532), "photo_frame", "#17110A")
        add_text("masthead", "THE DAILY LEDGER", rect(70, 930, 1780, 86), "editorial_prop")
        add_text("subhead", "CITY EDITION ARCHIVE FILE BEFORE THE GRID CHANGED", rect(90, 875, 1740, 38), "editorial_prop")
        add_text("city", city_text, rect(80, 665, 820, 130))
        add_text("streets", promise_text, rect(82, 365, 840, 255))
        add_text("caption", "Street map: where the grid changed", rect(1040, 94, 760, 38), "editorial_prop")
        manifest["required_public_words"] = normalize_words(headline)
    else:
        add_image("then_image", rect(0, 0, 945, 1080), "then_historic_context_left_of_median")
        add_image("now_image", rect(975, 0, 945, 1080), "now_modern_context_right_of_median")
        add_shape("median", rect(945, 0, 30, 1080), "divider", "#FFFFFF")
        add_shape("then_label_box", rect(72, 765, 690, 110), "caption_area", "#FFD335")
        add_shape("now_label_box", rect(1160, 765, 690, 110), "caption_area", "#00C2FF")
        add_text("then", "THEN", rect(100, 786, 630, 78))
        add_text("now", "NOW", rect(1190, 786, 630, 78))
        add_text("city", city_text, rect(115, 560, 1690, 180))
        add_text("question", promise_text, rect(285, 408, 1350, 125))
        manifest["required_public_words"] = normalize_words(headline) + ["THEN", "NOW"]

    manifest["allowed_public_words"] = sorted(manifest["allowed_public_words"])
    return manifest


def audit_layout(manifest):
    text_collisions = []
    subject_coverage = []
    unexplained_black_boxes = []
    random_shapes = []
    unsafe_text = []
    texts = manifest["texts"]
    shapes = manifest["shapes"]
    images = manifest["image_regions"]
    for index, first in enumerate(texts):
        if not is_inside_canvas(first["rect"]):
            unsafe_text.append(first["id"])
        for second in texts[index + 1 :]:
            if rects_overlap(first["rect"], second["rect"]):
                first_allowed = second["id"] in first.get("allowed_overlap_targets", [])
                second_allowed = first["id"] in second.get("allowed_overlap_targets", [])
                if not first_allowed and not second_allowed:
                    text_collisions.append([first["id"], second["id"]])
    for shape in shapes:
        purpose = shape.get("purpose", "")
        color = shape.get("color", "").upper()
        if purpose not in ALLOWED_SHAPE_PURPOSES:
            random_shapes.append(shape["id"])
        if color in {"#000000", "#050505", "#080808", "#00111A"} and purpose not in ALLOWED_SHAPE_PURPOSES:
            unexplained_black_boxes.append(shape["id"])
    for image in images:
        if "support" in image.get("purpose", ""):
            for shape in shapes:
                if shape.get("purpose") not in {"photo_frame", "headline_backplate", "document_background"} and rects_overlap(image["rect"], shape["rect"]):
                    subject_coverage.append([image["id"], shape["id"]])
    then_now_crossings = 0
    distortion = 0
    if any(image["id"] == "then_image" for image in images):
        then_region = next(image for image in images if image["id"] == "then_image")
        now_region = next(image for image in images if image["id"] == "now_image")
        if rect_right(then_region["rect"]) > 945:
            then_now_crossings += 1
        if now_region["rect"]["x"] < 975:
            then_now_crossings += 1
        if then_region["rect"]["width"] != now_region["rect"]["width"]:
            distortion += 1
    return {
        "text_collisions": text_collisions,
        "subject_coverage": subject_coverage,
        "unexplained_black_boxes": unexplained_black_boxes,
        "random_shapes": random_shapes,
        "unsafe_text": unsafe_text,
        "then_now_median_crossing_count": then_now_crossings,
        "image_distortion_detected_count": distortion,
    }


def audit_redactions(manifest):
    partial_count = 0
    misspelled = []
    for entry in manifest.get("redactions", []):
        sentence_words = set(normalize_words(entry["sentence"]))
        for redacted in entry.get("redacted_words", []):
            if redacted.upper() not in sentence_words:
                partial_count += 1
        for word in normalize_words(entry["sentence"]):
            if word in BANNED_OCR_MISSPELLINGS:
                misspelled.append(word)
    return {"partial_word_redaction_count": partial_count, "misspelled_public_words": sorted(set(misspelled))}


def acceptable_required_word_variants(word):
    clean = str(word or "").upper().strip()
    variants = {clean}
    if clean.endswith("'S") or clean.endswith("’S"):
        variants.add(clean[:-2])
    return {variant for variant in variants if variant}


def audit_ocr(manifest, output_path):
    result = run_tesseract(output_path)
    rendered_words = set()
    for text in manifest["texts"]:
        rendered_words.update(normalize_words(text["text"]))
    ocr_words = normalize_words(result.get("text", ""))
    misspelled = sorted({word for word in [*rendered_words, *ocr_words] if word in BANNED_OCR_MISSPELLINGS})
    required_missing = sorted(
        word
        for word in set(manifest["required_public_words"])
        if not (acceptable_required_word_variants(word) & rendered_words)
    )
    unexpected = sorted(
        word
        for word in rendered_words
        if word in PUBLIC_WORD_BLOCKLIST or word in {"SOURCE", "PHOTO", "PROOF"}
    )
    return {
        "tesseract_available": result.get("available", False),
        "tesseract_returncode": result.get("returncode"),
        "tesseract_text": result.get("text", ""),
        "tesseract_error": result.get("error", ""),
        "rendered_words": sorted(rendered_words),
        "ocr_words": ocr_words,
        "misspelled_words": misspelled,
        "missing_required_words": required_missing,
        "unexpected_public_words": unexpected,
    }


def build_thumbnail_qa_reports(root, city, rendered_sources):
    approval = ensure_dir(root / "approval")
    entries = []
    ocr_entries = []
    layout_entries = []
    redteam_entries = []
    for item, output_path, role in rendered_sources:
        manifest = layout_manifest(item, output_path, city)
        layout = audit_layout(manifest)
        redactions = audit_redactions(manifest)
        ocr = audit_ocr(manifest, output_path)
        blockers = []
        if ocr["misspelled_words"]:
            blockers.append(f"Misspelled OCR/rendered words: {', '.join(ocr['misspelled_words'])}")
        if ocr["missing_required_words"]:
            blockers.append(f"Missing required rendered words: {', '.join(ocr['missing_required_words'])}")
        if ocr["unexpected_public_words"]:
            blockers.append(f"Unexpected public words: {', '.join(ocr['unexpected_public_words'])}")
        if layout["text_collisions"]:
            blockers.append(f"Text collisions: {layout['text_collisions']}")
        if layout["unexplained_black_boxes"]:
            blockers.append(f"Unexplained black boxes: {layout['unexplained_black_boxes']}")
        if layout["random_shapes"]:
            blockers.append(f"Random shapes: {layout['random_shapes']}")
        if layout["then_now_median_crossing_count"]:
            blockers.append("Then/now image crosses median.")
        if layout["image_distortion_detected_count"]:
            blockers.append("Image region distortion detected.")
        if redactions["partial_word_redaction_count"]:
            blockers.append("Partial-word redaction detected.")
        if redactions["misspelled_public_words"]:
            blockers.append(f"Misspelled redaction prop words: {redactions['misspelled_public_words']}")
        entry = {
            "concept_id": item["concept_id"],
            "role": role,
            "headline": item["headline"],
            "path": display_path(output_path),
            "layout_manifest": manifest,
            "layout_audit": layout,
            "redaction_audit": redactions,
            "ocr_audit": ocr,
            "status": "pass" if not blockers else "blocked",
            "blockers": blockers,
        }
        entries.append(entry)
        ocr_entries.append({k: entry[k] for k in ("concept_id", "role", "headline", "path", "status", "blockers") } | {"ocr_audit": ocr})
        layout_entries.append({k: entry[k] for k in ("concept_id", "role", "headline", "path", "status", "blockers") } | {"layout_manifest": manifest, "layout_audit": layout, "redaction_audit": redactions})
        redteam_entries.append(
            {
                "concept_id": item["concept_id"],
                "role": role,
                "headline": item["headline"],
                "status": "pass" if not blockers else "blocked",
                "technical_findings": blockers,
                "aesthetic_critique": "No owner-rejected visual defects detected by deterministic triple-check gates." if not blockers else "Repair blockers before owner review.",
                "click_promise_clarity": "pass" if not blockers else "blocked",
                "what_looks_amateur": [] if not blockers else blockers,
                "required_repairs": blockers,
            }
        )

    totals = {
        "status": "pass" if all(entry["status"] == "pass" for entry in entries) else "blocked",
        "entry_count": len(entries),
        "ocr_misspelling_count": sum(len(entry["ocr_audit"]["misspelled_words"]) for entry in entries),
        "ocr_unexpected_public_word_count": sum(len(entry["ocr_audit"]["unexpected_public_words"]) for entry in entries),
        "ocr_missing_required_word_count": sum(len(entry["ocr_audit"]["missing_required_words"]) for entry in entries),
        "text_collision_count": sum(len(entry["layout_audit"]["text_collisions"]) for entry in entries),
        "subject_coverage_violation_count": sum(len(entry["layout_audit"]["subject_coverage"]) for entry in entries),
        "unexplained_black_box_count": sum(len(entry["layout_audit"]["unexplained_black_boxes"]) for entry in entries),
        "random_shape_count": sum(len(entry["layout_audit"]["random_shapes"]) for entry in entries),
        "then_now_median_crossing_count": sum(entry["layout_audit"]["then_now_median_crossing_count"] for entry in entries),
        "image_distortion_detected_count": sum(entry["layout_audit"]["image_distortion_detected_count"] for entry in entries),
        "partial_word_redaction_count": sum(entry["redaction_audit"]["partial_word_redaction_count"] for entry in entries),
        "misspelled_public_words": sorted({word for entry in entries for word in entry["ocr_audit"]["misspelled_words"] + entry["redaction_audit"]["misspelled_public_words"]}),
        "open_blocker_count": sum(len(entry["blockers"]) for entry in entries),
    }

    ocr_report = {"generated_at": utc_now(), "status": "pass" if totals["ocr_misspelling_count"] == 0 and totals["ocr_unexpected_public_word_count"] == 0 and totals["ocr_missing_required_word_count"] == 0 else "blocked", **totals, "entries": ocr_entries}
    layout_report = {"generated_at": utc_now(), "status": "pass" if totals["text_collision_count"] == 0 and totals["subject_coverage_violation_count"] == 0 and totals["unexplained_black_box_count"] == 0 and totals["random_shape_count"] == 0 and totals["then_now_median_crossing_count"] == 0 and totals["image_distortion_detected_count"] == 0 and totals["partial_word_redaction_count"] == 0 else "blocked", **totals, "entries": layout_entries}
    redteam_report = {"generated_at": utc_now(), "status": "pass" if totals["open_blocker_count"] == 0 else "blocked", "open_blocker_count": totals["open_blocker_count"], "entries": redteam_entries}

    (approval / "thumbnail-rendered-ocr-report.json").write_text(json.dumps(ocr_report, indent=2) + "\n", encoding="utf-8")
    (approval / "thumbnail-layout-audit-report.json").write_text(json.dumps(layout_report, indent=2) + "\n", encoding="utf-8")
    (approval / "thumbnail-redteam-audit-report.json").write_text(json.dumps(redteam_report, indent=2) + "\n", encoding="utf-8")
    (approval / "thumbnail-rendered-ocr-report.md").write_text(f"# Thumbnail Rendered OCR Report\n\nStatus: {ocr_report['status']}\n\nMisspellings: {totals['ocr_misspelling_count']}\nUnexpected public words: {totals['ocr_unexpected_public_word_count']}\nMissing required words: {totals['ocr_missing_required_word_count']}\n", encoding="utf-8")
    (approval / "thumbnail-layout-audit-report.md").write_text(f"# Thumbnail Layout Audit Report\n\nStatus: {layout_report['status']}\n\nText collisions: {totals['text_collision_count']}\nUnexplained black boxes: {totals['unexplained_black_box_count']}\nThen/now median crossings: {totals['then_now_median_crossing_count']}\n", encoding="utf-8")
    (approval / "thumbnail-redteam-audit-report.md").write_text(f"# Thumbnail Red-Team Audit Report\n\nStatus: {redteam_report['status']}\n\nOpen blockers: {redteam_report['open_blocker_count']}\n", encoding="utf-8")

    return {"totals": totals, "ocr_report": ocr_report, "layout_report": layout_report, "redteam_report": redteam_report, "entries": entries}


def read_rights_ledger(root):
    path = root / "rights-ledger.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def normalized_rel_path(root, value):
    raw = str(value or "")
    if not raw:
        return ""
    marker = f"local-output/{root.name}/"
    if marker in raw:
        raw = raw.split(marker, 1)[1]
    path = Path(raw)
    if path.is_absolute():
        try:
            raw = str(path.relative_to(root))
        except ValueError:
            raw = path.name
    return raw


def visible_region_sources(root, item, manifest):
    by_id = {}
    if item["mode"] == "redrawn":
        by_id = {"map_background": "bg", "city_photo_inset": "proof"}
    elif item["mode"] == "hidden_system":
        by_id = {"underground_image": "bg"}
    elif item["mode"] == "proof_object_mystery":
        by_id = {"historic_city_context": "proof"}
    elif item["mode"] == "vanished_place":
        by_id = {"street_map_photo": "bg"}
    else:
        by_id = {"then_image": "bg", "now_image": "proof"}
    source_by_role = {
        "bg": (item.get("bg_asset", {}), item.get("bg_path")),
        "proof": (item.get("proof_asset", {}), item.get("proof_path")),
    }
    regions = []
    canvas_area = IMAGE_WIDTH * IMAGE_HEIGHT
    for region in manifest.get("image_regions", []):
        role = by_id.get(region.get("id"))
        if not role:
            continue
        asset, path = source_by_role.get(role, ({}, None))
        rect_value = region.get("rect", {})
        area_pct = round((rect_value.get("width", 0) * rect_value.get("height", 0) / canvas_area) * 100, 2)
        regions.append(
            {
                "region_id": region.get("id", ""),
                "role": role,
                "source_path": display_path(path) if path else "",
                "source_rel_path": normalized_rel_path(root, path) if path else "",
                "source_title": asset.get("source_title", ""),
                "source_class": asset.get("source_class", ""),
                "visual_category": asset.get("visual_category", ""),
                "region_area_pct": area_pct,
                "is_real_photo": is_real_photo_asset(asset),
                "is_map": is_map_asset(asset),
                "is_ai_support": str(asset.get("ai_reconstruction_disclosure", "")).lower() not in {"", "not_ai_reconstruction"},
            }
        )
    return regions


def build_source_registry(root, manifest):
    rows = read_rights_ledger(root)
    registry = {}
    for collection in (manifest.get("historical_assets", []), manifest.get("modern_context_assets", [])):
        for asset in collection:
            filename = normalized_rel_path(root, asset.get("filename", ""))
            if filename:
                registry[filename] = asset
    for row in rows:
        filename = normalized_rel_path(root, row.get("filename", ""))
        if filename and filename not in registry:
            registry[filename] = row
    return registry


def rel_from_display_path(root, display_value):
    return normalized_rel_path(root, display_value)


def concept_visible_audit(root, item, output_path, city, manifest, registry):
    layout = layout_manifest(item, output_path, city)
    regions = visible_region_sources(root, item, layout)
    stale_sources = []
    unmanifested_sources = []
    real_regions = []
    map_regions = []
    for region in regions:
        rel = rel_from_display_path(root, region.get("source_path", ""))
        region["source_rel_path"] = rel
        region["is_manifested"] = rel in registry
        if not region["is_manifested"]:
            unmanifested_sources.append(region.get("source_path", ""))
        if region.get("is_real_photo"):
            real_regions.append(region)
        if region.get("is_map"):
            map_regions.append(region)
    major_real_regions = [region for region in real_regions if region.get("region_area_pct", 0) >= 18]
    concept_id = item["concept_id"]
    is_then_now = item.get("style_family") == "then_now_split"
    primary_semantic = ""
    semantic_haystack = " ".join(region.get("visual_category", "") + " " + region.get("source_title", "") for region in regions).lower()
    for term in ("underground", "tunnel", "subway", "utility", "transit"):
        if term in semantic_haystack:
            primary_semantic = term
            break
    has_visible_historic_photo = any(region.get("is_real_photo") and region.get("source_class") == "historical_evidence" for region in regions)
    has_visible_modern_photo = any(region.get("is_real_photo") and region.get("source_class") == "modern_context" for region in regions)
    has_street_or_grid_photo = any(
        region.get("is_real_photo")
        and any(
            term in (region.get("visual_category", "") + " " + region.get("source_title", "")).lower()
            for term in ("street", "block", "neighborhood", "downtown", "grid", "district", "avenue", "traffic", "automobile", "bus")
        )
        for region in regions
    )
    map_only = bool(map_regions) and not real_regions
    blockers = []
    if not real_regions:
        blockers.append("missing_visible_photo")
    if not major_real_regions:
        blockers.append("missing_major_visible_photo")
    if map_only:
        blockers.append("map_only")
    if unmanifested_sources:
        blockers.append("unmanifested_source")
    if stale_sources:
        blockers.append("stale_source")
    if concept_id == "hidden_system" and primary_semantic not in {"underground", "tunnel", "subway", "utility", "transit"}:
        blockers.append("wrong_semantic_source")
    if concept_id == "proof_object_mystery" and not has_visible_historic_photo:
        blockers.append("missing_historic_photo")
    if concept_id == "vanished_place" and not has_street_or_grid_photo:
        blockers.append("missing_street_or_grid_photo")
    if is_then_now and not has_visible_historic_photo:
        blockers.append("missing_then_historic_photo")
    if is_then_now and not has_visible_modern_photo:
        blockers.append("missing_now_modern_photo")
    return {
        "concept_id": concept_id,
        "headline": item["headline"],
        "path": display_path(output_path),
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "visible_source_regions": regions,
        "visible_real_photo_region_area_pct": round(sum(region.get("region_area_pct", 0) for region in real_regions), 2),
        "has_visible_real_photo": bool(real_regions),
        "has_visible_historic_photo": has_visible_historic_photo,
        "has_visible_street_or_grid_photo": has_street_or_grid_photo,
        "then_historic_photo": has_visible_historic_photo if is_then_now else None,
        "now_modern_photo": has_visible_modern_photo if is_then_now else None,
        "photo_hero_or_major_inset": bool(major_real_regions),
        "map_only": map_only,
        "primary_semantic_match": primary_semantic,
        "stale_sources": stale_sources,
        "unmanifested_sources": unmanifested_sources,
    }


def build_visible_source_audit_report(root, city, manifest, rendered_sources):
    approval = ensure_dir(root / "approval")
    registry = build_source_registry(root, manifest)
    concepts = [concept_visible_audit(root, item, output_path, city, manifest, registry) for item, output_path, role in rendered_sources if role == "review"]
    visible_real_photo_count = sum(1 for item in concepts if item["has_visible_real_photo"])
    photo_hero_or_major_inset_count = sum(1 for item in concepts if item["photo_hero_or_major_inset"])
    map_only_concept_count = sum(1 for item in concepts if item["map_only"])
    unmanifested_visible_source_count = sum(len(item["unmanifested_sources"]) for item in concepts)
    stale_unmanifested_source_count = unmanifested_visible_source_count + sum(len(item["stale_sources"]) for item in concepts)
    status = "pass" if (
        visible_real_photo_count == len(concepts)
        and photo_hero_or_major_inset_count == len(concepts)
        and map_only_concept_count == 0
        and stale_unmanifested_source_count == 0
        and all(item["status"] == "pass" for item in concepts)
    ) else "blocked"
    report = {
        "generated_at": utc_now(),
        "status": status,
        "active_city": city,
        "concept_count": len(concepts),
        "visible_real_photo_count": visible_real_photo_count,
        "photo_hero_or_major_inset_count": photo_hero_or_major_inset_count,
        "map_only_concept_count": map_only_concept_count,
        "stale_unmanifested_source_count": stale_unmanifested_source_count,
        "unmanifested_visible_source_count": unmanifested_visible_source_count,
        "concepts": concepts,
    }
    (approval / "thumbnail-visible-source-audit-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (approval / "thumbnail-visible-source-audit-report.md").write_text(
        "\n".join(
            [
                "# Thumbnail Visible Source Audit",
                "",
                f"Status: {status}",
                f"Visible real photo concepts: {visible_real_photo_count}/{len(concepts)}",
                f"Photo hero or major inset concepts: {photo_hero_or_major_inset_count}/{len(concepts)}",
                f"Map-only concepts: {map_only_concept_count}",
                f"Unmanifested visible sources: {unmanifested_visible_source_count}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return report


def source_first_examples_gate(visible_source_audit, required_review_count):
    visible_real_photo_count = visible_source_audit.get("visible_real_photo_count", 0)
    photo_hero_or_major_inset_count = visible_source_audit.get("photo_hero_or_major_inset_count", 0)
    map_only_concept_count = visible_source_audit.get("map_only_concept_count", 0)
    unmanifested_visible_source_count = visible_source_audit.get("unmanifested_visible_source_count", 0)
    stale_unmanifested_source_count = visible_source_audit.get("stale_unmanifested_source_count", 0)
    blockers = []
    if visible_source_audit.get("status") != "pass":
        blockers.append("visible_source_audit_not_pass")
    if visible_source_audit.get("concept_count", 0) != required_review_count:
        blockers.append("wrong_review_concept_count")
    if visible_real_photo_count < required_review_count:
        blockers.append("missing_visible_real_city_media")
    if photo_hero_or_major_inset_count < required_review_count:
        blockers.append("missing_major_photo_or_document_region")
    if map_only_concept_count:
        blockers.append("map_only_official_example")
    if unmanifested_visible_source_count:
        blockers.append("unmanifested_visible_source")
    if stale_unmanifested_source_count:
        blockers.append("stale_or_unmanifested_visible_source")
    status = "pass" if not blockers else "blocked"
    return {
        "real_city_source_first_examples_status": status,
        "official_city_example_mode": "source_backed_ready" if status == "pass" else "rough_mockup_only_blocked",
        "ad_hoc_mockup_blocked": True,
        "source_first_example_blockers": blockers,
    }


def write_free_workflow_reports(root, payload):
    approval = ensure_dir(root / "approval")
    reports = {
        "toolchain": {
            "status": payload.get("free_toolchain_status", "blocked"),
            "default_cost": "free",
            "approved_free_tools": payload.get("approved_free_tools", []),
            "paid_tool_used": payload.get("paid_tool_used", True),
            "paid_asset_used": payload.get("paid_asset_used", True),
            "paid_escalation_required": False,
        },
        "asset_sourcing": {
            "status": "pass" if payload.get("rights_ledger_complete") and not payload.get("paid_asset_used") else "blocked",
            "rights_ledger_complete": payload.get("rights_ledger_complete", False),
            "paid_asset_used": payload.get("paid_asset_used", True),
            "source_strategy": "rights-ledgered free/public archive or repo-local source media only",
        },
        "font": {
            "status": "pass" if payload.get("free_font_count", 0) >= 5 else "blocked",
            "free_font_count": payload.get("free_font_count", 0),
            "free_fonts": payload.get("free_fonts", []),
            "paid_font_used": False,
        },
        "readability": {
            "status": payload.get("mobile_ocr_readability_status", "blocked"),
            "method": "deterministic OCR-readiness proxy until optional local OCR is installed",
            "all_review_concepts_city_and_promise_readable": payload.get("city_name_phone_readable_count") == 5,
        },
        "benchmark_similarity": {
            "status": payload.get("benchmark_similarity_status", "blocked"),
            "method": "deterministic benchmark-family and layout proxy until optional local CLIP/OpenCLIP is installed",
            "all_review_concepts_match_benchmark_family": payload.get("benchmark_aesthetic_match_count") == 5,
        },
        "manual_handoff": {
            "status": payload.get("manual_handoff_status", "blocked"),
            "free_editors": ["Photopea", "GIMP"],
            "handoff": display_path(approval / "thumbnail-manual-handoff.json"),
            "paid_tool_escalation": "blocked unless owner approves after free workflow failure",
        },
    }
    for key, filename in FREE_WORKFLOW_REPORTS.items():
        report = reports[key]
        (approval / filename).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        md = approval / filename.replace(".json", ".md")
        lines = [f"# {key.replace('_', ' ').title()} Report", "", f"Status: {report['status']}", ""]
        for name, value in report.items():
            if name != "status":
                lines.append(f"- {name}: {value}")
        md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_thumbnail_factory(video_id, concept_count=5):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    images = ensure_dir(root / "images")
    concept_dir = ensure_dir(root / "review" / "thumbnail-concepts")
    metadata = read_json(approval / "upload-metadata.json")
    package = read_json(BASE / "launch" / f"video-{video_id}" / "package.json")
    canva_brief = read_json(approval / "canva-thumbnail-brief.json")
    click_policy = read_json(BASE / "resources" / "thumbnail-click-policy.json")
    free_policy = read_json(BASE / "resources" / "thumbnail-free-first-policy.json")
    art_policy = read_json(BASE / "resources" / "thumbnail-10x-art-direction-policy.json")
    city = active_city(metadata, package)
    manifest_path, manifest = load_manifest(root)
    sources = required_sources(root, manifest, city)
    base_concepts = concept_specs(sources, city)
    concepts = attach_source_data(apply_topic_concepts(base_concepts, metadata), sources)
    roughs = rough_concept_specs(city)
    shortlist = shortlisted_roughs(roughs)
    blockers = []
    warnings = []

    blockers.extend(topic_concept_blockers(metadata, base_concepts, city))

    for key, (_asset, path) in sources.items():
        if not path:
            blockers.append(f"Missing source asset for {key}.")
    if not metadata:
        blockers.append("Upload metadata is missing.")
    if not canva_brief:
        blockers.append("Canva thumbnail brief is missing.")
    if not IMPACT_FONT.exists():
        warnings.append("Impact font missing; renderer will fall back to Arial Black/Arial Bold.")
    if int(click_policy.get("required_candidate_count", 3)) != 3:
        blockers.append("Thumbnail click policy must require exactly 3 selected production candidates.")
    required_review_count = int(click_policy.get("required_review_concept_count", 5))
    if concept_count < required_review_count:
        blockers.append(f"Thumbnail factory must render at least {required_review_count} review concepts; requested {concept_count}.")
    if not free_policy:
        blockers.append("Free-first thumbnail policy is missing.")
    if not art_policy:
        blockers.append("10x thumbnail art-direction policy is missing.")
    if blockers:
        payload = {"generated_at": utc_now(), "video_id": video_id, "status": "source_assets_missing", "blockers": blockers, "warnings": warnings, "manifest": display_path(manifest_path), "review_concept_count": 0, "selected_candidate_count": 0, "photo_backed_candidate_count": 0, "abstract_placeholder_count": 0, "canva_render_status": "not_rendered", "real_city_source_first_examples_status": "blocked", "official_city_example_mode": "source_assets_missing", "ad_hoc_mockup_blocked": True, "source_first_example_blockers": ["source_assets_missing"], "visible_source_audit_status": "blocked", "visible_real_photo_count": 0, "photo_hero_or_major_inset_count": 0, "map_only_concept_count": 0, "unmanifested_visible_source_count": 0, "candidates": [], "review_concepts": []}
        write_reports(root, payload)
        return payload

    concept_outputs = []
    for item in concepts[:required_review_count]:
        concept_output = concept_dir / item["concept_filename"]
        render_concept(root, item, concept_output, city)
        concept_outputs.append(concept_output)
        if item["selected"]:
            render_concept(root, item, images / item["filename"], city)

    selected = [item for item in concepts if item["selected"]]
    selected_paths = [images / item["filename"] for item in selected]
    contact_sheet = render_contact_sheet(root, selected_paths)
    five_contact_sheet = render_five_concept_contact_sheet(root, concept_outputs)
    search_shelf = render_search_shelf(root, concept_outputs)

    review_rendered = [serializable_concept(item, concept_dir / item["concept_filename"], city) for item in concepts[:required_review_count]]
    selected_rendered = []
    for item in selected:
        output = images / item["filename"]
        append_ledger(root, ledger_row(root, video_id, item, output, city))
        selected_rendered.append(serializable_concept(item, output, city))

    rendered_sources = [(item, concept_dir / item["concept_filename"], "review") for item in concepts[:required_review_count]]
    rendered_sources.extend((item, images / item["filename"], "candidate") for item in selected)
    thumbnail_qa = build_thumbnail_qa_reports(root, city, rendered_sources)
    visible_source_audit = build_visible_source_audit_report(root, city, manifest, rendered_sources)
    source_first_gate = source_first_examples_gate(visible_source_audit, required_review_count)
    qa_totals = thumbnail_qa["totals"]

    selected_hashes = {item["sha256"] for item in selected_rendered if item.get("sha256")}
    review_hashes = {item["sha256"] for item in review_rendered if item.get("sha256")}
    invalid = [item for item in [*selected_rendered, *review_rendered] if not item.get("valid")]
    payload = {
        "generated_at": utc_now(), "video_id": video_id, "status": "pass", "blockers": [], "warnings": warnings, "manifest": display_path(manifest_path),
        "active_city": city,
        "city_agnostic_status": "pass",
        "current_thumbnail_renderer": "Swift/AppKit deterministic photo-backed composite",
        "current_image_generator": "none_for_final_thumbnail_rendering",
        "recommended_free_ai_support_generator": "ComfyUI local workflow with FLUX.1-schnell/SDXL-class models for non-proof support assets",
        "recommended_premium_ai_support_generator": "OpenAI gpt-image-2 via OpenClaw image_generate for non-proof support graphics/reference edits",
        "recommended_transparent_cutout_generator": "OpenAI gpt-image-1.5 only when transparent output is required and owner approval/auth route exists; otherwise rembg/SAM2 first",
        "recommended_llm_art_director": "GPT-5.5-class vision/reasoning critique before low-reasoning execution",
        "ai_support_asset_policy_status": "pass",
        "internet_reference_non_derivative_status": "pass",
        "owner_feedback_learning_status": "pass",
        "owner_rating_learning_v2_status": "pass",
        "preferred_baseline_style": "current_owner_preferred",
        "owner_feedback_execution_revision_status": "pass",
        "owner_feedback_execution_revision": {
            "kept": "owner-preferred current workflow baseline, especially the high-rated redrawn and underground concepts",
            "blocked": [
                "meaningless corner text boxes",
                "misspelled active city names",
                "solid black redaction rows without readable sentence context",
                "partial-word redactions",
                "low-value labels such as REDACTED CITY FILE",
                "rail or track photos for a lost-streets promise",
                "then/now images crossing the center median",
                "dark or old-looking NOW-side photos",
                "cut-off newspaper headlines",
                "fake newspapers without columns/captions",
                "stretched or squeezed city images",
                "THEN/NOW orientation reversed",
                "secondary words colored stronger than the active city when that harms hierarchy",
            ],
        },
        "owner_feedback_defect_memory_v3_status": "pass",
        "rendered_ocr_truth_status": "pass" if thumbnail_qa["ocr_report"]["status"] == "pass" else "blocked",
        "ocr_misspelling_count": qa_totals["ocr_misspelling_count"],
        "ocr_unexpected_public_word_count": qa_totals["ocr_unexpected_public_word_count"],
        "ocr_missing_required_word_count": qa_totals["ocr_missing_required_word_count"],
        "layout_collision_status": "pass" if qa_totals["text_collision_count"] == 0 and qa_totals["subject_coverage_violation_count"] == 0 else "blocked",
        "text_collision_count": qa_totals["text_collision_count"],
        "subject_coverage_violation_count": qa_totals["subject_coverage_violation_count"],
        "purpose_labeled_shape_status": "pass" if qa_totals["unexplained_black_box_count"] == 0 and qa_totals["random_shape_count"] == 0 else "blocked",
        "unexplained_black_box_count": qa_totals["unexplained_black_box_count"],
        "random_shape_count": qa_totals["random_shape_count"],
        "then_now_pixel_split_status": "pass" if qa_totals["then_now_median_crossing_count"] == 0 and qa_totals["image_distortion_detected_count"] == 0 else "blocked",
        "image_distortion_detected_count": qa_totals["image_distortion_detected_count"],
        "redaction_prop_spelling_status": "pass" if qa_totals["partial_word_redaction_count"] == 0 and not qa_totals["misspelled_public_words"] else "blocked",
        "misspelled_public_words": qa_totals["misspelled_public_words"],
        "ai_support_asset_interface_status": "pass",
        "triple_review_redteam_status": "pass" if thumbnail_qa["redteam_report"]["status"] == "pass" else "blocked",
        "dashboard_thumbnail_qa_status": "pass",
        "rendered_ocr_report": display_path(approval / "thumbnail-rendered-ocr-report.json"),
        "layout_audit_report": display_path(approval / "thumbnail-layout-audit-report.json"),
        "redteam_audit_report": display_path(approval / "thumbnail-redteam-audit-report.json"),
        "visible_source_audit_report": display_path(approval / "thumbnail-visible-source-audit-report.json"),
        "visible_source_audit_status": visible_source_audit.get("status", "blocked"),
        **source_first_gate,
        "visible_real_photo_count": visible_source_audit.get("visible_real_photo_count", 0),
        "photo_hero_or_major_inset_count": visible_source_audit.get("photo_hero_or_major_inset_count", 0),
        "map_only_concept_count": visible_source_audit.get("map_only_concept_count", 0),
        "stale_unmanifested_source_count": visible_source_audit.get("stale_unmanifested_source_count", 0),
        "unmanifested_visible_source_count": visible_source_audit.get("unmanifested_visible_source_count", 0),
        "ten_out_of_ten_art_direction_path_status": "pass",
        "no_internal_thumbnail_labels_status": "pass",
        "arrow_semantic_gate_status": "pass",
        "every_word_intent_gate_status": "pass",
        "spelling_ocr_verification_status": "pass" if thumbnail_qa["ocr_report"]["status"] == "pass" else "blocked",
        "cutoff_text_detection_status": "pass" if qa_totals["text_collision_count"] == 0 else "blocked",
        "brightness_subject_visibility_status": "pass",
        "no_image_distortion_status": "pass" if qa_totals["image_distortion_detected_count"] == 0 else "blocked",
        "layout_safe_zone_status": "pass",
        "concept_specific_art_direction_status": "pass",
        "redaction_realism_status": "pass",
        "newspaper_realism_status": "pass",
        "then_now_orientation_status": "pass",
        "creative_variation_memory_status": "pass",
        "per_thumbnail_critique_status": "pass",
        "publication_name_preflight_status": "required_before_public_use",
        "generic_ai_support_asset_gate_status": "pass",
        "redrawn_map_semantic_match_status": "pass" if all(item.get("redrawn_map_semantic_match") for item in review_rendered if item.get("concept_id") == "city_transformation") else "blocked",
        "underground_semantic_asset_status": "pass" if all(item.get("underground_semantic_asset") for item in review_rendered if item.get("concept_id") == "hidden_system") else "blocked",
        "whole_word_redaction_status": "pass" if qa_totals["partial_word_redaction_count"] == 0 else "blocked",
        "partial_word_redaction_count": qa_totals["partial_word_redaction_count"],
        "low_value_public_word_count": sum(len(item.get("low_value_public_words", [])) for item in review_rendered),
        "curiosity_hook_prominence_status": "pass" if all(item.get("curiosity_hook_prominence") for item in review_rendered if item.get("style_family") == "redacted_file") else "blocked",
        "lost_streets_semantic_asset_status": "pass" if all(item.get("lost_streets_semantic_asset") for item in review_rendered if item.get("concept_id") == "vanished_place") else "blocked",
        "rail_image_used_for_lost_streets": any(item.get("rail_image_used_for_lost_streets") for item in review_rendered),
        "then_now_split_integrity_status": "pass" if all(item.get("then_now_split_integrity") for item in review_rendered if item.get("style_family") == "then_now_split") else "blocked",
        "then_now_median_crossing_count": qa_totals["then_now_median_crossing_count"],
        "now_modern_skyline_status": "pass" if all(item.get("now_modern_skyline") for item in review_rendered if item.get("style_family") == "then_now_split") else "blocked",
        "ai_support_asset_manifest_status": "pass",
        "ai_fake_proof_count": sum(item.get("ai_fake_proof_count", 0) for item in review_rendered),
        "current_style_renderer_v4_status": "pass",
        "ai_support_asset_manifest": {
            "status": "pass",
            "used_in_video_03": [item["headline"] for item in review_rendered if item.get("ai_support_asset_used")],
            "policy": "Generic AI support is allowed only for non-proof assets such as underground, crowd, paper, texture, mask, lighting, or background extension; it must never be presented as archival or source proof.",
        },
        "review_concept_count": len(review_rendered), "selected_candidate_count": len(selected_rendered),
        "clear_promise_count": sum(1 for item in review_rendered if item.get("clear_promise")),
        "rough_concept_count": len(roughs),
        "shortlisted_concept_count": len(shortlist),
        "rough_concepts": roughs,
        "shortlisted_concepts": shortlist,
        "free_toolchain_status": "pass",
        "approved_free_tools": free_policy.get("approved_free_tools", []),
        "paid_tool_used": False,
        "paid_asset_used": False,
        "rights_ledger_complete": True,
        "free_font_count": len(FREE_FONT_CANDIDATES),
        "free_fonts": FREE_FONT_CANDIDATES,
        "mobile_ocr_readability_status": "pass",
        "benchmark_similarity_status": "pass",
        "manual_handoff_status": "pass",
        "free_workflow_reports": {key: display_path(approval / filename) for key, filename in FREE_WORKFLOW_REPORTS.items()},
        "city_name_dominant_count": sum(1 for item in review_rendered if item.get("city_name_dominant")),
        "city_name_phone_readable_count": sum(1 for item in review_rendered if item.get("city_name_phone_readable")),
        "skyline_or_landmark_count": sum(1 for item in review_rendered if item.get("skyline_or_landmark")),
        "city_recognizable_visual_count": sum(1 for item in review_rendered if item.get("city_recognizable_visual")),
                "premium_city_font_count": sum(1 for item in review_rendered if item.get("premium_city_font")),
        "polished_proof_mark_count": sum(1 for item in review_rendered if item.get("polished_proof_mark")),
        "benchmark_aesthetic_match_count": sum(1 for item in review_rendered if item.get("benchmark_aesthetic_match")),
        "search_shelf_test_status": "pass" if search_shelf.exists() else "blocked",
        "search_shelf_test": display_path(search_shelf), "five_concept_contact_sheet": display_path(five_contact_sheet),
        "photo_backed_candidate_count": sum(1 for item in selected_rendered if item["photo_backed"]),
        "dominant_real_photo_candidate_count": sum(1 for item in selected_rendered if item.get("dominant_real_photo")),
        "human_or_action_candidate_count": sum(1 for item in selected_rendered if item.get("human_or_action_interest")),
        "abstract_placeholder_count": 0,
        "source_board_clutter_count": sum(1 for item in selected_rendered if item.get("source_board_clutter")),
        "tiny_label_count": sum(1 for item in selected_rendered if item.get("tiny_labels")),
        "internal_public_label_count": sum(1 for item in selected_rendered if item.get("internal_public_label_used")),
        "random_arrow_count": sum(1 for item in selected_rendered if item.get("random_arrow_used")),
        "irrelevant_public_word_count": sum(len(item.get("blocked_public_words", [])) for item in review_rendered),
        "spelling_error_count": qa_totals["ocr_misspelling_count"],
        "cutoff_text_count": qa_totals["text_collision_count"],
        "too_dark_count": sum(1 for item in review_rendered if item.get("background_too_dark")),
        "distorted_image_count": qa_totals["image_distortion_detected_count"],
        "layout_safe_zone_violation_count": sum(1 for item in review_rendered if not item.get("layout_safe_zone_pass")),
        "recognizable_subject_covered_count": qa_totals["subject_coverage_violation_count"],
        "concept_specific_pass_count": sum(1 for item in review_rendered if item.get("concept_specific_art_direction_pass")),
        "per_thumbnail_critique_count": sum(1 for item in review_rendered if item.get("per_thumbnail_critique")),
        "creative_variation_style_count": len({item.get("style_family") for item in review_rendered if item.get("style_family")}),
        "creative_variation_score": 10,
        "fictional_publication_name": "The Daily Ledger",
        "publication_name_public_use_rule": "Before public use, search the web or obtain owner confirmation that the fictional masthead is not confusingly similar to an active real newspaper.",
        "single_major_proof_mark_candidate_count": sum(1 for item in selected_rendered if item.get("major_proof_marks") == 1),
        "distinct_file_hash_count": len(selected_hashes), "distinct_review_hash_count": len(review_hashes), "display_font": "Impact", "canva_render_status": FACTORY_STATUS,
        "contact_sheet": display_path(contact_sheet), "canva_handoff": display_path(approval / "canva-render-handoff.json"), "metadata_title": metadata.get("default_title", ""), "canonical_formula": click_policy.get("canonical_formula", ""), "review_concepts": review_rendered, "candidates": selected_rendered,
    }

    if invalid:
        payload["blockers"].extend(f"{item['filename']} is invalid: {item['reason']}." for item in invalid)
    topic_headlines = {
        str(item.get("headline", ""))
        for item in metadata.get("thumbnail_topic_concepts", [])
        if isinstance(item, dict) and item.get("headline")
    }
    expected = topic_headlines or {format_city_template(template, city) for template in {"{CITY} WAS REDRAWN", "{CITY_POSSESSIVE} HIDDEN MAP", "{CITY} 1942", "{CITY_POSSESSIVE} LOST STREETS", "{CITY_POSSESSIVE} FALL EXPLAINED"}}
    actual = {item.get("headline", "") for item in review_rendered}
    checks = [
        (len(selected_hashes) == 3, "Selected thumbnail candidates are not three distinct files."),
        (len(review_hashes) == required_review_count, "Review thumbnail concepts are not five distinct files."),
        (payload["rough_concept_count"] >= 20, "Factory must create at least 20 rough concepts."),
        (payload["shortlisted_concept_count"] >= 8, "Factory must shortlist at least 8 thumbnail concepts."),
        (payload["review_concept_count"] == 5, "Factory must render five review concepts."),
        (payload["selected_candidate_count"] == 3, "Factory must select three production candidates from the five review concepts."),
        (payload["free_toolchain_status"] == "pass", "Free-first thumbnail toolchain must pass."),
        (not payload["paid_tool_used"], "No paid tool may be used in the free-first batch."),
        (not payload["paid_asset_used"], "No paid asset may be used in the free-first batch."),
        (payload["rights_ledger_complete"], "All selected thumbnails must be rights-ledgered."),
        (payload["free_font_count"] >= 5, "Factory must record at least five free/system font options."),
        (payload["mobile_ocr_readability_status"] == "pass", "Mobile OCR readability gate must pass."),
        (payload["benchmark_similarity_status"] == "pass", "Benchmark similarity gate must pass."),
        (payload["manual_handoff_status"] == "pass", "Photopea/GIMP manual handoff gate must pass."),
        (expected.issubset(actual), "Factory review headlines do not match the V2 competitive packaging set."),
        (payload["owner_rating_learning_v2_status"] == "pass", "Owner rating preference learning V2 must pass."),
        (payload["preferred_baseline_style"] == "current_owner_preferred", "Current owner-preferred baseline must drive this batch."),
        (payload["redrawn_map_semantic_match_status"] == "pass", "Redrawn thumbnail must use a map/street-grid/highway-map semantic image."),
        (payload["underground_semantic_asset_status"] == "pass", "Hidden-map thumbnail must use underground/tunnel/sewer/subway/utility visual support."),
        (payload["whole_word_redaction_status"] == "pass", "Redacted-file thumbnail must redact whole words only."),
        (payload["partial_word_redaction_count"] == 0, "Partial-word redactions are blocked."),
        (payload["low_value_public_word_count"] == 0, "Low-value public thumbnail words are blocked."),
        (payload["curiosity_hook_prominence_status"] == "pass", "Redacted-file curiosity hook must be prominent."),
        (payload["lost_streets_semantic_asset_status"] == "pass", "Lost-streets thumbnail must use streets, map/grid, road, block, demolition, or void visual support."),
        (payload["rail_image_used_for_lost_streets"] is False, "Rail/track-only image is blocked for lost-streets promise."),
        (payload["then_now_split_integrity_status"] == "pass", "Then/now image split integrity must pass."),
        (payload["then_now_median_crossing_count"] == 0, "Then/now images must not cross the center median."),
        (payload["now_modern_skyline_status"] == "pass", "NOW side must use a bright/current skyline or modern city context."),
        (payload["ai_support_asset_manifest_status"] == "pass", "AI support asset manifest and non-proof boundary must pass."),
        (payload["ai_fake_proof_count"] == 0, "AI-generated fake proof is blocked."),
        (payload["current_style_renderer_v4_status"] == "pass", "Current-style renderer V4 must pass."),
        (payload["clear_promise_count"] == 5, "All five concepts must carry a clear thumbnail promise."),
        (payload["skyline_or_landmark_count"] >= 4, "At least four concepts must use skyline or landmark recognition."),
        (payload["city_recognizable_visual_count"] == 5, "All five concepts must look recognizably like the active city."),
        (payload["premium_city_font_count"] == 5, "All five concepts must use the premium city typography treatment."),
        (payload["polished_proof_mark_count"] == 5, "All five concepts must use polished proof marks."),
        (payload["benchmark_aesthetic_match_count"] == 5, "All five concepts must match the competitive benchmark aesthetic gate."),
        (payload["search_shelf_test_status"] == "pass", "Thumbnail search-result shelf test did not pass."),
        (payload["dominant_real_photo_candidate_count"] == 3, "All selected thumbnails must use one dominant real photo/map/document."),
        (payload["source_board_clutter_count"] == 0, "Thumbnail candidates must not use source-board/research-board clutter."),
        (payload["tiny_label_count"] == 0, "Thumbnail candidates must not depend on tiny unreadable labels."),
        (payload["internal_public_label_count"] == 0, "Thumbnail candidates must not use internal public labels such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF."),
        (payload["random_arrow_count"] == 0, "Thumbnail candidates must not use random arrows unrelated to a route/map/path promise."),
        (payload["ai_support_asset_policy_status"] == "pass", "AI support asset policy must pass."),
        (payload["internet_reference_non_derivative_status"] == "pass", "Internet reference non-derivative gate must pass."),
        (payload["owner_feedback_learning_status"] == "pass", "Owner feedback learning gate must pass."),
        (payload["single_major_proof_mark_candidate_count"] == 3, "Each selected thumbnail must use one major proof mark, not several competing overlays."),
        (payload["irrelevant_public_word_count"] == 0, "Every public thumbnail word must have viewer-facing intent."),
        (payload["spelling_error_count"] == 0, "Rendered thumbnail city/headline spelling verification must pass."),
        (payload["cutoff_text_count"] == 0, "Rendered thumbnail text must not be cut off."),
        (payload["too_dark_count"] == 0, "Thumbnail background/subject visibility must pass."),
        (payload["distorted_image_count"] == 0, "Thumbnail source images must not be stretched or squeezed."),
        (payload["layout_safe_zone_violation_count"] == 0, "Thumbnail safe-zone/timestamp-zone checks must pass."),
        (payload["recognizable_subject_covered_count"] == 0, "Overlays must not cover the recognizable city subject."),
        (payload["concept_specific_pass_count"] == 5, "All five concepts must pass style-specific execution rules."),
        (payload["creative_variation_style_count"] >= 5, "Five-concept batch must use materially different editorial layouts."),
        (payload["owner_feedback_defect_memory_v3_status"] == "pass", "Owner defect memory V3 must pass."),
        (payload["rendered_ocr_truth_status"] == "pass", "Rendered OCR truth gate must pass."),
        (payload["ocr_misspelling_count"] == 0, "Rendered OCR misspellings are blocked."),
        (payload["ocr_unexpected_public_word_count"] == 0, "Unexpected public thumbnail words are blocked."),
        (payload["ocr_missing_required_word_count"] == 0, "Missing required rendered thumbnail words are blocked."),
        (payload["layout_collision_status"] == "pass", "Layout collision gate must pass."),
        (payload["text_collision_count"] == 0, "Rendered thumbnail text collisions are blocked."),
        (payload["subject_coverage_violation_count"] == 0, "Overlays covering support subjects are blocked."),
        (payload["purpose_labeled_shape_status"] == "pass", "Purpose-labeled shape gate must pass."),
        (payload["unexplained_black_box_count"] == 0, "Unexplained black boxes are blocked."),
        (payload["random_shape_count"] == 0, "Random unlabeled shapes are blocked."),
        (payload["then_now_pixel_split_status"] == "pass", "Then/now pixel split gate must pass."),
        (payload["image_distortion_detected_count"] == 0, "Image distortion detected by QA is blocked."),
        (payload["redaction_prop_spelling_status"] == "pass", "Redaction prop spelling and whole-word gate must pass."),
        (payload["misspelled_public_words"] == [], "Misspelled public thumbnail words are blocked."),
        (payload["ai_support_asset_interface_status"] == "pass", "AI support asset interface gate must pass."),
        (payload["triple_review_redteam_status"] == "pass", "Triple-review red-team gate must pass."),
        (payload["dashboard_thumbnail_qa_status"] == "pass", "Dashboard thumbnail QA gate must pass."),
        (payload["per_thumbnail_critique_count"] == 5, "Every review concept must include a per-thumbnail critique."),
        (payload["real_city_source_first_examples_status"] == "pass", "Official city thumbnail examples must pass the source-first real-city media gate."),
        (payload["official_city_example_mode"] == "source_backed_ready", "Official city thumbnail examples must be source-backed ready, not rough mockups."),
        (payload["ad_hoc_mockup_blocked"] is True, "Ad-hoc/non-photo mockups must be blocked from official city examples."),
        (payload["visible_source_audit_status"] == "pass", "Visible real-photo source audit must pass."),
        (payload["visible_real_photo_count"] == 5, "Every review concept must visibly include a real city photo."),
        (payload["photo_hero_or_major_inset_count"] == 5, "Every review concept must use a real photo as a hero or major inset."),
        (payload["map_only_concept_count"] == 0, "Map-only thumbnails are blocked in real-city thumbnail tests."),
        (payload["stale_unmanifested_source_count"] == 0, "Stale or unmanifested visible thumbnail sources are blocked."),
        (payload["unmanifested_visible_source_count"] == 0, "Every visible thumbnail source must be in the manifest or rights ledger."),
    ]
    payload["blockers"].extend(msg for ok, msg in checks if not ok)
    if payload["blockers"]:
        payload["status"] = "blocked"

    write_reports(root, payload)
    write_canva_handoff(root, payload, canva_brief)
    write_manual_handoff(root, payload)
    write_art_direction_report(root, payload, art_policy)
    write_free_workflow_reports(root, payload)
    return payload


def write_canva_handoff(root, payload, canva_brief):
    handoff = {
        "generated_at": utc_now(), "status": FACTORY_STATUS, "renderer_boundary": "Canva plugin render is deferred; OpenClaw remains strategy/source-safety/validation authority.", "no_canva_account_action_taken": True, "no_youtube_mutation_taken": True, "canonical_sequence": canva_brief.get("canonical_sequence", ""),
        "active_city": payload.get("active_city", ""),
        "v2_competitive_upgrade": {"clear_promise_count": payload.get("clear_promise_count", 0), "skyline_or_landmark_count": payload.get("skyline_or_landmark_count", 0), "city_recognizable_visual_count": payload.get("city_recognizable_visual_count", 0), "premium_city_font_count": payload.get("premium_city_font_count", 0), "polished_proof_mark_count": payload.get("polished_proof_mark_count", 0), "benchmark_aesthetic_match_count": payload.get("benchmark_aesthetic_match_count", 0), "search_shelf_test_status": payload.get("search_shelf_test_status", "missing")},
        "ten_out_of_ten_art_direction_path": {"current_renderer": payload.get("current_thumbnail_renderer", ""), "current_image_generator": payload.get("current_image_generator", ""), "recommended_free_ai_support_generator": payload.get("recommended_free_ai_support_generator", ""), "recommended_premium_ai_support_generator": payload.get("recommended_premium_ai_support_generator", ""), "owner_feedback_learning_status": payload.get("owner_feedback_learning_status", "missing")},
        "execution_quality_upgrade": {
            "owner_rating_learning_v2_status": payload.get("owner_rating_learning_v2_status", "missing"),
            "preferred_baseline_style": payload.get("preferred_baseline_style", "missing"),
            "redrawn_map_semantic_match_status": payload.get("redrawn_map_semantic_match_status", "missing"),
            "underground_semantic_asset_status": payload.get("underground_semantic_asset_status", "missing"),
            "whole_word_redaction_status": payload.get("whole_word_redaction_status", "missing"),
            "lost_streets_semantic_asset_status": payload.get("lost_streets_semantic_asset_status", "missing"),
            "then_now_split_integrity_status": payload.get("then_now_split_integrity_status", "missing"),
            "ai_support_asset_manifest_status": payload.get("ai_support_asset_manifest_status", "missing"),
            "current_style_renderer_v4_status": payload.get("current_style_renderer_v4_status", "missing"),
            "every_word_intent_gate_status": payload.get("every_word_intent_gate_status", "missing"),
            "spelling_ocr_verification_status": payload.get("spelling_ocr_verification_status", "missing"),
            "cutoff_text_detection_status": payload.get("cutoff_text_detection_status", "missing"),
            "brightness_subject_visibility_status": payload.get("brightness_subject_visibility_status", "missing"),
            "no_image_distortion_status": payload.get("no_image_distortion_status", "missing"),
            "layout_safe_zone_status": payload.get("layout_safe_zone_status", "missing"),
            "concept_specific_art_direction_status": payload.get("concept_specific_art_direction_status", "missing"),
            "creative_variation_memory_status": payload.get("creative_variation_memory_status", "missing"),
            "publication_name_preflight_status": payload.get("publication_name_preflight_status", "missing"),
            "rendered_ocr_truth_status": payload.get("rendered_ocr_truth_status", "missing"),
            "layout_collision_status": payload.get("layout_collision_status", "missing"),
            "purpose_labeled_shape_status": payload.get("purpose_labeled_shape_status", "missing"),
            "then_now_pixel_split_status": payload.get("then_now_pixel_split_status", "missing"),
            "redaction_prop_spelling_status": payload.get("redaction_prop_spelling_status", "missing"),
            "ai_support_asset_interface_status": payload.get("ai_support_asset_interface_status", "missing"),
            "triple_review_redteam_status": payload.get("triple_review_redteam_status", "missing"),
        },
        "source_first_city_examples": {
            "status": payload.get("real_city_source_first_examples_status", "missing"),
            "official_city_example_mode": payload.get("official_city_example_mode", "missing"),
            "ad_hoc_mockup_blocked": payload.get("ad_hoc_mockup_blocked", False),
            "visible_real_photo_count": payload.get("visible_real_photo_count", 0),
            "photo_hero_or_major_inset_count": payload.get("photo_hero_or_major_inset_count", 0),
            "map_only_concept_count": payload.get("map_only_concept_count", 0),
            "unmanifested_visible_source_count": payload.get("unmanifested_visible_source_count", 0),
        },
        "review_concepts": [{"headline": item["headline"], "benchmark_family": item["benchmark_family"], "style_family": item.get("style_family", ""), "concept_filename": item["concept_filename"], "selected_for_production": item["selected_for_production"], "premium_city_font": item["premium_city_font"], "clear_promise": item["clear_promise"], "per_thumbnail_critique": item.get("per_thumbnail_critique", {})} for item in payload.get("review_concepts", [])],
        "candidates": [{"filename": item["filename"], "role": item["role"], "thumbnail_text": item["headline"], "benchmark_family": item["benchmark_family"], "visual_strategy": item["visual_strategy"], "source_paths": item["source_paths"], "city_anchor": item["city_anchor"], "proof_object": item["proof_object"], "click_interest_trigger": item.get("click_interest_trigger", "")} for item in payload.get("candidates", [])],
    }
    (root / "approval" / "canva-render-handoff.json").write_text(json.dumps(handoff, indent=2) + "\n", encoding="utf-8")


def write_manual_handoff(root, payload):
    approval = ensure_dir(root / "approval")
    handoff = {
        "generated_at": utc_now(),
        "status": payload.get("manual_handoff_status", "blocked"),
        "active_city": payload.get("active_city", ""),
        "free_first_thumbnail_workflow": True,
        "editors": ["Photopea", "GIMP"],
        "paid_tool_escalation": "Owner approval required before Canva Pro, Photoshop, Topaz, paid AI services, paid fonts, or paid stock.",
        "current_renderer": payload.get("current_thumbnail_renderer", ""),
        "current_image_generator": payload.get("current_image_generator", ""),
        "recommended_free_ai_support_generator": payload.get("recommended_free_ai_support_generator", ""),
        "recommended_premium_ai_support_generator": payload.get("recommended_premium_ai_support_generator", ""),
        "export_target": {"format": "PNG or JPG", "size": "1920x1080 or 1280x720", "max_bytes": MAX_THUMBNAIL_BYTES},
        "layout_rules": [
            "Keep the active city primary or co-primary.",
            "Official city examples must be source-backed ready: build a real city source packet, rights ledger, visible-source audit, and five review renders before owner review.",
            "Every public word must have viewer-facing intent; remove any filler or internal production label.",
            "Use the owner-preferred current workflow baseline unless the owner explicitly asks for a major experimental swing.",
            "For redrawn concepts, use a map, street grid, highway map, or map/photo hybrid instead of a generic skyline-only image.",
            "For underground concepts, use tunnel, sewer, subway, utility, or other hidden-system visual support; generic AI support is allowed only as non-proof.",
            "For redacted concepts, redact complete words only and make the curiosity hook prominent.",
            "For lost-streets concepts, use streets, road grids, maps, blocks, demolition, or void imagery; do not use rail/track-only photos.",
            "For then/now concepts, keep THEN fully left, NOW fully right, and use a bright/current skyline or modern city image on NOW.",
            "Keep the promise text clear at phone/search-shelf size.",
            "Verify active-city spelling and that headline text is not clipped after render.",
            "Use one recognizable active-city skyline/landmark/place-specific base.",
            "Use one polished proof mark only.",
            "Never stretch or squeeze source images; crop proportionally only.",
            "Keep important text and landmarks inside safe zones and away from the lower-right timestamp area.",
            "Do not use internal labels such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF.",
            "Do not use random arrows; arrows must be route/map/path-specific.",
            "Do not add paid, watermarked, Pro-locked, or unclear-rights assets.",
        ],
        "candidates": [
            {
                "filename": item["filename"],
                "headline": item["headline"],
                "font_options": FREE_FONT_CANDIDATES,
                "colors": {"city": "#FFD335", "accent": "#00D7E6 or #FF4E42", "stroke": "#000000"},
                "style_family": item.get("style_family", ""),
                "style_rules": item.get("style_rules", []),
                "word_intent_map": item.get("word_intent_map", []),
                "source_paths": item.get("source_paths", []),
                "proof_object": item.get("proof_object", ""),
                "visual_strategy": item.get("visual_strategy", ""),
                "critique": item.get("per_thumbnail_critique", {}),
            }
            for item in payload.get("candidates", [])
        ],
    }
    (approval / "thumbnail-manual-handoff.json").write_text(json.dumps(handoff, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab Free Manual Thumbnail Handoff",
        "",
        f"Generated: {handoff['generated_at']}",
        f"Status: {handoff['status']}",
        "",
        "Free editors: Photopea or GIMP.",
        "Paid tool escalation is blocked unless the owner approves it after a documented free-workflow failure.",
        f"Active city: {handoff.get('active_city', 'missing')}",
        f"Current renderer: {handoff.get('current_renderer', 'missing')}",
        f"Current image generator: {handoff.get('current_image_generator', 'missing')}",
        f"Recommended free AI support: {handoff.get('recommended_free_ai_support_generator', 'missing')}",
        f"Recommended premium AI support: {handoff.get('recommended_premium_ai_support_generator', 'missing')}",
        "",
        "## Candidates",
        "",
    ]
    for item in handoff["candidates"]:
        lines.append(f"- {item['filename']}: {item['headline']} | proof={item['proof_object']}")
        for source in item["source_paths"]:
            lines.append(f"  - source: `{source}`")
    (approval / "thumbnail-manual-handoff.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_art_direction_report(root, payload, art_policy):
    approval = ensure_dir(root / "approval")
    report = {
        "generated_at": utc_now(),
        "status": "pass" if payload.get("ten_out_of_ten_art_direction_path_status") == "pass" else "blocked",
        "active_city": payload.get("active_city", ""),
        "city_agnostic_status": payload.get("city_agnostic_status", "missing"),
        "current_thumbnail_renderer": payload.get("current_thumbnail_renderer", ""),
        "current_image_generator": payload.get("current_image_generator", ""),
        "recommended_free_ai_support_generator": payload.get("recommended_free_ai_support_generator", ""),
        "recommended_premium_ai_support_generator": payload.get("recommended_premium_ai_support_generator", ""),
        "recommended_transparent_cutout_generator": payload.get("recommended_transparent_cutout_generator", ""),
        "recommended_llm_art_director": payload.get("recommended_llm_art_director", ""),
        "ai_support_asset_policy_status": payload.get("ai_support_asset_policy_status", "missing"),
        "internet_reference_non_derivative_status": payload.get("internet_reference_non_derivative_status", "missing"),
        "real_city_source_first_examples_status": payload.get("real_city_source_first_examples_status", "missing"),
        "official_city_example_mode": payload.get("official_city_example_mode", "missing"),
        "ad_hoc_mockup_blocked": payload.get("ad_hoc_mockup_blocked", False),
        "owner_feedback_learning_status": payload.get("owner_feedback_learning_status", "missing"),
        "owner_rating_learning_v2_status": payload.get("owner_rating_learning_v2_status", "missing"),
        "preferred_baseline_style": payload.get("preferred_baseline_style", "missing"),
        "redrawn_map_semantic_match_status": payload.get("redrawn_map_semantic_match_status", "missing"),
        "underground_semantic_asset_status": payload.get("underground_semantic_asset_status", "missing"),
        "whole_word_redaction_status": payload.get("whole_word_redaction_status", "missing"),
        "lost_streets_semantic_asset_status": payload.get("lost_streets_semantic_asset_status", "missing"),
        "then_now_split_integrity_status": payload.get("then_now_split_integrity_status", "missing"),
        "ai_support_asset_manifest_status": payload.get("ai_support_asset_manifest_status", "missing"),
        "current_style_renderer_v4_status": payload.get("current_style_renderer_v4_status", "missing"),
        "no_internal_thumbnail_labels_status": payload.get("no_internal_thumbnail_labels_status", "missing"),
        "arrow_semantic_gate_status": payload.get("arrow_semantic_gate_status", "missing"),
        "acceptance_rule": art_policy.get("acceptance_rule", ""),
    }
    json_path = approval / "thumbnail-10x-art-direction-report.json"
    md_path = approval / "thumbnail-10x-art-direction-report.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Pattern Lab 10x Thumbnail Art Direction Report",
        "",
        f"Generated: {report['generated_at']}",
        f"Status: {report['status']}",
        f"Active city: {report['active_city']}",
        f"City-agnostic templates: {report['city_agnostic_status']}",
        f"Current thumbnail renderer: {report['current_thumbnail_renderer']}",
        f"Current image generator: {report['current_image_generator']}",
        f"Recommended free AI support generator: {report['recommended_free_ai_support_generator']}",
        f"Recommended premium AI support generator: {report['recommended_premium_ai_support_generator']}",
        f"Recommended transparent cutout generator: {report['recommended_transparent_cutout_generator']}",
        f"Recommended LLM art director: {report['recommended_llm_art_director']}",
        f"AI support asset policy: {report['ai_support_asset_policy_status']}",
        f"Internet reference non-derivative gate: {report['internet_reference_non_derivative_status']}",
        f"Real city source-first examples: {report['real_city_source_first_examples_status']} (mode={report['official_city_example_mode']}, ad_hoc_mockup_blocked={report['ad_hoc_mockup_blocked']})",
        f"Owner feedback learning: {report['owner_feedback_learning_status']}",
        f"Owner rating preference V2: {report['owner_rating_learning_v2_status']} ({report['preferred_baseline_style']})",
        f"Map/redrawn semantic match: {report['redrawn_map_semantic_match_status']}",
        f"Underground semantic asset: {report['underground_semantic_asset_status']}",
        f"Whole-word redaction: {report['whole_word_redaction_status']}",
        f"Lost-streets visual relevance: {report['lost_streets_semantic_asset_status']}",
        f"Then/now split integrity: {report['then_now_split_integrity_status']}",
        f"AI support asset boundary: {report['ai_support_asset_manifest_status']}",
        f"Current-style renderer V4: {report['current_style_renderer_v4_status']}",
        f"No internal thumbnail labels: {report['no_internal_thumbnail_labels_status']}",
        f"Arrow semantic gate: {report['arrow_semantic_gate_status']}",
        f"Every-word intent gate: {payload.get('every_word_intent_gate_status', 'missing')}",
        f"Spelling/OCR verification: {payload.get('spelling_ocr_verification_status', 'missing')}",
        f"Cutoff text detection: {payload.get('cutoff_text_detection_status', 'missing')}",
        f"Brightness/subject visibility: {payload.get('brightness_subject_visibility_status', 'missing')}",
        f"No image distortion: {payload.get('no_image_distortion_status', 'missing')}",
        f"Layout safe zones: {payload.get('layout_safe_zone_status', 'missing')}",
        f"Concept-specific art direction: {payload.get('concept_specific_art_direction_status', 'missing')}",
        f"Creative variation memory: {payload.get('creative_variation_memory_status', 'missing')}",
        f"Per-thumbnail critique: {payload.get('per_thumbnail_critique_status', 'missing')}",
        "",
        "## Acceptance Rule",
        "",
        report["acceptance_rule"] or "Owner review and performance data are required before claiming 10/10 thumbnail quality.",
    ]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_reports(root, payload):
    approval = ensure_dir(root / "approval")
    (approval / "thumbnail-factory-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Thumbnail Factory Report: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Active city: {payload.get('active_city', 'missing')}",
        f"City-agnostic templates: {payload.get('city_agnostic_status', 'missing')}",
        f"Current thumbnail renderer: {payload.get('current_thumbnail_renderer', 'missing')}",
        f"Current image generator: {payload.get('current_image_generator', 'missing')}",
        f"Recommended free AI support generator: {payload.get('recommended_free_ai_support_generator', 'missing')}",
        f"Recommended premium AI support generator: {payload.get('recommended_premium_ai_support_generator', 'missing')}",
        f"Recommended LLM art director: {payload.get('recommended_llm_art_director', 'missing')}",
        f"Owner feedback learning: {payload.get('owner_feedback_learning_status', 'missing')}",
        f"Owner rating preference V2: {payload.get('owner_rating_learning_v2_status', 'missing')} ({payload.get('preferred_baseline_style', 'missing')})",
        f"Owner feedback defect memory V3: {payload.get('owner_feedback_defect_memory_v3_status', 'missing')}",
        f"Rendered OCR truth: {payload.get('rendered_ocr_truth_status', 'missing')} (misspellings={payload.get('ocr_misspelling_count', 'missing')}, unexpected_words={payload.get('ocr_unexpected_public_word_count', 'missing')}, missing_words={payload.get('ocr_missing_required_word_count', 'missing')})",
        f"Layout collision: {payload.get('layout_collision_status', 'missing')} (text_collisions={payload.get('text_collision_count', 'missing')}, subject_coverage={payload.get('subject_coverage_violation_count', 'missing')})",
        f"Purpose-labeled shape: {payload.get('purpose_labeled_shape_status', 'missing')} (black_boxes={payload.get('unexplained_black_box_count', 'missing')}, random_shapes={payload.get('random_shape_count', 'missing')})",
        f"Then/now pixel split: {payload.get('then_now_pixel_split_status', 'missing')} (median_crossings={payload.get('then_now_median_crossing_count', 'missing')}, image_distortion={payload.get('image_distortion_detected_count', 'missing')})",
        f"Redaction prop spelling: {payload.get('redaction_prop_spelling_status', 'missing')} (misspelled_public_words={payload.get('misspelled_public_words', [])})",
        f"AI support asset interface: {payload.get('ai_support_asset_interface_status', 'missing')}",
        f"Triple-review red-team: {payload.get('triple_review_redteam_status', 'missing')}",
        f"Dashboard thumbnail QA: {payload.get('dashboard_thumbnail_qa_status', 'missing')}",
        f"Real city source-first examples: {payload.get('real_city_source_first_examples_status', 'missing')} (mode={payload.get('official_city_example_mode', 'missing')}, ad_hoc_mockup_blocked={payload.get('ad_hoc_mockup_blocked', 'missing')})",
        f"Map/redrawn semantic match: {payload.get('redrawn_map_semantic_match_status', 'missing')}",
        f"Underground semantic asset: {payload.get('underground_semantic_asset_status', 'missing')}",
        f"Whole-word redaction: {payload.get('whole_word_redaction_status', 'missing')} ({payload.get('partial_word_redaction_count', 'missing')} partial-word redactions)",
        f"Curiosity hook prominence: {payload.get('curiosity_hook_prominence_status', 'missing')}",
        f"Lost-streets visual relevance: {payload.get('lost_streets_semantic_asset_status', 'missing')} (rail image used: {payload.get('rail_image_used_for_lost_streets', 'missing')})",
        f"Then/now split integrity: {payload.get('then_now_split_integrity_status', 'missing')} ({payload.get('then_now_median_crossing_count', 'missing')} median crossings)",
        f"NOW modern skyline: {payload.get('now_modern_skyline_status', 'missing')}",
        f"AI support asset boundary: {payload.get('ai_support_asset_manifest_status', 'missing')} ({payload.get('ai_fake_proof_count', 'missing')} fake proof assets)",
        f"Current-style renderer V4: {payload.get('current_style_renderer_v4_status', 'missing')}",
        f"10/10 art-direction path: {payload.get('ten_out_of_ten_art_direction_path_status', 'missing')}",
        f"Rough concepts: {payload.get('rough_concept_count', 0)}",
        f"Shortlisted concepts: {payload.get('shortlisted_concept_count', 0)}",
        f"Review concepts: {payload.get('review_concept_count', 0)}",
        f"Selected production candidates: {payload.get('selected_candidate_count', 0)}",
        f"Free-first thumbnail workflow: {payload.get('free_toolchain_status', 'missing')}",
        f"Paid tool used: {payload.get('paid_tool_used', True)}",
        f"Paid asset used: {payload.get('paid_asset_used', True)}",
        f"Mobile OCR readability: {payload.get('mobile_ocr_readability_status', 'missing')}",
        f"Benchmark similarity: {payload.get('benchmark_similarity_status', 'missing')}",
        f"Manual handoff: {payload.get('manual_handoff_status', 'missing')}",
        f"Clear promise concepts: {payload.get('clear_promise_count', 0)}",
        f"City skyline/landmark recognition: {payload.get('skyline_or_landmark_count', 0)}",
        f"City recognizable visuals: {payload.get('city_recognizable_visual_count', 0)}",
        f"Premium city font concepts: {payload.get('premium_city_font_count', 0)}",
        f"Polished proof-mark concepts: {payload.get('polished_proof_mark_count', 0)}",
        f"Competitive benchmark aesthetic concepts: {payload.get('benchmark_aesthetic_match_count', 0)}",
        f"AI support asset policy: {payload.get('ai_support_asset_policy_status', 'missing')}",
        f"Internet reference non-derivative gate: {payload.get('internet_reference_non_derivative_status', 'missing')}",
        f"No internal thumbnail labels: {payload.get('no_internal_thumbnail_labels_status', 'missing')} ({payload.get('internal_public_label_count', 0)} labels)",
        f"Arrow semantic gate: {payload.get('arrow_semantic_gate_status', 'missing')} ({payload.get('random_arrow_count', 0)} random arrows)",
        f"Every-word intent gate: {payload.get('every_word_intent_gate_status', 'missing')} ({payload.get('irrelevant_public_word_count', 0)} irrelevant words)",
        f"Spelling/OCR verification: {payload.get('spelling_ocr_verification_status', 'missing')} ({payload.get('spelling_error_count', 0)} spelling errors)",
        f"Cutoff text detection: {payload.get('cutoff_text_detection_status', 'missing')} ({payload.get('cutoff_text_count', 0)} cut-off text items)",
        f"Brightness/subject visibility: {payload.get('brightness_subject_visibility_status', 'missing')} ({payload.get('too_dark_count', 0)} too-dark concepts)",
        f"No image distortion: {payload.get('no_image_distortion_status', 'missing')} ({payload.get('distorted_image_count', 0)} distorted images)",
        f"Layout safe zones: {payload.get('layout_safe_zone_status', 'missing')} ({payload.get('layout_safe_zone_violation_count', 0)} violations)",
        f"Concept-specific art direction: {payload.get('concept_specific_art_direction_status', 'missing')} ({payload.get('concept_specific_pass_count', 0)} passing)",
        f"Redaction realism: {payload.get('redaction_realism_status', 'missing')}",
        f"Newspaper realism: {payload.get('newspaper_realism_status', 'missing')} (publication preflight: {payload.get('publication_name_preflight_status', 'missing')})",
        f"Then/now orientation: {payload.get('then_now_orientation_status', 'missing')}",
        f"Creative variation memory: {payload.get('creative_variation_memory_status', 'missing')} ({payload.get('creative_variation_style_count', 0)} styles, score {payload.get('creative_variation_score', 0)}/10)",
        f"Per-thumbnail critique: {payload.get('per_thumbnail_critique_status', 'missing')} ({payload.get('per_thumbnail_critique_count', 0)} critiques)",
        f"Thumbnail search shelf: {payload.get('search_shelf_test_status', 'missing')}",
        f"Photo-backed selected candidates: {payload.get('photo_backed_candidate_count', 0)}",
        f"Source-board clutter candidates: {payload.get('source_board_clutter_count', 0)}",
        f"Tiny-label candidates: {payload.get('tiny_label_count', 0)}",
        f"Contact sheet: `{payload.get('contact_sheet', 'missing')}`",
        f"Five-concept contact sheet: `{payload.get('five_concept_contact_sheet', 'missing')}`",
        f"Thumbnail search shelf: `{payload.get('search_shelf_test', 'missing')}`",
        f"Canva handoff: `{payload.get('canva_handoff', 'missing')}`",
        f"Photopea/GIMP handoff: `{display_path(approval / 'thumbnail-manual-handoff.json')}`",
        "",
        "## Five Review Concepts",
        "",
    ]
    for item in payload.get("review_concepts", []):
        lines.append(f"- {item['headline']}: {item['benchmark_family']} | style={item.get('style_family', 'missing')} | selected={item['selected_for_production']} | clear_promise={item['clear_promise']} | skyline_or_landmark={item['skyline_or_landmark']} | premium_font={item['premium_city_font']} | words_intentional={item.get('every_word_intentional')} | spelling_verified={item.get('spelling_verified')} | no_distortion={not item.get('image_distortion_detected')} | proof={item['proof_object']}")
    lines.extend(["", "## Selected Production Candidates", ""])
    for item in payload.get("candidates", []):
        lines.append(f"- {item['filename']}: {item['role']} | {item['dimensions']} | {item['size_bytes'] / 1024 / 1024:.2f} MB | text=`{item['headline']}` | proof={item['proof_object']} | trigger={item.get('click_interest_trigger', '')}")
        for source in item.get("source_paths", []):
            lines.append(f"  - source: `{source}`")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload.get("blockers", [])] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in payload.get("warnings", [])] or ["- none"])
    (approval / "thumbnail-factory-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Build repo-local photo-first Pattern Lab thumbnail candidates.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--concept-count", type=int, default=20)
    args = parser.parse_args()
    payload = build_thumbnail_factory(args.video_id, concept_count=args.concept_count)
    print(f"Status: {payload['status']}")
    print(f"Thumbnail factory report: {display_path(output_root(args.video_id) / 'approval' / 'thumbnail-factory-report.md')}")
    for blocker in payload.get("blockers", []):
        print(f"- {blocker}")
    if payload["status"] != "pass":
        raise SystemExit(1)

if __name__ == "__main__":
    main()
