package me.rxresu.feature.assistant

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Rule
import org.junit.Test

class PageFitStatusTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    private fun show(measurement: PageFitMeasurement? = null) {
        val proposal = Proposal("one", "reply", "tool", "summary", "content", location = "Summary", before = "Before", after = "After")
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                RrTheme {
                    ProposalsScreen(AssistantState(loading = false, content = ConversationContent(proposals = listOf(proposal)), pageFit = measurement), {}, { _, _, _ -> }, {})
                }
            }
        }
    }

    @Test fun completedMeasurementShowsItsActualCounts() {
        show(PageFitMeasurement(2, 3))
        compose.onNodeWithText("Page fit: 2 → 3 printed pages.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Couldn't measure page fit. Check the page preview before accepting.").assertDoesNotExist()
    }

    @Test fun unavailableMeasurementNeverClaimsTheStoryboardCounts() {
        show()
        compose.onNodeWithText("Couldn't measure page fit. Check the page preview before accepting.").performScrollTo().assertIsDisplayed()
        compose.onAllNodes(hasText("Page fit:", substring = true)).assertCountEquals(0)
    }
}
