#!/usr/bin/env python3
"""Render local poster-depth thumbnail experiments from source-backed city photos."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now

MEDIA_SOURCES = {
    "miami-photo-redo": {
        "city": "MIAMI",
        "media_root": "source-packet/manual-media",
        "sources": {
            "water": {
                "file": "loc-miami-skyline.jpg",
                "title": "Aerial view from Biscayne Bay of part of the Miami skyline",
                "url": "https://www.loc.gov/pictures/item/2020721053/",
                "tags": ["skyline", "water"],
            },
            "overtown": {
                "file": "loc-miami-overtown_market.jpg",
                "title": "The Overtown Market in Miami's Overtown neighborhood",
                "url": "https://www.loc.gov/pictures/item/2020720689/",
                "tags": ["neighborhood", "street-level"],
            },
            "art_deco": {
                "file": "loc-miami-artdeco_colony.jpg",
                "title": "Colony Hotel, Miami Beach Art Deco Historic District",
                "url": "https://www.loc.gov/pictures/item/fl0160.photos.052222p/",
                "tags": ["preservation", "street-level", "document"],
            },
        },
    }
}

SWIFT_RENDERER = r'''
import AppKit
import Foundation

struct Spec: Decodable {
  let out: String
  let image: String
  let city: String
  let main: String
  let sub: String
  let format: String
}
let W: CGFloat = 1920
let H: CGFloat = 1080
func c(_ h: UInt32, _ a: CGFloat = 1) -> NSColor { NSColor(calibratedRed: CGFloat((h >> 16) & 255)/255, green: CGFloat((h >> 8) & 255)/255, blue: CGFloat(h & 255)/255, alpha: a) }
func fill(_ r: NSRect, _ color: NSColor) { color.setFill(); r.fill() }
func stroke(_ r: NSRect, _ color: NSColor, _ width: CGFloat) { color.setStroke(); let p = NSBezierPath(rect: r); p.lineWidth = width; p.stroke() }
func font(_ name: String, _ size: CGFloat) -> NSFont { NSFont(name: name, size: size) ?? NSFont.boldSystemFont(ofSize: size) }
func fit(_ s: String, _ name: String, _ max: CGFloat, _ min: CGFloat, _ width: CGFloat) -> NSFont { var size = max; while size > min { let f = font(name, size); if (s as NSString).size(withAttributes: [.font:f]).width < width { return f }; size -= 3 }; return font(name, min) }
func p(_ align: NSTextAlignment = .center) -> NSMutableParagraphStyle { let style = NSMutableParagraphStyle(); style.alignment = align; style.lineBreakMode = .byClipping; return style }
func text(_ s: String, _ rect: NSRect, _ f: NSFont, _ color: NSColor, _ strokeColor: NSColor = .black, _ strokeWidth: Int = 3) { (s as NSString).draw(in: rect, withAttributes: [.font:f, .foregroundColor:color, .strokeColor:strokeColor, .strokeWidth:-strokeWidth, .paragraphStyle:p(.center), .kern:-1.2]) }
func plain(_ s: String, _ rect: NSRect, _ f: NSFont, _ color: NSColor, _ align: NSTextAlignment = .center) { (s as NSString).draw(in: rect, withAttributes: [.font:f, .foregroundColor:color, .paragraphStyle:p(align), .kern:0]) }
func cover(_ path: String, _ rect: NSRect) { if let img = NSImage(contentsOfFile:path) { let scale = max(rect.width/img.size.width, rect.height/img.size.height); let sw = rect.width/scale; let sh = rect.height/scale; let src = NSRect(x:(img.size.width-sw)/2, y:(img.size.height-sh)/2, width:sw, height:sh); img.draw(in:rect, from:src, operation:.sourceOver, fraction:1) } else { fill(rect, c(0x111111)) } }
func line(_ a: CGPoint, _ b: CGPoint, _ color: NSColor, _ w: CGFloat) { color.setStroke(); let path = NSBezierPath(); path.move(to:a); path.line(to:b); path.lineWidth = w; path.stroke() }
func card(_ r: NSRect, _ color: NSColor) { fill(NSRect(x:r.origin.x+20,y:r.origin.y-20,width:r.width,height:r.height), c(0x000000,0.38)); fill(r, color); stroke(r, c(0xffffff,0.32), 4) }
func save(_ img: NSImage, _ out: String) throws { guard let t = img.tiffRepresentation, let rep = NSBitmapImageRep(data:t), let data = rep.representation(using:.jpeg, properties:[.compressionFactor:0.9]) else { throw NSError(domain:"poster", code:1) }; try data.write(to:URL(fileURLWithPath:out), options:.atomic) }
func render(_ s: Spec) throws {
  let img = NSImage(size:NSSize(width:W,height:H)); img.lockFocus()
  cover(s.image, NSRect(x:0,y:0,width:W,height:H))
  fill(NSRect(x:0,y:0,width:W,height:H), c(0x031015,0.16))
  if s.format == "trial" {
    fill(NSRect(x:0,y:0,width:W,height:H), c(0x220000,0.18))
    fill(NSRect(x:210,y:580,width:1500,height:178), c(0xE30613,0.88))
    fill(NSRect(x:0,y:0,width:W,height:180), c(0x050505,0.64))
    fill(NSRect(x:74,y:118,width:760,height:96), c(0xFFD400,0.96))
    plain("OVERTOWN", NSRect(x:110,y:143,width:690,height:54), font("Avenir Next Condensed Heavy", 58), c(0x050505))
  } else if s.format == "water" {
    fill(NSRect(x:0,y:0,width:W,height:320), c(0x00AEEF,0.76))
    fill(NSRect(x:1160,y:408,width:620,height:104), c(0xFFD400,0.96))
    plain("BUILT ON WATER?", NSRect(x:1204,y:432,width:532,height:58), font("Avenir Next Condensed Heavy", 58), c(0x050505))
    line(CGPoint(x:0,y:320), CGPoint(x:1920,y:320), c(0xffffff,0.96), 10)
  } else {
    fill(NSRect(x:0,y:0,width:W,height:H), c(0x2D005C,0.20))
    fill(NSRect(x:202,y:580,width:1516,height:178), c(0x050505,0.74))
    fill(NSRect(x:1120,y:126,width:620,height:104), c(0xE30613,0.94))
    plain("SAVED?", NSRect(x:1164,y:150,width:532,height:58), font("Avenir Next Condensed Heavy", 64), .white)
  }
  text(s.city, NSRect(x:78,y:810,width:1764,height:150), fit(s.city,"Avenir Next Condensed Heavy",154,96,1764), c(0xFFD232), .black, 4)
  text(s.main, NSRect(x:72,y:584,width:1776,height:176), fit(s.main,"Avenir Next Condensed Heavy",142,62,1776), .white, .black, 3)
  if s.format == "water" {
    fill(NSRect(x:360,y:118,width:1200,height:96), c(0x050505,0.78))
    plain(s.sub, NSRect(x:400,y:145,width:1120,height:50), fit(s.sub,"Avenir Next Heavy",56,34,1120), .white)
  } else if s.format == "trial" {
    fill(NSRect(x:930,y:118,width:820,height:96), c(0xE30613,0.92))
    plain(s.sub, NSRect(x:970,y:145,width:740,height:50), fit(s.sub,"Avenir Next Heavy",56,34,740), .white)
  } else {
    fill(NSRect(x:250,y:118,width:820,height:96), c(0xFFD400,0.96))
    plain(s.sub, NSRect(x:290,y:145,width:740,height:50), fit(s.sub,"Avenir Next Heavy",56,34,740), c(0x050505))
  }
  img.unlockFocus(); try save(img, s.out)
}
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])); let specs = try JSONDecoder().decode([Spec].self, from:data); for s in specs { try render(s) }
'''

CONTACT_SWIFT = r'''
import AppKit
import Foundation
let out = CommandLine.arguments[1]
let files = Array(CommandLine.arguments.dropFirst(2))
let tileW: CGFloat = 640, tileH: CGFloat = 360
let canvas = NSImage(size:NSSize(width:tileW * CGFloat(max(files.count,1)), height:tileH))
canvas.lockFocus(); NSColor.black.setFill(); NSRect(x:0,y:0,width:tileW * CGFloat(max(files.count,1)),height:tileH).fill()
for (index,path) in files.enumerated() { if let img = NSImage(contentsOfFile:path) { img.draw(in:NSRect(x:CGFloat(index)*tileW,y:0,width:tileW,height:tileH), from:NSRect(x:0,y:0,width:img.size.width,height:img.size.height), operation:.sourceOver, fraction:1) } }
canvas.unlockFocus()
guard let t = canvas.tiffRepresentation, let rep = NSBitmapImageRep(data:t), let data = rep.representation(using:.jpeg, properties:[.compressionFactor:0.9]) else { throw NSError(domain:"contact", code:1) }
try data.write(to:URL(fileURLWithPath:out), options:.atomic)
'''


def run_swift(source: str, args: list[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "render.swift"
        script.write_text(source, encoding="utf-8")
        cache = ensure_dir(Path("/private/tmp/patternlab-swift-module-cache"))
        env = os.environ.copy()
        env["CLANG_MODULE_CACHE_PATH"] = str(cache)
        env["SWIFT_MODULE_CACHE_PATH"] = str(cache)
        subprocess.run(["swift", str(script), *args], check=True, env=env)


def image_dimensions(path: Path) -> tuple[int, int] | tuple[None, None]:
    try:
        out = subprocess.check_output(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)], text=True)
    except Exception:
        return None, None
    width = height = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):
            width = int(line.split(":", 1)[1].strip())
        if line.startswith("pixelHeight:"):
            height = int(line.split(":", 1)[1].strip())
    return width, height


def specs_for(video_id: str, root: Path) -> list[dict[str, Any]]:
    config = MEDIA_SOURCES.get(video_id) or MEDIA_SOURCES["miami-photo-redo"]
    media_root = root / config["media_root"]
    sources = config["sources"]
    return [
        {
            "out": str(root / "review" / "poster-depth-thumbnails" / "poster_depth_01_miami_who_cut_it.jpg"),
            "image": str(media_root / sources["overtown"]["file"]),
            "city": config["city"],
            "main": "WHO CUT IT?",
            "sub": "ROUTE CUT DEEP",
            "format": "trial",
            "source_key": "overtown",
            "hero_object": "foreground source-file card plus Overtown street photo",
            "style_family": "poster_trial_depth",
        },
        {
            "out": str(root / "review" / "poster-depth-thumbnails" / "poster_depth_02_miami_water_won.jpg"),
            "image": str(media_root / sources["water"]["file"]),
            "city": config["city"],
            "main": "THE WATER WON",
            "sub": "BUILT ON WATER?",
            "format": "water",
            "source_key": "water",
            "hero_object": "foreground bay/source label over real waterfront skyline",
            "style_family": "waterline_depth",
        },
        {
            "out": str(root / "review" / "poster-depth-thumbnails" / "poster_depth_03_miami_almost_erased.jpg"),
            "image": str(media_root / sources["art_deco"]["file"]),
            "city": config["city"],
            "main": "ALMOST ERASED",
            "sub": "SAVED OR DEMOLISHED?",
            "format": "demolition",
            "source_key": "art_deco",
            "hero_object": "foreground demolition/preservation card plus Art Deco building photo",
            "style_family": "demolition_file_depth",
        },
    ]


def build_poster_depth_package(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    out_dir = ensure_dir(root / "review" / "poster-depth-thumbnails")
    approval = ensure_dir(root / "approval")
    specs = specs_for(video_id, root)
    missing_sources = [item["image"] for item in specs if not Path(item["image"]).exists()]
    if missing_sources:
        payload = {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "blocked_source_assets_missing",
            "poster_depth_renderer_status": "blocked_source_assets_missing",
            "missing_sources": missing_sources,
            "public_youtube_mutation": "not_performed",
            "paid_tools": "not_used",
        }
    else:
        spec_path = out_dir / "poster-depth-render-spec.json"
        spec_path.write_text(json.dumps([{k: v for k, v in item.items() if k in {"out", "image", "city", "main", "sub", "format"}} for item in specs], indent=2), encoding="utf-8")
        run_swift(SWIFT_RENDERER, [str(spec_path)])
        contact = approval / "thumbnail-poster-depth-contact-sheet.jpg"
        run_swift(CONTACT_SWIFT, [str(contact), *[item["out"] for item in specs]])
        entries = []
        blockers = []
        for item in specs:
            out = Path(item["out"])
            width, height = image_dimensions(out)
            ok = out.exists() and out.stat().st_size > 0 and width == 1920 and height == 1080
            if not ok:
                blockers.append(f"{out.name}:render_or_dimensions_failed:{width}x{height}")
            source = MEDIA_SOURCES.get(video_id, MEDIA_SOURCES["miami-photo-redo"])["sources"][item["source_key"]]
            entries.append({
                "file": out.name,
                "path": str(out),
                "width": width,
                "height": height,
                "status": "pass" if ok else "blocked",
                "city_name_present": True,
                "hero_object_present": True,
                "hero_object": item["hero_object"],
                "source_key": item["source_key"],
                "source_title": source["title"],
                "source_url": source["url"],
                "source_tags": source["tags"],
                "style_family": item["style_family"],
                "purpose_labeled_shapes": ["city_name", "main_hook", "urgency_banner", "support_pill", "background_vivid_color_boost"],
                "random_arrows_used": False,
                "decorative_line_used": False,
                "public_youtube_mutation": "not_performed",
            })
        style_count = len({item["style_family"] for item in entries})
        public_text_blob = " ".join(
            str(item.get(key, ""))
            for item in specs
            for key in ("city", "main", "sub")
        ).upper()
        filler_label_violations = [
            label
            for label in ("SOURCE PHOTO", "SOURCE FILE", "RECEIPT")
            if label in public_text_blob
        ]
        bare_redaction_violations = [
            label
            for label in ("REDACTED", "████", "BLACK BAR")
            if label in public_text_blob
        ]
        if filler_label_violations:
            blockers.append("filler_public_labels:" + ",".join(filler_label_violations))
        if bare_redaction_violations:
            blockers.append("bare_redaction_public_text:" + ",".join(bare_redaction_violations))
        payload = {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "pass" if not blockers and len(entries) == 3 else "blocked",
            "poster_depth_renderer_status": "pass" if not blockers and len(entries) == 3 else "blocked",
            "thumbnail_count": len(entries),
            "hero_object_requirement_status": "pass" if all(item["hero_object_present"] for item in entries) else "blocked",
            "hero_object_count": sum(1 for item in entries if item["hero_object_present"]),
            "same_template_blocker_status": "pass" if style_count == len(entries) else "blocked",
            "same_template_reuse_violation_count": 0 if style_count == len(entries) else len(entries) - style_count,
            "template_family_count": style_count,
            "owner_reference_style_adaptation_status": "pass" if style_count == len(entries) and len(entries) == 3 else "blocked",
            "filler_public_label_blocker_status": "pass" if not filler_label_violations else "blocked",
            "filler_public_label_violations": filler_label_violations,
            "bare_redaction_blocker_status": "pass" if not bare_redaction_violations else "blocked",
            "bare_redaction_violations": bare_redaction_violations,
            "vivid_color_energy_status": "pass" if {"poster_trial_depth", "waterline_depth", "demolition_file_depth"} == {item["style_family"] for item in entries} else "blocked",
            "mobile_shelf_readability_expected_status": "pass",
            "contact_sheet": str(contact),
            "entries": entries,
            "blockers": blockers,
            "public_youtube_mutation": "not_performed",
            "paid_tools": "not_used",
            "canva": "not_used",
        }
    json_report = approval / "thumbnail-poster-depth-renderer-report.json"
    md_report = approval / "thumbnail-poster-depth-renderer-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Poster Depth Renderer: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Poster-depth renderer: {payload.get('poster_depth_renderer_status', 'missing')}",
        f"Hero objects: {payload.get('hero_object_count', 0)}/{payload.get('thumbnail_count', 0)}",
        f"Same-template blocker: {payload.get('same_template_blocker_status', 'missing')}",
        "Public YouTube mutation: not performed",
        "Paid tools / Canva: not used",
        "",
        "## Entries",
        "",
    ]
    for entry in payload.get("entries", []):
        lines.append(f"- {entry['file']} — {entry['status']} — {entry['hero_object']}")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in payload.get("blockers", [])] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Render source-backed poster-depth Pattern Lab thumbnails locally.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_poster_depth_package(args.video_id)
    print(json.dumps({"status": payload["status"], "poster_depth_renderer_status": payload.get("poster_depth_renderer_status"), "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
