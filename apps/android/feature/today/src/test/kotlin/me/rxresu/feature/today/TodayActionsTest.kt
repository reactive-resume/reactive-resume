package me.rxresu.feature.today

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first

class TodayActionsTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun markReadCanBeCompletedWithoutSwipe() {
        val repos = FakeRepositories()
        val state = TodayUiState(loading = false, needsYou = listOf(TodayEntry(me.rxresu.core.data.TodayItem("notice", null, "Company", "Ready", null, me.rxresu.core.data.TodayKind.Notification))))
        var calls = 0
        compose.setContent {
            RrTheme { TodayScreen(state, repos.time.now(), repos.time.timezone(), TodayActions(onMarkRead = { calls++ })) }
        }
        compose.onNodeWithText("Ready").performTouchInput { longClick() }
        compose.onAllNodesWithText("Mark as read").onFirst().performClick()
        compose.runOnIdle { assertEquals(1, calls) }
    }

    @Test fun rolePreviewKeepsOtherRolesReachableThroughHeading() {
        FakeRepositories().use { repos ->
            val roles = runBlocking { repos.today.observe().first { !it.loading }.data!!.newRoles }
            val state = TodayUiState(loading = false, newRoles = roles)
            val second = roles[1]
            val secondLabel = listOfNotNull(second.company, second.location).joinToString(" · ")
            var tracked: String? = null
            compose.setContent {
                RrTheme { TodayScreen(state, repos.time.now(), repos.time.timezone(), TodayActions(onTrack = { tracked = it.id })) }
            }
            compose.onNodeWithText("KS", useUnmergedTree = true).assertExists()
            compose.onNodeWithText("KI", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithText(secondLabel).assertDoesNotExist()
            compose.onNodeWithText("New roles").performScrollTo().performClick()
            compose.onNodeWithText(secondLabel).assertExists().performClick()
            compose.onNodeWithText("Track in Applications").performClick()
            compose.runOnIdle { assertEquals(second.id, tracked) }
        }
    }
}
