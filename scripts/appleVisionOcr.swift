import CoreGraphics
import Foundation
import ImageIO
import Vision

struct Output: Encodable {
    let text: String
}

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: appleVisionOcr <image-path> [language ...]\n", stderr)
    exit(2)
}

let imagePath = CommandLine.arguments[1]
let languages = Array(CommandLine.arguments.dropFirst(2))
let url = URL(fileURLWithPath: imagePath)
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Could not open image: \(imagePath)\n", stderr)
    exit(1)
}

let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
let orientationValue = properties?[kCGImagePropertyOrientation] as? UInt32
let orientation = CGImagePropertyOrientation(rawValue: orientationValue ?? 1) ?? .up
let request = VNRecognizeTextRequest()
// Revision 3 improves rotation and handwriting recognition on macOS 13+.
// This is intentionally explicit: leaving the revision at the system default
// can select an older model on machines with a newer SDK/runtime combination.
if #available(macOS 13.0, *) {
    request.revision = VNRecognizeTextRequestRevision3
    request.automaticallyDetectsLanguage = true
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if !languages.isEmpty { request.recognitionLanguages = languages }

do {
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let output = try JSONEncoder().encode(Output(text: lines.joined(separator: "\n")))
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fputs("Vision OCR failed: \(error)\n", stderr)
    exit(1)
}
