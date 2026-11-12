package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.unit.dp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RrRootHeaderGeometryTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun emptyActionsKeepTitleLineHeightWhileRealActionsKeepTouchHeight() {
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRrInsets provides RrInsets(top = 0.dp, bottom = 0.dp), LocalRrDesignTags provides true) {
                    Column {
                        RrLargeTitleHeader("Empty", rememberRrLargeTitleState(), subtitle = "Empty subtitle")
                        RrLargeTitleHeader("Actions", rememberRrLargeTitleState(), subtitle = "Actions subtitle", actions = {
                            RrIconButton(R.drawable.ic_ph_plus, "Add", {})
                        })
                    }
                }
            }
        }
        val empty = rule.onNode(SemanticsMatcher("Empty line box") { it.config.getOrNull(DesignTagKey)?.text == "Empty" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        val emptySubtitle = rule.onNode(SemanticsMatcher("Empty subtitle line box") { it.config.getOrNull(DesignTagKey)?.text == "Empty subtitle" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        val actions = rule.onNode(SemanticsMatcher("Actions line box") { it.config.getOrNull(DesignTagKey)?.text == "Actions" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        val actionsSubtitle = rule.onNode(SemanticsMatcher("Actions subtitle line box") { it.config.getOrNull(DesignTagKey)?.text == "Actions subtitle" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertEquals(40.dp, empty.bottom - empty.top)
        assertEquals(0.dp, emptySubtitle.top - empty.bottom)
        assertEquals(3.dp, actionsSubtitle.top - actions.bottom)
    }

    @Test fun collapsingKeepsTheBottomSlotsCallerOwnedSideMargins() {
        lateinit var state: RrLargeTitleState
        rule.setContent {
            RrTheme(reducedMotion = true) {
                state = rememberRrLargeTitleState()
                RrLargeTitleHeader("Applications", state, bottom = {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
                        Box(Modifier.fillMaxWidth().height(32.dp).testTag("bottom-slot"))
                    }
                })
            }
        }
        val expanded = rule.onNodeWithTag("bottom-slot").getUnclippedBoundsInRoot()
        assertEquals(24.dp, expanded.left)
        assertEquals(342.dp, expanded.right - expanded.left)
        rule.runOnIdle { state.onScrolled(Float.MAX_VALUE) }
        val collapsed = rule.onNodeWithTag("bottom-slot").getUnclippedBoundsInRoot()
        assertEquals(expanded.left, collapsed.left)
        assertEquals(expanded.right, collapsed.right)
    }
}
