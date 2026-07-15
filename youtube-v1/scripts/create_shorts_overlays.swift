#!/usr/bin/env swift
import AppKit
import Foundation

let canvasWidth: CGFloat = 1080
let canvasHeight: CGFloat = 1920

func color(_ hex: Int, _ alpha: CGFloat = 1.0) -> NSColor {
    let red = CGFloat((hex >> 16) & 0xff) / 255.0
    let green = CGFloat((hex >> 8) & 0xff) / 255.0
    let blue = CGFloat(hex & 0xff) / 255.0
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

let deepCharcoal = color(0x14181C)
let inkPanel = color(0x14181C, 0.78)
let archivalPaper = color(0xF4F0E8)
let oldMapBlue = color(0x315A72)
let evidenceAmber = color(0xD6923B)
let copper = color(0x934A32)
let captionWhite = color(0xFFFDF8)
let proofRed = color(0xAE493A)
let mutedArchive = color(0xD4D0C6)

func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    return NSRect(x: x, y: canvasHeight - y - height, width: width, height: height)
}

func fillRounded(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ radius: CGFloat, _ fill: NSColor, _ stroke: NSColor? = nil, lineWidth: CGFloat = 3) {
    let path = NSBezierPath(roundedRect: rect(x, y, width, height), xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke = stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func drawLine(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, color: NSColor, width: CGFloat) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: x1, y: canvasHeight - y1))
    path.line(to: NSPoint(x: x2, y: canvasHeight - y2))
    color.setStroke()
    path.lineWidth = width
    path.stroke()
}

func bestFont(named names: [String], size: CGFloat, weight: NSFont.Weight, mono: Bool = false) -> NSFont {
    for name in names {
        if let font = NSFont(name: name, size: size) {
            return font
        }
    }
    return mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
}

func drawText(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular, textColor: NSColor = captionWhite, align: NSTextAlignment = .center, mono: Bool = false, hook: Bool = false) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = align
    paragraph.lineBreakMode = .byWordWrapping
    let font: NSFont
    if hook {
        font = bestFont(named: ["ArchivoBlack-Regular", "Archivo Black", "AvenirNextCondensed-Heavy", "Avenir Next Condensed Heavy"], size: size, weight: .heavy)
    } else if mono {
        font = bestFont(named: ["IBMPlexMono-Bold", "IBM Plex Mono Bold", "SFMono-Bold", "Menlo-Bold"], size: size, weight: weight, mono: true)
    } else {
        font = bestFont(named: ["Inter-SemiBold", "Inter Semi Bold", "AvenirNext-DemiBold", "Avenir Next Demi Bold", "HelveticaNeue-Medium"], size: size, weight: weight)
    }
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
        .kern: hook ? 0.8 : 0.0,
    ]
    NSString(string: text).draw(in: rect(x, y, width, height), withAttributes: attributes)
}

func overlayText(_ item: [String: Any], _ key: String) -> String {
    return (item[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

func drawSourceTag(_ brand: String, accent: NSColor) {
    fillRounded(54, 56, 282, 54, 18, inkPanel, nil)
    drawText(brand.uppercased(), x: 72, y: 72, width: 246, height: 22, size: 17, weight: .bold, textColor: accent, align: .left, mono: true)
}

func renderOverlay(item: [String: Any], output: String) throws {
    let kind = overlayText(item, "kind")
    let brand = overlayText(item, "brand")
    let text = overlayText(item, "text")
    let subtext = overlayText(item, "subtext")
    let accent = kind == "payoff" ? evidenceAmber : (kind == "proof" ? proofRed : oldMapBlue)
    let image = NSImage(size: NSSize(width: canvasWidth, height: canvasHeight))
    image.lockFocus()
    NSGraphicsContext.current?.shouldAntialias = true
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()
    drawSourceTag(brand, accent: kind == "bridge" ? evidenceAmber : archivalPaper)

    if kind == "first" {
        fillRounded(54, 1160, 972, 412, 36, inkPanel, nil)
        fillRounded(82, 1192, 12, 300, 6, evidenceAmber, nil)
        drawText(text.uppercased(), x: 122, y: 1214, width: 846, height: 172, size: 76, weight: .heavy, textColor: captionWhite, hook: true)
        drawText(subtext, x: 126, y: 1410, width: 830, height: 88, size: 30, weight: .bold, textColor: mutedArchive, align: .left)
    } else {
        fillRounded(54, 1424, 972, 300, 30, inkPanel, nil)
        drawText(kind.uppercased(), x: 88, y: 1452, width: 210, height: 22, size: 18, weight: .bold, textColor: accent, align: .left, mono: true)
        drawText(text, x: 88, y: 1492, width: 856, height: 96, size: 45, weight: .heavy, textColor: captionWhite, align: .left, hook: kind == "hook")
        drawText(subtext, x: 88, y: 1602, width: 856, height: 62, size: 26, weight: .bold, textColor: kind == "bridge" ? evidenceAmber : mutedArchive, align: .left)
    }

    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PatternLabShortsOverlay", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create PNG data"])
    }
    try data.write(to: URL(fileURLWithPath: output), options: .atomic)
}

func parseArgs() -> String {
    let args = CommandLine.arguments
    for index in 0..<args.count {
        if args[index] == "--spec", index + 1 < args.count {
            return args[index + 1]
        }
    }
    return ""
}

let specPath = parseArgs()
if specPath.isEmpty {
    fputs("Missing --spec\n", stderr)
    exit(2)
}

let data = try Data(contentsOf: URL(fileURLWithPath: specPath))
guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let overlays = payload["overlays"] as? [[String: Any]] else {
    fputs("Invalid overlay spec\n", stderr)
    exit(2)
}

for item in overlays {
    guard let output = item["output"] as? String else { continue }
    try FileManager.default.createDirectory(at: URL(fileURLWithPath: output).deletingLastPathComponent(), withIntermediateDirectories: true)
    try renderOverlay(item: item, output: output)
    print("Generated \(output)")
}
