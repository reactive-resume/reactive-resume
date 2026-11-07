package me.rxresu.core.designsystem

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Timed components driven by the test clock (no real waits). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RrInteractionTest {
    @get:Rule val rule = createComposeRule()

    private fun progress(value: Float) = SemanticsMatcher("progress $value") { node ->
        val info = node.config.getOrElseNullable(SemanticsProperties.ProgressBarRangeInfo) { null } ?: return@SemanticsMatcher false
        kotlin.math.abs(info.current - value) < 0.02f
    }

    @Test fun holdToDeleteFillsOver1200msThenDeletes() {
        var deleted = 0
        rule.mainClock.autoAdvance = false
        rule.setContent { RrTheme { RrHoldToDeleteButton(onDelete = { deleted++ }) } }
        val button = rule.onNodeWithContentDescription("Hold to delete")
        button.performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(600)
        button.assert(progress(0.5f))
        assertEquals(0, deleted)
        rule.mainClock.advanceTimeBy(700)
        assertEquals(1, deleted)
        button.performTouchInput { up() }
    }

    @Test fun holdToDeleteDrainsWhenReleasedEarly() {
        var deleted = 0
        rule.mainClock.autoAdvance = false
        rule.setContent { RrTheme { RrHoldToDeleteButton(onDelete = { deleted++ }) } }
        val button = rule.onNodeWithContentDescription("Hold to delete")
        button.performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(600)
        button.performTouchInput { up() }
        rule.mainClock.advanceTimeBy(RrHoldToDelete.DRAIN_MS.toLong() + 32)
        button.assert(progress(0f))
        rule.mainClock.advanceTimeBy(2_000)
        assertEquals(0, deleted)
    }

    @Test fun holdToDeleteTalkBackActionDeletesAtOnce() {
        var deleted = 0
        rule.setContent { RrTheme { RrHoldToDeleteButton(onDelete = { deleted++ }) } }
        rule.onNodeWithContentDescription("Hold to delete").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(1, deleted)
    }

    @Test fun workingLabelStepsOnTheClock() {
        rule.mainClock.autoAdvance = false
        rule.setContent { RrTheme(reducedMotion = true) { RrWorkingLabel(listOf("Reading the posting", "Matching your facts", "Still working")) } }
        rule.mainClock.advanceTimeByFrame()
        rule.onNodeWithText("Reading the posting").assertExists()
        rule.mainClock.advanceTimeBy(2_200)
        rule.onNodeWithText("Matching your facts").assertExists()
        rule.mainClock.advanceTimeBy(10_000)
        rule.onNodeWithText("Still working").assertExists()
    }

}
