package me.rxresu.feature.today

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

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
}
