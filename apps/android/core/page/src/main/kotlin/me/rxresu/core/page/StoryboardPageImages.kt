package me.rxresu.core.page

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlin.math.roundToInt

/** Unmodified image crops supplied with storyboard v2.1, never whole-screen screenshot baselines. */
enum class StoryboardImage(val filename: String) {
    ResumeOverview("page-resume-B1.png"),
    ResumeDesign("page-resume-B6.png"),
    ResumeFull("page-resume-full.png"),
    PublicFull("page-public-full.png"),
    TemplateOnyx("thumb-template-onyx.png"),
    ResumeShare("thumb-resume-B11.png"),
    LetterDesign("thumb-letter-L2.png"),
    Photo("photo-alex.png"),
}

/** Fake-only image selection. Callers own each returned bitmap, including at the fixture's native width. */
object StoryboardPageImages {
    fun page(source: PageSource, widthPx: Int): Bitmap = bitmap(fixture(source, widthPx), widthPx)

    // shortcut: dimensions identify the drawn resume surface; use bitmap explicitly if two surfaces request the same width.
    internal fun fixture(source: PageSource, widthPx: Int): StoryboardImage = when (source) {
        is PageSource.Public -> StoryboardImage.PublicFull
        is PageSource.Letter -> StoryboardImage.LetterDesign
        is PageSource.ResumeVersion -> StoryboardImage.ResumeFull
        is PageSource.Resume -> when (widthPx) {
            340 -> StoryboardImage.ResumeOverview
            300 -> StoryboardImage.ResumeDesign
            360 -> StoryboardImage.TemplateOnyx
            144 -> StoryboardImage.ResumeShare
            else -> StoryboardImage.ResumeFull
        }
    }

    /** ResumeFull already includes the Check marker; screenshot callers must not draw that marker again. */
    fun bitmap(fixture: StoryboardImage, widthPx: Int): Bitmap {
        require(widthPx in 1..4096)
        val options = BitmapFactory.Options().apply { inScaled = false }
        val original = requireNotNull(javaClass.getResourceAsStream("/storyboard/${fixture.filename}")) {
            "Storyboard image missing: ${fixture.filename}"
        }.use { requireNotNull(BitmapFactory.decodeStream(it, null, options)) }
        try {
            val height = (widthPx.toDouble() * original.height / original.width).roundToInt().coerceAtLeast(1)
            require(widthPx.toLong() * height * 4 <= 32L * 1024 * 1024)
            val scaled = Bitmap.createScaledBitmap(original, widthPx, height, true)
            if (scaled !== original) original.recycle()
            return scaled
        } catch (error: Throwable) {
            original.recycle()
            throw error
        }
    }
}
