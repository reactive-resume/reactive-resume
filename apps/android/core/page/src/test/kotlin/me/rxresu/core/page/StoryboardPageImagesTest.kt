package me.rxresu.core.page

import android.graphics.BitmapFactory
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class StoryboardPageImagesTest {
    @Test fun fakeRendererReturnsEachUnmodifiedSurfaceCropAtNativeSize() = runBlocking {
        val renderer = FakePageRenderer(RuntimeEnvironment.getApplication())
        val resume = PageSource.Resume("resume", "1")
        val cases = listOf(
            Triple(resume, 340, "page-resume-B1.png"),
            Triple(resume, 300, "page-resume-B6.png"),
            Triple(resume, 360, "thumb-template-onyx.png"),
            Triple(resume, 144, "thumb-resume-B11.png"),
            Triple(resume, 716, "page-resume-full.png"),
            Triple(PageSource.ResumeVersion("resume", "version"), 716, "page-resume-full.png"),
            Triple(PageSource.Public("https://example.invalid/alex/resume"), 716, "page-public-full.png"),
            Triple(PageSource.Letter("letter", "1"), 300, "thumb-letter-L2.png"),
        )
        for ((source, width, filename) in cases) {
            val expected = requireNotNull(javaClass.getResourceAsStream("/storyboard/$filename")).use {
                requireNotNull(BitmapFactory.decodeStream(it))
            }
            val actual = renderer.page(RenderedDocument(source, File("unused.pdf"), 1), 0, width)
            try {
                assertEquals(filename, expected.width, actual.width)
                assertEquals(filename, expected.height, actual.height)
                assertTrue(filename, expected.sameAs(actual))
            } finally { expected.recycle(); actual.recycle() }
        }
    }

    @Test fun scaledImagesKeepCropAspectAndEachCallerOwnsItsBitmap() {
        val source = PageSource.Letter("letter", "1")
        val first = StoryboardPageImages.page(source, 150)
        val second = StoryboardPageImages.page(source, 150)
        try {
            assertEquals(150, first.width)
            assertEquals(212, first.height)
            assertNotSame(first, second)
            first.recycle()
            assertFalse(second.isRecycled)
        } finally { if (!first.isRecycled) first.recycle(); second.recycle() }
        StoryboardPageImages.bitmap(StoryboardImage.Photo, 128).let { photo ->
            try { assertEquals(128, photo.width); assertEquals(128, photo.height) }
            finally { photo.recycle() }
        }
        assertTrue(runCatching { StoryboardPageImages.page(source, 0) }.exceptionOrNull() is IllegalArgumentException)
        assertTrue(runCatching { StoryboardPageImages.page(source, 4096) }.exceptionOrNull() is IllegalArgumentException)
    }
}
