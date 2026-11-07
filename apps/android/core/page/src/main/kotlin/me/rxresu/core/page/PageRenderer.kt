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

/** A rendered PDF on disk. */
data class RenderedDocument(val source: PageSource, val file: java.io.File, val pageCount: Int)

interface PageRenderer {
    /** The PDF for `source`, from cache when the revision matches. Throws when offline with nothing cached. */
    suspend fun render(source: PageSource): RenderedDocument

    /** The last good render for this document regardless of revision (offline fallback), or null. */
    suspend fun lastGood(source: PageSource): RenderedDocument?

    /** One page as a bitmap `widthPx` wide (A4 210:297), white paper in both themes. */
    suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap
}
