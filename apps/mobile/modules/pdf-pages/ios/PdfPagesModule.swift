import ExpoModulesCore
import PDFKit
import UIKit

public class PdfPagesModule: Module {
  private let queue = DispatchQueue(label: "me.rxresu.pdf-pages", qos: .userInitiated)
  private var documents: [String: PDFDocument] = [:]
  private var directories: [String: URL] = [:]

  public func definition() -> ModuleDefinition {
    Name("PdfPages")
    OnCreate {
      self.queue.async {
        let root = FileManager.default.temporaryDirectory
        let stale = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for directory in stale where directory.lastPathComponent.hasPrefix("rr-pdf-") {
          try? FileManager.default.removeItem(at: directory)
        }
      }
    }
    AsyncFunction("open") { (bytes: Data) -> [String: Any] in
      guard let document = PDFDocument(data: bytes), document.pageCount > 0 else {
        throw PdfPagesError("Invalid PDF")
      }
      let id = UUID().uuidString
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent("rr-pdf-\(id)")
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let pages = try (0..<document.pageCount).map { index -> [String: Double] in
        guard let page = document.page(at: index) else { throw PdfPagesError("Missing page") }
        let box = page.bounds(for: .mediaBox)
        return ["width": box.width, "height": box.height]
      }
      self.documents[id] = document
      self.directories[id] = directory
      return ["id": id, "pages": pages]
    }.runOnQueue(queue)

    AsyncFunction("rasterize") { (id: String, indices: [Int], scale: Double) -> [[String: Any]] in
      guard let document = self.documents[id], let directory = self.directories[id] else {
        throw PdfPagesError("Closed PDF")
      }
      guard scale.isFinite, scale >= 0.1, scale <= 6 else { throw PdfPagesError("Invalid scale") }
      return try indices.map { index -> [String: Any] in
        try autoreleasepool {
          guard index >= 0, index < document.pageCount, let page = document.page(at: index) else {
            throw PdfPagesError("Invalid page")
          }
          let box = page.bounds(for: .mediaBox)
          guard box.width.isFinite, box.height.isFinite, box.width > 0, box.height > 0 else {
            throw PdfPagesError("Invalid page dimensions")
          }
          let limit = 25_000_000.0
          let pageScale = min(scale, sqrt(limit / box.width / box.height), limit / box.width, limit / box.height)
          let width = max(1, floor(box.width * pageScale)), height = max(1, floor(box.height * pageScale))
          let file = directory.appendingPathComponent("\(index)-\(pageScale).png")
          if !FileManager.default.fileExists(atPath: file.path) {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
              UIColor.white.setFill()
              context.fill(CGRect(x: 0, y: 0, width: width, height: height))
              let cg = context.cgContext
              cg.translateBy(x: 0, y: height)
              cg.scaleBy(x: pageScale, y: -pageScale)
              cg.translateBy(x: -box.minX, y: -box.minY)
              page.draw(with: .mediaBox, to: cg)
            }
            guard let png = image.pngData() else { throw PdfPagesError("PNG encoding failed") }
            try png.write(to: file, options: .atomic)
          }
          for old in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where old.lastPathComponent.hasPrefix("\(index)-") && old.pathExtension == "png" && old != file {
            try? FileManager.default.removeItem(at: old)
          }
          return ["index": index, "uri": file.absoluteString, "width": box.width, "height": box.height]
        }
      }
    }.runOnQueue(queue)

    AsyncFunction("close") { (id: String) in self.remove(id) }.runOnQueue(queue)
    OnDestroy {
      self.queue.async { for id in Array(self.documents.keys) { self.remove(id) } }
    }
  }

  private func remove(_ id: String) {
    documents.removeValue(forKey: id)
    if let directory = directories.removeValue(forKey: id) { try? FileManager.default.removeItem(at: directory) }
  }
}

private struct PdfPagesError: Error, LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}
