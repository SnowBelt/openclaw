#!/usr/bin/env python3
"""Create a mobile shelf strip for current Pattern Lab thumbnails and reference comparison state."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_poster_depth_renderer import build_poster_depth_package
from patternlab_thumbnail_reference_library import validate_reference_library

CONTACT_SWIFT = r'''
import AppKit
import Foundation
struct Item: Decodable { let path: String; let label: String; let kind: String }
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let items = try JSONDecoder().decode([Item].self, from: data)
let tileW: CGFloat = 320, tileH: CGFloat = 180, labelH: CGFloat = 56
let cols = max(items.count, 1)
let canvas = NSImage(size: NSSize(width: tileW * CGFloat(cols), height: tileH + labelH))
func fill(_ r: NSRect, _ c: NSColor) { c.setFill(); r.fill() }
func para() -> NSMutableParagraphStyle { let p = NSMutableParagraphStyle(); p.alignment = .center; p.lineBreakMode = .byTruncatingTail; return p }
func drawText(_ s: String, _ r: NSRect, _ color: NSColor) { (s as NSString).draw(in: r, withAttributes: [.font:NSFont.boldSystemFont(ofSize:17), .foregroundColor:color, .paragraphStyle:para()]) }
canvas.lockFocus(); fill(NSRect(x:0,y:0,width:tileW * CGFloat(cols),height:tileH + labelH), NSColor.black)
for (index,item) in items.enumerated() {
  let x = CGFloat(index) * tileW
  if let img = NSImage(contentsOfFile: item.path) {
    let rect = NSRect(x:x,y:labelH,width:tileW,height:tileH)
    img.draw(in:rect, from:NSRect(x:0,y:0,width:img.size.width,height:img.size.height), operation:.sourceOver, fraction:1)
  }
  fill(NSRect(x:x,y:0,width:tileW,height:labelH), item.kind == "poster_depth" ? NSColor(calibratedRed:0.08,green:0.04,blue:0.0,alpha:1) : NSColor(calibratedRed:0.02,green:0.05,blue:0.06,alpha:1))
  drawText(item.label, NSRect(x:x+8,y:14,width:tileW-16,height:28), item.kind == "poster_depth" ? NSColor(calibratedRed:1,green:0.83,blue:0.22,alpha:1) : NSColor.white)
}
canvas.unlockFocus()
guard let t = canvas.tiffRepresentation, let rep = NSBitmapImageRep(data:t), let out = rep.representation(using:.jpeg, properties:[.compressionFactor:0.88]) else { throw NSError(domain:"shelf", code:1) }
try out.write(to:URL(fileURLWithPath: CommandLine.arguments[2]), options:.atomic)
'''


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def run_swift(source: str, args: list[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "shelf.swift"
        script.write_text(source, encoding="utf-8")
        cache = ensure_dir(Path("/private/tmp/patternlab-swift-module-cache"))
        env = os.environ.copy()
        env["CLANG_MODULE_CACHE_PATH"] = str(cache)
        env["SWIFT_MODULE_CACHE_PATH"] = str(cache)
        subprocess.run(["swift", str(script), *args], check=True, env=env)


def photo_backed_items(root: Path, limit: int = 3) -> list[dict[str, str]]:
    report = read_json(root / "approval" / "miami-photo-backed-thumbnail-report.json")
    items: list[dict[str, str]] = []
    for topic in report.get("reports", []):
        for entry in topic.get("entries", []):
            path = str(entry.get("path", ""))
            if path and Path(path).exists():
                items.append({"path": path, "label": str(entry.get("file", "current"))[:26], "kind": "current"})
            if len(items) >= limit:
                return items
    return items


def build_shelf_strip(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    poster, poster_json, _poster_md = build_poster_depth_package(video_id)
    library, library_json, _library_md = validate_reference_library(video_id)
    items = photo_backed_items(root, 3)
    for entry in poster.get("entries", [])[:3]:
        path = str(entry.get("path", ""))
        if path and Path(path).exists():
            items.append({"path": path, "label": str(entry.get("file", "poster"))[:26], "kind": "poster_depth"})
    out = approval / "thumbnail-mobile-shelf-strip.jpg"
    spec = approval / "thumbnail-mobile-shelf-strip-spec.json"
    spec.write_text(json.dumps(items, indent=2), encoding="utf-8")
    blockers: list[str] = []
    if not items:
        blockers.append("no_thumbnail_images_for_shelf_strip")
    else:
        run_swift(CONTACT_SWIFT, [str(spec), str(out)])
        if not out.exists() or out.stat().st_size == 0:
            blockers.append("shelf_strip_render_failed")
    refs_available = library.get("status") == "pass"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers and refs_available else "blocked_missing_owner_reference_images" if not refs_available else "blocked",
        "infrastructure_status": "pass" if not blockers else "blocked",
        "current_shelf_strip_status": "pass" if not blockers else "blocked",
        "reference_comparison_status": "pass" if refs_available else "blocked_missing_owner_reference_images",
        "strip_path": str(out),
        "item_count": len(items),
        "current_item_count": sum(1 for item in items if item["kind"] == "current"),
        "poster_depth_item_count": sum(1 for item in items if item["kind"] == "poster_depth"),
        "reference_library_report": display_path(library_json),
        "poster_depth_report": display_path(poster_json),
        "blockers": ["blocked_missing_owner_reference_images"] if not refs_available else blockers,
        "public_youtube_mutation": "not_performed",
        "paid_tools": "not_used",
    }
    json_report = approval / "thumbnail-mobile-shelf-strip-report.json"
    md_report = approval / "thumbnail-mobile-shelf-strip-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Mobile Shelf Strip: {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Infrastructure: {payload['infrastructure_status']}",
        f"Current shelf strip: {payload['current_shelf_strip_status']}",
        f"Reference comparison: {payload['reference_comparison_status']}",
        f"Strip: {display_path(out)}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
    ]
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Pattern Lab thumbnail mobile shelf strip.")
    parser.add_argument("--video-id", default="miami-photo-redo")
    args = parser.parse_args()
    payload, json_report, _md_report = build_shelf_strip(args.video_id)
    print(json.dumps({"status": payload["status"], "infrastructure_status": payload["infrastructure_status"], "report": display_path(json_report)}, indent=2))


if __name__ == "__main__":
    main()
