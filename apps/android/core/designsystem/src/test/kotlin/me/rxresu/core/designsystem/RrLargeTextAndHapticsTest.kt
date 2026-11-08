package me.rxresu.core.designsystem

import android.content.Context
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Counts the haptics a component plays (`performHapticFeedback` is all [rrHaptic] calls). */
private class HapticCounter(context: Context) : View(context) {
    var count = 0
    override fun performHapticFeedback(feedbackConstant: Int): Boolean { count++; return true }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE) // real text widths
class RrLargeTextAndHapticsTest {
    @get:Rule val rule = createComposeRule()

    private val views = listOf("List", "Board", "Calendar", "Insights")

    @Composable
    private fun Scaled(fontScale: Float, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale), content = content)
    }

    @Test fun segmentPlaysOneSelectionPerChangeAndNoneOnReselectOrWhenOff() {
        val counter = HapticCounter(ApplicationProvider.getApplicationContext())
        var enabled by mutableIntStateOf(1)
        rule.setContent {
            RrTheme(hapticsEnabled = enabled == 1) {
                CompositionLocalProvider(LocalView provides counter) {
                    var selected by remember { mutableIntStateOf(0) }
                    RrSegmentedControl(views.map { RrSegment(it) }, selected, { selected = it })
                }
            }
        }
        rule.onNodeWithText("Board").performClick()
        assertEquals(1, counter.count)
        rule.onNodeWithText("Board").performClick()
        assertEquals(1, counter.count)
        enabled = 0
        rule.onNodeWithText("Calendar").performClick()
        assertEquals(1, counter.count)
    }

    @Test fun disabledSegmentsIgnoreTaps() {
        val counter = HapticCounter(ApplicationProvider.getApplicationContext())
        var picked = -1
        rule.setContent {
            RrTheme { CompositionLocalProvider(LocalView provides counter) { RrSegmentedControl(views.map { RrSegment(it) }, 0, { picked = it }, enabled = false) } }
        }
        rule.onNodeWithText("Board").performClick()
        assertEquals(-1, picked)
        assertEquals(0, counter.count)
    }

    @Test fun oversizedSegmentsWrapSoEveryViewStaysWholeAt200Percent() {
        var picked = -1
        rule.setContent {
            RrTheme {
                Scaled(2f) {
                    Box(Modifier.width(358.dp).testTag("track")) {
                        RrSegmentedControl(views.map { RrSegment(it, R.drawable.ic_ph_list) }, 0, { picked = it })
                    }
                }
            }
        }
        val track = rule.onNodeWithTag("track").getUnclippedBoundsInRoot()
        val list = rule.onNodeWithText("List").getUnclippedBoundsInRoot()
        val insights = rule.onNodeWithText("Insights").getUnclippedBoundsInRoot()
        assertTrue("Insights ends at ${insights.right}, track at ${track.right}", insights.right <= track.right)
        assertTrue("Insights wraps under List", insights.top >= list.bottom)
        rule.onNodeWithText("Insights").performClick()
        assertEquals(3, picked)
    }

    @Test fun wideTrailingValueMovesUnderTheWordsAtLargeFontScale() {
        rule.setContent {
            RrTheme {
                Scaled(2f) {
                    Box(Modifier.width(358.dp)) {
                        RrListRow("Lumen", subtitle = "Senior product designer", trailing = { RrText("Applied 2 days ago", Modifier.testTag("time")) })
                    }
                }
            }
        }
        val subtitle = rule.onNodeWithText("Senior product designer").getUnclippedBoundsInRoot()
        val time = rule.onNodeWithTag("time").getUnclippedBoundsInRoot()
        assertTrue("trailing at ${time.top} should sit under the words ending at ${subtitle.bottom}", time.top >= subtitle.bottom)
    }

    @Test fun trailingStaysBesideTheWordsAtNormalScale() {
        rule.setContent {
            RrTheme {
                Box(Modifier.width(358.dp)) {
                    RrListRow("Lumen", subtitle = "Senior product designer", trailing = { RrText("Applied 2 days ago", Modifier.testTag("time")) })
                }
            }
        }
        val subtitle = rule.onNodeWithText("Senior product designer").getUnclippedBoundsInRoot()
        val time = rule.onNodeWithTag("time").getUnclippedBoundsInRoot()
        assertTrue(time.top < subtitle.bottom)
        assertTrue(time.left >= subtitle.right)
    }
}
