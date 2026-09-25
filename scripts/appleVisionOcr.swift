import CoreGraphics
import Foundation
import ImageIO
import AppKit
import PDFKit
import Vision

struct Output: Encodable {
    let text: String
    let pages: [PageOutput]
}

struct PageOutput: Encodable {
    let pageNumber: Int
    let text: String
}

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: appleVisionOcr <image-path> [language ...]\n", stderr)
    exit(2)
}

let imagePath = CommandLine.arguments[1]
let languages = Array(CommandLine.arguments.dropFirst(2))
let url = URL(fileURLWithPath: imagePath)
let isPdf = url.pathExtension.lowercased() == "pdf"
var source: CGImageSource?
var pdfDocument: PDFDocument?
if isPdf {
    guard let document = PDFDocument(url: url) else {
        fputs("Could not open PDF: \(imagePath)\n", stderr)
        exit(1)
    }
    pdfDocument = document
} else {
    guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        fputs("Could not open image: \(imagePath)\n", stderr)
        exit(1)
    }
    source = imageSource
}

func renderPdfPage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    // PDFKit's thumbnail renderer produces a Vision-compatible image and
    // avoids the problematic 420f conversion seen with manually-created RGB
    // CGContext images on some macOS/SDK combinations.
    let maxDimension: CGFloat = 1600.0
    let scale = min(1.0, maxDimension / max(bounds.width, bounds.height))
    let thumbnailSize = CGSize(width: max(bounds.width * scale, 1), height: max(bounds.height * scale, 1))
    let thumbnail = page.thumbnail(of: thumbnailSize, for: .mediaBox)
    return thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil)
}

let pageCount = isPdf ? (pdfDocument?.pageCount ?? 0) : CGImageSourceGetCount(source!)
var pageTexts: [String] = []
do {
    for pageIndex in 0..<pageCount {
        let image: CGImage
        let orientation: CGImagePropertyOrientation
        if isPdf {
            guard let page = pdfDocument?.page(at: pageIndex), let rendered = renderPdfPage(page) else {
                fputs("Could not render PDF page \(pageIndex + 1) of \(imagePath)\n", stderr)
                exit(1)
            }
            image = rendered
            orientation = .up
        } else {
            guard let rendered = CGImageSourceCreateImageAtIndex(source!, pageIndex, nil) else {
                fputs("Could not render page \(pageIndex + 1) of \(imagePath)\n", stderr)
                exit(1)
            }
            let properties = CGImageSourceCopyPropertiesAtIndex(source!, pageIndex, nil) as? [CFString: Any]
            let orientationValue = properties?[kCGImagePropertyOrientation] as? UInt32
            image = rendered
            orientation = CGImagePropertyOrientation(rawValue: orientationValue ?? 1) ?? .up
        }
        let request = VNRecognizeTextRequest()
        // Revision 3 improves rotation and handwriting recognition on macOS 13+.
        if #available(macOS 13.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
            request.automaticallyDetectsLanguage = true
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if !languages.isEmpty { request.recognitionLanguages = languages }

        let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
        try handler.perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        pageTexts.append(lines.joined(separator: "\n"))
    }
    let pages = pageTexts.enumerated().map { PageOutput(pageNumber: $0.offset + 1, text: $0.element) }
    let output = try JSONEncoder().encode(Output(text: pageTexts.joined(separator: "\n\n"), pages: pages))
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fputs("Vision OCR failed: \(error)\n", stderr)
    exit(1)
}
