package me.rxresu.feature.builder

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.navigation.PagePreview
import me.rxresu.core.page.*
import me.rxresu.core.testing.*
import org.junit.Assert.*
import org.junit.Test

class PagePreviewScreensTest : RrScreenshotTest() {
    private fun capture(dark: Boolean, variant: String = "") {
        val repositories = FakeRepositories()
        try {
            val page = runBlocking {
                val source = PageSource.Resume(StoryboardIds.resume, "fixture")
                repositories.pages.page(RenderedDocument(source, java.io.File("unused-fixture.pdf"), 1), 0, 716).asImageBitmap()
            }
            captureScreen("B18-Preview" + variant, dark, wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) {
                // The supplied full-page raster already paints marker 1. No Compose marker or text metadata is added.
                PagePreviewScreen(PagePreviewState(pages = listOf(page), updating = variant == "-Updating", offline = variant == "-Offline"), PagePreview(StoryboardIds.resume, versionId = "frozen".takeIf { variant == "-Version" }), {}, {}, {}, {}, {}, if (variant == "-Version") ({}) else null)
            }
        } finally { repositories.close() }
    }
    @Test fun light() = capture(false)
    @Test fun dark() = capture(true)
    @Test fun versionLight() = capture(false, "-Version")
    @Test fun versionDark() = capture(true, "-Version")
    @Test fun updating() = capture(false, "-Updating")
    @Test fun offline() = capture(true, "-Offline")

    @Test fun markerHitUsesBlockAndPageRatherThanNearestSection() {
        val block = PageBlock(BlockTarget.Header, 0, 0.8f, 0.1f, 0.95f, 0.2f)
        val state = PagePreviewState(blocks = listOf(block), markers = listOf(BlockTarget.Header to 1))
        assertEquals(1, previewMarkerHit(state, 0, 0.76f, 0.12f, 358f))
        assertNull(previewMarkerHit(state, 1, 0.76f, 0.12f, 358f))
        assertNull(previewMarkerHit(state, 0, 0.9f, 0.12f, 358f))
    }
}
