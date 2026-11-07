package me.rxresu.feature.assistant

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AssistantQuestionTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun answersAndOwnWordsKeepToolIdentity() {
        val actions = mutableListOf<String>()
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                RrTheme {
                    AssistantScreen(AssistantState(loading = false, content = ConversationContent(question = Question("Did you lead it?", listOf("Yes", "No"), "question-1"))), {}, {}, {}, {}, { _, _ -> }, actions::add)
                }
            }
        }
        compose.onNodeWithText("Yes").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("answer:question-1:Yes"), actions) }
        compose.onNodeWithText("Or in your own words…").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasContentDescription("Or in your own words…")).performScrollTo().performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("I co-led it")) }
        compose.onNode(hasContentDescription("Send") and isEnabled()).performClick()
        compose.runOnIdle { assertEquals("answer:question-1:I co-led it", actions.last()) }
    }
}
