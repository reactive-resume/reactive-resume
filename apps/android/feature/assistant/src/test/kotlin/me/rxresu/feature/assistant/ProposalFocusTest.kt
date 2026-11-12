package me.rxresu.feature.assistant

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ProposalFocusTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun onlyFocusedEditHasAcceptAndUnverifiedClaimCannotJoinBulkAccept() {
        val first = Proposal("one", "reply", "tool", "experience", "description", location = "Experience", before = "Before", after = "After")
        val second = first.copy(id = "two", section = "summary", location = "Summary", newDetail = true)
        var accepted: List<String> = emptyList()
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                RrTheme { ProposalsScreen(AssistantState(loading = false, content = ConversationContent(proposals = listOf(first, second))), {}, { ids, decision, _ -> if (decision == Decision.Accepted) accepted = ids }, {}) }
            }
        }
        compose.onAllNodesWithText("Accept").assertCountEquals(1)
        compose.onNodeWithText("Reject all").assertExists()
        compose.onNodeWithText("Accept all").assertDoesNotExist()
        compose.onNodeWithText("Accept the others").assertDoesNotExist()
        compose.onNodeWithText("Summary").performClick()
        compose.onAllNodesWithText("Accept").assertCountEquals(1)
        compose.onNodeWithText("Accept").performClick()
        compose.runOnIdle { assertEquals(listOf("two"), accepted) }
    }
}
