// Turns a document into page images. v1 renders on the server (GET /resumes/{id}/pdf and friends) and rasterises with
// android.graphics.pdf.PdfRenderer; an on-device engine (packages/forme-native) can implement the same interface later.
package me.rxresu.core.page

import android.graphics.Bitmap

/** What to render. `revision` keys the cache: same source + revision = same PDF. */
sealed interface PageSource {
    val revision: String
    data class Resume(val id: String, override val revision: String) : PageSource
    data class ResumeVersion(val resumeId: String, val versionId: String) : PageSource { override val revision get() = versionId }
    data class Letter(val id: String, override val revision: String) : PageSource
    data class Public(val url: String, val password: String? = null, override val revision: String = url) : PageSource
}

/** An issue already painted into a page image; coordinates are fractions of that page. */
data class RasterIssueMarker(val page: Int, val number: Int, val x: Float, val y: Float) {
    init { require(page >= 0 && number > 0 && x in 0f..1f && y in 0f..1f) }
}

/** A rendered PDF on disk, including interactive content already painted by its renderer. */
data class RenderedDocument(
    val source: PageSource, val file: java.io.File, val pageCount: Int,
    val rasterIssueMarkers: List<RasterIssueMarker> = emptyList(),
)

interface PageRenderer {
    /** The PDF for `source`, from cache when the revision matches. Throws when offline with nothing cached. */
    suspend fun render(source: PageSource): RenderedDocument

    /** The last good render for this document regardless of revision (offline fallback), or null. */
    suspend fun lastGood(source: PageSource): RenderedDocument?

    /** One page as a bitmap `widthPx` wide (A4 210:297), white paper in both themes. */
    suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap
}
