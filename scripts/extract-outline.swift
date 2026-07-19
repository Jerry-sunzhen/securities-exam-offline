import Foundation
import PDFKit

struct Page: Codable {
    let page: Int
    let title: String
    let text: String
}

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: extract-outline.swift <pdf>\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: args[1])
guard let document = PDFDocument(url: url) else {
    fputs("Cannot open PDF\n", stderr)
    exit(3)
}

let headingPattern = try! NSRegularExpression(pattern: "^(金融市场基础知识|证券市场基本法律法规|第[一二三四五六七八九十]+章[^\\n]*|第[一二三四五六七八九十]+节[^\\n]*)$", options: [.anchorsMatchLines])
var pages: [Page] = []

for index in 0..<document.pageCount {
    let raw = document.page(at: index)?.string ?? ""
    let text = raw
        .replacingOccurrences(of: "\u{00a0}", with: " ")
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let matches = headingPattern.matches(in: text, range: range)
    var title = "第 \(index + 1) 页"
    if let first = matches.first, let swiftRange = Range(first.range, in: text) {
        title = String(text[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    pages.append(Page(page: index + 1, title: title, text: text))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
let data = try! encoder.encode(pages)
FileHandle.standardOutput.write(data)

