package me.rxresu.core.page

import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.PdfRendererPreV
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.ext.SdkExtensions
import java.io.File

/** A line of text on a page, in fractions of the page (0..1, top-left origin). */
data class PageTextRun(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val centerY get() = (top + bottom) / 2
}

/**
 * Reads the lines a rendered PDF draws, with their positions, so a tap on the page can find what it touched (builder
 * and letter pages). Uses the platform PDF text API: Android 15, or Android 12–14 with the S extension 13 backport.
 */
object PdfText {
    val supported: Boolean
        get() = Build.VERSION.SDK_INT >= 35 ||
            (Build.VERSION.SDK_INT >= 31 && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) >= 13)

    /** Every page's lines, or null where the platform can't read PDF text. */
    fun read(file: File): List<List<PageTextRun>>? {
        if (!supported) return null
        return runCatching {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                if (Build.VERSION.SDK_INT >= 35) {
                    PdfRenderer(fd).use { pdf ->
                        (0 until pdf.pageCount).map { i -> pdf.openPage(i).use { page ->
                            page(page.textContents.map { it.text to it.bounds }, page.width, page.height) { line -> page.searchText(line).map { it.bounds } }
                        } }
                    }
                } else {
                    @Suppress("NewApi")
                    PdfRendererPreV(fd).use { pdf ->
                        (0 until pdf.pageCount).map { i -> pdf.openPage(i).use { page ->
                            page(page.textContents.map { it.text to it.bounds }, page.width, page.height) { line -> page.searchText(line).map { it.bounds } }
                        } }
                    }
                }
            }
        }.getOrNull()
    }

    private fun page(contents: List<Pair<String, List<RectF>>>, width: Int, height: Int, search: (String) -> List<List<RectF>>) =
        runs(contents, width, height).ifEmpty { located(contents, width, height, search) }

    /** One run per line: a content's text splits on line breaks and pairs with its per-line bounds when they agree. */
    fun runs(contents: List<Pair<String, List<RectF>>>, width: Int, height: Int): List<PageTextRun> = contents.flatMap { (text, bounds) ->
        val lines = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val pairs = if (lines.size == bounds.size) lines.zip(bounds) else bounds.map { text.trim() to it }
        pairs.map { (line, b) -> PageTextRun(line, b.left / width, b.top / height, b.right / width, b.bottom / height) }
    }

    /**
     * The server's Forme PDFs come back as one text content per page with no bounds. Each line is then found with the
     * page's text search: the n-th occurrence of a repeated line takes the n-th match, in reading order.
     */
    fun located(contents: List<Pair<String, List<RectF>>>, width: Int, height: Int, search: (String) -> List<List<RectF>>): List<PageTextRun> {
        val seen = HashMap<String, Int>()
        return contents.flatMap { (text, _) -> text.split('\n').map { it.trim() } }.filter { it.length >= 2 }.mapNotNull { line ->
            val n = seen.merge(line, 1, Int::plus)!! - 1
            search(line).getOrNull(n)?.takeIf { it.isNotEmpty() }?.let { rects ->
                PageTextRun(line, rects.minOf { it.left } / width, rects.minOf { it.top } / height, rects.maxOf { it.right } / width, rects.maxOf { it.bottom } / height)
            }
        }
    }
}
