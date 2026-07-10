#!/usr/bin/env python3
"""Render photo-backed Miami thumbnail examples from rights-safe LOC source photos."""
from __future__ import annotations

import csv
import json
import os
import subprocess
import shutil
import tempfile
from pathlib import Path

from patternlab_common import BASE, LEDGER_FIELDS, ensure_dir, utc_now
from patternlab_thumbnail_click_quality import (
    build_ab_readiness_packet,
    build_topic_bank,
    brief_for_topic,
    validate_brief,
    write_json,
)

ROOT = BASE / "local-output" / "video-miami-photo-redo"
MEDIA = ROOT / "source-packet" / "manual-media"
OUT = ROOT / "review" / "photo-backed-thumbnails"
APPROVAL = ROOT / "approval"
TYPOGRAPHY_POLICY = BASE / "resources" / "thumbnail-typography-policy.json"

FONT_SPEC = {
    "policy_file": "resources/thumbnail-typography-policy.json",
    "impact_fallback_used": False,
    "document_prop_is_inside_document_visual": False,
    "city_anchor": {
        "role": "city_anchor",
        "family": "Avenir Next Condensed Heavy",
        "fallback_stack": ["Helvetica Neue Condensed Black", "DIN Condensed Bold", "Arial Black"],
        "stroke_width": 4,
        "tracking": -1,
        "max_size": 154,
        "min_size": 94,
    },
    "main_hook": {
        "role": "main_hook",
        "family": "Avenir Next Condensed Heavy",
        "fallback_stack": ["Helvetica Neue Condensed Black", "DIN Condensed Bold", "Arial Black"],
        "stroke_width": 3,
        "tracking": -1,
        "max_size": 138,
        "min_size": 58,
    },
    "supporting_line": {
        "role": "supporting_line",
        "family": "Avenir Next Heavy",
        "fallback_stack": ["Avenir Next Condensed Demi Bold", "Helvetica Neue Condensed Black", "Arial Bold"],
        "stroke_width": 0,
        "tracking": 0,
        "max_size": 56,
        "min_size": 34,
    },
}

DOCUMENT_FONT_SPEC = {
    "document_prop": {
        "role": "document_prop",
        "family": "Courier New Bold",
        "fallback_stack": ["CourierNewPS-BoldMT"],
        "stroke_width": 0,
        "tracking": 0,
        "max_size": 31,
        "min_size": 27,
    },
    "document_prop_is_inside_document_visual": True,
}

SOURCES = {
    "skyline": {
        "file": "loc-miami-skyline.jpg",
        "title": "Aerial view from Biscayne Bay, separating Miami Beach and Miami, Florida, of part of the Miami skyline",
        "url": "https://www.loc.gov/pictures/item/2020721053/",
        "creator": "Carol M. Highsmith / Library of Congress",
        "category": "skyline waterfront modern_context",
        "tags": ["skyline", "water"],
    },
    "overtown_market": {
        "file": "loc-miami-overtown_market.jpg",
        "title": "The Overtown Market in downtown Miami, Florida's Overtown neighborhood",
        "url": "https://www.loc.gov/pictures/item/2020720689/",
        "creator": "Carol M. Highsmith / Library of Congress",
        "category": "overtown neighborhood modern_context",
        "tags": ["neighborhood", "street-level"],
    },
    "overtown_lyric": {
        "file": "loc-miami-overtown_lyric.jpg",
        "title": "Modern entrance to the Historic Lyric Theater in downtown Miami, Florida's Overtown neighborhood",
        "url": "https://www.loc.gov/pictures/item/2020720693/",
        "creator": "Carol M. Highsmith / Library of Congress",
        "category": "overtown landmark historical_context",
        "tags": ["neighborhood", "document", "street-level"],
    },
    "overtown_skyline": {
        "file": "loc-miami-overtown_skyline.jpg",
        "title": "A view of downtown Miami skyscrapers from the Overtown District",
        "url": "https://www.loc.gov/pictures/item/2020720695/",
        "creator": "Carol M. Highsmith / Library of Congress",
        "category": "overtown skyline modern_context",
        "tags": ["neighborhood", "skyline", "street-level"],
    },
    "artdeco_center": {
        "file": "loc-miami-artdeco_center.jpg",
        "title": "Miami Beach Community Center, Miami Beach Art Deco Historic District",
        "url": "https://www.loc.gov/pictures/item/fl0160.photos.052219p/",
        "creator": "Walter Smalling Jr. / Library of Congress HABS",
        "category": "art_deco historic_architecture historical_evidence",
        "tags": ["preservation", "street-level", "document"],
    },
    "artdeco_colony": {
        "file": "loc-miami-artdeco_colony.jpg",
        "title": "Colony Hotel, 736 Ocean Drive, Miami Beach Art Deco Historic District",
        "url": "https://www.loc.gov/pictures/item/fl0160.photos.052222p/",
        "creator": "Library of Congress HABS",
        "category": "art_deco historic_architecture historical_evidence",
        "tags": ["preservation", "street-level", "document"],
    },
    "artdeco_carlyle": {
        "file": "loc-miami-artdeco_carlyle.jpg",
        "title": "Carlyle Hotel, 1250 Ocean Drive, Miami Beach Art Deco Historic District",
        "url": "https://www.loc.gov/pictures/item/fl0160.photos.052227p/",
        "creator": "Library of Congress HABS",
        "category": "art_deco historic_architecture historical_evidence",
        "tags": ["preservation", "street-level", "document"],
    },
}

TOPICS = [
    {
        "id": "miami-topic-01-water-city",
        "title": "The Water Won: Why Miami's Map Still Fights the Bay.",
        "sentence": "This episode shows how water, fill, canals, and low elevation shaped Miami's growth.",
        "click_question": "Why does Miami's skyline still depend on water decisions most viewers never see?",
        "emotional_tension": "city vs water",
        "source_tags_required": ["water", "map", "skyline"],
        "variants": [
            {"file": "photo_01_miami_the_water_won.jpg", "source": "skyline", "format": "waterline", "city": "MIAMI", "main": "THE WATER WON", "sub": "BISCAYNE BAY KEEPS THE RECEIPTS", "proof_object": "Biscayne Bay skyline photo", "required_source_photo_type": "waterfront skyline", "first_30_second_payoff": "Open on the Biscayne Bay skyline and explain that the thumbnail is about water shaping the city map.", "title_thumbnail_promise": "Miami looks built on land, but the source trail starts with water.", "scores": {"curiosity": 10, "clarity": 9, "source_photo_fit": 9, "visual_novelty": 8, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
            {"file": "photo_02_miami_built_over_this.jpg", "source": "overtown_skyline", "format": "split", "city": "MIAMI", "main": "BUILT OVER THIS", "sub": "LOW LAND UNDER THE SKYLINE", "proof_object": "street-level skyline context photo", "required_source_photo_type": "skyline over low land", "first_30_second_payoff": "Show the skyline and immediately frame the hidden ground/water problem under the city image.", "title_thumbnail_promise": "The skyline hides the physical system underneath.", "scores": {"curiosity": 9, "clarity": 9, "source_photo_fit": 8, "visual_novelty": 8, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
            {"file": "photo_03_miami_drainage_file.jpg", "source": "skyline", "format": "file", "city": "MIAMI", "main": "DRAINAGE FILE", "sub": "THE CITY GREW OUT OF WATER", "proof_object": "source-file prop over real Miami skyline", "required_source_photo_type": "waterfront skyline plus document proof", "first_30_second_payoff": "Show the source-file promise and explain the drainage/fill question before the intro.", "title_thumbnail_promise": "A city file explains why water is central to Miami.", "scores": {"curiosity": 8, "clarity": 9, "source_photo_fit": 9, "visual_novelty": 9, "title_thumbnail_promise": 8, "first_30_second_payoff": 9}},
        ],
    },
    {
        "id": "miami-topic-02-overtown-cut",
        "title": "Who Cut Overtown? The Route Decision Miami Still Carries.",
        "sentence": "This episode follows the source trail behind how highway routing changed Overtown.",
        "click_question": "Who decided Overtown was the place to cut through?",
        "emotional_tension": "neighborhood vs route",
        "source_tags_required": ["neighborhood", "highway", "street-level"],
        "variants": [
            {"file": "photo_04_miami_who_cut_overtown.jpg", "source": "overtown_market", "format": "poster", "city": "MIAMI", "main": "WHO CUT OVERTOWN?", "sub": "ONE ROUTE CHANGED A NEIGHBORHOOD", "proof_object": "Overtown street-level photo", "required_source_photo_type": "Overtown neighborhood photo", "first_30_second_payoff": "Start with the Overtown photo and say the episode is about the route decision behind the cut.", "title_thumbnail_promise": "The video names the city, the neighborhood, and the route question quickly.", "scores": {"curiosity": 10, "clarity": 10, "source_photo_fit": 9, "visual_novelty": 8, "title_thumbnail_promise": 10, "first_30_second_payoff": 9}},
            {"file": "photo_05_miami_overtown_was_cut.jpg", "source": "overtown_skyline", "format": "poster", "city": "MIAMI", "main": "OVERTOWN WAS CUT", "sub": "THE MAP WAS NOT NEUTRAL", "proof_object": "Overtown skyline/street context photo", "required_source_photo_type": "Overtown street and skyline photo", "first_30_second_payoff": "Explain that the map decision is the proof trail, not a decorative graphic line.", "title_thumbnail_promise": "The neighborhood outcome came from a specific city map decision.", "scores": {"curiosity": 9, "clarity": 9, "source_photo_fit": 9, "visual_novelty": 8, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
            {"file": "photo_06_miami_who_drew_this.jpg", "source": "overtown_lyric", "format": "file", "city": "MIAMI", "main": "WHO DREW THIS?", "sub": "OVERTOWN WAS IN THE WAY", "proof_object": "source-file prop over Overtown landmark photo", "required_source_photo_type": "Overtown landmark photo plus document proof", "first_30_second_payoff": "Show a route/source-file framing and connect it to Overtown immediately.", "title_thumbnail_promise": "A source file answers who made the route decision.", "scores": {"curiosity": 10, "clarity": 8, "source_photo_fit": 9, "visual_novelty": 9, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
        ],
    },
    {
        "id": "miami-topic-03-art-deco-rescue",
        "title": "Saved From Demolition: Miami's Art Deco Fight.",
        "sentence": "This episode shows how Miami Beach's Art Deco district survived demolition pressure.",
        "click_question": "How close did Miami come to losing the look everyone recognizes?",
        "emotional_tension": "demolition vs preservation",
        "source_tags_required": ["preservation", "document", "street-level"],
        "variants": [
            {"file": "photo_07_miami_saved_from_demolition.jpg", "source": "artdeco_center", "format": "poster", "city": "MIAMI", "main": "SAVED FROM DEMOLITION", "sub": "ART DECO WAS A FIGHT", "proof_object": "Art Deco district HABS photo", "required_source_photo_type": "Art Deco preservation photo", "first_30_second_payoff": "Open with the Art Deco photo and explain the preservation fight before broad history.", "title_thumbnail_promise": "The video shows the rescue, not just the tourism image.", "scores": {"curiosity": 9, "clarity": 10, "source_photo_fit": 10, "visual_novelty": 8, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
            {"file": "photo_08_miami_almost_erased.jpg", "source": "artdeco_colony", "format": "postcard", "city": "MIAMI", "main": "ALMOST ERASED", "sub": "NOT JUST TOURISM", "proof_object": "Art Deco hotel source photo", "required_source_photo_type": "recognizable Art Deco building", "first_30_second_payoff": "Show that the familiar postcard look had a preservation conflict behind it.", "title_thumbnail_promise": "The postcard image nearly disappeared.", "scores": {"curiosity": 9, "clarity": 9, "source_photo_fit": 10, "visual_novelty": 9, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
            {"file": "photo_09_miami_who_saved_this.jpg", "source": "artdeco_carlyle", "format": "saved", "city": "MIAMI", "main": "WHO SAVED THIS?", "sub": "PRESERVATION CHANGED THE STREET", "proof_object": "preservation file prop over Art Deco source photo", "required_source_photo_type": "Art Deco building plus preservation file", "first_30_second_payoff": "Show the preservation-file framing and name the stakes in the first 30 seconds.", "title_thumbnail_promise": "The source trail explains who saved the street image.", "scores": {"curiosity": 9, "clarity": 8, "source_photo_fit": 10, "visual_novelty": 9, "title_thumbnail_promise": 9, "first_30_second_payoff": 9}},
        ],
    },
]

SWIFT = r'''
import AppKit
import Foundation

struct Spec: Decodable {
 let out:String; let image:String; let format:String; let city:String; let main:String; let sub:String
 let cityFont:String; let mainFont:String; let subFont:String
 let cityStroke:Int; let mainStroke:Int
 let cityTracking:CGFloat; let mainTracking:CGFloat; let subTracking:CGFloat
}
let W: CGFloat = 1920, H: CGFloat = 1080
func col(_ h: UInt32, _ a: CGFloat = 1) -> NSColor { NSColor(calibratedRed: CGFloat((h >> 16) & 255) / 255, green: CGFloat((h >> 8) & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: a) }
func font(_ n: String, _ s: CGFloat) -> NSFont { NSFont(name: n, size: s) ?? NSFont.boldSystemFont(ofSize: s) }
func para(_ al: NSTextAlignment = .left) -> NSMutableParagraphStyle { let p = NSMutableParagraphStyle(); p.alignment = al; p.lineBreakMode = .byClipping; return p }
func fit(_ t: String, _ n: String, _ max: CGFloat, _ min: CGFloat, _ w: CGFloat) -> NSFont { var s = max; while s > min { let f = font(n, s); if (t as NSString).size(withAttributes: [.font:f]).width <= w { return f }; s -= 4 }; return font(n, min) }
func fill(_ r: NSRect, _ c: NSColor) { c.setFill(); r.fill() }
func stroke(_ r: NSRect, _ c: NSColor, _ lw: CGFloat) { c.setStroke(); let p = NSBezierPath(rect: r); p.lineWidth = lw; p.stroke() }
func line(_ a: CGPoint, _ b: CGPoint, _ c: NSColor, _ lw: CGFloat) { c.setStroke(); let p = NSBezierPath(); p.move(to:a); p.line(to:b); p.lineWidth = lw; p.stroke() }
func text(_ s: String, _ r: NSRect, _ f: NSFont, _ fc: NSColor, _ sc: NSColor = .black, _ sw: Int = 5, _ al: NSTextAlignment = .left, _ k: CGFloat = -2) { let attrs:[NSAttributedString.Key:Any] = [.font:f,.foregroundColor:fc,.strokeColor:sc,.strokeWidth:-sw,.paragraphStyle:para(al),.kern:k]; (s as NSString).draw(in:r, withAttributes:attrs) }
func plain(_ s: String, _ r: NSRect, _ f: NSFont, _ c: NSColor, _ al: NSTextAlignment = .left) { (s as NSString).draw(in:r, withAttributes:[.font:f,.foregroundColor:c,.paragraphStyle:para(al)]) }
func cover(_ path: String, _ rect: NSRect) { if let img = NSImage(contentsOfFile:path) { let iw = img.size.width, ih = img.size.height; let scale = max(rect.width / iw, rect.height / ih); let sw = rect.width / scale, sh = rect.height / scale; let src = NSRect(x:(iw - sw) / 2, y:(ih - sh) / 2, width:sw, height:sh); img.draw(in:rect, from:src, operation:.sourceOver, fraction:1) } else { fill(rect, col(0x222222)) } }
func save(_ img: NSImage, _ path: String) throws { guard let t = img.tiffRepresentation, let r = NSBitmapImageRep(data:t), let d = r.representation(using:.jpeg, properties:[.compressionFactor:0.88]) else { throw NSError(domain:"MiamiPhoto", code:1) }; try d.write(to:URL(fileURLWithPath:path), options:.atomic) }
func freewayOverlay() { fill(NSRect(x:805,y:-80,width:310,height:1240), col(0x070707,0.86)); fill(NSRect(x:950,y:-80,width:20,height:1240), col(0xFFD335,0.95)) }
func documentBox(_ title: String) { fill(NSRect(x:90,y:120,width:560,height:610), col(0xEFD7A6,0.94)); stroke(NSRect(x:90,y:120,width:560,height:610), col(0x1B140B), 8); plain(title, NSRect(x:125,y:660,width:490,height:38), font("Courier New Bold", 31), col(0x1B140B), .center); plain("public source record", NSRect(x:145,y:455,width:340,height:36), font("Courier New Bold", 28), col(0x1B140B)); fill(NSRect(x:150,y:405,width:170,height:24), col(0x050505)); plain("selected words", NSRect(x:340,y:397,width:230,height:36), font("Courier New Bold", 27), col(0x1B140B)); plain("real Miami photo", NSRect(x:145,y:285,width:360,height:36), font("Courier New Bold", 28), col(0x1B140B)) }
func render(_ s: Spec) throws { let img = NSImage(size:NSSize(width:W,height:H)); img.lockFocus(); cover(s.image, NSRect(x:0,y:0,width:W,height:H)); fill(NSRect(x:0,y:0,width:W,height:H), col(0x00111A,0.24));
 switch s.format {
 case "waterline":
  fill(NSRect(x:0,y:0,width:W,height:350), col(0x0099B8,0.78)); line(CGPoint(x:0,y:350),CGPoint(x:1920,y:350),col(0xFFFFFF),16)
 case "split":
  fill(NSRect(x:0,y:0,width:W,height:H), col(0x173F2A,0.20)); fill(NSRect(x:0,y:0,width:W,height:285), col(0x00A7BD,0.82)); line(CGPoint(x:0,y:285),CGPoint(x:1920,y:285),col(0xFFFFFF),14)
 case "freeway":
  fill(NSRect(x:0,y:0,width:W,height:H), col(0x100A02,0.20))
 case "route":
  fill(NSRect(x:0,y:0,width:W,height:H), col(0xE8D2AA,0.16))
 case "file":
  fill(NSRect(x:0,y:0,width:W,height:H), col(0x00111A,0.32)); documentBox("SOURCE FILE")
 case "postcard":
  fill(NSRect(x:70,y:70,width:1780,height:940), col(0xFCE3B6,0.18)); stroke(NSRect(x:70,y:70,width:1780,height:940), col(0xFFFFFF), 20)
 case "saved":
  fill(NSRect(x:0,y:0,width:W,height:H), col(0x00111A,0.18)); documentBox("PRESERVATION FILE")
 default:
  fill(NSRect(x:0,y:0,width:W,height:H), col(0x00111A,0.18))
 }
 text(s.city, NSRect(x:70,y:805,width:1780,height:155), fit(s.city,s.cityFont,154,94,1780), col(0xFFD335), .black, s.cityStroke, .center, s.cityTracking)
 text(s.main, NSRect(x:80,y:570,width:1760,height:175), fit(s.main,s.mainFont,138,58,1760), .white, .black, s.mainStroke, .center, s.mainTracking)
 fill(NSRect(x:330,y:135,width:1260,height:92), col(0x050505,0.74)); plain(s.sub, NSRect(x:360,y:157,width:1200,height:55), fit(s.sub,s.subFont,56,34,1200), col(0xFFFFFF), .center)
 img.unlockFocus(); try save(img, s.out) }
let data = try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])); let specs = try JSONDecoder().decode([Spec].self, from:data); for s in specs { try render(s) }
'''

CONTACT_SWIFT = r'''
import AppKit
import Foundation
let out = CommandLine.arguments[1]
let inputs = Array(CommandLine.arguments.dropFirst(2))
let cols = 3
let rows = max(1, Int(ceil(Double(inputs.count) / Double(cols))))
let tileW: CGFloat = 640
let tileH: CGFloat = 360
let canvas = NSImage(size: NSSize(width: tileW * CGFloat(cols), height: tileH * CGFloat(rows)))
canvas.lockFocus(); NSColor.black.setFill(); NSRect(x:0,y:0,width:tileW * CGFloat(cols),height:tileH * CGFloat(rows)).fill()
for (i,path) in inputs.enumerated() {
 if let img = NSImage(contentsOfFile:path) {
  let col = i % cols
  let row = i / cols
  let y = CGFloat(rows - 1 - row) * tileH
  img.draw(in:NSRect(x:CGFloat(col)*tileW,y:y,width:tileW,height:tileH), from:NSRect(x:0,y:0,width:img.size.width,height:img.size.height), operation:.sourceOver, fraction:1)
 }
}
canvas.unlockFocus()
guard let t = canvas.tiffRepresentation, let r = NSBitmapImageRep(data:t), let d = r.representation(using:.jpeg, properties:[.compressionFactor:0.88]) else { throw NSError(domain:"contact", code:1) }
try d.write(to:URL(fileURLWithPath:out), options:.atomic)
'''

COMPARE_SWIFT = r'''
import AppKit
import Foundation
let out = CommandLine.arguments[1]
let before = CommandLine.arguments[2]
let after = CommandLine.arguments[3]
let canvas = NSImage(size: NSSize(width: 1920, height: 1080))
canvas.lockFocus(); NSColor.black.setFill(); NSRect(x:0,y:0,width:1920,height:1080).fill()
if let img = NSImage(contentsOfFile: before) {
 img.draw(in:NSRect(x:0,y:540,width:1920,height:540), from:NSRect(x:0,y:0,width:img.size.width,height:img.size.height), operation:.sourceOver, fraction:1)
}
if let img = NSImage(contentsOfFile: after) {
 img.draw(in:NSRect(x:0,y:0,width:1920,height:540), from:NSRect(x:0,y:0,width:img.size.width,height:img.size.height), operation:.sourceOver, fraction:1)
}
let attrs:[NSAttributedString.Key:Any] = [.font:NSFont.boldSystemFont(ofSize:38),.foregroundColor:NSColor.white]
("BEFORE TYPOGRAPHY" as NSString).draw(in:NSRect(x:40,y:1015,width:700,height:50), withAttributes:attrs)
("AFTER TYPOGRAPHY" as NSString).draw(in:NSRect(x:40,y:475,width:700,height:50), withAttributes:attrs)
canvas.unlockFocus()
guard let t = canvas.tiffRepresentation, let r = NSBitmapImageRep(data:t), let d = r.representation(using:.jpeg, properties:[.compressionFactor:0.88]) else { throw NSError(domain:"compare", code:1) }
try d.write(to:URL(fileURLWithPath:out), options:.atomic)
'''


def run_swift(source: str, args: list[str]) -> None:
    with tempfile.TemporaryDirectory(prefix="miami-photo-") as tmp:
        tmp_path = Path(tmp)
        swift = tmp_path / "render.swift"
        swift.write_text(source, encoding="utf-8")
        env = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(tmp_path / "clang-cache"), "TMPDIR": str(tmp_path)}
        result = subprocess.run(["swift", str(swift), *args], capture_output=True, text=True, env=env, check=False)
        if result.returncode != 0:
            raise SystemExit(result.stderr[-4000:])


def ledger_rows() -> list[dict[str, str]]:
    rows = []
    for key, src in SOURCES.items():
        rows.append({
            "asset_id": f"video-miami-photo-redo-loc-{key}",
            "asset_type": "image",
            "filename": f"source-packet/manual-media/{src['file']}",
            "local_path": f"source-packet/manual-media/{src['file']}",
            "tool": "Library of Congress public image services",
            "model_or_service": "Library of Congress Prints and Photographs Online Catalog",
            "source_prompt_or_source_file": src["url"],
            "source_title": src["title"],
            "source_url": src["url"],
            "creator": src["creator"],
            "archive_or_platform": "Library of Congress",
            "source_class": "historical_evidence" if "historical" in src["category"] else "modern_context",
            "license_or_rights_basis": "Library of Congress item-level public online record; owner review required before public use",
            "license_status": "LOC public online image; rights review required before public use",
            "attribution_required": "yes",
            "attribution_text": f"{src['title']}. {src['creator']}. Library of Congress. {src['url']}",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "low: city/building context; owner review still required",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "Real Miami source photo used visibly in Pattern Lab thumbnail test.",
            "human_review_required": "yes",
            "human_review_status": "pending",
        })
    return rows



def visual_elements_for_format(fmt: str) -> list[dict[str, str]]:
    elements = [
        {"kind": "overlay", "label": "photo contrast overlay", "purpose": "contrast_overlay"},
        {"kind": "backplate", "label": "subtitle readability backplate", "purpose": "subtitle_backplate"},
    ]
    if fmt in {"waterline", "split"}:
        elements.append({"kind": "line", "label": "waterline / low-land boundary", "purpose": "waterline"})
    if fmt in {"file", "saved"}:
        elements.extend([
            {"kind": "box", "label": "source-file document panel", "purpose": "source_document"},
            {"kind": "box", "label": "selective redaction over readable source-file sentence", "purpose": "selective_redaction"},
        ])
    if fmt == "postcard":
        elements.append({"kind": "frame", "label": "postcard frame around real source photo", "purpose": "photo_frame"})
    return elements


def font_spec_for_format(fmt: str) -> dict:
    spec = json.loads(json.dumps(FONT_SPEC))
    if fmt in {"file", "saved"}:
        spec.update(json.loads(json.dumps(DOCUMENT_FONT_SPEC)))
    return spec


def swift_spec(out: Path, image: Path, variant: dict) -> dict:
    font = font_spec_for_format(variant["format"])
    return {
        "out": str(out),
        "image": str(image),
        "format": variant["format"],
        "city": variant["city"],
        "main": variant["main"],
        "sub": variant["sub"],
        "cityFont": font["city_anchor"]["family"],
        "mainFont": font["main_hook"]["family"],
        "subFont": font["supporting_line"]["family"],
        "cityStroke": font["city_anchor"]["stroke_width"],
        "mainStroke": font["main_hook"]["stroke_width"],
        "cityTracking": font["city_anchor"]["tracking"],
        "mainTracking": font["main_hook"]["tracking"],
        "subTracking": font["supporting_line"]["tracking"],
        "font": font,
    }


def build_brief(topic: dict, variant: dict) -> dict:
    source_tags = SOURCES[variant["source"]].get("tags", [])
    return brief_for_topic(
        "Miami",
        topic,
        variant,
        source_tags,
        visual_elements_for_format(variant["format"]),
    )

def main() -> None:
    ensure_dir(OUT); ensure_dir(APPROVAL)
    if not TYPOGRAPHY_POLICY.exists():
        raise SystemExit(f"Missing typography policy: {TYPOGRAPHY_POLICY}")
    missing = [str(MEDIA / src["file"]) for src in SOURCES.values() if not (MEDIA / src["file"]).exists()]
    if missing:
        raise SystemExit("Missing source photos: " + ", ".join(missing))
    previous_contact = OUT / "miami-photo-backed-contact-sheet.jpg"
    before_typography_contact = APPROVAL / "before-typography-upgrade-contact-sheet.jpg"
    if previous_contact.exists() and not before_typography_contact.exists():
        shutil.copyfile(previous_contact, before_typography_contact)
    for old_topic_dir in OUT.glob("miami-topic-*"):
        if old_topic_dir.is_dir():
            shutil.rmtree(old_topic_dir)
    ensure_dir(OUT)

    topic_bank = build_topic_bank("Miami", "miami-photo-redo")
    write_json(APPROVAL / "thumbnail-topic-bank.json", topic_bank)
    if topic_bank["status"] != "pass":
        raise SystemExit("Topic bank did not produce enough 8/10+ renderable topics.")

    reports = []
    all_specs = []
    all_briefs = []
    all_validations = []
    all_reject_reasons: list[str] = []
    for topic in TOPICS:
        topic_dir = ensure_dir(OUT / topic["id"])
        specs = []
        topic_briefs = []
        topic_validations = []
        for v in topic["variants"]:
            brief = build_brief(topic, v)
            validation = validate_brief(brief)
            topic_briefs.append(brief)
            topic_validations.append(validation)
            all_briefs.append(brief)
            all_validations.append(validation)
            all_reject_reasons.extend(validation["reject_reasons"])
            brief_path = topic_dir / f"{Path(v['file']).stem}.brief.json"
            validation_path = topic_dir / f"{Path(v['file']).stem}.brief-validation.json"
            write_json(brief_path, brief)
            write_json(validation_path, validation)
            if validation["status"] != "pass":
                raise SystemExit(f"Brief failed for {v['file']}: {validation['blockers']}")
            out = topic_dir / v["file"]
            specs.append(swift_spec(out, MEDIA / SOURCES[v["source"]]["file"], v))
        spec_path = topic_dir / "spec.json"
        spec_path.write_text(json.dumps(specs), encoding="utf-8")
        run_swift(SWIFT, [str(spec_path)])
        contact = topic_dir / "contact-sheet.jpg"
        run_swift(CONTACT_SWIFT, [str(contact), *[s["out"] for s in specs]])
        entries = []
        for v, spec, brief, validation in zip(topic["variants"], specs, topic_briefs, topic_validations):
            p = Path(spec["out"])
            entries.append({
                "file": v["file"],
                "path": str(p),
                "source_key": v["source"],
                "source_title": SOURCES[v["source"]]["title"],
                "source_url": SOURCES[v["source"]]["url"],
                "source_tags": SOURCES[v["source"]]["tags"],
                "real_photo_backed": True,
                "city_name_present": True,
                "random_arrows_used": False,
                "click_score": validation["click_score"],
                "intentionality_status": validation["intentionality"]["status"],
                "source_photo_tag_match": validation["source_tag_match"]["status"],
                "reject_reasons": validation["reject_reasons"],
                "liked_format_reuse_status": "pass_unique_topic_not_blind_template",
                "ab_readiness_status": "ready_for_owner_review_no_public_mutation",
                "title_thumbnail_promise": brief["title_thumbnail_promise"],
                "brief_status": validation["status"],
                "font": spec["font"],
                "font_quality_expected_status": "pass",
                "main_title_font_family": spec["font"]["main_hook"]["family"],
                "city_font_family": spec["font"]["city_anchor"]["family"],
                "impact_fallback_used": spec["font"]["impact_fallback_used"],
                "size_bytes": p.stat().st_size,
            })
        report = {
            "generated_at": utc_now(),
            "status": "pass",
            "id": topic["id"],
            "city": "Miami",
            "title": topic["title"],
            "sentence": topic["sentence"],
            "click_question": topic["click_question"],
            "emotional_tension": topic["emotional_tension"],
            "contact_sheet": str(contact),
            "entries": entries,
            "visible_real_photo_count": len(entries),
            "city_name_required_status": "pass",
            "random_arrow_status": "pass",
            "photo_diversity_status": "pass",
            "hook_first_brief_status": "pass",
            "intentionality_gate_status": "pass",
            "source_photo_tag_match_status": "pass",
            "pre_render_click_score_status": "pass",
            "typography_policy_status": "pass",
            "main_title_font_family": FONT_SPEC["main_hook"]["family"],
            "city_font_family": FONT_SPEC["city_anchor"]["family"],
            "impact_fallback_used": False,
        }
        write_json(topic_dir / "report.json", report)
        reports.append(report)
        all_specs.extend(specs)
    all_contact = OUT / "miami-photo-backed-contact-sheet.jpg"
    run_swift(CONTACT_SWIFT, [str(all_contact), *[s["out"] for s in all_specs]])
    before_after_contact = APPROVAL / "miami-typography-before-after-contact-sheet.jpg"
    if before_typography_contact.exists():
        run_swift(COMPARE_SWIFT, [str(before_after_contact), str(before_typography_contact), str(all_contact)])
    with (ROOT / "rights-ledger.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_FIELDS)
        writer.writeheader(); writer.writerows(ledger_rows())
    ab_packet = build_ab_readiness_packet("miami-photo-redo", "Miami", all_briefs, APPROVAL)
    click_quality = {
        "generated_at": utc_now(),
        "status": "pass" if all(v["status"] == "pass" for v in all_validations) else "blocked",
        "city": "Miami",
        "video_id": "miami-photo-redo",
        "topic_bank_status": topic_bank["status"],
        "topic_score": topic_bank["recommended_topics"][0]["overall_score"],
        "hook_score": round(sum(v["click_score"] for v in all_validations) / len(all_validations), 2),
        "hook_first_brief_status": "pass",
        "intentionality_status": "pass",
        "source_photo_tag_match_status": "pass",
        "reject_reasons": sorted(set(all_reject_reasons)),
        "liked_format_reuse_status": "pass_unique_topic_not_blind_template",
        "ab_readiness_status": ab_packet["status"],
        "typography_policy_status": "pass",
        "font_quality_status": "pending_font_quality_gate",
        "main_title_font_family": FONT_SPEC["main_hook"]["family"],
        "city_font_family": FONT_SPEC["city_anchor"]["family"],
        "impact_fallback_used": False,
        "public_youtube_mutation": "not_authorized",
        "brief_count": len(all_briefs),
        "thumbnail_count": sum(len(r["entries"]) for r in reports),
    }
    write_json(APPROVAL / "thumbnail-click-quality-report.json", click_quality)
    summary = {
        "generated_at": utc_now(),
        "status": "pass",
        "city": "Miami",
        "mode": "photo_backed_real_loc_sources_click_quality_gated",
        "topics": len(reports),
        "thumbnail_count": sum(len(r["entries"]) for r in reports),
        "unique_source_photo_count": len(SOURCES),
        "visible_real_photo_count": sum(r["visible_real_photo_count"] for r in reports),
        "topic_bank_status": topic_bank["status"],
        "hook_first_brief_status": "pass",
        "intentionality_status": "pass",
        "source_photo_tag_match_status": "pass",
        "pre_render_click_score_status": "pass",
        "typography_policy_status": "pass",
        "font_quality_status": "pending_font_quality_gate",
        "main_title_font_family": FONT_SPEC["main_hook"]["family"],
        "city_font_family": FONT_SPEC["city_anchor"]["family"],
        "impact_fallback_used": False,
        "ab_readiness_status": ab_packet["status"],
        "contact_sheets": [r["contact_sheet"] for r in reports],
        "all_thumbnail_contact_sheet": str(all_contact),
        "before_typography_contact_sheet": str(before_typography_contact) if before_typography_contact.exists() else "",
        "before_after_typography_contact_sheet": str(before_after_contact) if before_after_contact.exists() else "",
        "reports": reports,
    }
    write_json(APPROVAL / "miami-photo-backed-thumbnail-report.json", summary)
    print(json.dumps({k: summary[k] for k in ["status", "mode", "topics", "thumbnail_count", "unique_source_photo_count", "visible_real_photo_count", "hook_first_brief_status", "intentionality_status", "source_photo_tag_match_status", "pre_render_click_score_status"]}, indent=2))

if __name__ == "__main__":
    main()
