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
        if raw[index] == "--video-id", index + 1 < raw.count {
            args.videoID = raw[index + 1]
            index += 2
        } else if raw[index] == "--output-root", index + 1 < raw.count {
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

func color(_ hex: Int, _ alpha: CGFloat = 1.0) -> NSColor {
    let red = CGFloat((hex >> 16) & 0xff) / 255.0
    let green = CGFloat((hex >> 8) & 0xff) / 255.0
    let blue = CGFloat(hex & 0xff) / 255.0
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

let bg = color(0x03080a)
let panel = color(0x061719, 0.90)
let panelSoft = color(0x092125, 0.72)
let grid = color(0x163339, 0.45)
let cyan = color(0x00d5e8)
let cyanSoft = color(0x00d5e8, 0.35)
let gold = color(0xf4c84c)
let red = color(0xf26355)
let green = color(0x46e09b)
let white = color(0xf4f7f8)
let muted = color(0xa6b7bb)

func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    return NSRect(x: x, y: canvasHeight - y - h, width: w, height: h)
}

func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
    return NSPoint(x: x, y: canvasHeight - y)
}

func fillRounded(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ fill: NSColor, _ stroke: NSColor? = nil, lineWidth: CGFloat = 2) {
    let path = NSBezierPath(roundedRect: rect(x, y, w, h), xRadius: r, yRadius: r)
    fill.setFill()
    path.fill()
    if let stroke = stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func line(_ points: [NSPoint], _ stroke: NSColor, width: CGFloat = 4) {
    guard let first = points.first else { return }
    let path = NSBezierPath()
    path.move(to: first)
    for item in points.dropFirst() {
        path.line(to: item)
    }
    stroke.setStroke()
    path.lineWidth = width
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.stroke()
}

func drawText(_ text: String, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular, textColor: NSColor = white, align: NSTextAlignment = .left, mono: Bool = false) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = align
    paragraph.lineBreakMode = .byWordWrapping
    let font = mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
        .kern: 0,
    ]
    NSString(string: text).draw(in: rect(x, y, w, h), withAttributes: attrs)
}

func drawGrid() {
    for x in stride(from: CGFloat(80), through: canvasWidth - 80, by: 64) {
        line([point(x, 80), point(x, canvasHeight - 80)], grid, width: 1)
    }
    for y in stride(from: CGFloat(90), through: canvasHeight - 90, by: 64) {
        line([point(70, y), point(canvasWidth - 70, y)], grid, width: 1)
    }
}

func base(_ title: String, _ subtitle: String, _ accent: NSColor = cyan) {
    bg.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()
    drawGrid()
    fillRounded(74, 70, 1772, 940, 34, color(0x031011, 0.58), color(0x103a42, 0.86), lineWidth: 3)
    drawText("PATTERN LAB", x: 116, y: 104, w: 420, h: 36, size: 26, weight: .bold, textColor: cyan, mono: true)
    drawText(title.uppercased(), x: 116, y: 162, w: 920, h: 68, size: 52, weight: .heavy, textColor: white)
    drawText(subtitle, x: 116, y: 232, w: 980, h: 42, size: 25, weight: .semibold, textColor: muted)
    fillRounded(116, 298, 470, 8, 4, accent)
}

func drawAvatarSilhouette(cx: CGFloat, cy: CGFloat, accent: NSColor, variant: Int) {
    let ring = NSBezierPath(ovalIn: rect(cx - 220, cy - 220, 440, 440))
    color(0x02090a, 0.78).setFill()
    ring.fill()
    accent.setStroke()
    ring.lineWidth = 10
    ring.stroke()

    let head = NSBezierPath(ovalIn: rect(cx - 78, cy - 130, 156, 156))
    color(0x111b1f).setFill()
    head.fill()
    accent.withAlphaComponent(0.45).setStroke()
    head.lineWidth = 5
    head.stroke()

    fillRounded(cx - 145, cy + 8, 290, 170, 80, color(0x111b1f), accent.withAlphaComponent(0.42), lineWidth: 5)
    if variant == 1 {
        line([point(cx - 72, cy - 38), point(cx - 24, cy - 10), point(cx + 18, cy - 46), point(cx + 80, cy - 16)], accent, width: 9)
    } else if variant == 2 {
        fillRounded(cx - 86, cy - 44, 172, 42, 20, color(0x02090a, 0.92), accent, lineWidth: 4)
        drawText("J", x: cx - 31, y: cy - 53, w: 62, h: 55, size: 44, weight: .heavy, textColor: accent, align: .center, mono: true)
    } else {
        line([point(cx - 92, cy - 22), point(cx - 50, cy - 58), point(cx + 8, cy - 12), point(cx + 78, cy - 62)], accent, width: 7)
        fillRounded(cx - 118, cy + 118, 236, 46, 22, color(0x02090a, 0.92), accent, lineWidth: 3)
        drawText("SIGNAL", x: cx - 92, y: cy + 128, w: 184, h: 30, size: 22, weight: .bold, textColor: accent, align: .center, mono: true)
    }
}

func drawCards(_ accent: NSColor) {
    let labels = [("PATTERN", "Find the signal"), ("CRITERIA", "Score what holds"), ("PROOF", "Show the artifact")]
    for (index, item) in labels.enumerated() {
        let x = CGFloat(116 + index * 390)
        fillRounded(x, 754, 340, 132, 18, panelSoft, index == 1 ? gold : accent, lineWidth: 3)
        drawText(item.0, x: x + 22, y: 778, w: 280, h: 26, size: 18, weight: .bold, textColor: index == 1 ? gold : accent, mono: true)
        drawText(item.1, x: x + 22, y: 816, w: 285, h: 42, size: 24, weight: .semibold)
    }
}

func avatarConceptA() {
    base("James Avatar A", "Faceless signal analyst. Human presence without fake realism.", cyan)
    drawAvatarSilhouette(cx: 1400, cy: 485, accent: cyan, variant: 1)
    drawText("JAMES", x: 116, y: 382, w: 680, h: 120, size: 110, weight: .heavy, textColor: white)
    drawText("Use for intro, outro, and decision moments. No realistic face. No lip-sync. No impersonation risk.", x: 120, y: 512, w: 820, h: 110, size: 32, weight: .semibold, textColor: muted)
    drawCards(cyan)
}

func avatarConceptB() {
    base("James Avatar B", "Criteria host. More branded, more graphic, less human.", gold)
    drawAvatarSilhouette(cx: 1400, cy: 485, accent: gold, variant: 2)
    drawText("JAMES", x: 116, y: 382, w: 680, h: 120, size: 110, weight: .heavy, textColor: white)
    drawText("Best for trust. The presenter is a judgment layer, not a deepfake talking head.", x: 120, y: 512, w: 820, h: 110, size: 32, weight: .semibold, textColor: muted)
    drawCards(gold)
}

func avatarConceptC() {
    base("James Avatar C", "Abstract voice mark. Safest, cleanest, least avatar-like.", cyan)
    drawAvatarSilhouette(cx: 1400, cy: 485, accent: cyan, variant: 3)
    drawText("JAMES", x: 116, y: 382, w: 680, h: 120, size: 110, weight: .heavy, textColor: white)
    drawText("Best if the channel should feel editorial and premium without a character host.", x: 120, y: 512, w: 820, h: 110, size: 32, weight: .semibold, textColor: muted)
    drawCards(cyan)
}

func drawMode(_ title: String, _ subtitle: String, _ mode: String, _ accent: NSColor) {
    base(title, subtitle, accent)
    fillRounded(116, 360, 680, 460, 28, panel, accent, lineWidth: 4)
    fillRounded(860, 360, 860, 460, 28, color(0x041112, 0.82), color(0x24515a, 0.85), lineWidth: 3)
    drawText(mode.uppercased(), x: 154, y: 400, w: 580, h: 70, size: 54, weight: .heavy, textColor: accent, mono: true)
    if mode == "lab mode" {
        let rows = ["Demand", "Proof", "Risk", "Decision"]
        for i in 0..<rows.count {
            fillRounded(900, CGFloat(410 + i * 78), 760, 52, 12, color(0x0a2226, 0.92), i == 3 ? green : accent.withAlphaComponent(0.75), lineWidth: 2)
            drawText(rows[i], x: 928, y: CGFloat(422 + i * 78), w: 270, h: 28, size: 24, weight: .bold)
            drawText(i == 3 ? "KEEP" : "\(92 - i * 7)", x: 1460, y: CGFloat(420 + i * 78), w: 160, h: 34, size: 28, weight: .heavy, textColor: i == 3 ? green : accent, align: .right, mono: true)
        }
        drawText("Tables move row by row. The viewer watches the test happen.", x: 154, y: 512, w: 580, h: 120, size: 34, weight: .semibold)
    } else if mode == "judgment mode" {
        for (i, item) in [("PASS", green), ("REVISE", gold), ("REJECT", red)].enumerated() {
            fillRounded(930, CGFloat(408 + i * 100), 650, 70, 16, color(0x0a2226, 0.92), item.1, lineWidth: 4)
            drawText(item.0, x: 970, y: CGFloat(424 + i * 100), w: 320, h: 38, size: 34, weight: .heavy, textColor: item.1, mono: true)
        }
        drawText("Decision moments get visual punctuation instead of another static image.", x: 154, y: 512, w: 580, h: 120, size: 34, weight: .semibold)
    } else {
        for i in 0..<5 {
            line([point(930 + CGFloat(i * 110), 650 - CGFloat(i % 2) * 55), point(985 + CGFloat(i * 110), 540 - CGFloat(i) * 18)], accent, width: 8)
            fillRounded(CGFloat(905 + i * 120), CGFloat(675 - i * 42), 64, 64, 14, color(0x092125, 0.95), accent, lineWidth: 3)
        }
        drawText("Generated context scenes appear only when the narration leaves the table.", x: 154, y: 512, w: 580, h: 120, size: 34, weight: .semibold)
    }
    drawText("Motion cadence: small movement every 2-4s, meaningful beat every 8-14s.", x: 154, y: 676, w: 580, h: 80, size: 25, weight: .bold, textColor: muted)
}

func save(_ output: String, draw: () -> Void) throws {
    let image = NSImage(size: NSSize(width: canvasWidth, height: canvasHeight))
    image.lockFocus()
    NSGraphicsContext.current?.shouldAntialias = true
    draw()
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PatternLabVisualUpgrade", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not render PNG"])
    }
    try FileManager.default.createDirectory(at: URL(fileURLWithPath: output).deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: URL(fileURLWithPath: output), options: .atomic)
    print("Generated \(output)")
}

let args = parseArgs()
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(args.outputRoot).path
let out = "\(root)/visual-upgrade"

try save("\(out)/james_avatar_concept_a.png") { avatarConceptA() }
try save("\(out)/james_avatar_concept_b.png") { avatarConceptB() }
try save("\(out)/james_avatar_concept_c.png") { avatarConceptC() }
try save("\(out)/visual_mode_lab.png") { drawMode("Lab Mode", "Artifact first: table, proof, score, decision.", "lab mode", cyan) }
try save("\(out)/visual_mode_judgment.png") { drawMode("Judgment Mode", "Reject, revise, pass moments become visual events.", "judgment mode", gold) }
try save("\(out)/visual_mode_field.png") { drawMode("Field Mode", "Context scenes support the artifact, not replace it.", "field mode", cyan) }
