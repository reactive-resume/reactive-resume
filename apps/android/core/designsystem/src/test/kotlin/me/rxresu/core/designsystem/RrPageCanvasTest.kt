package me.rxresu.core.designsystem

import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RrPageCanvasTest {
    @get:Rule val rule = createComposeRule()

    // A Galaxy S24 crashed with "AnimationVector cannot contain a NaN" when a pinch settled.
    @Test fun pinchSettlesToFiniteZoomEvenFromANonFinitePan() {
        val zoom = RrPageZoomState()
        rule.setContent {
            RrTheme { RrPageCanvas(emptyList(), onTap = { _, _, _ -> }, Modifier.testTag("canvas"), pageCount = 1, zoom = zoom) }
        }
        runBlocking { zoom.x.snapTo(Float.NaN); zoom.y.snapTo(Float.NaN) }
        rule.onNodeWithTag("canvas").performTouchInput {
            down(0, center)
            down(1, center + Offset(40f, 0f))
            moveBy(1, Offset(120f, 0f))
            up(1)
            moveBy(0, Offset(20f, 0f))
            up(0)
        }
        rule.waitForIdle()
        listOf(zoom.scale.value, zoom.x.value, zoom.y.value).forEach { assertTrue("$it", it.isFinite()) }
    }
}
