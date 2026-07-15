import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

enum MaskError: Error, CustomStringConvertible {
    case usage
    case noForeground
    case cannotWrite

    var description: String {
        switch self {
        case .usage: return "usage: patternlab_vision_foreground_mask <input-image> <output-mask.png>"
        case .noForeground: return "Apple Vision did not find a foreground subject"
        case .cannotWrite: return "could not write foreground mask"
        }
    }
}

func main() throws {
    guard CommandLine.arguments.count == 3 else { throw MaskError.usage }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    let handler = VNImageRequestHandler(url: input, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first else { throw MaskError.noForeground }
    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: observation.allInstances,
        from: handler
    )
    let image = CIImage(cvPixelBuffer: maskBuffer)
    let context = CIContext(options: [.useSoftwareRenderer: false])
    let colorSpace = CGColorSpaceCreateDeviceGray()
    try context.writePNGRepresentation(
        of: image,
        to: output,
        format: .L8,
        colorSpace: colorSpace,
        options: [:]
    )
}

do {
    try main()
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
