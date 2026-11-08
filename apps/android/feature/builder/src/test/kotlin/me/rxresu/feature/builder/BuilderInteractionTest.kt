package me.rxresu.feature.builder

import android.content.Context
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.navigation.DesignGroup
import me.rxresu.core.navigation.WriteView
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Counts the haptics the screen plays (`performHapticFeedback` is all `rrHaptic` calls). */
private class HapticCounter(context: Context) : View(context) {
    var count = 0
    override fun performHapticFeedback(feedbackConstant: Int): Boolean { count++; return true }
}

/** Builder gestures and their non-gesture paths, on the test clock. */
class BuilderInteractionTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    private val haptics = HapticCounter(ApplicationProvider.getApplicationContext())

    private fun content(reduced: Boolean = false, body: @Composable () -> Unit) = rule.setContent {
        RrTheme(darkTheme = false, reducedMotion = reduced) { CompositionLocalProvider(LocalView provides haptics, content = body) }
    }

    @Test fun switchingModeOrViewPlaysOneSelectionAndReselectingNone() {
        content {
            var mode by remember { mutableStateOf(BuilderMode.Write) }
            var view by remember { mutableStateOf(WriteView.Page) }
            val state = Fixtures.state()
            BuilderScreen(state, mode, { mode = it }, {}, {}, {}, {}, {}, {}) { WriteMode(state, view, { view = it }, NoBuilderActions, WriteNav()) }
        }
        rule.onNodeWithText("Outline").performClick()
        assertEquals(1, haptics.count)
        rule.onNodeWithText("Outline").performClick()
        assertEquals(1, haptics.count)
        rule.onNodeWithText("Design").performClick()
        assertEquals(2, haptics.count)
        rule.onNodeWithText("Design").performClick()
        assertEquals(2, haptics.count)
    }

    @Test fun lockedDesignChoicesStaySilentAndUnchanged() {
        var edits = 0
        val actions = object : BuilderActions {
            override fun edit(toast: BuilderToast?, undoStep: String?, change: (kotlinx.serialization.json.JsonObject) -> kotlinx.serialization.json.JsonObject) { edits++ }
        }
        content { DesignMode(Fixtures.state().copy(locked = true), DesignGroup.Type, {}, actions) }
        rule.onNodeWithText("Compact").performScrollTo().performClick()
        assertEquals(0, edits)
        assertEquals(0, haptics.count)
    }

    private fun layoutDrag(finish: androidx.compose.ui.test.TouchInjectionScope.() -> Unit): List<Triple<String, Int, Boolean>> {
        val placed = mutableListOf<Triple<String, Int, Boolean>>()
        val actions = object : BuilderActions {
            override fun placeSection(key: String, page: Int, sidebar: Boolean) { placed += Triple(key, page, sidebar) }
        }
        content { DesignMode(Fixtures.state(Fixtures.twoColumns), DesignGroup.Layout, {}, actions) }
        rule.onNodeWithText("Skills").performScrollTo()
        val skills = rule.onNodeWithText("Skills").getUnclippedBoundsInRoot()
        val experience = rule.onNodeWithText("Experience").getUnclippedBoundsInRoot()
        val by = with(rule.density) { Offset((experience.left - skills.left).toPx(), (experience.top - skills.top).toPx()) }
        rule.onNodeWithText("Skills").performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            repeat(10) { moveBy(by / 10f) }
            finish()
        }
        rule.waitForIdle()
        return placed
    }

    @Test fun cancelledLayoutDragLeavesThePlacement() {
        assertEquals(emptyList<Triple<String, Int, Boolean>>(), layoutDrag { cancel() })
    }

    @Test fun releasedLayoutDragMovesOnce() {
        assertEquals(listOf(Triple("skills", 0, false)), layoutDrag { up() })
    }

    @Test fun reducedMotionMovesReorderNeighboursWithoutAnimating() {
        content(reduced = true) {
            ReorderColumn(listOf("a", "b", "c"), { it }, { _, _ -> }, {}) { item, _ -> RrText(item, Modifier.height(40.dp).testTag(item)) }
        }
        val before = rule.onNodeWithTag("b").getUnclippedBoundsInRoot().top
        rule.onNodeWithTag("a").performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            moveBy(Offset(0f, 1f))
        }
        // From here on, frames only advance when the test says so: a spring would still be on its way.
        rule.mainClock.autoAdvance = false
        rule.onNodeWithTag("a").performTouchInput { moveBy(Offset(0f, 60.dp.toPx())) }
        rule.waitForIdle() // delivers the move without advancing the clock
        // Three frames: the move recomposes and lays out; a spring would take about twenty.
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        assertEquals(before - 40.dp, rule.onNodeWithTag("b").getUnclippedBoundsInRoot().top)
    }

    @Test fun pickedBlockFollowsTheSheetsLiveTop() {
        val zoom = me.rxresu.core.designsystem.RrPageZoomState()
        var cover by mutableFloatStateOf(0f)
        val state = Fixtures.state().copy(highlight = BlockTarget.Item("experience", "experience-harbour"), highlightAboveSheet = true)
        content { Box { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav(), zoom = zoom, sheetCover = { cover }) } }
        val windowPx = with(rule.density) { 844.dp.toPx() }
        // Harbour Studio's block ends at 45.3% of the first page; the page fills the 390 dp width less 16 dp gutters.
        val blockBottom = with(rule.density) { (16.dp + (358.dp / me.rxresu.core.designsystem.RrLayout.PAGE_ASPECT) * 0.453f).toPx() }
        val clearance = with(rule.density) { 16.dp.toPx() }
        // At 55% the block is already clear of the sheet: the page stays put.
        cover = windowPx * 0.55f
        rule.waitForIdle()
        assertEquals(0f, zoom.y.value)
        // Raised to 92% (or the keyboard opens): the block's bottom lands 16 dp above the sheet's new top.
        cover = windowPx * 0.92f
        rule.waitForIdle()
        assertEquals(windowPx - cover - clearance, blockBottom + zoom.y.value, 1f)
        cover = windowPx * 0.55f
        rule.waitForIdle()
        assertEquals(0f, zoom.y.value)
    }
}
