package me.rxresu.feature.assistant

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** B17: unsaved wording comes back from the view model's draft, and closing over it asks first. */
class ProposalWordingTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun reopenedProposalsShowTheDraftAndBackAsksBeforeDiscarding() {
        val proposal = Proposal("one", "reply", "tool", "summary", "content", location = "Summary", before = "<p>Before</p>", after = "<p>After</p>")
        val state = AssistantState(loading = false, content = ConversationContent(proposals = listOf(proposal)), wording = WordingDraft(proposal, "My own wording"))
        var dismissed = 0; var cancelled = 0
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                RrTheme(darkTheme = false) { ProposalsScreen(state, { dismissed++ }, { _, _, _ -> }, {}, cancelWording = { cancelled++ }) }
            }
        }
        compose.onNodeWithText("My own wording").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        compose.onNodeWithText("Discard changes?").assertIsDisplayed()
        compose.onNodeWithText("Keep editing").performClick()
        assertEquals(0, dismissed); assertEquals(0, cancelled)
        compose.onNodeWithText("My own wording").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        compose.onNodeWithText("Discard changes").performClick()
        compose.runOnIdle { assertEquals(1, dismissed); assertEquals(1, cancelled) }
    }
}
