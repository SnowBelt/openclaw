#!/usr/bin/env python3
"""Render Miami unique-topic thumbnail tests.

This lane intentionally avoids the current AB-test templates. It is a design test
only when real source-photo sourcing is unavailable; do not use for public review
until the source-photo packet passes.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from patternlab_common import BASE, ensure_dir, utc_now

WIDTH = 1920
HEIGHT = 1080
MAX_BYTES = 2 * 1024 * 1024
ROOT = BASE / "local-output" / "miami-unique-format-test"

TOPICS = [
    {
        "id": "miami-topic-01-water-city",
        "title": "Miami Was Built on Water. The Map Explains Why.",
        "sentence": "This episode explains how Miami grew on low, wet land shaped by drainage, fill, canals, and the Everglades edge.",
        "variants": [
            {"file": "topic1_01_water_under_city.jpg", "format": "waterline_city_poster", "a": "MIAMI", "b": "WATER", "c": "UNDER IT"},
            {"file": "topic1_02_swamp_to_skyline.jpg", "format": "swamp_to_skyline_split", "a": "MIAMI", "b": "BUILT", "c": "ON WATER"},
            {"file": "topic1_03_drainage_file.jpg", "format": "drainage_file", "a": "MIAMI", "b": "THE", "c": "DRAINAGE FILE"},
        ],
    },
    {
        "id": "miami-topic-02-overtown-cut",
        "title": "The Highway That Cut Through Miami’s Overtown.",
        "sentence": "This episode follows the source trail behind highway construction through Overtown and how one route changed a neighborhood.",
        "variants": [
            {"file": "topic2_01_overtown_cut.jpg", "format": "freeway_cut", "a": "MIAMI", "b": "OVERTOWN", "c": "CUT"},
            {"file": "topic2_02_route_through_homes.jpg", "format": "route_over_blocks", "a": "MIAMI", "b": "ROUTE", "c": "THROUGH HOMES"},
            {"file": "topic2_03_neighborhood_file.jpg", "format": "neighborhood_file", "a": "MIAMI", "b": "WHO", "c": "DREW THIS?"},
        ],
    },
    {
        "id": "miami-topic-03-art-deco-rescue",
        "title": "Miami Almost Lost Its Art Deco Face.",
        "sentence": "This episode shows how Miami Beach’s Art Deco district became a preservation fight, not just a tourist postcard.",
        "variants": [
            {"file": "topic3_01_art_deco_saved.jpg", "format": "art_deco_saved", "a": "MIAMI", "b": "ALMOST", "c": "ERASED"},
            {"file": "topic3_02_pastel_postcard_warning.jpg", "format": "postcard_warning", "a": "MIAMI", "b": "POSTCARD", "c": "HAD A FIGHT"},
            {"file": "topic3_03_preservation_file.jpg", "format": "preservation_file", "a": "MIAMI", "b": "SAVED", "c": "THIS"},
        ],
    },
]

SWIFT = r'''
import AppKit
import Foundation

struct Spec: Decodable { let out:String; let format:String; let a:String; let b:String; let c:String }
let W:CGFloat = 1920, H:CGFloat = 1080
func col(_ h:UInt32,_ a:CGFloat=1)->NSColor{NSColor(calibratedRed:CGFloat((h>>16)&255)/255,green:CGFloat((h>>8)&255)/255,blue:CGFloat(h&255)/255,alpha:a)}
func font(_ n:String,_ s:CGFloat)->NSFont{NSFont(name:n,size:s) ?? NSFont.boldSystemFont(ofSize:s)}
func para(_ al: NSTextAlignment = .left)->NSMutableParagraphStyle{let p = NSMutableParagraphStyle();p.alignment = al;p.lineBreakMode = .byClipping;return p}
func fit(_ t:String,_ n:String,_ max:CGFloat,_ min:CGFloat,_ w:CGFloat)->NSFont{var s=max;while s>min{let f=font(n,s);if (t as NSString).size(withAttributes:[.font:f]).width<=w{return f};s-=4};return font(n,min)}
func fill(_ r:NSRect,_ c:NSColor){c.setFill();r.fill()}
func stroke(_ r:NSRect,_ c:NSColor,_ lw:CGFloat){c.setStroke();let p=NSBezierPath(rect:r);p.lineWidth=lw;p.stroke()}
func line(_ a:CGPoint,_ b:CGPoint,_ c:NSColor,_ lw:CGFloat){c.setStroke();let p=NSBezierPath();p.move(to:a);p.line(to:b);p.lineWidth=lw;p.stroke()}
func text(_ s:String,_ r:NSRect,_ f:NSFont,_ fc:NSColor,_ sc:NSColor = .black,_ sw: Int = 5,_ al: NSTextAlignment = .left,_ k: CGFloat = -2){let attrs:[NSAttributedString.Key:Any]=[.font:f,.foregroundColor:fc,.strokeColor:sc,.strokeWidth:-sw,.paragraphStyle:para(al),.kern:k];(s as NSString).draw(in:r,withAttributes:attrs)}
func plain(_ s: String,_ r: NSRect,_ f: NSFont,_ c: NSColor,_ al: NSTextAlignment = .left){(s as NSString).draw(in:r,withAttributes:[.font:f,.foregroundColor:c,.paragraphStyle:para(al)])}
func skyline(_ y: CGFloat,_ water: Bool = false){let base = water ? col(0x96D8EF) : col(0x0E2330); if water { fill(NSRect(x:0,y:0,width:W,height:y), col(0x0AA6C8)) }; for i in 0..<18{let x=CGFloat(i)*112+20;let h=CGFloat([170,260,330,220,420,300,250,520,360,280,450,230,310,390,240,350,285,210][i]);fill(NSRect(x:x,y:y,width:76,height:h),base);fill(NSRect(x:x+12,y:y+h-26,width:52,height:12),col(0xDDECF2,0.55))}}
func grid(_ alpha: CGFloat = 0.35){for x in stride(from:0,through:1920,by:120){line(CGPoint(x:CGFloat(x),y:0),CGPoint(x:CGFloat(x)+260,y:1080),col(0xFFFFFF,alpha),3)};for y in stride(from:80,through:1080,by:120){line(CGPoint(x:0,y:CGFloat(y)),CGPoint(x:1920,y:CGFloat(y)-120),col(0xFFFFFF,alpha),3)}}
func road(_ x:CGFloat,_ w:CGFloat,_ c:NSColor=col(0x111111)){fill(NSRect(x:x,y:0,width:w,height:H),c);fill(NSRect(x:x+w/2-6,y:0,width:12,height:H),col(0xFFD335))}
func deco(_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat,_ c:NSColor){fill(NSRect(x:x,y:y,width:w,height:h),c);stroke(NSRect(x:x,y:y,width:w,height:h),col(0x102030),8);for yy in stride(from:y+60,through:y+h-80,by:90){fill(NSRect(x:x+32,y:yy,width:w-64,height:34),col(0xFFFFFF,0.55))};fill(NSRect(x:x+w*0.38,y:y+h,width:w*0.24,height:90),c)}
func save(_ img:NSImage,_ path:String)throws{guard let t=img.tiffRepresentation,let r=NSBitmapImageRep(data:t),let d=r.representation(using:.jpeg,properties:[.compressionFactor:0.86])else{throw NSError(domain:"Miami",code:1)};try d.write(to:URL(fileURLWithPath:path),options:.atomic)}
func city(_ s:Spec,_ y:CGFloat=780){text(s.a,NSRect(x:80,y:y,width:1760,height:160),fit(s.a,"Impact",160,90,1760),col(0xFFD335),.black,7,.center)}
func render(_ s:Spec)throws{let img=NSImage(size:NSSize(width:W,height:H));img.lockFocus();fill(NSRect(x:0,y:0,width:W,height:H),col(0x07131C));
 switch s.format{
 case "waterline_city_poster":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0x9BD7EA));skyline(430,true);fill(NSRect(x:0,y:0,width:W,height:430),col(0x0280A2,0.82));line(CGPoint(x:0,y:430),CGPoint(x:1920,y:430),col(0xFFFFFF),18);city(s,805);text(s.b+" "+s.c,NSRect(x:120,y:600,width:1680,height:135),fit(s.b+" "+s.c,"Impact",128,76,1680),.white,.black,7,.center);plain("NOT A BEACH STORY",NSRect(x:580,y:210,width:760,height:70),font("Avenir Next Heavy",58),col(0xFFFFFF),.center)
 case "swamp_to_skyline_split":
  fill(NSRect(x:0,y:0,width:960,height:H),col(0x456A39));for i in 0..<38{fill(NSRect(x:CGFloat(i*26),y:CGFloat((i*47)%920),width:14,height:150),col(0x9BBF6A,0.75))};fill(NSRect(x:960,y:0,width:960,height:H),col(0x91D3EF));skyline(260,true);fill(NSRect(x:930,y:0,width:60,height:H),col(0xFFFFFF));city(s,785);text(s.b+" "+s.c,NSRect(x:90,y:555,width:1740,height:150),fit(s.b+" "+s.c,"Impact",134,76,1740),.white,.black,7,.center);plain("SWAMP",NSRect(x:180,y:150,width:420,height:70),font("Avenir Next Heavy",60),col(0xFFFFFF),.center);plain("SKYLINE",NSRect(x:1290,y:150,width:420,height:70),font("Avenir Next Heavy",60),col(0x00111A),.center)
 case "drainage_file":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0x05202A));grid(0.22);fill(NSRect(x:165,y:105,width:820,height:870),col(0xF1D99A));stroke(NSRect(x:165,y:105,width:820,height:870),col(0x241A10),12);plain("DRAINAGE DISTRICT FILE",NSRect(x:215,y:855,width:720,height:48),font("Courier New Bold",42),col(0x241A10),.center);text(s.a,NSRect(x:220,y:680,width:710,height:130),fit(s.a,"Georgia Bold",126,76,710),col(0x17110A),col(0x17110A),0,.center);text(s.b+" "+s.c,NSRect(x:210,y:470,width:740,height:170),fit(s.b+" "+s.c,"Impact",102,58,740),col(0xB00020),.black,2,.center);plain("canals changed the land",NSRect(x:260,y:360,width:620,height:44),font("Courier New Bold",34),col(0x241A10),.center);fill(NSRect(x:315,y:315,width:210,height:26),col(0x080808));plain("before approval",NSRect(x:560,y:310,width:270,height:38),font("Courier New Bold",28),col(0x241A10));fill(NSRect(x:1120,y:0,width:800,height:260),col(0x0280A2));for i in 0..<7{fill(NSRect(x:CGFloat(1120+i*105),y:90,width:72,height:CGFloat([120,180,150,230,170,140,200][i])),col(0x96D8EF))}
 case "freeway_cut":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0xD8C2A0));grid(0.42);road(820,280);fill(NSRect(x:0,y:0,width:W,height:H),col(0x00111A,0.18));city(s,790);text(s.b+" "+s.c,NSRect(x:120,y:590,width:1680,height:150),fit(s.b+" "+s.c,"Impact",128,70,1680),.white,.black,7,.center);plain("THE ROUTE CUT THROUGH",NSRect(x:520,y:155,width:880,height:70),font("Avenir Next Heavy",58),col(0xB00020),.center)
 case "route_over_blocks":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0xEFE2C3));grid(0.55);for x in stride(from:120,through:1600,by:260){fill(NSRect(x:CGFloat(x),y:190,width:150,height:110),col(0x8E5A3B));fill(NSRect(x:CGFloat(x)+35,y:330,width:90,height:170),col(0x9B6B48))};road(1010,230,col(0x191919));city(s,775);text(s.b+" "+s.c,NSRect(x:90,y:560,width:1760,height:150),fit(s.b+" "+s.c,"Impact",118,64,1760),col(0xB00020),.black,5,.center)
 case "neighborhood_file":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0x111111));fill(NSRect(x:120,y:80,width:1680,height:920),col(0xF0D9A7));stroke(NSRect(x:120,y:80,width:1680,height:920),col(0x25190E),10);plain("NEIGHBORHOOD ROUTE MEMO",NSRect(x:190,y:890,width:1540,height:50),font("Courier New Bold",44),col(0x25190E),.center);text(s.a,NSRect(x:190,y:710,width:1540,height:135),fit(s.a,"Georgia Bold",130,82,1540),col(0x17110A),col(0x17110A),0,.center);text(s.b+" "+s.c,NSRect(x:190,y:500,width:1540,height:150),fit(s.b+" "+s.c,"Impact",132,70,1540),col(0xB00020),.black,3,.center);plain("The approved route crossed",NSRect(x:360,y:390,width:640,height:40),font("Courier New Bold",34),col(0x25190E));fill(NSRect(x:1015,y:396,width:350,height:28),col(0x080808));plain("blocks",NSRect(x:1385,y:390,width:160,height:40),font("Courier New Bold",34),col(0x25190E))
 case "art_deco_saved":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0x9FE1E6));deco(170,130,360,620,col(0xF5A3B7));deco(610,90,420,710,col(0x8ED5E5));deco(1110,150,430,590,col(0xFFE08A));fill(NSRect(x:0,y:0,width:W,height:H),col(0x00111A,0.16));city(s,800);text(s.b+" "+s.c,NSRect(x:100,y:560,width:1720,height:150),fit(s.b+" "+s.c,"Impact",135,76,1720),.white,.black,7,.center);plain("A PRESERVATION FIGHT",NSRect(x:555,y:165,width:810,height:70),font("Avenir Next Heavy",58),col(0x00111A),.center)
 case "postcard_warning":
  fill(NSRect(x:0,y:0,width:W,height:H),col(0xF9D7A8));fill(NSRect(x:95,y:95,width:1730,height:890),col(0xFDE8C8));stroke(NSRect(x:95,y:95,width:1730,height:890),col(0xFFFFFF),22);deco(1180,180,420,570,col(0x72D7E8));city(s,745);text(s.b,NSRect(x:130,y:545,width:1040,height:150),fit(s.b,"Impact",126,72,1040),col(0xE1192B),.black,5,.center);text(s.c,NSRect(x:130,y:410,width:1040,height:120),fit(s.c,"Impact",96,54,1040),col(0x17110A),.black,3,.center);plain("NOT JUST TOURISM",NSRect(x:210,y:210,width:850,height:65),font("Avenir Next Heavy",54),col(0x0099B8),.center)
 default:
  fill(NSRect(x:0,y:0,width:W,height:H),col(0x101820));deco(1060,120,520,690,col(0xF2B2C0));fill(NSRect(x:90,y:110,width:900,height:850),col(0xF2D59D));stroke(NSRect(x:90,y:110,width:900,height:850),col(0x23190E),10);plain("PRESERVATION FILE",NSRect(x:140,y:855,width:800,height:48),font("Courier New Bold",42),col(0x23190E),.center);text(s.a,NSRect(x:140,y:690,width:800,height:130),fit(s.a,"Georgia Bold",126,78,800),col(0x17110A),col(0x17110A),0,.center);text(s.b+" "+s.c,NSRect(x:140,y:500,width:800,height:150),fit(s.b+" "+s.c,"Impact",130,74,800),col(0xB00020),.black,3,.center);plain("demolition request",NSRect(x:210,y:390,width:390,height:40),font("Courier New Bold",32),col(0x23190E));fill(NSRect(x:620,y:396,width:235,height:28),col(0x080808))
 }
 img.unlockFocus(); try save(img,s.out)
}
let data=try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]));let specs=try JSONDecoder().decode([Spec].self,from:data);for s in specs{try render(s)}
'''


def render_topic(topic: dict) -> dict:
    out_dir = ensure_dir(ROOT / topic["id"])
    specs = []
    paths = []
    for v in topic["variants"]:
        path = out_dir / v["file"]
        specs.append({"out": str(path), "format": v["format"], "a": v["a"], "b": v["b"], "c": v["c"]})
        paths.append(path)
    with tempfile.TemporaryDirectory(prefix="miami-unique-") as tmp:
        tmp_path = Path(tmp)
        swift = tmp_path / "render.swift"
        spec = tmp_path / "spec.json"
        swift.write_text(SWIFT, encoding="utf-8")
        spec.write_text(json.dumps(specs), encoding="utf-8")
        env = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(tmp_path / "clang-cache"), "TMPDIR": str(tmp_path)}
        result = subprocess.run(["swift", str(swift), str(spec)], capture_output=True, text=True, env=env, check=False)
        if result.returncode != 0:
            raise SystemExit(result.stderr[-4000:])
    contact = out_dir / "contact-sheet.jpg"
    contact_swift = r"""
import AppKit
import Foundation
let out = CommandLine.arguments[1]
let inputs = Array(CommandLine.arguments.dropFirst(2))
let canvas = NSImage(size: NSSize(width: 1920, height: 360))
canvas.lockFocus()
NSColor.black.setFill(); NSRect(x: 0, y: 0, width: 1920, height: 360).fill()
for (i, path) in inputs.enumerated() {
    if let img = NSImage(contentsOfFile: path) {
        img.draw(in: NSRect(x: CGFloat(i) * 640, y: 0, width: 640, height: 360), from: NSRect(x: 0, y: 0, width: img.size.width, height: img.size.height), operation: .sourceOver, fraction: 1.0)
    }
}
canvas.unlockFocus()
guard let tiff = canvas.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.88]) else { throw NSError(domain: "contact", code: 1) }
try data.write(to: URL(fileURLWithPath: out), options: .atomic)
"""
    with tempfile.TemporaryDirectory(prefix="miami-contact-") as tmp:
        tmp_path = Path(tmp)
        swift = tmp_path / "contact.swift"
        swift.write_text(contact_swift, encoding="utf-8")
        env = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(tmp_path / "clang-cache"), "TMPDIR": str(tmp_path)}
        result = subprocess.run(["swift", str(swift), str(contact), *map(str, paths)], capture_output=True, text=True, env=env, check=False)
        if result.returncode != 0:
            raise SystemExit(result.stderr[-4000:])
    entries = [{"file": v["file"], "format": v["format"], "path": str(p), "city_name_present": True, "random_arrows_used": False, "real_photo_backed": False, "source_photo_status": "blocked_dns_unavailable", "size_bytes": p.stat().st_size} for v, p in zip(topic["variants"], paths)]
    report = {"generated_at": utc_now(), "status": "design_review_only_blocked_for_real_photo_sourcing", "id": topic["id"], "title": topic["title"], "sentence": topic["sentence"], "city": "Miami", "city_name_required_status": "pass", "random_arrow_status": "pass", "photo_diversity_status": "blocked_real_photo_sourcing_unavailable", "contact_sheet": str(contact), "entries": entries}
    (out_dir / "report.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    return report


def main() -> None:
    ensure_dir(ROOT)
    reports = [render_topic(t) for t in TOPICS]
    summary = {"generated_at": utc_now(), "status": "design_review_only_blocked_for_real_photo_sourcing", "dns_blocker": "Local shell cannot resolve Wikimedia/OpenStreetMap hosts, so these are not source-photo-backed public candidates.", "reports": reports}
    (ROOT / "summary.json").write_text(json.dumps(summary, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"status": summary["status"], "topics": len(reports), "thumbnails": sum(len(r["entries"]) for r in reports)}, indent=2))

if __name__ == "__main__":
    main()
