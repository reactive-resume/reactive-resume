// Tap a block to edit it. The page is a server-rendered PDF with no layout tree, so blocks are rebuilt from the text
// the PDF draws: runs that read as a section title, an entry's name or the person's name become anchors, and every
// other run joins the nearest anchor above it in the same column. Outline (B3) stays the precise path.
package me.rxresu.feature.builder

import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.PdfRendererPreV
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.ext.SdkExtensions
import java.io.File

/** What a tap opens. */
internal sealed interface BlockTarget {
    data object Header : BlockTarget
    data class Section(val key: String) : BlockTarget
    data class Item(val section: String, val itemId: String) : BlockTarget
}

/** A run of text on a page, in fractions of the page (0..1, top-left origin). */
internal data class TextRun(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val centerY get() = (top + bottom) / 2
}

/** A tappable block on one page, in fractions of the page. */
internal data class PageBlock(val target: BlockTarget, val page: Int, val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val area get() = (right - left) * (bottom - top)
    fun contains(x: Float, y: Float, slop: Float = 0.006f) = x in (left - slop)..(right + slop) && y in (top - slop)..(bottom + slop)
}

internal object PageBlocks {
    private fun norm(text: String) = text.lowercase().replace(Regex("\\s+"), " ").trim()

    /**
     * Builds blocks for every page. [pages] holds each page's runs. Columns come from the layout: in two-column
     * templates a run left of (or right of) the sidebar edge belongs to the sidebar.
     */
    fun build(doc: ResumeDoc, pages: List<List<TextRun>>, twoColumns: Boolean): List<PageBlock> {
        val runs = pages.flatMapIndexed { page, list -> list.sortedWith(compareBy({ it.top }, { it.left })).map { page to it } }
        val used = BooleanArray(runs.size)
        val anchors = mutableListOf<Pair<Int, BlockTarget>>() // run index → target
        fun claim(from: Int, match: (String) -> Boolean): Int? =
            (from until runs.size).firstOrNull { !used[it] && match(norm(runs[it].second.text)) }?.also { used[it] = true }

        val name = norm(doc.basics["name"].str())
        if (name.isNotEmpty()) claim(0) { it == name || it.startsWith(name) }?.let { anchors += it to BlockTarget.Header }
        val visible = doc.sections.filter { !doc.hidden(it) && doc.pageOf(it.key) != null }
        // An empty title prints the type's name in the resume's language; English is matched here (see report).
        val titles = visible.associateWith { ref -> norm(doc.title(ref).ifBlank { ref.kind.englishTitle }).let { title -> claim(0) { it == title } } }
        titles.forEach { (ref, index) -> if (index != null) anchors += index to BlockTarget.Section(ref.key) }
        for (ref in visible) {
            if (ref.kind == SectionKind.Summary) {
                // Without a matched heading, the summary's first words anchor it.
                if (titles[ref] == null) norm(htmlText(doc.sectionJson(ref)["content"].str()).firstOrNull().orEmpty()).take(24).takeIf { it.length >= 8 }
                    ?.let { start -> claim(0) { it.startsWith(start) } }?.let { anchors += it to BlockTarget.Section(ref.key) }
                continue
            }
            val from = titles[ref] ?: 0
            for (item in doc.items(ref)) {
                if (item["hidden"].bool()) continue
                val anchor = norm(ref.kind.itemTitle(item)).takeIf { it.length >= 2 } ?: continue
                claim(from) { it == anchor || it.startsWith("$anchor ") || it.startsWith(anchor) }
                    ?.let { anchors += it to BlockTarget.Item(ref.key, item["id"].str()) }
            }
        }
        if (anchors.isEmpty()) return emptyList()

        val layout = doc.metadata["layout"].obj()
        val sidebarWidth = (layout["sidebarWidth"].num() ?: 35.0).toFloat() / 100f
        val sidebarLeft = layout["sidebarSide"].str().ifBlank { "left" } == "left"
        fun column(page: Int, run: TextRun): Int {
            val fullWidth = doc.pages.getOrNull(page)?.fullWidth ?: true
            if (!twoColumns || fullWidth) return 0
            return if (sidebarLeft) (if (run.left < sidebarWidth) 1 else 0) else (if (run.left >= 1 - sidebarWidth) 1 else 0)
        }

        // Every run joins the closest anchor above it on its page and column; runs above all anchors join none.
        val anchorAt = anchors.toMap()
        val members = anchors.associate { (index, _) -> index to mutableListOf(index) }
        runs.indices.filter { it !in anchorAt }.forEach { i ->
            val (page, run) = runs[i]
            val owner = anchors.map { it.first }
                .filter { a -> runs[a].first == page && runs[a].second.top <= run.top + 0.002f && column(page, runs[a].second) == column(page, run) }
                .maxByOrNull { runs[it].second.top }
            if (owner != null) members.getValue(owner) += i
        }

        fun box(target: BlockTarget, indexes: List<Int>): List<PageBlock> = indexes.groupBy { runs[it].first }.map { (page, list) ->
            val r = list.map { runs[it].second }
            PageBlock(target, page, r.minOf { it.left }, r.minOf { it.top }, r.maxOf { it.right }, r.maxOf { it.bottom })
        }
        val blocks = anchors.flatMap { (index, target) -> box(target, members.getValue(index)) }.toMutableList()
        // A section's block also covers its entries, so a tap on the gap between entries still finds the section.
        for ((ref, title) in titles) {
            if (title == null) continue
            val itemIndexes = anchors.filter { (it.second as? BlockTarget.Item)?.section == ref.key }.flatMap { members.getValue(it.first) }
            if (itemIndexes.isEmpty()) continue
            blocks.removeAll { it.target == BlockTarget.Section(ref.key) }
            blocks += box(BlockTarget.Section(ref.key), members.getValue(title) + itemIndexes)
        }
        return blocks
    }

    /** The smallest block under the point; else the nearest block on that page (a tap between blocks opens the closest one). */
    fun hit(blocks: List<PageBlock>, page: Int, x: Float, y: Float): PageBlock? {
        val onPage = blocks.filter { it.page == page }
        return onPage.filter { it.contains(x, y) }.minByOrNull { it.area }
            ?: onPage.filter { it.target !is BlockTarget.Header || y < 0.2f }
                .minByOrNull { b -> (if (y < b.top) b.top - y else if (y > b.bottom) y - b.bottom else 0f) + (if (x < b.left) b.left - x else if (x > b.right) x - b.right else 0f) / 4 }
    }
}

/**
 * Reads text runs with their bounds from a rendered PDF. Uses the platform PDF text API (Android 15, or Android 12–14
 * with the S extension 13 backport); returns null where it isn't available, and the builder falls back to Outline.
 */
internal object PdfTextReader {
    val supported: Boolean
        get() = Build.VERSION.SDK_INT >= 35 ||
            (Build.VERSION.SDK_INT >= 31 && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) >= 13)

    fun read(file: File): List<List<TextRun>>? {
        if (!supported) return null
        return runCatching {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                if (Build.VERSION.SDK_INT >= 35) {
                    PdfRenderer(fd).use { pdf ->
                        (0 until pdf.pageCount).map { i -> pdf.openPage(i).use { page ->
                            val contents = page.textContents.map { it.text to it.bounds }
                            runs(contents, page.width, page.height).ifEmpty {
                                located(contents, page.width, page.height) { line -> page.searchText(line).map { it.bounds } }
                            }
                        } }
                    }
                } else {
                    @Suppress("NewApi")
                    PdfRendererPreV(fd).use { pdf ->
                        (0 until pdf.pageCount).map { i -> pdf.openPage(i).use { page ->
                            val contents = page.textContents.map { it.text to it.bounds }
                            runs(contents, page.width, page.height).ifEmpty {
                                located(contents, page.width, page.height) { line -> page.searchText(line).map { it.bounds } }
                            }
                        } }
                    }
                }
            }
        }.getOrNull()
    }

    /**
     * Some PDFs (the server's Forme output) come back as one text content per page with no bounds. Each line is then
     * found with the page's text search: the n-th occurrence of a repeated line takes the n-th match, in reading order.
     */
    internal fun located(contents: List<Pair<String, List<RectF>>>, width: Int, height: Int, search: (String) -> List<List<RectF>>): List<TextRun> {
        val seen = HashMap<String, Int>()
        return contents.flatMap { (text, _) -> text.split('\n').map { it.trim() } }.filter { it.length >= 2 }.mapNotNull { line ->
            val n = seen.merge(line, 1, Int::plus)!! - 1
            search(line).getOrNull(n)?.takeIf { it.isNotEmpty() }?.let { rects ->
                TextRun(line, rects.minOf { it.left } / width, rects.minOf { it.top } / height, rects.maxOf { it.right } / width, rects.maxOf { it.bottom } / height)
            }
        }
    }

    /** One run per line: a content's text splits on line breaks and pairs with its per-line bounds when they agree. */
    internal fun runs(contents: List<Pair<String, List<RectF>>>, width: Int, height: Int): List<TextRun> = contents.flatMap { (text, bounds) ->
        val lines = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val pairs = if (lines.size == bounds.size) lines.zip(bounds) else bounds.map { text.trim() to it }
        pairs.map { (line, b) -> TextRun(line, b.left / width, b.top / height, b.right / width, b.bottom / height) }
    }
}
