#!/usr/bin/env swift
import AppKit
import Foundation

let canvasWidth: CGFloat = 1920
let canvasHeight: CGFloat = 1080

struct Args {
    var videoID = "02"
    var outputRoot = ""
}

func parseArgs() -> Args {
    var args = Args()
    var index = 1
    let raw = CommandLine.arguments
    while index < raw.count {
        let item = raw[index]
        if item == "--video-id", index + 1 < raw.count {
            args.videoID = raw[index + 1]
            index += 2
        } else if item == "--output-root", index + 1 < raw.count {
            args.outputRoot = raw[index + 1]
            index += 2
        } else {
            index += 1
        }
    }
    if args.outputRoot.isEmpty {
        args.outputRoot = "youtube-v1/local-output/video-\(args.videoID)"
    }
    return args
}

func absolutePath(_ path: String) -> String {
    if path.hasPrefix("/") {
        return path
    }
    return URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(path).path
}

func color(_ hex: Int, _ alpha: CGFloat = 1.0) -> NSColor {
    let red = CGFloat((hex >> 16) & 0xff) / 255.0
    let green = CGFloat((hex >> 8) & 0xff) / 255.0
    let blue = CGFloat(hex & 0xff) / 255.0
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

let background = color(0x03080a)
let panel = color(0x061719, 0.90)
let panelSoft = color(0x082124, 0.72)
let cyan = color(0x00d5e8)
let cyanSoft = color(0x00bacc, 0.46)
let gold = color(0xf4c84c)
let red = color(0xf26355)
let green = color(0x46e09b)
let white = color(0xf4f7f8)
let muted = color(0xa6b7bb)
let grid = color(0x163339, 0.48)

func topRect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    return NSRect(x: x, y: canvasHeight - y - height, width: width, height: height)
}

func topPoint(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
    return NSPoint(x: x, y: canvasHeight - y)
}

func fillRounded(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ radius: CGFloat, _ fill: NSColor, _ stroke: NSColor? = nil, lineWidth: CGFloat = 2) {
    let path = NSBezierPath(roundedRect: topRect(x, y, width, height), xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke = stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func fillRect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ fill: NSColor) {
    fill.setFill()
    topRect(x, y, width, height).fill()
}

func strokeLine(_ points: [NSPoint], _ stroke: NSColor, lineWidth: CGFloat = 4) {
    guard let first = points.first else { return }
    let path = NSBezierPath()
    path.move(to: first)
    for point in points.dropFirst() {
        path.line(to: point)
    }
    stroke.setStroke()
    path.lineWidth = lineWidth
    path.lineJoinStyle = .round
    path.lineCapStyle = .round
    path.stroke()
}

func drawText(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular, color textColor: NSColor = white, align: NSTextAlignment = .left, mono: Bool = false) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = align
    paragraph.lineBreakMode = .byWordWrapping
    let font = mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
        .kern: 0,
    ]
    NSString(string: text).draw(in: topRect(x, y, width, height), withAttributes: attributes)
}

func drawGrid() {
    for x in stride(from: CGFloat(80), through: canvasWidth - 80, by: 64) {
        strokeLine([topPoint(x, 80), topPoint(x, canvasHeight - 80)], grid, lineWidth: 1)
    }
    for y in stride(from: CGFloat(90), through: canvasHeight - 90, by: 64) {
        strokeLine([topPoint(70, y), topPoint(canvasWidth - 70, y)], grid, lineWidth: 1)
    }
}

func drawBrandChrome() {
    background.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()
    drawGrid()
    fillRounded(76, 72, 1768, 936, 34, color(0x031011, 0.55), color(0x103a42, 0.80), lineWidth: 2)
    drawText("PATTERN LAB", x: 116, y: 102, width: 500, height: 38, size: 26, weight: .bold, color: cyan, mono: true)
    drawText("City. Source. System.", x: 116, y: 138, width: 520, height: 38, size: 24, weight: .semibold, color: muted)
    fillRect(116, 184, 400, 5, cyan)
}

func drawMiniSparkline(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, stroke: NSColor) {
    let points = [
        topPoint(x, y + height * 0.72),
        topPoint(x + width * 0.22, y + height * 0.56),
        topPoint(x + width * 0.42, y + height * 0.62),
        topPoint(x + width * 0.62, y + height * 0.34),
        topPoint(x + width * 0.86, y + height * 0.24),
    ]
    strokeLine(points, stroke, lineWidth: 6)
}

func drawArrow(from start: NSPoint, to end: NSPoint, stroke: NSColor, lineWidth: CGFloat = 9) {
    strokeLine([start, end], stroke, lineWidth: lineWidth)
    let angle = atan2(end.y - start.y, end.x - start.x)
    let length: CGFloat = 34
    let spread: CGFloat = 0.58
    let left = NSPoint(x: end.x - cos(angle - spread) * length, y: end.y - sin(angle - spread) * length)
    let right = NSPoint(x: end.x - cos(angle + spread) * length, y: end.y - sin(angle + spread) * length)
    strokeLine([left, end, right], stroke, lineWidth: lineWidth)
}

func drawCheckMark(x: CGFloat, y: CGFloat, size: CGFloat, stroke: NSColor) {
    strokeLine(
        [
            topPoint(x, y + size * 0.55),
            topPoint(x + size * 0.28, y + size * 0.80),
            topPoint(x + size, y + size * 0.12),
        ],
        stroke,
        lineWidth: max(8, size * 0.12)
    )
}

func drawXMark(x: CGFloat, y: CGFloat, size: CGFloat, stroke: NSColor) {
    strokeLine([topPoint(x, y), topPoint(x + size, y + size)], stroke, lineWidth: max(8, size * 0.12))
    strokeLine([topPoint(x + size, y), topPoint(x, y + size)], stroke, lineWidth: max(8, size * 0.12))
}

func drawThumbnailBase(_ tag: String, accent: NSColor) {
    background.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()
    drawGrid()
    fillRounded(80, 70, 1760, 940, 34, color(0x031011, 0.66), color(0x103a42, 0.84), lineWidth: 3)
    drawText("PATTERN LAB", x: 116, y: 104, width: 500, height: 38, size: 26, weight: .bold, color: cyan, mono: true)
    drawText(tag.uppercased(), x: 1320, y: 104, width: 430, height: 38, size: 24, weight: .bold, color: accent, align: .right, mono: true)
}

func drawScoreCard(x: CGFloat, y: CGFloat, title: String, value: String, body: String, accent: NSColor) {
    fillRounded(x, y, 360, 174, 20, panelSoft, accent, lineWidth: 3)
    drawText(title.uppercased(), x: x + 26, y: y + 24, width: 220, height: 28, size: 21, weight: .bold, color: accent, mono: true)
    drawText(body, x: x + 26, y: y + 60, width: 218, height: 50, size: 22, weight: .semibold, color: white)
    drawText(value, x: x + 26, y: y + 108, width: 150, height: 56, size: 55, weight: .heavy, color: accent, mono: true)
    drawMiniSparkline(x: x + 242, y: y + 90, width: 90, height: 58, stroke: accent)
}

func drawTable(x: CGFloat, y: CGFloat, width: CGFloat, rows: [(String, String, String, String)], accent: NSColor) {
    let rowHeight: CGFloat = 68
    fillRounded(x, y, width, CGFloat(rows.count + 1) * rowHeight, 16, color(0x051315, 0.84), color(0x1b4d56, 0.90), lineWidth: 2)
    let columns: [CGFloat] = [0, 0.30, 0.52, 0.74, 1.0]
    let headers = ["PATTERN", "PROOF", "RISK", "DECISION"]
    for index in 0..<headers.count {
        let cx = x + width * columns[index] + 24
        let cw = width * (columns[index + 1] - columns[index]) - 38
        drawText(headers[index], x: cx, y: y + 24, width: cw, height: 28, size: 18, weight: .bold, color: accent, mono: true)
    }
    for rowIndex in 0..<rows.count {
        let top = y + rowHeight * CGFloat(rowIndex + 1)
        fillRect(x + 18, top, width - 36, 1, color(0x2c4b52, 0.60))
        let row = rows[rowIndex]
        let values = [row.0, row.1, row.2, row.3]
        for index in 0..<values.count {
            let cx = x + width * columns[index] + 24
            let cw = width * (columns[index + 1] - columns[index]) - 38
            drawText(values[index], x: cx, y: top + 21, width: cw, height: 34, size: 22, weight: index == 3 ? .bold : .medium, color: index == 3 ? accent : white)
        }
    }
}

func drawGate(x: CGFloat, y: CGFloat, label: String, value: String, accent: NSColor) {
    fillRounded(x, y, 300, 114, 16, color(0x07191b, 0.86), accent, lineWidth: 3)
    drawText(label.uppercased(), x: x + 22, y: y + 22, width: 260, height: 26, size: 18, weight: .bold, color: accent, mono: true)
    drawText(value, x: x + 22, y: y + 58, width: 260, height: 34, size: 28, weight: .heavy, color: white)
}

func saveImage(_ filename: String, draw: () -> Void) throws {
    let image = NSImage(size: NSSize(width: canvasWidth, height: canvasHeight))
    image.lockFocus()
    NSGraphicsContext.current?.shouldAntialias = true
    draw()
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PatternLabImagePack", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create PNG data"])
    }
    try data.write(to: URL(fileURLWithPath: filename), options: .atomic)
}

func drawCityBlocks(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, accent: NSColor) {
    fillRounded(x, y, width, height, 26, color(0x07191b, 0.84), accent, lineWidth: 4)
    for row in 0..<4 {
        for col in 0..<5 {
            let bx = x + 34 + CGFloat(col) * ((width - 68) / 5)
            let by = y + 34 + CGFloat(row) * ((height - 68) / 4)
            fillRounded(bx, by, (width - 110) / 5, (height - 116) / 4, 8, color(0x12323a, 0.92), nil)
        }
    }
}

func drawMapRoute(accent: NSColor) {
    strokeLine([
        topPoint(250, 748),
        topPoint(520, 632),
        topPoint(760, 690),
        topPoint(1010, 520),
        topPoint(1295, 578),
        topPoint(1605, 392),
    ], accent, lineWidth: 18)
    drawArrow(from: topPoint(1295, 578), to: topPoint(1605, 392), stroke: accent, lineWidth: 13)
}

func thumbnailA() {
    drawThumbnailBase("emotional mystery", accent: gold)
    fillRounded(150, 178, 760, 590, 30, color(0x24100f, 0.84), red, lineWidth: 5)
    drawText("OLD BLOCK", x: 198, y: 224, width: 500, height: 54, size: 46, weight: .heavy, color: white)
    drawText("photo frame", x: 204, y: 292, width: 360, height: 38, size: 28, weight: .bold, color: muted)
    fillRounded(205, 365, 600, 236, 18, color(0xf1e0bf, 0.92), nil)
    drawText("STOREFRONTS", x: 242, y: 432, width: 480, height: 58, size: 50, weight: .heavy, color: color(0x2a1f14))
    drawText("PEOPLE  /  TRACKS  /  SIGNS", x: 250, y: 512, width: 450, height: 34, size: 25, weight: .bold, color: color(0x624728))
    fillRounded(1030, 178, 740, 590, 30, color(0x061719, 0.88), cyan, lineWidth: 5)
    drawText("TODAY", x: 1088, y: 224, width: 380, height: 54, size: 46, weight: .heavy, color: cyan)
    drawText("same place?", x: 1094, y: 292, width: 420, height: 38, size: 28, weight: .bold, color: muted)
    drawCityBlocks(x: 1110, y: 370, width: 520, height: 220, accent: cyan)
    drawXMark(x: 1440, y: 430, size: 120, stroke: red)
    drawText("WHAT VANISHED?", x: 260, y: 800, width: 1400, height: 110, size: 98, weight: .heavy, color: white, align: .center)
}

func thumbnailB() {
    drawThumbnailBase("map/system proof", accent: cyan)
    drawCityBlocks(x: 230, y: 220, width: 1280, height: 500, accent: color(0x22515a))
    drawMapRoute(accent: gold)
    fillRounded(1190, 250, 460, 154, 24, color(0x031011, 0.94), gold, lineWidth: 4)
    drawText("SOURCE MAP", x: 1232, y: 287, width: 380, height: 45, size: 38, weight: .heavy, color: white, align: .center)
    drawText("route / cut / system", x: 1240, y: 346, width: 360, height: 32, size: 24, weight: .bold, color: muted, align: .center)
    drawText("THE MAP", x: 210, y: 760, width: 700, height: 104, size: 94, weight: .heavy, color: white)
    drawText("CHANGED", x: 900, y: 760, width: 730, height: 104, size: 94, weight: .heavy, color: gold)
    fillRounded(420, 910, 1080, 62, 18, color(0x041416, 0.92), cyan, lineWidth: 3)
    drawText("CITY ANCHOR + PROOF OBJECT + 2-4 WORDS", x: 455, y: 928, width: 1010, height: 30, size: 25, weight: .heavy, color: white, align: .center)
}

func thumbnailC() {
    drawThumbnailBase("contrarian history", accent: red)
    fillRounded(150, 210, 730, 480, 30, color(0x061719, 0.90), cyan, lineWidth: 5)
    drawText("FAMILIAR STORY", x: 204, y: 260, width: 560, height: 58, size: 50, weight: .heavy, color: white)
    drawText("decline, simplified", x: 212, y: 338, width: 430, height: 42, size: 31, weight: .bold, color: muted)
    drawXMark(x: 640, y: 310, size: 120, stroke: red)
    fillRounded(1030, 210, 740, 480, 30, color(0x0c1d14, 0.90), gold, lineWidth: 5)
    drawText("SOURCE CLUE", x: 1086, y: 260, width: 560, height: 58, size: 50, weight: .heavy, color: white)
    drawText("map + photo + date", x: 1094, y: 338, width: 430, height: 42, size: 31, weight: .bold, color: muted)
    drawCheckMark(x: 1450, y: 308, size: 125, stroke: green)
    fillRounded(1120, 435, 460, 130, 18, color(0xf1e0bf, 0.92), nil)
    drawText("1930s MAP", x: 1165, y: 476, width: 360, height: 42, size: 36, weight: .heavy, color: color(0x2a1f14), align: .center)
    drawArrow(from: topPoint(880, 462), to: topPoint(1030, 462), stroke: gold)
    drawText("NOT THE", x: 250, y: 760, width: 650, height: 104, size: 92, weight: .heavy, color: white)
    drawText("WHOLE STORY", x: 780, y: 760, width: 920, height: 104, size: 92, weight: .heavy, color: red)
}

func citySourceMapVisual() {
    drawBrandChrome()
    drawText("City Source Map", x: 150, y: 230, width: 780, height: 76, size: 64, weight: .heavy, color: white)
    drawText("The map keeps receipts: place, route, source, and system.", x: 154, y: 316, width: 1050, height: 44, size: 29, weight: .medium, color: muted)
    drawCityBlocks(x: 150, y: 420, width: 1120, height: 360, accent: cyan)
    drawMapRoute(accent: gold)
    drawGate(x: 1340, y: 430, label: "city", value: "Detroit", accent: cyan)
    drawGate(x: 1340, y: 570, label: "source", value: "map + photo", accent: gold)
    drawGate(x: 1340, y: 710, label: "system", value: "route + policy", accent: green)
}

func archivalEvidenceBoardVisual() {
    drawBrandChrome()
    drawText("Archival Evidence Board", x: 150, y: 230, width: 980, height: 76, size: 62, weight: .heavy, color: white)
    drawText("Old photos are evidence, not decoration.", x: 154, y: 316, width: 860, height: 44, size: 30, weight: .medium, color: muted)
    drawTable(
        x: 150,
        y: 420,
        width: 1540,
        rows: [
            ("source", "archive photo", "low", "keep"),
            ("place", "street + block", "low", "verify"),
            ("date", "year visible", "medium", "cite"),
            ("claim", "what changed", "high", "prove"),
        ],
        accent: gold
    )
    fillRounded(420, 850, 1080, 72, 20, color(0x07191b, 0.92), cyan, lineWidth: 3)
    drawText("NO SOURCE, NO STORY", x: 470, y: 868, width: 980, height: 38, size: 34, weight: .heavy, color: white, align: .center)
}

func thenNowStructureVisual() {
    drawBrandChrome()
    drawText("Then / Now Structure", x: 150, y: 230, width: 920, height: 76, size: 62, weight: .heavy, color: white)
    drawText("A city-file visual must show what changed and why it mattered.", x: 154, y: 316, width: 1080, height: 44, size: 29, weight: .medium, color: muted)
    fillRounded(150, 420, 700, 360, 28, color(0x24100f, 0.82), red, lineWidth: 4)
    drawText("THEN", x: 210, y: 470, width: 300, height: 70, size: 64, weight: .heavy, color: white)
    drawText("tracks / signs / storefronts", x: 218, y: 570, width: 520, height: 44, size: 30, weight: .bold, color: muted)
    fillRounded(1070, 420, 700, 360, 28, color(0x061719, 0.86), cyan, lineWidth: 4)
    drawText("NOW", x: 1130, y: 470, width: 300, height: 70, size: 64, weight: .heavy, color: white)
    drawText("route / void / changed block", x: 1138, y: 570, width: 520, height: 44, size: 30, weight: .bold, color: muted)
    drawArrow(from: topPoint(880, 600), to: topPoint(1030, 600), stroke: gold)
}

func subscribeCityFileCardVisual() {
    drawBrandChrome()
    drawText("Subscribe", x: 150, y: 260, width: 760, height: 118, size: 104, weight: .heavy, color: white)
    drawText("FOR THE NEXT CITY FILE", x: 150, y: 400, width: 1180, height: 80, size: 68, weight: .heavy, color: gold)
    drawText("City. Source. System.", x: 154, y: 510, width: 820, height: 54, size: 40, weight: .bold, color: cyan)
    drawCityBlocks(x: 1070, y: 260, width: 610, height: 360, accent: cyan)
    fillRounded(260, 720, 1400, 88, 22, color(0x041416, 0.92), gold, lineWidth: 3)
    drawText("THE MAP KEEPS RECEIPTS", x: 310, y: 744, width: 1300, height: 40, size: 38, weight: .heavy, color: white, align: .center)
}

let args = parseArgs()
let root = absolutePath(args.outputRoot)
let imagesDir = URL(fileURLWithPath: root).appendingPathComponent("images").path
try FileManager.default.createDirectory(atPath: imagesDir, withIntermediateDirectories: true)

let renders: [(String, () -> Void)] = [
    ("thumbnail_candidate_a.png", thumbnailA),
    ("thumbnail_candidate_b.png", thumbnailB),
    ("thumbnail_candidate_c.png", thumbnailC),
    ("city_source_map.png", citySourceMapVisual),
    ("archival_evidence_board.png", archivalEvidenceBoardVisual),
    ("then_now_structure.png", thenNowStructureVisual),
    ("subscribe_city_file_card.png", subscribeCityFileCardVisual),
]

for (filename, render) in renders {
    let output = URL(fileURLWithPath: imagesDir).appendingPathComponent(filename).path
    try saveImage(output, draw: render)
    print("Generated \(output)")
}
