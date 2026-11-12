package me.rxresu.feature.share

import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.rememberNavController
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.page.PageHttpException
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.RenderedDocument
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ShareExportFeedbackTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun realExportShowsBusyThenFailureAndRetriesFromTheCard() {
        val gate = AtomicReference(CompletableDeferred<Unit>())
        val requests = AtomicInteger()
        val pages = object : PageRenderer {
            override suspend fun render(source: PageSource): RenderedDocument {
                val pending = gate.get()
                requests.incrementAndGet()
                pending.await()
                throw PageHttpException(503)
            }
            override suspend fun lastGood(source: PageSource): RenderedDocument? = null
            override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap = error("No PDF was rendered")
        }
        val repositories = FakeRepositories(pageRenderer = pages)
        try {
            rule.setContent {
                CompositionLocalProvider(LocalRepositories provides repositories, LocalToasts provides RrToastHostState()) {
                    RrTheme(reducedMotion = true) { BuilderShareMode(StoryboardIds.resume, rememberNavController()) }
                }
            }
            rule.waitUntil { rule.onAllNodes(androidx.compose.ui.test.hasText("Share PDF")).fetchSemanticsNodes().isNotEmpty() }
            rule.onNodeWithText("Share PDF").performClick()
            rule.onNodeWithText("Preparing…").assertIsNotEnabled()
            rule.runOnIdle { gate.get().complete(Unit) }
            rule.waitUntil { rule.onAllNodes(androidx.compose.ui.test.hasText("Download failed. Try again.")).fetchSemanticsNodes().isNotEmpty() }
            val beforeRetry = requests.get()
            rule.runOnIdle { gate.set(CompletableDeferred()) }
            rule.onNodeWithText("Try again").performClick()
            rule.onNodeWithText("Preparing…").assertIsNotEnabled()
            rule.onNodeWithText("Download failed. Try again.").assertDoesNotExist()
            rule.waitUntil { requests.get() > beforeRetry }
            rule.runOnIdle { gate.get().complete(Unit) }
            rule.waitUntil { rule.onAllNodes(androidx.compose.ui.test.hasText("Download failed. Try again.")).fetchSemanticsNodes().isNotEmpty() }
            rule.runOnIdle { assertTrue(requests.get() > beforeRetry) }
        } finally { repositories.close() }
    }
}
