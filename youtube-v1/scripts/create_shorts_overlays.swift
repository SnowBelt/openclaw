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

let deepCharcoal = color(0x111315)
let inkPanel = color(0x1B1A17, 0.90)
let archivalPaper = color(0xE8DDC5)
let oldMapBlue = color(0x2E5E73)
let evidenceAmber = color(0xC88A2D)
let copper = color(0x9B4F2F)
let captionWhite = color(0xF4F0E8)
let proofRed = color(0xB23A2E)
let mutedArchive = color(0xAFA58F)

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

func drawEvidenceGrid() {
    for x in stride(from: CGFloat(90), through: CGFloat(990), by: CGFloat(150)) {
        drawLine(x, 0, x, canvasHeight, color: oldMapBlue.withAlphaComponent(0.10), width: 1)
    }
    for y in stride(from: CGFloat(160), through: CGFloat(1760), by: CGFloat(160)) {
        drawLine(0, y, canvasWidth, y, color: archivalPaper.withAlphaComponent(0.055), width: 1)
    }
    drawLine(118, 330, 940, 620, color: evidenceAmber.withAlphaComponent(0.20), width: 9)
    drawLine(190, 1510, 900, 1320, color: oldMapBlue.withAlphaComponent(0.28), width: 7)
}

func drawBrandPill(_ brand: String, accent: NSColor) {
    fillRounded(58, 58, 964, 88, 28, inkPanel, oldMapBlue.withAlphaComponent(0.88), lineWidth: 3)
    fillRounded(78, 77, 140, 50, 16, archivalPaper.withAlphaComponent(0.95), nil)
    drawText("SOURCE", x: 92, y: 92, width: 112, height: 24, size: 22, weight: .bold, textColor: deepCharcoal, align: .center, mono: true)
    drawText(brand.uppercased(), x: 242, y: 84, width: 704, height: 34, size: 29, weight: .bold, textColor: accent, align: .center, mono: true)
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
    drawEvidenceGrid()
    drawBrandPill(brand, accent: kind == "bridge" ? evidenceAmber : archivalPaper)

    if kind == "first" {
        fillRounded(70, 430, 940, 500, 44, inkPanel, evidenceAmber, lineWidth: 5)
        fillRounded(94, 456, 18, 448, 9, evidenceAmber, nil)
        fillRounded(130, 486, 820, 82, 24, archivalPaper.withAlphaComponent(0.96), nil)
        drawText("DETROIT CITY FILE", x: 156, y: 512, width: 768, height: 30, size: 27, weight: .bold, textColor: deepCharcoal, align: .center, mono: true)
        drawText(text.uppercased(), x: 126, y: 600, width: 850, height: 172, size: 82, weight: .heavy, textColor: captionWhite, hook: true)
        drawText(subtext, x: 150, y: 790, width: 802, height: 84, size: 34, weight: .bold, textColor: mutedArchive)
    } else {
        fillRounded(74, 1306, 932, 352, 36, inkPanel, accent, lineWidth: 5)
        fillRounded(106, 1338, 112, 44, 14, archivalPaper.withAlphaComponent(0.96), nil)
        drawText(kind.uppercased(), x: 124, y: 1350, width: 76, height: 20, size: 18, weight: .bold, textColor: deepCharcoal, align: .center, mono: true)
        drawText(text, x: 118, y: 1410, width: 846, height: 116, size: 50, weight: .heavy, textColor: captionWhite, hook: kind == "hook")
        drawText(subtext, x: 128, y: 1536, width: 826, height: 82, size: 31, weight: .bold, textColor: kind == "bridge" ? evidenceAmber : mutedArchive)
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
