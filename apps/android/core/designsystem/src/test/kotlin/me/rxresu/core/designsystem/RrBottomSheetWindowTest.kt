package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-mdpi")
class RrBottomSheetWindowTest {
    @get:Rule val rule = createComposeRule()

    @Test fun fixedStoryboardHeightIncludesBottomSafeAreaAndCanExceedAdaptiveCap() {
        rule.setContent {
            CompositionLocalProvider(LocalRrInsets provides StoryboardInsets, LocalRrDesignTags provides true) {
                RrTheme(reducedMotion = true) {
                    Box(Modifier.size(390.dp, 844.dp)) {
                        RrBottomSheet(onDismissRequest = {}, title = "Document menu", fixedHeight = 790.dp, footer = { RrText("Footer") }) { RrText("Details") }
                    }
                }
            }
        }
        val sheet = rule.onNode(SemanticsMatcher("BottomSheet") { it.config.getOrNull(DesignTagKey)?.component == "BottomSheet" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertEquals(790f, (sheet.bottom - sheet.top).value, 0.5f)
        assertEquals(54f, sheet.top.value, 0.5f)
        val footer = rule.onNode(SemanticsMatcher("Footer line box") { it.config.getOrNull(DesignTagKey)?.text == "Footer" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertEquals(810f, footer.bottom.value, 0.5f)
    }

    // A Galaxy S24 crashed with "Size(1440 x 2147483647) is out of range" opening the month picker from an entry's
    // scrolling fields: the sheet took its parent's unbounded height.
    @Test fun aSheetOpenedInsideScrollingContentGetsItsOwnWindow() {
        rule.setContent {
            RrTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    RrText("Start")
                    RrBottomSheet(onDismissRequest = {}, fitContent = true, title = "Month") { RrText("July") }
                }
            }
        }
        rule.onNodeWithText("July").assertIsDisplayed()
    }
}
