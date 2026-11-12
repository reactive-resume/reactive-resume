package me.rxresu.core.page

import android.content.Context
import android.graphics.Bitmap
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Bundled, fictional Alex Morgan A4 page for previews and screenshots; no server or real resume data. */
class FakePageRenderer(private val context: Context) : PageRenderer {
    /** Copy sample PDF into app cache, useful for preview sharing as well as page images. */
    override suspend fun render(source: PageSource): RenderedDocument = withContext(Dispatchers.IO) {
        val file = File(context.cacheDir, "preview-sample-resume.pdf")
        if (!file.exists()) context.resources.openRawResource(R.raw.sample_resume).use { input -> file.outputStream().use { input.copyTo(it) } }
        RenderedDocument(source, file, 1, StoryboardPageImages.rasterIssueMarkers(source))
    }
    /** Sample is always available, including offline previews. */
    override suspend fun lastGood(source: PageSource) = render(source)
    /** Caller owns returned bitmap; recycle after it is no longer displayed. White paper in either theme. */
    override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap = withContext(Dispatchers.IO) {
        require(index == 0)
        StoryboardPageImages.page(document.source, widthPx)
    }
}
