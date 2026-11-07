package me.rxresu.core.page

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Bundled, fictional Alex Morgan A4 page for previews and screenshots; no server or real resume data. */
class FakePageRenderer(private val context: Context) : PageRenderer {
    /** Copy sample PDF into app cache, useful for preview sharing as well as page images. */
    override suspend fun render(source: PageSource): RenderedDocument = withContext(Dispatchers.IO) {
        val file = File(context.cacheDir, "preview-sample-resume.pdf")
        if (!file.exists()) context.resources.openRawResource(R.raw.sample_resume).use { input -> file.outputStream().use { input.copyTo(it) } }
        RenderedDocument(source, file, 1)
    }
    /** Sample is always available, including offline previews. */
    override suspend fun lastGood(source: PageSource) = render(source)
    /** Caller owns returned bitmap; recycle after it is no longer displayed. White paper in either theme. */
    override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap = withContext(Dispatchers.IO) {
        require(index == 0 && widthPx in 1..4096)
        require(widthPx.toLong() * (widthPx * 842.0 / 595).toInt() * 4 <= 32L * 1024 * 1024)
        val options = BitmapFactory.Options().apply { inScaled = false }
        val original = BitmapFactory.decodeResource(context.resources, R.drawable.sample_resume, options)
        val scaled = Bitmap.createScaledBitmap(original, widthPx, (widthPx * 842.0 / 595).toInt(), true)
        if (scaled !== original) original.recycle()
        scaled
    }
}
