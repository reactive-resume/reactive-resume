package me.rxresu.feature.applications

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.compose.*
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.*
import org.junit.Assert.*

class ApplicationInteractionTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun trashUndoSurvivesDetailPop() {
        val repos = FakeRepositories()
        val toasts = RrToastHostState()
        compose.setContent { RrTheme {
            CompositionLocalProvider(LocalRepositories provides repos, LocalToasts provides toasts) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "list") {
                    composable("list") { RrButton("Open detail", { nav.navigate("detail") }) }
                    composable("detail") { ApplicationRoute(StoryboardIds.kiln, nav) }
                }
                RrToastHost(toasts)
            }
        } }
        compose.onNodeWithText("Open detail").performClick()
        compose.onNodeWithContentDescription("Application options").performClick()
        compose.onNodeWithText("Move to Trash", ignoreCase = true).performClick()
        compose.onNodeWithText("Open detail").assertIsDisplayed()
        compose.onNodeWithText("Undo").performClick()
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(RrMotion.D2.toLong()))
        compose.waitForIdle()
        assertNull(runBlocking { repos.applications.getApplication(StoryboardIds.kiln) }.trashedAt)
        assertNull(toasts.current)
    }

    @Test fun overviewShortcutPushesApplyWithoutPager() {
        var destination: WorkspaceTab? = null
        val repos = FakeRepositories()
        val app = runBlocking { repos.applications.getApplication(StoryboardIds.kiln) }.copy(status = ApplicationStage.Saved)
        compose.setContent { RrTheme(reducedMotion = true) {
            ApplicationScreen(
                ApplicationState(app = app, loading = false), repos.time,
                onBack = {}, onCoach = {}, onMove = {}, onInterview = {}, onAddToCalendar = {},
                onOpenResume = {}, onOpenLetter = {}, onPrepareResume = {}, onOffers = {}, onEmail = {},
                onOpenLink = {}, onLogFollowUp = {}, onReopen = {}, onTrash = {}, onPatch = { _, _ -> },
                onAddNote = {}, onRetry = {}, onTab = { destination = it },
            )
        } }
        compose.mainClock.autoAdvance = false
        compose.onNodeWithText("Confirm applied").performScrollTo().performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeByFrame()
        assertEquals(WorkspaceTab.Apply, destination)
    }

    @Test fun headlineStatisticExplainsItsDenominator() {
        val repos = FakeRepositories()
        val insights = runBlocking { repos.applications.insights() }
        compose.setContent { RrTheme {
            InsightsView(ApplicationsState(insights = insights), rememberDates(repos.time.timezone()), rememberRrLargeTitleState(), {}, {})
        } }
        compose.onNodeWithText("replied").performClick()
        compose.onNodeWithText("Applications that received a reply divided by applications sent", substring = true).assertIsDisplayed()
    }

    @Test fun pipelineKeepsReadableStageWidthsInsideHorizontalScroll() {
        val repos = FakeRepositories()
        val insights = runBlocking { repos.applications.insights() }
        compose.setContent { RrTheme {
            CompositionLocalProvider(LocalToasts provides RrToastHostState()) { PipelineFlow(insights) }
        } }
        val label = compose.onNodeWithText("Screening", useUnmergedTree = true).fetchSemanticsNode()
        assertTrue(label.boundsInRoot.width >= 100f)
        compose.onNodeWithText("Save image").assertIsDisplayed()
    }

    @Test fun pipelineExportWritesRealPng() {
        val bitmap = Bitmap.createBitmap(16, 12, Bitmap.Config.ARGB_8888)
        val bytes = ByteArrayOutputStream().also { it.writePipelinePng(bitmap) }.toByteArray()
        assertArrayEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10), bytes.copyOf(8))
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        assertEquals(16, decoded.width)
        assertEquals(12, decoded.height)
    }
}
