package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RrStagePageMarksTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun expandedNeighbourTargetsPickTheNearestVisibleMark() {
        var picked = -1
        rule.setContent {
            RrTheme {
                Box(Modifier.padding(24.dp)) { RrStagePageMarks(6, 1, { picked = it }) }
            }
        }
        rule.onNodeWithContentDescription("Page 2 of 6").assertIsSelected()
        // Both taps sit outside the 4 dp mark, inside its expanded target; adjacent marks still arbitrate correctly.
        rule.onRoot().performTouchInput { click(Offset(55.dp.toPx(), 38.dp.toPx())) }
        rule.runOnIdle { assertEquals(1, picked) }
        rule.onRoot().performTouchInput { click(Offset(76.dp.toPx(), 38.dp.toPx())) }
        rule.runOnIdle { assertEquals(2, picked) }
    }
}
