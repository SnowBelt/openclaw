#!/usr/bin/env python3
"""Render topic-specific unique Pattern Lab thumbnail formats.

This is the non-template creative lane. It reuses source-first city packages and
renders three topic-specific thumbnails per package without Canva or YouTube.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from patternlab_common import BASE, ensure_dir, ffmpeg_cmd, output_root, utc_now

WIDTH = 1920
HEIGHT = 1080
MAX_BYTES = 2 * 1024 * 1024
TOPICS = {
    "chicago-topic-01": {
        "topic": "Chicago Reversed Its River. The Map Still Shows Why.",
        "sentence": "This episode follows the source trail behind Chicago reversing its river and how that engineering decision reshaped the city, its neighbors, and its map.",
        "variants": [
            {"id":"direction_reversal_map", "filename":"unique_01_river_flipped.png", "text1":"CHICAGO", "text2":"RIVER", "text3":"REVERSED", "format":"direction_reversal_map"},
            {"id":"wrong_way_river_poster", "filename":"unique_02_wrong_way.png", "text1":"WRONG", "text2":"WAY", "text3":"RIVER", "format":"wrong_way_river_poster"},
            {"id":"planning_file_cutout", "filename":"unique_03_1900_switch.png", "text1":"1900", "text2":"THE", "text3":"SWITCH", "format":"planning_file_cutout"}
        ]
    },
    "chicago-topic-02": {
        "topic": "The Hidden System That Put Chicago Above the Street.",
        "sentence": "This episode explains how Chicago built a layered city of elevated rail, stations, and streets that changed how people moved through the Loop.",
        "variants": [
            {"id":"above_street_cutaway", "filename":"unique_01_above_street.png", "text1":"ABOVE", "text2":"THE", "text3":"STREET", "format":"above_street_cutaway"},
            {"id":"loop_system_diagram", "filename":"unique_02_loop_secret.png", "text1":"THE", "text2":"LOOP'S", "text3":"SECRET", "format":"loop_system_diagram"},
            {"id":"raised_city_stack", "filename":"unique_03_raised_city.png", "text1":"RAISED", "text2":"CITY", "text3":"SYSTEM", "format":"raised_city_stack"}
        ]
    },
    "chicago-topic-03": {
        "topic": "Chicago’s Lakefront Was Made, Not Found.",
        "sentence": "This episode traces how Chicago’s lakefront became a constructed public edge through maps, landfill, parks, rail lines, and planning fights.",
        "variants": [
            {"id":"made_land_shoreline_tear", "filename":"unique_01_made_land.png", "text1":"CHICAGO", "text2":"MADE", "text3":"LAND", "format":"made_land_shoreline_tear"},
            {"id":"old_shore_missing_file", "filename":"unique_02_old_shore_gone.png", "text1":"OLD", "text2":"SHORE", "text3":"GONE", "format":"old_shore_missing_file"},
            {"id":"lakefront_blueprint_poster", "filename":"unique_03_lakefront_built.png", "text1":"LAKEFRONT", "text2":"WAS", "text3":"BUILT", "format":"lakefront_blueprint_poster"}
        ]
    }
}

SWIFT = r'''
import AppKit
import Foundation

struct Spec: Decodable {
    let output: String
    let format: String
    let text1: String
    let text2: String
    let text3: String
    let city: String
    let map: String
    let skyline: String
    let historic: String
    let underground: String
}

let width: CGFloat = 1920
let height: CGFloat = 1080
func color(_ hex: UInt32, alpha: CGFloat = 1.0) -> NSColor {
    NSColor(calibratedRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8) & 255)/255, blue: CGFloat(hex & 255)/255, alpha: alpha)
}
func font(_ name: String, _ size: CGFloat) -> NSFont { NSFont(name: name, size: size) ?? NSFont.boldSystemFont(ofSize: size) }
func para(_ align: NSTextAlignment = .left) -> NSMutableParagraphStyle { let p = NSMutableParagraphStyle(); p.alignment = align; p.lineBreakMode = .byClipping; return p }
func fit(_ text: String, _ name: String, _ max: CGFloat, _ min: CGFloat, _ w: CGFloat) -> NSFont { var s = max; while s > min { let f = font(name, s); if (text as NSString).size(withAttributes:[.font:f]).width <= w { return f }; s -= 4 }; return font(name, min) }
func fill(_ r: NSRect, _ c: NSColor) { c.setFill(); r.fill() }
func stroke(_ r: NSRect, _ c: NSColor, _ lw: CGFloat) { c.setStroke(); let p = NSBezierPath(rect: r); p.lineWidth = lw; p.stroke() }
func line(_ a: CGPoint, _ b: CGPoint, _ c: NSColor, _ lw: CGFloat) { c.setStroke(); let p = NSBezierPath(); p.move(to:a); p.line(to:b); p.lineWidth=lw; p.stroke() }
func text(_ s: String, _ r: NSRect, _ f: NSFont, _ fillColor: NSColor, _ strokeColor: NSColor = .black, _ sw: Int = 6, _ align: NSTextAlignment = .left, _ kern: CGFloat = -2) {
    let attrs:[NSAttributedString.Key:Any] = [.font:f,.foregroundColor:fillColor,.strokeColor:strokeColor,.strokeWidth:-sw,.paragraphStyle:para(align),.kern:kern]
    let sh:[NSAttributedString.Key:Any] = [.font:f,.foregroundColor:NSColor.black.withAlphaComponent(0.75),.paragraphStyle:para(align),.kern:kern]
    (s as NSString).draw(in:r.offsetBy(dx:7,dy:-7), withAttributes:sh)
    (s as NSString).draw(in:r, withAttributes:attrs)
}
func plain(_ s:String,_ r:NSRect,_ f:NSFont,_ c:NSColor,_ align:NSTextAlignment = .left) { (s as NSString).draw(in:r, withAttributes:[.font:f,.foregroundColor:c,.paragraphStyle:para(align)]) }
func image(_ path: String, _ r: NSRect, _ alpha: CGFloat = 1.0, _ xBias: CGFloat = 0.5, _ yBias: CGFloat = 0.5) throws {
    guard let img = NSImage(contentsOfFile:path) else { throw NSError(domain:"UniqueThumb", code:1, userInfo:[NSLocalizedDescriptionKey:"missing image \(path)"]) }
    let src = img.size
    let scale = max(r.width/src.width, r.height/src.height)
    let sw = r.width/scale, sh = r.height/scale
    let sx = max(0, min(src.width - sw, (src.width - sw) * xBias))
    let sy = max(0, min(src.height - sh, (src.height - sh) * yBias))
    img.draw(in:r, from:NSRect(x:sx,y:sy,width:sw,height:sh), operation:.sourceOver, fraction:alpha)
}
func arrow(_ from: CGPoint, _ to: CGPoint, _ c: NSColor) {
    line(from, to, c, 18)
    let dx = to.x - from.x, dy = to.y - from.y
    let ang = atan2(dy, dx)
    for off in [CGFloat.pi * 0.82, -CGFloat.pi * 0.82] {
        let p = CGPoint(x: to.x + cos(ang + off) * 70, y: to.y + sin(ang + off) * 70)
        line(to, p, c, 18)
    }
}
func save(_ img:NSImage, _ path:String) throws {
    guard let tiff=img.tiffRepresentation, let rep=NSBitmapImageRep(data:tiff), let data=rep.representation(using:.jpeg, properties:[.compressionFactor:0.82]) else { throw NSError(domain:"UniqueThumb", code:2) }
    try data.write(to: URL(fileURLWithPath:path), options:.atomic)
}
func render(_ spec: Spec) throws {
    let img = NSImage(size:NSSize(width:width,height:height)); img.lockFocus(); fill(NSRect(x:0,y:0,width:width,height:height), .black)
    switch spec.format {
    case "direction_reversal_map":
        try image(spec.map, NSRect(x:0,y:0,width:width,height:height), 1.0)
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x00111A, alpha:0.28))
        fill(NSRect(x:80,y:95,width:1760,height:850), color(0x00111A, alpha:0.72))
        try image(spec.skyline, NSRect(x:1090,y:140,width:660,height:470), 0.96)
        stroke(NSRect(x:1065,y:115,width:710,height:520), color(0xFFD335), 14)
        arrow(CGPoint(x:760,y:370), CGPoint(x:310,y:725), color(0xFF2438))
        arrow(CGPoint(x:355,y:650), CGPoint(x:755,y:305), color(0x00D7E6))
        text(spec.text1, NSRect(x:110,y:760,width:1320,height:170), fit(spec.text1,"Impact",180,110,1320), color(0xFFD335), .black, 8)
        text(spec.text2 + " " + spec.text3, NSRect(x:115,y:625,width:1280,height:120), fit(spec.text2 + " " + spec.text3,"Avenir Next Heavy",112,68,1280), .white, .black, 5)
        plain("THE FLOW WENT BACKWARD", NSRect(x:120,y:145,width:900,height:60), font("Avenir Next Heavy",54), color(0x00D7E6))
    case "wrong_way_river_poster":
        try image(spec.skyline, NSRect(x:0,y:0,width:width,height:height), 1.0)
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x000000, alpha:0.45))
        fill(NSRect(x:95,y:95,width:780,height:890), color(0xF4E5BE, alpha:0.94))
        plain("CITY ENGINEERING FILE", NSRect(x:135,y:875,width:700,height:42), font("Courier New Bold",36), color(0x2B2115), .center)
        text(spec.text1, NSRect(x:135,y:665,width:700,height:160), fit(spec.text1,"Impact",150,90,700), color(0xE1192B), .black, 4, .center)
        text(spec.text2, NSRect(x:135,y:505,width:700,height:150), fit(spec.text2,"Impact",145,90,700), color(0xE1192B), .black, 4, .center)
        text(spec.text3, NSRect(x:135,y:355,width:700,height:135), fit(spec.text3,"Impact",125,80,700), color(0x17110A), color(0x17110A), 0, .center)
        for y in stride(from:250, through:320, by:30) { fill(NSRect(x:180,y:CGFloat(y),width:560,height:8), color(0x2B2115, alpha:0.65)) }
        arrow(CGPoint(x:1320,y:760), CGPoint(x:1090,y:365), color(0xFFD335))
        arrow(CGPoint(x:1160,y:315), CGPoint(x:1395,y:690), color(0xFF2438))
    case "planning_file_cutout":
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x0B1016))
        try image(spec.map, NSRect(x:880,y:0,width:1040,height:height), 0.88)
        fill(NSRect(x:880,y:0,width:1040,height:height), color(0x00D7E6, alpha:0.14))
        fill(NSRect(x:80,y:110,width:880,height:850), color(0xF2D59D))
        stroke(NSRect(x:80,y:110,width:880,height:850), color(0x2B2115), 12)
        plain("SANITARY DISTRICT MAP", NSRect(x:130,y:850,width:780,height:48), font("Courier New Bold",42), color(0x2B2115), .center)
        text(spec.text1, NSRect(x:140,y:670,width:760,height:150), fit(spec.text1,"Georgia Bold",136,92,760), color(0xB00020), .black, 1, .center)
        text(spec.text2 + " " + spec.text3, NSRect(x:140,y:520,width:760,height:120), fit(spec.text2 + " " + spec.text3,"Avenir Next Heavy",92,58,760), color(0x17110A), .black, 0, .center)
        fill(NSRect(x:185,y:430,width:330,height:28), color(0x080808)); fill(NSRect(x:585,y:430,width:210,height:28), color(0x080808)); plain("river direction changed after approval", NSRect(x:155,y:380,width:750,height:38), font("Courier New Bold",30), color(0x2B2115), .center)
    case "above_street_cutaway":
        try image(spec.underground, NSRect(x:0,y:0,width:width,height:height), 1.0)
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x000000, alpha:0.48))
        fill(NSRect(x:0,y:540,width:width,height:70), color(0xFFD335))
        text(spec.text1, NSRect(x:105,y:690,width:1720,height:170), fit(spec.text1,"Impact",160,100,1720), color(0xFFD335), .black, 8, .center)
        text(spec.text2 + " " + spec.text3, NSRect(x:105,y:420,width:1720,height:150), fit(spec.text2 + " " + spec.text3,"Impact",135,72,1720), .white, .black, 7, .center)
        plain("STREET LEVEL", NSRect(x:120,y:555,width:500,height:48), font("Avenir Next Heavy",42), color(0x00111A))
        plain("SYSTEM BELOW / CITY ABOVE", NSRect(x:1120,y:555,width:680,height:48), font("Avenir Next Heavy",42), color(0x00111A), .right)
    case "loop_system_diagram":
        try image(spec.map, NSRect(x:0,y:0,width:width,height:height), 1.0)
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x00111A, alpha:0.62))
        try image(spec.skyline, NSRect(x:1090,y:0,width:830,height:height), 0.8)
        let loop = NSBezierPath(ovalIn:NSRect(x:250,y:190,width:740,height:640)); color(0xFFD335).setStroke(); loop.lineWidth=28; loop.stroke()
        for a in [0,90,180,270] { let rad = CGFloat(a) * .pi / 180; fill(NSRect(x:610+cos(rad)*370-20,y:510+sin(rad)*320-20,width:40,height:40), color(0xFF2438)) }
        text(spec.text1, NSRect(x:90,y:790,width:920,height:90), font("Impact",86), .white, .black, 5)
        text(spec.text2, NSRect(x:90,y:650,width:920,height:140), fit(spec.text2,"Impact",130,90,920), color(0xFFD335), .black, 7)
        text(spec.text3, NSRect(x:90,y:520,width:920,height:120), fit(spec.text3,"Impact",116,72,920), .white, .black, 6)
    case "raised_city_stack":
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x050505))
        try image(spec.skyline, NSRect(x:0,y:545,width:width,height:535), 0.9)
        try image(spec.underground, NSRect(x:0,y:0,width:width,height:480), 0.86)
        fill(NSRect(x:0,y:500,width:width,height:48), color(0xFFD335))
        text(spec.text1 + " " + spec.text2, NSRect(x:80,y:700,width:1760,height:180), fit(spec.text1 + " " + spec.text2,"Impact",165,88,1760), .white, .black, 8, .center)
        text(spec.text3, NSRect(x:240,y:315,width:1440,height:145), fit(spec.text3,"Avenir Next Heavy",116,68,1440), color(0xFFD335), .black, 5, .center)
        plain("CITY ABOVE", NSRect(x:90,y:512,width:500,height:38), font("Avenir Next Heavy",36), color(0x00111A)); plain("TRANSIT BELOW", NSRect(x:1320,y:512,width:520,height:38), font("Avenir Next Heavy",36), color(0x00111A), .right)
    case "made_land_shoreline_tear":
        try image(spec.map, NSRect(x:0,y:0,width:960,height:height), 1.0)
        try image(spec.skyline, NSRect(x:960,y:0,width:960,height:height), 1.0)
        fill(NSRect(x:900,y:0,width:120,height:height), color(0xFFFFFF))
        for y in stride(from:0, through:1080, by:70) { line(CGPoint(x:915,y:CGFloat(y)), CGPoint(x:1005,y:CGFloat(y+35)), color(0x00111A), 10) }
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x00111A, alpha:0.18))
        text(spec.text1, NSRect(x:90,y:720,width:1740,height:170), fit(spec.text1,"Impact",160,90,1740), color(0xFFD335), .black, 8, .center)
        text(spec.text2 + " " + spec.text3, NSRect(x:90,y:545,width:1740,height:150), fit(spec.text2 + " " + spec.text3,"Impact",140,82,1740), .white, .black, 7, .center)
        plain("THE SHORELINE MOVED", NSRect(x:610,y:155,width:760,height:58), font("Avenir Next Heavy",52), color(0x00D7E6), .center)
    case "old_shore_missing_file":
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x102030))
        try image(spec.historic, NSRect(x:920,y:0,width:1000,height:height), 0.85)
        fill(NSRect(x:95,y:95,width:850,height:890), color(0xEFE1BD))
        plain("LAKEFRONT PLANNING FILE", NSRect(x:145,y:865,width:750,height:42), font("Courier New Bold",38), color(0x2B2115), .center)
        text(spec.text1, NSRect(x:145,y:690,width:750,height:130), fit(spec.text1,"Impact",126,76,750), color(0x17110A), .black, 1, .center)
        text(spec.text2, NSRect(x:145,y:545,width:750,height:130), fit(spec.text2,"Impact",126,76,750), color(0xB00020), .black, 2, .center)
        text(spec.text3, NSRect(x:145,y:400,width:750,height:120), fit(spec.text3,"Impact",112,70,750), color(0x17110A), .black, 1, .center)
        fill(NSRect(x:220,y:335,width:250,height:30), color(0x080808)); fill(NSRect(x:525,y:335,width:280,height:30), color(0x080808)); plain("shoreline before the park plan", NSRect(x:170,y:285,width:700,height:38), font("Courier New Bold",30), color(0x2B2115), .center)
    default:
        try image(spec.skyline, NSRect(x:0,y:0,width:width,height:height), 1.0)
        fill(NSRect(x:0,y:0,width:width,height:height), color(0x00111A, alpha:0.50))
        for x in stride(from:0, through:1920, by:160) { line(CGPoint(x:CGFloat(x),y:0), CGPoint(x:CGFloat(x)+360,y:1080), color(0x00D7E6, alpha:0.30), 5) }
        fill(NSRect(x:90,y:100,width:1740,height:840), color(0x00111A, alpha:0.58))
        text(spec.text1, NSRect(x:130,y:700,width:1660,height:150), fit(spec.text1,"Impact",140,76,1660), color(0xFFD335), .black, 8, .center)
        text(spec.text2 + " " + spec.text3, NSRect(x:130,y:515,width:1660,height:150), fit(spec.text2 + " " + spec.text3,"Impact",140,76,1660), .white, .black, 8, .center)
        plain("MAP • PARKS • FILL • RAIL", NSRect(x:430,y:260,width:1060,height:60), font("Avenir Next Heavy",52), color(0x00D7E6), .center)
    }
    img.unlockFocus(); try save(img, spec.output)
}
let specs = try JSONDecoder().decode([Spec].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
for spec in specs { try render(spec) }
'''


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def choose_assets(root: Path) -> dict[str, str]:
    manifest_path = root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json"
    manifest = read_json(manifest_path)
    assets = manifest.get("historical_assets", []) + manifest.get("modern_context_assets", [])
    def pick(*terms: str, source_class: str | None = None) -> str:
        for asset in assets:
            text = " ".join(str(asset.get(k, "")) for k in ("filename", "source_title", "visual_category", "notes")).lower()
            if source_class and asset.get("source_class") != source_class:
                continue
            if all(term in text for term in terms):
                return str(root / asset["filename"])
        for asset in assets:
            if source_class and asset.get("source_class") == source_class:
                return str(root / asset["filename"])
        return str(root / assets[0]["filename"])
    return {
        "map": str(root / "images" / "city_source_map.png"),
        "skyline": pick("skyline", source_class="modern_context"),
        "historic": pick("historic", source_class="historical_evidence"),
        "underground": pick("subway", source_class="historical_evidence"),
    }


def run_swift(specs: list[dict]) -> None:
    with tempfile.TemporaryDirectory(prefix="patternlab-unique-") as tmp:
        tmp_path = Path(tmp)
        swift_path = tmp_path / "render.swift"
        spec_path = tmp_path / "specs.json"
        swift_path.write_text(SWIFT, encoding="utf-8")
        spec_path.write_text(json.dumps(specs), encoding="utf-8")
        env = {**__import__("os").environ, "CLANG_MODULE_CACHE_PATH": str(tmp_path / "clang-module-cache"), "TMPDIR": str(tmp_path)}
        result = subprocess.run(["swift", str(swift_path), str(spec_path)], capture_output=True, text=True, check=False, env=env)
        if result.returncode != 0:
            raise SystemExit(result.stderr[-4000:])


def render_contact_sheet(root: Path, paths: list[Path]) -> Path:
    output = root / "review" / "unique-thumbnails" / "unique-contact-sheet.jpg"
    filter_complex = "".join(f"[{i}:v]scale=640:360[t{i}];" for i in range(len(paths))) + "".join(f"[t{i}]" for i in range(len(paths))) + f"hstack=inputs={len(paths)}[out]"
    cmd = [ffmpeg_cmd(), "-y"]
    for path in paths:
        cmd.extend(["-i", str(path)])
    cmd.extend(["-filter_complex", filter_complex, "-map", "[out]", "-frames:v", "1", str(output)])
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit(result.stderr[-4000:])
    return output


def build(video_id: str, config: dict) -> dict:
    root = output_root(video_id)
    out_dir = ensure_dir(root / "review" / "unique-thumbnails")
    assets = choose_assets(root)
    specs = []
    paths = []
    for variant in config["variants"]:
        output = out_dir / variant["filename"]
        specs.append({**variant, "output": str(output), "city": "Chicago", **assets})
        paths.append(output)
    run_swift(specs)
    contact = render_contact_sheet(root, paths)
    entries = []
    for variant, path in zip(config["variants"], paths):
        entries.append({
            "id": variant["id"],
            "format": variant["format"],
            "filename": str(path.relative_to(root)),
            "path": str(path),
            "exists": path.exists(),
            "size_bytes": path.stat().st_size if path.exists() else 0,
            "under_youtube_limit": path.exists() and path.stat().st_size <= MAX_BYTES,
            "source_first": True,
            "reuses_normal_ab_test_template": False,
        })
    report = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": "Chicago",
        "topic": config["topic"],
        "sentence": config["sentence"],
        "status": "pass" if all(item["exists"] and item["under_youtube_limit"] for item in entries) else "blocked",
        "mode": "unique_topic_format_test",
        "normal_ab_test_templates_reused": False,
        "source_first": True,
        "contact_sheet": str(contact),
        "entries": entries,
    }
    (out_dir / "unique-thumbnail-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (out_dir / "unique-thumbnail-report.md").write_text("\n".join([
        f"# Unique Thumbnail Format Test: {video_id}", "", f"Status: {report['status']}", f"Topic: {config['topic']}", f"Sentence: {config['sentence']}", "", *[f"- {item['id']}: `{item['filename']}`" for item in entries], ""
    ]), encoding="utf-8")
    return report


def main() -> None:
    reports = [build(video_id, config) for video_id, config in TOPICS.items()]
    summary = {"generated_at": utc_now(), "status": "pass" if all(r["status"] == "pass" for r in reports) else "blocked", "reports": reports}
    output = ensure_dir(BASE / "local-output" / "chicago-unique-format-test")
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": summary["status"], "topics": len(reports), "thumbnails": sum(len(r["entries"]) for r in reports)}, indent=2))


if __name__ == "__main__":
    main()
