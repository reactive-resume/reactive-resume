package me.rxresu.feature.documents

import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.CancellationException
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.PageSource

/** The page source for a library item; the edit time keys the render cache. */
internal fun DocumentSummary.pageSource(): PageSource =
    if (type == DocumentType.Letter) PageSource.Letter(id, updatedAt) else PageSource.Resume(id, updatedAt)

/**
 * First-page bitmaps for the library, kept in memory across scrolls and screens. Offline, the last good render is used;
 * with nothing cached the thumbnail stays the still skeleton page.
 * ponytail: one process-wide LRU of 32 pages; size it by bytes if thumbnails grow.
 */
internal object Thumbnails {
    private val cache = LruCache<String, ImageBitmap>(32)
    private fun key(source: PageSource, widthPx: Int) = "$source@$widthPx"

    fun cached(source: PageSource, widthPx: Int): ImageBitmap? = cache.get(key(source, widthPx))

    suspend fun load(pages: PageRenderer, source: PageSource, widthPx: Int): ImageBitmap? {
        cached(source, widthPx)?.let { return it }
        val document = try {
            pages.render(source)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            pages.lastGood(source)
        } ?: return null
        return runCatching { pages.page(document, 0, widthPx).asImageBitmap() }.getOrNull()?.also { cache.put(key(source, widthPx), it) }
    }

    fun clear() = cache.evictAll()
}

@Composable
internal fun rememberThumbnail(document: DocumentSummary, width: Dp): ImageBitmap? {
    val pages = LocalRepositories.current.pages
    val px = with(LocalDensity.current) { width.roundToPx() }.coerceAtLeast(1)
    val source = document.pageSource()
    val bitmap by produceState(Thumbnails.cached(source, px), source, px) {
        if (value == null) value = runCatching { Thumbnails.load(pages, source, px) }.getOrNull()
    }
    return bitmap
}
