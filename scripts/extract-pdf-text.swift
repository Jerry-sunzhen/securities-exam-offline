import AppKit
import Foundation
import PDFKit
import Vision

struct Configuration {
  let inputPath: String
  let outputPath: String
  let firstPage: Int
  let lastPage: Int?
  let scale: CGFloat
}

func usage() -> Never {
  FileHandle.standardError.write(Data("Usage: swift scripts/extract-pdf-text.swift INPUT.pdf OUTPUT.txt [FIRST_PAGE] [LAST_PAGE] [SCALE]\n".utf8))
  exit(2)
}

func parseConfiguration() -> Configuration {
  guard CommandLine.arguments.count >= 3 else { usage() }
  let firstPage = CommandLine.arguments.count >= 4 ? Int(CommandLine.arguments[3]) ?? 1 : 1
  let lastPage = CommandLine.arguments.count >= 5 ? Int(CommandLine.arguments[4]) : nil
  let scale = CommandLine.arguments.count >= 6 ? Double(CommandLine.arguments[5]) ?? 3.0 : 3.0
  guard firstPage >= 1, scale >= 1 else { usage() }
  return Configuration(
    inputPath: CommandLine.arguments[1],
    outputPath: CommandLine.arguments[2],
    firstPage: firstPage,
    lastPage: lastPage,
    scale: CGFloat(scale)
  )
}

func render(page: PDFPage, scale: CGFloat) -> CGImage? {
  let bounds = page.bounds(for: .mediaBox)
  let width = max(1, Int((bounds.width * scale).rounded()))
  let height = max(1, Int((bounds.height * scale).rounded()))
  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return nil }

  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  return context.makeImage()
}

func recognize(image: CGImage) throws -> String {
  var observations: [VNRecognizedTextObservation] = []
  let request = VNRecognizeTextRequest { request, error in
    if let error {
      FileHandle.standardError.write(Data("Vision request error: \(error)\n".utf8))
      return
    }
    observations = request.results as? [VNRecognizedTextObservation] ?? []
  }
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  request.usesLanguageCorrection = true
  request.minimumTextHeight = 0.006
  try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])

  let ordered = observations.sorted { lhs, rhs in
    let verticalDistance = abs(lhs.boundingBox.midY - rhs.boundingBox.midY)
    if verticalDistance < 0.008 {
      return lhs.boundingBox.minX < rhs.boundingBox.minX
    }
    return lhs.boundingBox.midY > rhs.boundingBox.midY
  }
  return ordered.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let config = parseConfiguration()
let inputURL = URL(fileURLWithPath: config.inputPath)
let outputURL = URL(fileURLWithPath: config.outputPath)
guard let document = PDFDocument(url: inputURL) else {
  FileHandle.standardError.write(Data("Cannot open PDF: \(config.inputPath)\n".utf8))
  exit(1)
}

let lastPage = min(config.lastPage ?? document.pageCount, document.pageCount)
guard config.firstPage <= lastPage else { usage() }

FileManager.default.createFile(atPath: outputURL.path, contents: nil)
guard let output = try? FileHandle(forWritingTo: outputURL) else {
  FileHandle.standardError.write(Data("Cannot create output: \(config.outputPath)\n".utf8))
  exit(1)
}
defer { try? output.close() }

for pageNumber in config.firstPage...lastPage {
  let started = Date()
  let text: String = try autoreleasepool {
    guard let page = document.page(at: pageNumber - 1), let image = render(page: page, scale: config.scale) else {
      throw NSError(domain: "TextExtraction", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot render page \(pageNumber)"])
    }
    return try recognize(image: image)
  }
  let section = "===== PDF 第 \(pageNumber) 页 =====\n\(text.trimmingCharacters(in: .whitespacesAndNewlines))\n\n"
  try output.write(contentsOf: Data(section.utf8))
  try output.synchronize()
  let elapsed = Date().timeIntervalSince(started)
  print("Processed page \(pageNumber)/\(lastPage) (\(String(format: "%.1f", elapsed))s, \(text.count) chars)")
  fflush(stdout)
}
